import { promises as fs } from "node:fs";
import path from "node:path";
import type { TaskRecordMap } from "../types.js";
import type { PersistenceAdapter } from "./PersistenceAdapter.js";

interface FileAdapterOptions {
  indexFileName?: string;
  prettyPrint?: boolean;
}

export class FileAdapter implements PersistenceAdapter {
  private indexFileName: string;
  private prettyPrint: boolean;

  constructor(
    private baseDir: string,
    options: FileAdapterOptions = {}
  ) {
    this.indexFileName = options.indexFileName ?? "index.json";
    this.prettyPrint = options.prettyPrint ?? true;
  }

  private safeName(conversationId: string): string {
    return conversationId.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private filePath(conversationId: string): string {
    return path.join(this.baseDir, `${this.safeName(conversationId)}.json`);
  }

  private tempFilePath(conversationId: string): string {
    return path.join(this.baseDir, `${this.safeName(conversationId)}.json.tmp`);
  }

  private indexPath(): string {
    return path.join(this.baseDir, this.indexFileName);
  }

  private async ensureBaseDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  private async readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJsonAtomic(filePath: string, tempPath: string, data: unknown): Promise<void> {
    const json = this.prettyPrint
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);

    await fs.writeFile(tempPath, json, "utf-8");
    await fs.rename(tempPath, filePath);
  }

  private async updateIndex(conversationId: string, remove = false): Promise<void> {
    await this.ensureBaseDir();

    const index = await this.readJsonFile<string[]>(this.indexPath(), []);
    const next = new Set(index);

    if (remove) {
      next.delete(conversationId);
    } else {
      next.add(conversationId);
    }

    const tempIndexPath = `${this.indexPath()}.tmp`;
    await this.writeJsonAtomic(this.indexPath(), tempIndexPath, Array.from(next).sort());
  }

  async loadConversation(conversationId: string): Promise<TaskRecordMap> {
    await this.ensureBaseDir();

    const filePath = this.filePath(conversationId);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as TaskRecordMap;

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      return parsed;
    } catch {
      return {};
    }
  }

  async saveConversation(conversationId: string, tasks: TaskRecordMap): Promise<void> {
    await this.ensureBaseDir();

    const filePath = this.filePath(conversationId);
    const tempPath = this.tempFilePath(conversationId);

    await this.writeJsonAtomic(filePath, tempPath, tasks);
    await this.updateIndex(conversationId, false);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.ensureBaseDir();

    try {
      await fs.unlink(this.filePath(conversationId));
    } catch {}

    try {
      await fs.unlink(this.tempFilePath(conversationId));
    } catch {}

    await this.updateIndex(conversationId, true);
  }

  async listConversations(): Promise<string[]> {
    await this.ensureBaseDir();
    return this.readJsonFile<string[]>(this.indexPath(), []);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureBaseDir();

      const probeFile = path.join(this.baseDir, ".healthcheck.tmp");
      await fs.writeFile(probeFile, "ok", "utf-8");
      await fs.unlink(probeFile);

      return true;
    } catch {
      return false;
    }
  }

  async rebuildIndex(): Promise<number> {
    await this.ensureBaseDir();

    const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
    const conversations = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".json") &&
          entry.name !== this.indexFileName
      )
      .map((entry) => entry.name.replace(/\.json$/, ""))
      .sort();

    await this.writeJsonAtomic(
      this.indexPath(),
      `${this.indexPath()}.tmp`,
      conversations
    );

    return conversations.length;
  }
}

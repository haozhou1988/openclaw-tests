import { promises as fs } from "node:fs";
import path from "node:path";
import type { FeishuPinnedCardRecordMap } from "../types.js";
import type { FeishuPinnedCardPersistenceAdapter } from "./FeishuPinnedCardPersistenceAdapter.js";

export class FileFeishuPinnedCardAdapter implements FeishuPinnedCardPersistenceAdapter {
  private filePath: string;

  constructor(
    private baseDir: string,
    options: { fileName?: string } = {}
  ) {
    this.filePath = path.join(baseDir, options.fileName ?? "feishu-pinned-cards.json");
  }

  private async ensureBaseDir(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async loadAll(): Promise<FeishuPinnedCardRecordMap> {
    await this.ensureBaseDir();
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as FeishuPinnedCardRecordMap;
    } catch {
      return {};
    }
  }

  async saveAll(records: FeishuPinnedCardRecordMap): Promise<void> {
    await this.ensureBaseDir();
    const temp = `${this.filePath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(records, null, 2), "utf-8");
    await fs.rename(temp, this.filePath);
  }

  async loadConversation(conversationId: string): Promise<FeishuPinnedCardRecordMap> {
    const all = await this.loadAll();
    return Object.fromEntries(
      Object.entries(all).filter(([, record]) => record.conversationId === conversationId)
    );
  }

  async saveConversation(conversationId: string, records: FeishuPinnedCardRecordMap): Promise<void> {
    const existing = await this.loadAll();
    const retained = Object.fromEntries(
      Object.entries(existing).filter(([, record]) => record.conversationId !== conversationId)
    );
    const merged = { ...retained, ...records };
    await this.saveAll(merged);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const existing = await this.loadAll();
    const retained = Object.fromEntries(
      Object.entries(existing).filter(([, record]) => record.conversationId !== conversationId)
    );
    await this.saveAll(retained);
  }

  async listConversations(): Promise<string[]> {
    const all = await this.loadAll();
    return Array.from(new Set(Object.values(all).map((record) => record.conversationId))).sort();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureBaseDir();
      return true;
    } catch {
      return false;
    }
  }
}

import type { TaskState } from "../render/ProgressRenderer.js";

export interface TaskNode {
  task: TaskState;
  children: TaskNode[];
}

export class TaskTreeManager {
  buildTree(tasks: TaskState[]): TaskNode[] {
    const nodeMap = new Map<string, TaskNode>();
    const roots: TaskNode[] = [];

    for (const task of tasks) {
      nodeMap.set(task.taskId, { task, children: [] });
    }

    for (const task of tasks) {
      const node = nodeMap.get(task.taskId)!;
      if (task.parentTaskId && nodeMap.has(task.parentTaskId)) {
        nodeMap.get(task.parentTaskId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  getChildren(tasks: TaskState[], parentTaskId: string): TaskState[] {
    return tasks.filter((t) => t.parentTaskId === parentTaskId);
  }

  getDescendants(tasks: TaskState[], parentTaskId: string): TaskState[] {
    const result: TaskState[] = [];
    const visit = (pid: string) => {
      const children = this.getChildren(tasks, pid);
      for (const child of children) {
        result.push(child);
        visit(child.taskId);
      }
    };
    visit(parentTaskId);
    return result;
  }

  summarizeParent(task: TaskState, children: TaskState[]): string {
    const total = children.length;
    const done = children.filter((c) => c.status === "done").length;
    const running = children.filter((c) => c.status === "running").length;
    const blocked = children.filter((c) => c.status === "blocked").length;

    return `任务 ${task.taskId} 有 ${total} 个子任务：完成 ${done}，运行中 ${running}，阻塞 ${blocked}。`;
  }

  findSubtree(tasks: TaskState[], rootTaskId: string): TaskNode | undefined {
    const roots = this.buildTree(tasks);

    const visit = (node: TaskNode): TaskNode | undefined => {
      if (node.task.taskId === rootTaskId) return node;
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
      return undefined;
    };

    for (const root of roots) {
      const found = visit(root);
      if (found) return found;
    }

    return undefined;
  }

  renderTreeText(nodes: TaskNode[], indent = 0): string {
    const lines: string[] = [];

    for (const node of nodes) {
      const prefix = "  ".repeat(indent);
      const parts: string[] = [];
      parts.push(`${prefix}- ${node.task.taskId}`);
      if (node.task.stage) parts.push(`[${node.task.stage}]`);
      parts.push(`[${node.task.status}]`);
      if (node.task.percent !== undefined) parts.push(`${node.task.percent}%`);
      parts.push(node.task.label);

      lines.push(parts.join(" "));
      if (node.children.length > 0) {
        lines.push(this.renderTreeText(node.children, indent + 1));
      }
    }

    return lines.join("\n");
  }
}

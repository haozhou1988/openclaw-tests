export interface PromptProgressTask {
  taskId: string;
  stage?: string;
  status?: string;
  percent?: number;
  label: string;
  updatedAt: number;
  trail?: string;
}

export function buildCompactPromptContext(tasks: PromptProgressTask[]): string {
  if (!tasks.length) return "";

  const lines: string[] = ["[Progress Context]"];

  for (const task of tasks) {
    const parts: string[] = [];
    parts.push(`Task=${task.taskId}`);
    if (task.status) parts.push(`Status=${task.status}`);
    if (task.stage) parts.push(`Stage=${task.stage}`);
    if (task.percent !== undefined) parts.push(`Percent=${task.percent}`);
    parts.push(`Label=${task.label}`);
    if (task.trail) parts.push(`Trail=${task.trail}`);

    lines.push(`- ${parts.join(" | ")}`);
  }

  return lines.join("\n");
}

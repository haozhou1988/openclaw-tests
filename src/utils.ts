export function normalizePercent(percent?: number): number | undefined {
  if (percent === undefined || percent === null || Number.isNaN(percent)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export function inferPercentFromStage(
  stage?: string,
  defaultStages: string[] = ["start", "research", "draft", "done"]
): number | undefined {
  if (!stage) return undefined;
  const index = defaultStages.indexOf(stage);
  if (index === -1) return undefined;
  if (defaultStages.length === 1) return 100;
  return Math.round((index / (defaultStages.length - 1)) * 100);
}

export function progressBar(percent: number): string {
  const safe = Math.max(0, Math.min(100, Math.round(percent)));
  const width = 10;

  if (safe >= 100) {
    return `[${"=".repeat(width)}]`;
  }

  const filled = Math.min(width - 1, Math.floor((safe / 100) * width));
  return `[${"=".repeat(filled)}>${"-".repeat(width - filled - 1)}]`;
}

export function pickConversationId(context: any): string {
  return (
    context?.conversation?.id ||
    context?.session?.conversationId ||
    context?.session?.id ||
    "default"
  );
}

export function pickModelName(
  context: any,
  explicitModel?: string
): string | undefined {
  if (explicitModel) return explicitModel;
  if (context?.session?.model?.name) return context.session.model.name;
  if (context?.session?.model?.primary) return context.session.model.primary;
  return undefined;
}

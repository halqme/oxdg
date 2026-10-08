import type { DependencyExplanation } from "../types/analysis.ts";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Render only lines containing the detected imports; no surrounding source context. */
export function renderExplanations(
  explanations: readonly DependencyExplanation[],
  json = false,
): string {
  const sorted = [...explanations].sort(
    (left, right) =>
      compareStrings(left.from, right.from) ||
      compareStrings(left.to ?? "", right.to ?? "") ||
      compareStrings(left.source, right.source) ||
      left.line - right.line ||
      compareStrings(left.specifier, right.specifier),
  );
  if (json) return `${JSON.stringify(sorted, null, 2)}\n`;

  const lines: string[] = [];
  let previous: string | undefined;
  for (const item of sorted) {
    const group = `${item.from} -> ${item.to ?? "?"}`;
    if (group !== previous) {
      if (lines.length > 0) lines.push("");
      lines.push(group);
      previous = group;
    }
    lines.push(`  ${item.source}:${item.line}: ${item.code}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

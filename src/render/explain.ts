import type { DependencyExplanation } from "../types/analysis.ts";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Render only root-relative source locations, without code or column offsets. */
export function renderExplanations(
  explanations: readonly DependencyExplanation[],
  json = false,
): string {
  const sorted = [...explanations].sort(
    (left, right) =>
      compareStrings(left.from, right.from) ||
      compareStrings(left.to ?? "", right.to ?? "") ||
      compareStrings(left.source, right.source) ||
      left.line - right.line,
  );
  // Several imports on one source line establish the same edge just once.
  const locations = sorted
    .filter(
      (item, index) =>
        index === 0 ||
        item.from !== sorted[index - 1]?.from ||
        item.to !== sorted[index - 1]?.to ||
        item.source !== sorted[index - 1]?.source ||
        item.line !== sorted[index - 1]?.line,
    )
    .map(({ from, to, source, line }) => ({
      from,
      ...(to === undefined ? {} : { to }),
      source,
      line,
    }));

  if (json) return `${JSON.stringify(locations, null, 2)}\n`;

  const lines: string[] = [];
  let previous: string | undefined;
  for (const item of locations) {
    const group = `${item.from} -> ${item.to ?? "?"}`;
    if (group !== previous) {
      if (lines.length > 0) lines.push("");
      lines.push(group);
      previous = group;
    }
    lines.push(`  ${item.source}:${item.line}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

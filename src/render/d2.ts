import { classifyNodes, NODE_STYLES } from "./node-styles.ts";
import type { ModuleGraph } from "../types.ts";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function renderD2(graph: ModuleGraph): string {
  const nodes = [...graph.nodes.keys()].sort(compareStrings);
  const ids = new Map(nodes.map((module, index) => [module, `n${index}`]));
  const nodeCategories = classifyNodes(graph);
  const lines = nodes.flatMap((module) => {
    const nodeId = ids.get(module) ?? "";
    const colors = NODE_STYLES[nodeCategories.get(module) ?? "normal"];
    return [
      `${nodeId}: ${JSON.stringify(module)}`,
      `${nodeId}.style.fill: "#ffffff"`,
      `${nodeId}.style.stroke: "${colors.stroke}"`,
      `${nodeId}.style.font-color: "${colors.text}"`,
    ];
  });
  const edges: string[] = [];

  for (const edge of graph.edges) {
    if (edge.status !== "internal" || edge.to === undefined) {
      continue;
    }
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (from && to) {
      edges.push(`${from} -> ${to}`);
    }
  }

  return [...lines, ...(lines.length > 0 && edges.length > 0 ? [""] : []), ...edges].join("\n");
}

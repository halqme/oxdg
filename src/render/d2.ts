import { classifyGraph, EDGE_COLORS, isCycleEdge, NODE_STYLES } from "./node-styles.ts";
import type { ModuleGraph } from "../types.ts";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function renderD2(graph: ModuleGraph): string {
  const nodes = [...graph.nodes.keys()].sort(compareStrings);
  const ids = new Map(nodes.map((module, index) => [module, `n${index}`]));
  const graphStyles = classifyGraph(graph);
  const nodeCategories = graphStyles.nodeCategories;
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
      const stroke = isCycleEdge(graphStyles, edge.from, edge.to)
        ? EDGE_COLORS.cyclic
        : EDGE_COLORS.normal;
      edges.push(`${from} -> ${to}: {\n  style.stroke: "${stroke}"\n}`);
    }
  }

  return [...lines, ...(lines.length > 0 && edges.length > 0 ? [""] : []), ...edges].join("\n");
}

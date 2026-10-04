import { classifyGraph, EDGE_COLORS, isCycleEdge, NODE_STYLES } from "./node-styles.ts";
import type { GraphDirection } from "../types/render.ts";
import type { ModuleGraph } from "../types/graph.ts";

export interface MermaidRenderOptions {
  direction?: GraphDirection;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeLabel(label: string): string {
  return label
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "&#10;");
}

export function renderMermaid(graph: ModuleGraph, options: MermaidRenderOptions = {}): string {
  const nodes = [...graph.nodes.keys()].sort(compareStrings);
  const ids = new Map(nodes.map((module, index) => [module, `n${index}`]));
  const graphStyles = classifyGraph(graph);
  const nodeCategories = graphStyles.nodeCategories;
  const lines = [
    `flowchart ${options.direction ?? "LR"}`,
    ...Object.entries(NODE_STYLES).map(
      ([category, colors]) =>
        `  classDef ${category} fill:#ffffff,stroke:${colors.stroke},color:${colors.text};`,
    ),
  ];

  for (const module of nodes) {
    const nodeId = ids.get(module);
    const category = nodeCategories.get(module);
    if (nodeId && category) {
      lines.push(`  ${nodeId}["${escapeLabel(module)}"]`);
      lines.push(`  class ${nodeId} ${category};`);
    }
  }

  let linkIndex = 0;
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
      lines.push(`  ${from} --> ${to}`);
      lines.push(`  linkStyle ${linkIndex} stroke:${stroke};`);
      linkIndex += 1;
    }
  }

  return lines.join("\n");
}

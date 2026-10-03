import { findCycles } from "../graph/cycles.ts";
import { findLeaves } from "../graph/queries.ts";
import type { ModuleGraph, ModuleId } from "../types.ts";

export const NODE_STYLES = {
  normal: { stroke: "#3b82f6", text: "#1d4ed8" },
  leaf: { stroke: "#22c55e", text: "#15803d" },
  cyclic: { stroke: "#ef4444", text: "#b91c1c" },
} as const;

export type NodeCategory = keyof typeof NODE_STYLES;

export function classifyNodes(graph: ModuleGraph): ReadonlyMap<ModuleId, NodeCategory> {
  const cyclicModules = new Set(findCycles(graph).flatMap((cycle) => cycle.modules));
  const leafModules = new Set(findLeaves(graph));
  const categories = new Map<ModuleId, NodeCategory>();

  for (const module of graph.nodes.keys()) {
    categories.set(
      module,
      cyclicModules.has(module) ? "cyclic" : leafModules.has(module) ? "leaf" : "normal",
    );
  }

  return categories;
}

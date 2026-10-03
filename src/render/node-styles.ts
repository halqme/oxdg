import { findCycles } from "../graph/cycles.ts";
import { findLeaves } from "../graph/queries.ts";
import type { ModuleGraph, ModuleId } from "../types.ts";

export const NODE_STYLES = {
  normal: { stroke: "#3b82f6", text: "#1d4ed8" },
  leaf: { stroke: "#22c55e", text: "#15803d" },
  cyclic: { stroke: "#ef4444", text: "#b91c1c" },
} as const;

export const EDGE_COLORS = {
  normal: "#94a3b8",
  cyclic: "#ef4444",
} as const;

export type NodeCategory = keyof typeof NODE_STYLES;

export interface GraphStyleClassification {
  nodeCategories: ReadonlyMap<ModuleId, NodeCategory>;
  cyclicEdges: ReadonlyMap<ModuleId, ReadonlySet<ModuleId>>;
}

export function classifyGraph(graph: ModuleGraph): GraphStyleClassification {
  const cycles = findCycles(graph);
  const cyclicModules = new Set(cycles.flatMap((cycle) => cycle.modules));
  const mutableCyclicEdges = new Map<ModuleId, Set<ModuleId>>();

  for (const cycle of cycles) {
    for (let index = 0; index < cycle.modules.length; index += 1) {
      const from = cycle.modules[index];
      const to = cycle.modules[(index + 1) % cycle.modules.length];
      if (from === undefined || to === undefined) {
        continue;
      }
      const targets = mutableCyclicEdges.get(from) ?? new Set<ModuleId>();
      targets.add(to);
      mutableCyclicEdges.set(from, targets);
    }
  }

  const leafModules = new Set(findLeaves(graph));
  const nodeCategories = new Map<ModuleId, NodeCategory>();
  for (const module of graph.nodes.keys()) {
    nodeCategories.set(
      module,
      cyclicModules.has(module) ? "cyclic" : leafModules.has(module) ? "leaf" : "normal",
    );
  }

  const cyclicEdges = new Map<ModuleId, ReadonlySet<ModuleId>>(mutableCyclicEdges);
  return { nodeCategories, cyclicEdges };
}

export function isCycleEdge(
  classification: GraphStyleClassification,
  from: ModuleId,
  to: ModuleId,
): boolean {
  return classification.cyclicEdges.get(from)?.has(to) ?? false;
}

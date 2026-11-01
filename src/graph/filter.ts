import { findCycles } from "./cycles.ts";
import { createGraphBuilder } from "./graph.ts";
import type { ModuleGraph, ModuleId, ModuleNode } from "../types/graph.ts";

export type GraphFilter = (node: ModuleNode) => boolean;

export function filterGraph(graph: ModuleGraph, predicate: GraphFilter): ModuleGraph {
  const builder = createGraphBuilder(graph.rootDir);
  const included = new Set<string>();

  for (const node of graph.nodes.values()) {
    if (predicate(node)) {
      included.add(node.id);
      builder.addNode(node);
    }
  }

  for (const edge of graph.edges) {
    if (!included.has(edge.from)) {
      continue;
    }
    if (edge.status === "internal" && (edge.to === undefined || !included.has(edge.to))) {
      continue;
    }
    builder.addEdge(edge);
  }

  return builder.build();
}

export function cyclicSubgraph(graph: ModuleGraph): ModuleGraph {
  const cyclicModules = new Set(findCycles(graph).flatMap((cycle) => cycle.modules));
  const builder = createGraphBuilder(graph.rootDir);

  for (const [id, node] of graph.nodes) {
    if (cyclicModules.has(id)) {
      builder.addNode(node);
    }
  }

  for (const edge of graph.edges) {
    if (
      edge.status === "internal" &&
      edge.to !== undefined &&
      cyclicModules.has(edge.from) &&
      cyclicModules.has(edge.to)
    ) {
      builder.addEdge(edge);
    }
  }

  return builder.build();
}

export function reachableSubgraph(graph: ModuleGraph, moduleId: ModuleId): ModuleGraph {
  if (!graph.nodes.has(moduleId)) {
    return createGraphBuilder(graph.rootDir).build();
  }

  const adjacency = new Map<ModuleId, ModuleId[]>();
  for (const edge of graph.edges) {
    if (edge.status !== "internal" || edge.to === undefined) {
      continue;
    }
    const targets = adjacency.get(edge.from);
    if (targets === undefined) {
      adjacency.set(edge.from, [edge.to]);
    } else {
      targets.push(edge.to);
    }
  }

  const reachable = new Set<ModuleId>([moduleId]);
  const queue = [moduleId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    for (const next of adjacency.get(current) ?? []) {
      if (reachable.has(next)) {
        continue;
      }
      reachable.add(next);
      queue.push(next);
    }
  }

  return filterGraph(graph, (node) => reachable.has(node.id));
}

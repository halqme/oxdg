import type { Cycle } from "../graph/cycles.ts";
import type { ModuleGraph } from "../types/graph.ts";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function npmPackageName(moduleId: string): string | undefined {
  const segments = moduleId.split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex === -1) {
    return undefined;
  }

  const packageIndex = nodeModulesIndex + 1;
  const packageSegment = segments[packageIndex];
  if (packageSegment === undefined) {
    return undefined;
  }

  if (packageSegment.startsWith("@")) {
    const scopedPackage = segments[packageIndex + 1];
    return scopedPackage === undefined ? undefined : `${packageSegment}/${scopedPackage}`;
  }

  return packageSegment;
}

function displayTarget(from: string, target: string): string {
  const targetPackage = npmPackageName(target);
  return targetPackage !== undefined && targetPackage !== npmPackageName(from)
    ? `npm:${targetPackage}`
    : target;
}

export function renderText(graph: ModuleGraph): string {
  const edgesByModule = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.status !== "internal" || edge.to === undefined) {
      continue;
    }
    const targets = edgesByModule.get(edge.from) ?? new Set<string>();
    targets.add(edge.to);
    edgesByModule.set(edge.from, targets);
  }

  const blocks = [...graph.nodes.keys()].sort(compareStrings).map((module) => {
    const lines = [module];
    const targets = [
      ...new Set(
        [...(edgesByModule.get(module) ?? [])].map((target) => displayTarget(module, target)),
      ),
    ].sort(compareStrings);
    lines.push(...targets.map((target) => `  -> ${target}`));
    return lines.join("\n");
  });

  return blocks.join("\n\n");
}

export function renderCycles(cycles: readonly Cycle[]): string {
  if (cycles.length === 0) {
    return "No circular dependencies found.";
  }

  return cycles
    .map((cycle) => {
      const first = cycle.modules[0];
      return first === undefined ? "" : `${[...cycle.modules, first].join(" -> ")}`;
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

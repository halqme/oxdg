import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  analyze,
  cyclicSubgraph,
  findCycles,
  findDirectDependencies,
  findDirectDependents,
  findLeaves,
  findOrphans,
} from "../../src/index.ts";
import type { AnalyzeOptions, ModuleGraph } from "../../src/index.ts";
import caseData from "./cases.json" with { type: "json" };

export interface CompatCase {
  id: string;
  source: string;
  line: number;
  title: string;
  disposition: string;
  baseline?: string;
  difference?: string;
  reason?: string;
  scope?: string;
  cwd?: string;
  input?: string | string[];
  operation?: string;
  expected?: unknown;
  options?: AnalyzeOptions;
  setup?: string;
  module?: string;
  command?: string;
}

export const cases: readonly CompatCase[] = caseData;
export const upstreamRoot = fileURLToPath(new URL("./upstream/", import.meta.url));

export function adjacency(graph: ModuleGraph): Record<string, readonly string[]> {
  return Object.fromEntries(
    [...graph.nodes.keys()].sort().map((id) => [id, findDirectDependencies(graph, id)]),
  );
}

export interface Comparison {
  id: string;
  title: string;
  source: string;
  status: "match" | "difference" | "unsupported" | "error";
  reason?: string;
  scope?: string;
  expected?: unknown;
  actual?: unknown;
  warnings?: unknown;
}

export async function compareCase(entry: CompatCase): Promise<Comparison> {
  const base = {
    id: entry.id,
    title: entry.title,
    source: `${entry.source}:${entry.line}`,
    ...(entry.scope ? { scope: entry.scope } : {}),
  };
  if (entry.disposition === "unsupported") {
    return { ...base, status: "unsupported", reason: entry.reason ?? "No adapter" };
  }
  let temporary: string | undefined;
  try {
    if (entry.cwd === undefined || entry.input === undefined) {
      throw new Error("Comparison is missing its input or root");
    }
    let cwd = join(upstreamRoot, "test", entry.cwd);
    if (entry.setup === "git-directory") {
      temporary = await mkdtemp(join(tmpdir(), "oxdg-madge-compat-"));
      await cp(cwd, temporary, { recursive: true });
      await rename(join(temporary, ".git_tmp"), join(temporary, ".git"));
      cwd = temporary;
    }
    const pending = analyze(entry.input, { ...entry.options, cwd });
    if (entry.operation === "missing") {
      try {
        await pending;
        return { ...base, status: "difference", expected: entry.expected, actual: "resolved" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ...base,
          status: message.includes(String(entry.expected)) ? "match" : "difference",
          expected: entry.expected,
          actual: message,
        };
      }
    }
    const isPromise = pending instanceof Promise;
    const { graph, warnings } = await pending;
    let actual: unknown;
    switch (entry.operation) {
      case "promise":
        actual = isPromise;
        break;
      case "graph":
        actual = adjacency(graph);
        break;
      case "cycles":
        actual = findCycles(graph).map((cycle) => cycle.modules);
        break;
      case "cyclicGraph":
        actual = adjacency(cyclicSubgraph(graph));
        break;
      case "dependents":
        actual = findDirectDependents(graph, entry.module ?? "");
        break;
      case "orphans":
        actual = findOrphans(graph);
        break;
      case "leaves":
        actual = findLeaves(graph);
        break;
      case "warnings":
        actual = { graph: adjacency(graph), warnings };
        break;
      default:
        throw new Error(`Unknown operation: ${entry.operation}`);
    }
    return {
      ...base,
      status: isDeepStrictEqual(actual, entry.expected) ? "match" : "difference",
      expected: entry.expected,
      actual,
      warnings,
    };
  } catch (error) {
    return {
      ...base,
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

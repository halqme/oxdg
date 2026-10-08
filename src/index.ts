export { analyze } from "./analyzer/analyze.ts";
export { analyzePackages } from "./analyzer/packages.ts";

export { findCycles } from "./graph/cycles.ts";

export {
  findDirectDependencies,
  findDirectDependents,
  findLeaves,
  findOrphans,
} from "./graph/queries.ts";

export { filterGraph, cyclicSubgraph } from "./graph/filter.ts";

export { renderText } from "./render/text.ts";
export { renderJson } from "./render/json.ts";
export { renderMermaid } from "./render/mermaid.ts";
export { renderD2 } from "./render/d2.ts";
export { renderSvg } from "./render/svg.ts";

export type {
  AnalysisResult,
  AnalysisWarning,
  AnalysisWarningCode,
  AnalyzeInput,
  AnalyzeOptions,
  ExcludePattern,
} from "./types/analysis.ts";

export type {
  DependencyEdge,
  DependencyKind,
  DependencyStatus,
  ModuleGraph,
  ModuleId,
  ModuleNode,
} from "./types/graph.ts";

export type { GraphDirection } from "./types/render.ts";

export type { Cycle } from "./graph/cycles.ts";
export type { MermaidRenderOptions } from "./render/mermaid.ts";
export type { SvgRenderOptions } from "./render/svg.ts";

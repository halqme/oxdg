import type { ModuleGraph } from "./graph.ts";

/** A gitignore pattern relative to the analysis cwd. */
export type ExcludePattern = string;

export type AnalysisWarningCode =
  | "parse-error"
  | "unresolved-import"
  | "dynamic-specifier"
  | "unsupported-file";

export interface AnalysisWarning {
  code: AnalysisWarningCode;
  file: string;
  message: string;
}

export interface AnalysisResult {
  graph: ModuleGraph;
  warnings: readonly AnalysisWarning[];
}

export interface AnalyzeOptions {
  /** Base directory. Defaults to process.cwd(). */
  cwd?: string;

  /** Explicit tsconfig path. */
  tsconfig?: string;

  /** Analyze files inside node_modules. Default: false. */
  includeNpm?: boolean;

  /** Include type-only imports as graph edges. Default: true. */
  includeTypeImports?: boolean;

  /** Source file extensions. */
  extensions?: readonly string[];

  /** Gitignore patterns relative to cwd for excluded modules, evaluated in order. */
  exclude?: ExcludePattern | readonly ExcludePattern[];
}

export type AnalyzeInput = string | readonly string[];

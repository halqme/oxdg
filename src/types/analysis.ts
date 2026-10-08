import type { DependencyKind, ModuleGraph } from "./graph.ts";

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

/** A source-level reason for a graph edge, captured only with explain enabled. */
export interface DependencyExplanation {
  from: string;
  to?: string;
  /** Root-relative path of the importing source file. */
  source: string;
  /** 1-based location of the import or re-export. */
  line: number;
  specifier: string;
  kind: DependencyKind;
  typeOnly: boolean;
}

export interface AnalysisResult {
  graph: ModuleGraph;
  warnings: readonly AnalysisWarning[];
  explanations?: readonly DependencyExplanation[];
}

export interface AnalyzeOptions {
  /** Collect source-line evidence for explanations. Default: false. */
  explain?: boolean;

  /** Base directory. Defaults to process.cwd(). */
  cwd?: string;

  /** Explicit tsconfig path. */
  tsconfig?: string;

  /** Represent resolved npm dependencies as package-level graph nodes. Default: false. */
  includeNpm?: boolean;

  /** Include type-only imports as graph edges. Default: true. */
  includeTypeImports?: boolean;

  /** Source file extensions. */
  extensions?: readonly string[];

  /** Gitignore patterns relative to cwd for excluded modules, evaluated in order. */
  exclude?: ExcludePattern | readonly ExcludePattern[];
}

export type AnalyzeInput = string | readonly string[];

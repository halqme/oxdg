import type { AnalysisWarning } from "../types/analysis.ts";
import type { DependencyKind } from "../types/graph.ts";

export interface ImportReference {
  specifier: string;
  kind: DependencyKind;
  typeOnly: boolean;
  /** Populated only when source locations are requested. */
  location?: { line: number };
}

export interface ImportExtractionResult {
  imports: readonly ImportReference[];
  warnings: readonly AnalysisWarning[];
}

export type ScriptLanguage = "js" | "jsx" | "ts" | "tsx";

export type ScriptExtractor = (
  source: string,
  filePath: string,
  language: ScriptLanguage,
  includeLocations?: boolean,
) => ImportExtractionResult;

export interface SourceExtractor {
  supports(filePath: string): boolean;

  extract(source: string, filePath: string, includeLocations?: boolean): ImportExtractionResult;
}

export interface SourceExtractorPlugin {
  /**
   * Lowercase extensions handled by the created extractor. Its `supports()` must
   * match this set exactly, regardless of path extension casing.
   */
  readonly extensions: readonly string[];

  create(extractScript: ScriptExtractor): SourceExtractor;
}

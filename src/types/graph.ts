export type ModuleId = string;

export type DependencyKind =
  | "import"
  | "dynamic-import"
  | "require"
  | "require-resolve"
  | "re-export";

export type DependencyStatus = "internal" | "external" | "unresolved";

export interface ModuleNode {
  id: ModuleId;
  absolutePath: string;
}

export interface DependencyEdge {
  from: ModuleId;

  /** Present only when status === "internal". */
  to?: ModuleId;

  /** Original source specifier. */
  specifier: string;

  kind: DependencyKind;
  typeOnly: boolean;
  status: DependencyStatus;
}

export interface ModuleGraph {
  /** Absolute working directory used as the graph root. */
  rootDir: string;

  nodes: ReadonlyMap<ModuleId, ModuleNode>;
  edges: readonly DependencyEdge[];
}

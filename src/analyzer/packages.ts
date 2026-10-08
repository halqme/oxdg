import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";
import { ResolverFactory } from "oxc-resolver";
import { parse } from "yaml";
import { analyze } from "./analyze.ts";
import { discoverFiles, DEFAULT_EXTENSIONS } from "./discover.ts";
import { createExcludeMatcher } from "./exclude.ts";
import { createGraphBuilder } from "../graph/graph.ts";
import type { AnalysisResult, AnalyzeInput, AnalyzeOptions } from "../types/analysis.ts";

interface WorkspacePackage {
  id: string;
  absolutePath: string;
}

async function optionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function contains(directory: string, path: string): boolean {
  const suffix = relative(directory, path);
  return (
    suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`))
  );
}

async function discoverPackages(
  root: string,
  excludedDirectories: string[],
): Promise<WorkspacePackage[]> {
  const manifestSource = await optionalFile(join(root, "package.json"));
  const manifest = manifestSource ? JSON.parse(manifestSource) : {};
  const yamlSource = await optionalFile(join(root, "pnpm-workspace.yaml"));
  const workspaces = manifest.workspaces;
  const patterns: unknown =
    yamlSource !== undefined
      ? parse(yamlSource)?.packages
      : Array.isArray(workspaces)
        ? workspaces
        : workspaces?.packages;
  if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === "string")) {
    throw new Error(`No valid workspace package patterns found in ${root}`);
  }
  const positives = patterns.filter((pattern: string) => !pattern.startsWith("!"));
  const negatives = patterns
    .filter((pattern: string) => pattern.startsWith("!"))
    .map((pattern: string) => pattern.slice(1));
  const packages: WorkspacePackage[] = [];
  async function visit(directory: string): Promise<void> {
    const path = relative(root, directory).split(sep).join("/") || ".";
    const matches = (pattern: string) =>
      matchesGlob(path, pattern.replace(/^\.\//, "").replace(/\/$/, ""));
    if (negatives.some(matches)) {
      excludedDirectories.push(await realpath(directory));
    }
    if (positives.some(matches) && !negatives.some(matches)) {
      const source = await optionalFile(join(directory, "package.json"));
      if (source) {
        const { name } = JSON.parse(source);
        if (typeof name !== "string" || !name)
          throw new Error(`Workspace package has no name: ${directory}`);
        packages.push({ id: name, absolutePath: await realpath(directory) });
      }
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
        await visit(join(directory, entry.name));
      }
    }
  }
  await visit(root);
  const names = new Set<string>();
  for (const pkg of packages) {
    if (names.has(pkg.id)) throw new Error(`Duplicate workspace package name: ${pkg.id}`);
    names.add(pkg.id);
  }
  return packages;
}

/** Aggregate actual source imports into workspace package nodes, not manifest dependencies. */
export async function analyzePackages(
  input: AnalyzeInput,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const inputs = typeof input === "string" ? [input] : input;
  const packages: WorkspacePackage[] = [];
  const excludedDirectories: string[] = [];
  for (const entry of inputs) {
    const path = await realpath(resolve(cwd, entry));
    const root = (await stat(path)).isDirectory() ? path : dirname(path);
    for (const pkg of await discoverPackages(root, excludedDirectories)) {
      const existing = packages.find((candidate) => candidate.id === pkg.id);
      if (existing && existing.absolutePath !== pkg.absolutePath)
        throw new Error(`Duplicate workspace package name: ${pkg.id}`);
      if (!existing) packages.push(pkg);
    }
  }
  const builder = createGraphBuilder(cwd);
  for (const pkg of packages) builder.addNode(pkg);
  const ownership = [...packages].sort((a, b) => b.absolutePath.length - a.absolutePath.length);
  const owner = (path: string) => ownership.find((pkg) => contains(pkg.absolutePath, path));
  const matchesExclude = createExcludeMatcher(options.exclude, await realpath(cwd));
  const isExcluded = (path: string) =>
    matchesExclude(path) || excludedDirectories.some((directory) => contains(directory, path));
  const files = await discoverFiles(
    packages.map((pkg) => pkg.absolutePath),
    {
      cwd,
      extensions: options.extensions ?? DEFAULT_EXTENSIONS,
      exclude: isExcluded,
    },
  );
  if (!files.length) return { graph: builder.build(), warnings: [] };
  const result = await analyze(files, options);
  const resolvedWarnings = new Set<string>();
  const esm = new ResolverFactory({
    builtinModules: true,
    extensions: [
      "",
      ...new Set(
        [...(options.extensions ?? DEFAULT_EXTENSIONS), ".json"].map((extension) =>
          extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
        ),
      ),
    ],
    conditionNames: ["node", "import"],
    symlinks: false,
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
      ".ts": [".ts", ".tsx"],
      ".mts": [".mts", ".mjs"],
      ".cts": [".cts", ".cjs"],
    },
    tsconfig: options.tsconfig
      ? { configFile: resolve(cwd, options.tsconfig), references: "auto" }
      : "auto",
  });
  const cjs = esm.cloneWithOptions({ conditionNames: ["node", "require"] });
  for (const edge of result.graph.edges) {
    const source = result.graph.nodes.get(edge.from);
    const from = source && owner(source.absolutePath);
    if (!from || isExcluded(source.absolutePath)) continue;
    const target = edge.to ? result.graph.nodes.get(edge.to) : undefined;
    if (target && isExcluded(target.absolutePath)) continue;
    let to = target && owner(target.absolutePath)?.id;
    if (!to && target?.id.startsWith("npm:") && options.includeNpm) {
      builder.addNode(target);
      to = target.id;
    }
    const factory = edge.kind === "require" || edge.kind === "require-resolve" ? cjs : esm;
    const original = !edge.to && factory.resolveFileSync(source.absolutePath, edge.specifier);
    if (!edge.to && original && !original.path && !original.builtin) {
      const pkg = packages.find(
        (candidate) =>
          edge.specifier === candidate.id || edge.specifier.startsWith(`${candidate.id}/`),
      );
      if (pkg) {
        // Package self-resolution honors exports without requiring node_modules links.
        let resolution = factory.resolveFileSync(
          join(pkg.absolutePath, "package.json"),
          edge.specifier,
        );
        if (!resolution.path) {
          const manifest = JSON.parse(
            await readFile(join(pkg.absolutePath, "package.json"), "utf8"),
          );
          if (manifest.exports === undefined) {
            const subpath = edge.specifier.slice(pkg.id.length);
            resolution = factory.resolveFileSync(source.absolutePath, pkg.absolutePath + subpath);
          }
        }
        if (resolution.path) {
          const path = await realpath(resolution.path);
          if (!isExcluded(path)) {
            to = owner(path)?.id;
            if (to)
              resolvedWarnings.add(`${source.absolutePath}\0${JSON.stringify(edge.specifier)}`);
          } else continue;
        }
      }
    }
    if (to === from.id) continue;
    builder.addEdge(
      to
        ? { ...edge, from: from.id, to, status: "internal" }
        : {
            from: from.id,
            specifier: edge.specifier,
            kind: edge.kind,
            typeOnly: edge.typeOnly,
            status: edge.status === "internal" ? "external" : edge.status,
          },
    );
  }
  return {
    graph: builder.build(),
    warnings: result.warnings.filter(
      (warning) =>
        !(warning.file && isExcluded(warning.file)) &&
        (warning.code !== "unresolved-import" ||
          ![...resolvedWarnings].some((key) => {
            const [file, specifier] = key.split("\0");
            return (
              warning.file === file &&
              warning.message.startsWith(`Unable to resolve ${specifier} from `)
            );
          })),
    ),
  };
}

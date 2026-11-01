import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ignore from "ignore";
import type { AnalyzeInput, ExcludePattern } from "../types/analysis.ts";

export type ExcludeMatcher = ((filePath: string) => boolean) & {
  /** Record a `.gitignore` found while reading a directory. */
  registerGitignore?: (directory: string, content: string) => void;
  /** Record that a directory listing contained no `.gitignore`. */
  registerNoGitignore?: (directory: string) => void;
};

interface GitignoreLayer {
  dir: string;
  ig: ReturnType<typeof ignore>;
}

type Ignore = ReturnType<typeof ignore>;

export interface ExcludeMatcherOptions {
  patterns?: ExcludePattern | readonly ExcludePattern[];
  rootDir: string;
  /** Load and apply `.gitignore` files under rootDir. Default: true. */
  gitignore?: boolean;
  /**
   * Absolute paths passed as analysis inputs. Gitignore rules that ignore these
   * roots do not exclude the roots themselves; ignored children are still skipped.
   */
  explicitRoots?: readonly string[];
}

export function isGitPath(filePath: string): boolean {
  return filePath.split(sep).includes(".git");
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isWithin(root: string, filePath: string): boolean {
  const relativePath = relative(root, filePath);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
  );
}

function findExplicitRoot(filePath: string, explicitRoots: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const root of explicitRoots) {
    if (!isWithin(root, filePath)) {
      continue;
    }
    if (best === undefined || root.length > best.length) {
      best = root;
    }
  }
  return best;
}

interface LayerDecision {
  ignored: boolean;
  unignored: boolean;
}

function emptyDecision(): LayerDecision {
  return { ignored: false, unignored: false };
}

/** Match a path, retrying with a trailing slash so `dir/` patterns apply to directories. */
function testIgnore(ig: Ignore, relativePath: string): LayerDecision {
  if (relativePath === "" || !ignore.isPathValid(relativePath)) {
    return emptyDecision();
  }
  const direct = ig.test(relativePath);
  if (direct.ignored || direct.unignored) {
    return direct;
  }
  if (relativePath.endsWith("/")) {
    return emptyDecision();
  }
  return ig.test(`${relativePath}/`);
}

function layerIgnoresPath(layer: GitignoreLayer, filePath: string): boolean {
  const relativePath = toPosix(relative(layer.dir, filePath));
  const decision = testIgnore(layer.ig, relativePath);
  return decision.ignored && !decision.unignored;
}

function applyLayerDecision(layer: GitignoreLayer, filePath: string, ignored: boolean): boolean {
  const relativePath = toPosix(relative(layer.dir, filePath));
  const decision = testIgnore(layer.ig, relativePath);
  if (decision.unignored) {
    return false;
  }
  if (decision.ignored) {
    return true;
  }
  return ignored;
}

function applyLayersToPath(
  partialPath: string,
  layers: readonly GitignoreLayer[],
  explicitRoot: string | undefined,
): boolean {
  let ignored = false;

  for (const layer of layers) {
    if (!isWithin(layer.dir, partialPath)) {
      continue;
    }

    if (
      explicitRoot !== undefined &&
      isWithin(layer.dir, explicitRoot) &&
      layer.dir !== explicitRoot
    ) {
      // Ancestor .gitignore outside the explicit root.
      if (layerIgnoresPath(layer, explicitRoot)) {
        // Rules that ignore the explicit root do not cascade into it.
        // Basename-style patterns still apply via the path under the root.
        const suffix = toPosix(relative(explicitRoot, partialPath));
        const decision = testIgnore(layer.ig, suffix);
        if (decision.unignored) {
          ignored = false;
        } else if (decision.ignored) {
          ignored = true;
        }
        continue;
      }
    }

    ignored = applyLayerDecision(layer, partialPath, ignored);
  }

  return ignored;
}

/**
 * Lazily load `.gitignore` files for ancestors of a path. Avoids a full-tree walk
 * so entrypoint analysis only pays for directories it actually touches.
 */
function insertLayer(layers: GitignoreLayer[], layer: GitignoreLayer): void {
  let index = layers.length;
  while (index > 0) {
    const previous = layers[index - 1]!;
    const order = previous.dir.length - layer.dir.length || compareStrings(previous.dir, layer.dir);
    if (order <= 0) {
      break;
    }
    index -= 1;
  }
  layers.splice(index, 0, layer);
}

function createLayerLoader(rootDir: string): {
  ensureAncestorsLoaded: (filePath: string) => void;
  registerGitignore: (directory: string, content: string) => void;
  registerNoGitignore: (directory: string) => void;
  layers: () => readonly GitignoreLayer[];
} {
  const seenDirs = new Set<string>();
  const layers: GitignoreLayer[] = [];

  function registerGitignore(directory: string, content: string): void {
    if (seenDirs.has(directory) || !isWithin(rootDir, directory)) {
      return;
    }
    seenDirs.add(directory);
    insertLayer(layers, { dir: directory, ig: ignore().add(content) });
  }

  function registerNoGitignore(directory: string): void {
    if (!isWithin(rootDir, directory)) {
      return;
    }
    seenDirs.add(directory);
  }

  function loadDir(directory: string): void {
    if (seenDirs.has(directory)) {
      return;
    }
    if (!isWithin(rootDir, directory)) {
      seenDirs.add(directory);
      return;
    }

    try {
      const content = readFileSync(join(directory, ".gitignore"), "utf8");
      registerGitignore(directory, content);
    } catch {
      // Missing or unreadable .gitignore — treat as no layer for this directory.
      registerNoGitignore(directory);
    }
  }

  function ensureAncestorsLoaded(filePath: string): void {
    if (!isWithin(rootDir, filePath)) {
      return;
    }

    loadDir(rootDir);

    const relativeFromRoot = relative(rootDir, filePath);
    if (relativeFromRoot === "") {
      return;
    }

    const parts = relativeFromRoot.split(sep);
    // Load parent directories only. A directory's own .gitignore applies to its
    // children, and is loaded when those children are checked.
    for (let index = 0; index < parts.length - 1; index += 1) {
      loadDir(join(rootDir, ...parts.slice(0, index + 1)));
    }
  }

  return {
    ensureAncestorsLoaded,
    registerGitignore,
    registerNoGitignore,
    layers: () => layers,
  };
}

function isIgnoredByGitignore(
  filePath: string,
  rootDir: string,
  layers: readonly GitignoreLayer[],
  explicitRoots: readonly string[],
  cache: Map<string, boolean>,
): boolean {
  const cached = cache.get(filePath);
  if (cached !== undefined) {
    return cached;
  }

  if (!isWithin(rootDir, filePath)) {
    cache.set(filePath, false);
    return false;
  }

  const explicitRoot = findExplicitRoot(filePath, explicitRoots);
  if (explicitRoot === filePath) {
    cache.set(filePath, false);
    return false;
  }

  const relativeFromRoot = relative(rootDir, filePath);
  if (relativeFromRoot === "") {
    cache.set(filePath, false);
    return false;
  }

  // If a cached ancestor directory is ignored, children are ignored. Git does not
  // allow re-including a path under an excluded parent.
  let ancestor = dirname(filePath);
  while (ancestor.startsWith(rootDir) && ancestor !== filePath) {
    const ancestorIgnored = cache.get(ancestor);
    if (ancestorIgnored === true) {
      cache.set(filePath, true);
      return true;
    }
    if (ancestorIgnored === false || ancestor === rootDir) {
      break;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      break;
    }
    ancestor = parent;
  }

  const parts = relativeFromRoot.split(sep);
  for (let index = 0; index < parts.length; index += 1) {
    const partialPath = join(rootDir, ...parts.slice(0, index + 1));
    const isFinal = index === parts.length - 1;

    const partialCached = cache.get(partialPath);
    if (partialCached === true) {
      cache.set(filePath, true);
      return true;
    }
    if (partialCached === false && !isFinal) {
      continue;
    }

    if (
      explicitRoot !== undefined &&
      isWithin(partialPath, explicitRoot) &&
      partialPath !== explicitRoot &&
      !isFinal
    ) {
      // Ancestors of an explicit root stay walkable even when ignored.
      cache.set(partialPath, false);
      continue;
    }

    if (explicitRoot !== undefined && partialPath === explicitRoot && !isFinal) {
      // The explicit root directory itself is force-included; still filter children.
      cache.set(partialPath, false);
      continue;
    }

    const ignored = applyLayersToPath(partialPath, layers, explicitRoot);
    cache.set(partialPath, ignored);
    if (ignored) {
      cache.set(filePath, true);
      return true;
    }
  }

  cache.set(filePath, false);
  return false;
}

export async function resolveExplicitRoots(input: AnalyzeInput, cwd: string): Promise<string[]> {
  const inputs = typeof input === "string" ? [input] : [...input];
  const roots: string[] = [];
  for (const entry of inputs) {
    const absolutePath = resolve(cwd, entry);
    try {
      roots.push(await realpath(absolutePath));
    } catch {
      roots.push(absolutePath);
    }
  }
  return roots;
}

export async function createExcludeMatcher(
  options: ExcludeMatcherOptions,
): Promise<ExcludeMatcher> {
  const patternList =
    typeof options.patterns === "string" ? [options.patterns] : [...(options.patterns ?? [])];
  const excludeIg = ignore().add(patternList);
  const useGitignore = options.gitignore !== false;
  const explicitRoots = options.explicitRoots ?? [];
  const loader = useGitignore ? createLayerLoader(options.rootDir) : undefined;
  const gitignoreCache = new Map<string, boolean>();
  const resultCache = new Map<string, boolean>();

  const matches = ((filePath: string): boolean => {
    const cached = resultCache.get(filePath);
    if (cached !== undefined) {
      return cached;
    }

    if (isGitPath(filePath)) {
      resultCache.set(filePath, true);
      return true;
    }

    const relativePath = toPosix(relative(options.rootDir, filePath));
    if (ignore.isPathValid(relativePath)) {
      const excluded =
        excludeIg.ignores(relativePath) ||
        (!relativePath.endsWith("/") && excludeIg.ignores(`${relativePath}/`));
      if (excluded) {
        resultCache.set(filePath, true);
        return true;
      }
    }

    if (!loader) {
      resultCache.set(filePath, false);
      return false;
    }

    loader.ensureAncestorsLoaded(filePath);
    const ignored = isIgnoredByGitignore(
      filePath,
      options.rootDir,
      loader.layers(),
      explicitRoots,
      gitignoreCache,
    );
    resultCache.set(filePath, ignored);
    return ignored;
  }) as ExcludeMatcher;

  if (loader) {
    matches.registerGitignore = loader.registerGitignore;
    matches.registerNoGitignore = loader.registerNoGitignore;
  }

  return matches;
}

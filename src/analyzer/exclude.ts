import { readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import ignore from "ignore";
import type { AnalyzeInput, ExcludePattern } from "../types/analysis.ts";

export type ExcludeMatcher = (filePath: string) => boolean;

interface GitignoreLayer {
  dir: string;
  ig: ReturnType<typeof ignore>;
}

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

async function loadGitignoreLayers(rootDir: string): Promise<GitignoreLayer[]> {
  const layers: GitignoreLayer[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => compareStrings(left.name, right.name));
    const subdirectories: string[] = [];

    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        subdirectories.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name === ".gitignore") {
        const content = await readFile(entryPath, "utf8");
        layers.push({ dir: directory, ig: ignore().add(content) });
      }
    }

    for (const subdirectory of subdirectories) {
      await walk(subdirectory);
    }
  }

  await walk(rootDir);
  layers.sort(
    (left, right) => left.dir.length - right.dir.length || compareStrings(left.dir, right.dir),
  );
  return layers;
}

function layerIgnoresPath(layer: GitignoreLayer, filePath: string): boolean {
  const relativePath = toPosix(relative(layer.dir, filePath));
  if (relativePath === "") {
    return false;
  }
  if (!ignore.isPathValid(relativePath)) {
    return false;
  }
  // Directory patterns like `dist/` match `dist/` but not bare `dist`.
  return layer.ig.ignores(relativePath) || layer.ig.ignores(`${relativePath}/`);
}

function applyLayerDecision(layer: GitignoreLayer, filePath: string, ignored: boolean): boolean {
  const relativePath = toPosix(relative(layer.dir, filePath));
  if (relativePath === "" || !ignore.isPathValid(relativePath)) {
    return ignored;
  }
  const result = layer.ig.test(relativePath);
  if (result.unignored) {
    return false;
  }
  if (result.ignored) {
    return true;
  }
  return ignored;
}

function isIgnoredByGitignore(
  filePath: string,
  rootDir: string,
  layers: readonly GitignoreLayer[],
  explicitRoots: readonly string[],
): boolean {
  if (!isWithin(rootDir, filePath)) {
    return false;
  }

  const explicitRoot = findExplicitRoot(filePath, explicitRoots);
  if (explicitRoot === filePath) {
    return false;
  }

  const relativeFromRoot = relative(rootDir, filePath);
  if (relativeFromRoot === "") {
    return false;
  }

  const parts = relativeFromRoot.split(sep);
  for (let index = 0; index < parts.length; index += 1) {
    const partialPath = join(rootDir, ...parts.slice(0, index + 1));
    const isFinal = index === parts.length - 1;

    if (
      explicitRoot !== undefined &&
      isWithin(partialPath, explicitRoot) &&
      partialPath !== explicitRoot &&
      !isFinal
    ) {
      // Ancestors of an explicit root stay walkable even when ignored.
      continue;
    }

    if (explicitRoot !== undefined && partialPath === explicitRoot && !isFinal) {
      // The explicit root directory itself is force-included; still filter children.
      continue;
    }

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
          if (suffix !== "" && ignore.isPathValid(suffix)) {
            const result = layer.ig.test(suffix);
            if (result.unignored) {
              ignored = false;
            } else if (result.ignored) {
              ignored = true;
            }
          }
          continue;
        }
      }

      ignored = applyLayerDecision(layer, partialPath, ignored);
    }

    if (ignored) {
      return true;
    }
  }

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
  const layers = useGitignore ? await loadGitignoreLayers(options.rootDir) : [];
  const explicitRoots = options.explicitRoots ?? [];

  return (filePath: string): boolean => {
    if (isGitPath(filePath)) {
      return true;
    }

    const relativePath = toPosix(relative(options.rootDir, filePath));
    if (ignore.isPathValid(relativePath) && excludeIg.ignores(relativePath)) {
      return true;
    }

    if (!useGitignore || layers.length === 0) {
      return false;
    }

    return isIgnoredByGitignore(filePath, options.rootDir, layers, explicitRoots);
  };
}

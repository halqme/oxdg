import { realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ResolverFactory } from "oxc-resolver";
import { DEFAULT_EXTENSIONS } from "./discover.ts";
import { isNodeModulesPath } from "./npm.ts";
import { isGitPath } from "./exclude.ts";
import type { AnalyzeOptions } from "../types/analysis.ts";
import type { DependencyKind } from "../types/graph.ts";

const JSON_EXTENSION = ".json";

export type ResolveResult =
  | { status: "internal"; absolutePath: string }
  | { status: "external" }
  | { status: "excluded" }
  | { status: "unresolved"; reason?: string };

export interface Resolver {
  resolve(specifier: string, importer: string, kind: DependencyKind): ResolveResult;
}

function normalizeExtensions(extensions: readonly string[]): string[] {
  const normalized = extensions.map((extension) =>
    extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
  );
  return ["", ...new Set(normalized)];
}

function isSupportedFile(filePath: string, extensions: ReadonlySet<string>): boolean {
  return extensions.has(extname(filePath).toLowerCase());
}

function isJsonFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === JSON_EXTENSION;
}

function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !isAbsolute(specifier) &&
    !specifier.startsWith("file:")
  );
}

function isWithinRoot(root: string, filePath: string): boolean {
  const path = relative(root, filePath);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function hasInstalledPackage(specifier: string, importer: string): boolean {
  const parts = specifier.split("/");
  const packageName = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  // Package presence does not depend on a working main, index, or exported subpath.
  const lookupPaths = createRequire(importer).resolve.paths(packageName) ?? [];
  return lookupPaths.some((lookupPath) => {
    try {
      // Follow workspace/package-manager symlinks to their package directories.
      return statSync(join(lookupPath, packageName)).isDirectory();
    } catch {
      return false;
    }
  });
}

function resolveFromRoot(
  factory: ResolverFactory,
  root: string,
  specifier: string,
  importer: string,
): string | undefined {
  if (
    specifier.length === 0 ||
    !isBareSpecifier(specifier) ||
    specifier.startsWith("#") ||
    /[\\:?#\0]/.test(specifier) ||
    !isWithinRoot(root, resolve(root, specifier)) ||
    hasInstalledPackage(specifier, importer)
  ) {
    return undefined;
  }
  const result = factory.sync(root, `./${specifier}`);
  if (!result.path || !isWithinRoot(root, resolve(result.path))) {
    return undefined;
  }
  try {
    // Directory mains and symlinks can escape even when the request stays inside cwd.
    return isWithinRoot(realpathSync(root), realpathSync(result.path)) ? result.path : undefined;
  } catch {
    return undefined;
  }
}

function createResolverOptions(
  options: AnalyzeOptions,
  extensions: readonly string[],
  conditionNames: readonly string[],
): NonNullable<ConstructorParameters<typeof ResolverFactory>[0]> {
  const tsconfig = options.tsconfig
    ? {
        configFile: resolve(options.cwd ?? process.cwd(), options.tsconfig),
        references: "auto" as const,
      }
    : ("auto" as const);

  return {
    builtinModules: true,
    conditionNames: [...conditionNames],
    extensions: normalizeExtensions(extensions),
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
    tsconfig,
  };
}

export function createResolver(options: AnalyzeOptions): Resolver {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const supportedExtensions = new Set(
    extensions.map((extension) =>
      extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
    ),
  );
  const esmFactory = new ResolverFactory(
    createResolverOptions(options, [...extensions, JSON_EXTENSION], ["node", "import"]),
  );
  const cjsFactory = esmFactory.cloneWithOptions(
    createResolverOptions(options, [...extensions, JSON_EXTENSION], ["node", "require"]),
  );
  const includeNpm = options.includeNpm ?? false;
  const root = resolve(options.cwd ?? process.cwd());

  return {
    resolve(specifier, importer, kind) {
      const isRequire = kind === "require" || kind === "require-resolve";
      const factory = isRequire ? cjsFactory : esmFactory;
      const result = factory.resolveFileSync(importer, specifier);

      if (result.builtin) {
        return { status: "external" };
      }

      const resolvedPath =
        result.path ??
        (result.error === `Cannot find module '${specifier}'`
          ? resolveFromRoot(factory, root, specifier, importer)
          : undefined);
      if (resolvedPath) {
        const absolutePath = resolve(resolvedPath);
        let canonicalPath: string;
        try {
          canonicalPath = realpathSync(absolutePath);
        } catch {
          return {
            status: "unresolved",
            reason: `resolved file no longer exists: ${absolutePath}`,
          };
        }
        if (isGitPath(absolutePath) || isGitPath(canonicalPath)) {
          return { status: "excluded" };
        }
        if (isNodeModulesPath(absolutePath)) {
          return includeNpm ? { status: "internal", absolutePath } : { status: "external" };
        }
        if (isJsonFile(absolutePath)) {
          return { status: "external" };
        }
        if (!isSupportedFile(absolutePath, supportedExtensions)) {
          return {
            status: "unresolved",
            reason: `resolved file has an unsupported extension: ${absolutePath}`,
          };
        }
        return { status: "internal", absolutePath };
      }

      if (!includeNpm && isBareSpecifier(specifier) && !specifier.startsWith("#")) {
        return { status: "external" };
      }

      return {
        status: "unresolved",
        ...(result.error ? { reason: result.error } : {}),
      };
    },
  };
}

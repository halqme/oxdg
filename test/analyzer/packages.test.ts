import { expect, test } from "bun:test";
import { analyzePackages } from "../../src/analyzer/packages.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

async function withWorkspace(files: Record<string, string>, run: (cwd: string) => Promise<void>) {
  const cwd = await createFixture(files);
  try {
    await run(cwd);
  } finally {
    await removeFixture(cwd);
  }
}

for (const workspaces of [
  ["packages/*", "!packages/ignored"],
  { packages: ["packages/*", "!packages/ignored"] },
]) {
  test(`workspace discovery and actual imports: ${JSON.stringify(workspaces)}`, async () => {
    await withWorkspace(
      {
        "package.json": JSON.stringify({ workspaces }),
        "packages/a/package.json": JSON.stringify({
          name: "@test/a",
          dependencies: { unused: "*" },
        }),
        "packages/a/index.ts": 'import "@test/b"; import "@test/b/sub"; import "./local";',
        "packages/a/local.ts": 'import "@test/b";',
        "packages/b/package.json": JSON.stringify({
          name: "@test/b",
          exports: { ".": "./index.ts", "./sub": "./sub.ts" },
        }),
        "packages/b/index.ts": "export {};",
        "packages/b/sub.ts": "export {};",
        "packages/empty/package.json": JSON.stringify({ name: "empty" }),
        "packages/ignored/package.json": JSON.stringify({ name: "ignored" }),
        "packages/ignored/index.ts": 'import "@test/a";',
      },
      async (cwd) => {
        const result = await analyzePackages(".", { cwd, includeNpm: true });
        expect([...result.graph.nodes.keys()]).toEqual(["@test/a", "@test/b", "empty"]);
        expect(
          result.graph.edges.map(({ from, to, specifier }) => ({ from, to, specifier })),
        ).toEqual([
          { from: "@test/a", to: "@test/b", specifier: "@test/b" },
          { from: "@test/a", to: "@test/b", specifier: "@test/b/sub" },
        ]);
        expect(result.warnings).toEqual([]);
      },
    );
  });
}

test("pnpm YAML, closest ownership, relative imports, and external npm nodes", async () => {
  await withWorkspace(
    {
      "pnpm-workspace.yaml":
        'packages: &packages\n  - "packages/**"\n  - "!packages/excluded" # comment\n',
      "packages/a/package.json": '{"name":"a"}',
      "packages/a/index.ts":
        'import "./nested/index"; import "third-party"; import type { T } from "../b/index";',
      "packages/a/nested/package.json": '{"name":"nested"}',
      "packages/a/nested/index.ts": 'import "../../b/index";',
      "packages/b/package.json": '{"name":"b"}',
      "packages/b/index.ts": "export type T = string;",
      "packages/excluded/package.json": '{"name":"excluded"}',
      "node_modules/third-party/package.json": '{"name":"third-party","main":"index.js"}',
      "node_modules/third-party/index.js": "module.exports = {};",
    },
    async (cwd) => {
      const included = await analyzePackages(".", { cwd, includeNpm: true });
      expect([...included.graph.nodes.keys()]).toEqual(["a", "b", "nested", "npm:third-party"]);
      expect(included.graph.edges.map((edge) => [edge.from, edge.to])).toEqual([
        ["a", "b"],
        ["a", "nested"],
        ["a", "npm:third-party"],
        ["nested", "b"],
      ]);
      const excluded = await analyzePackages(".", {
        cwd,
        includeTypeImports: false,
        exclude: "packages/b/**",
      });
      expect([...excluded.graph.nodes.keys()]).toEqual(["a", "b", "nested"]);
      expect(excluded.graph.edges.some((edge) => edge.to === "b")).toBe(false);
      expect(excluded.graph.edges.find((edge) => edge.specifier === "third-party")?.status).toBe(
        "external",
      );
    },
  );
});

test("isolated packages without sources and duplicate names", async () => {
  await withWorkspace(
    {
      "package.json": '{"workspaces":["packages/*"]}',
      "packages/a/package.json": '{"name":"a"}',
    },
    async (cwd) => {
      const result = await analyzePackages(".", { cwd });
      expect([...result.graph.nodes.keys()]).toEqual(["a"]);
      expect(result.graph.edges).toEqual([]);
    },
  );
  await withWorkspace(
    {
      "package.json": '{"workspaces":["packages/*"]}',
      "packages/a/package.json": '{"name":"same"}',
      "packages/b/package.json": '{"name":"same"}',
    },
    async (cwd) => {
      expect(analyzePackages(".", { cwd })).rejects.toThrow("Duplicate workspace package name");
    },
  );
});

test("successful external and outside resolutions take precedence over workspace fallback", async () => {
  await withWorkspace(
    {
      "package.json": '{"workspaces":["packages/*"]}',
      "tsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"outside":["outside.ts"]}}}',
      "outside.ts": "export {};",
      "packages/a/package.json": '{"name":"a"}',
      "packages/a/index.ts": 'import "installed"; import "outside"; import "json";',
      "packages/installed/package.json": '{"name":"installed","main":"index.ts"}',
      "packages/installed/index.ts": "export {};",
      "packages/outside/package.json": '{"name":"outside","main":"index.ts"}',
      "packages/outside/index.ts": "export {};",
      "packages/json/package.json": '{"name":"json","exports":"./data.json"}',
      "packages/json/data.json": "{}",
      "node_modules/installed/package.json": '{"name":"installed","main":"index.js"}',
      "node_modules/installed/index.js": "module.exports = {};",
    },
    async (cwd) => {
      for (const includeNpm of [false, true]) {
        const result = await analyzePackages(".", { cwd, includeNpm });
        expect(result.graph.edges.find((edge) => edge.specifier === "installed")?.to).toBe(
          includeNpm ? "npm:installed" : undefined,
        );
        expect(result.graph.edges.find((edge) => edge.specifier === "outside")?.to).toBeUndefined();
      }
    },
  );
});

for (const [extension, target] of [
  ["jsx", "tsx"],
  ["mjs", "mts"],
  ["cjs", "cts"],
  ["ts", "tsx"],
  ["mts", "mjs"],
  ["cts", "cjs"],
]) {
  test(`workspace fallback aliases .${extension} to .${target}`, async () => {
    await withWorkspace(
      {
        "package.json": '{"workspaces":["packages/*"]}',
        "packages/a/package.json": '{"name":"a"}',
        "packages/a/index.ts": 'import "b";',
        "packages/b/package.json": JSON.stringify({ name: "b", exports: `./index.${extension}` }),
        [`packages/b/index.${target}`]: "export {};",
      },
      async (cwd) => {
        const result = await analyzePackages(".", { cwd, includeNpm: true });
        expect(result.graph.edges[0]?.to).toBe("b");
        expect(result.warnings).toEqual([]);
      },
    );
  });
}

test("negative nested workspace patterns do not leak sources or imported targets into the parent", async () => {
  await withWorkspace(
    {
      "package.json": '{"workspaces":["packages/**","!packages/a/nested"]}',
      "packages/a/package.json": '{"name":"a"}',
      "packages/a/index.ts": 'import "./nested/index";',
      "packages/a/nested/package.json": '{"name":"nested"}',
      "packages/a/nested/index.ts": 'import "../../b/index"; import "./missing";',
      "packages/b/package.json": '{"name":"b"}',
      "packages/b/index.ts": "export {};",
    },
    async (cwd) => {
      const result = await analyzePackages(".", { cwd });
      expect([...result.graph.nodes.keys()]).toEqual(["a", "b"]);
      expect(result.graph.edges).toEqual([]);
      expect(result.warnings).toEqual([]);
    },
  );
});

test("legacy main resolution and blocked exports without installed links", async () => {
  await withWorkspace(
    {
      "package.json": '{"workspaces":["packages/*"]}',
      "packages/a/package.json": '{"name":"a"}',
      "packages/a/index.ts": 'import "legacy"; import "private/hidden";',
      "packages/legacy/package.json": '{"name":"legacy","main":"src.js"}',
      "packages/legacy/src.ts": "export {};",
      "packages/private/package.json": '{"name":"private","exports":"./index.ts"}',
      "packages/private/index.ts": "export {};",
      "packages/private/hidden.ts": "export {};",
    },
    async (cwd) => {
      const result = await analyzePackages(".", { cwd, includeNpm: true });
      expect(result.graph.edges.find((edge) => edge.specifier === "legacy")?.to).toBe("legacy");
      expect(result.graph.edges.find((edge) => edge.specifier === "private/hidden")?.status).toBe(
        "unresolved",
      );
      expect(result.warnings).toHaveLength(1);
    },
  );
});

import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderText } from "../../src/render/text.ts";
import type { ModuleGraph } from "../../src/types/graph.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("renders modules and internal dependencies in stable order", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;

    expect(renderText(graph)).toContain("src/a.ts\n  -> src/b.ts");
  } finally {
    await removeFixture(root);
  }
});

test("renders npm package boundaries by name without changing module IDs", async () => {
  const root = await createFixture({
    "src/entry.ts": [
      'import "fixture-package";',
      'import "@scope/scoped";',
      'import "../shared/local.js";',
    ].join("\n"),
    "shared/local.js": "export const local = true;\n",
    "node_modules/fixture-package/index.js": 'import "./internal.js";\nimport "nested-dep";\n',
    "node_modules/fixture-package/internal.js": "export const internal = true;\n",
    "node_modules/fixture-package/node_modules/nested-dep/index.js":
      "export const nested = true;\n",
    "node_modules/@scope/scoped/index.js": "export const scoped = true;\n",
  });

  try {
    const graph = (await analyze("src/entry.ts", { cwd: root, includeNpm: true })).graph;
    const output = renderText(graph);

    expect(output).toContain(
      "src/entry.ts\n  -> npm:@scope/scoped\n  -> npm:fixture-package\n  -> shared/local.js",
    );
    expect(output).toContain(
      "node_modules/fixture-package/index.js\n  -> node_modules/fixture-package/internal.js\n  -> npm:nested-dep",
    );
    expect(graph.nodes.has("node_modules/fixture-package/index.js")).toBe(true);
    expect(graph.nodes.has("node_modules/@scope/scoped/index.js")).toBe(true);
    expect(graph.nodes.has("node_modules/fixture-package/node_modules/nested-dep/index.js")).toBe(
      true,
    );
  } finally {
    await removeFixture(root);
  }
});

test("renders empty graphs as empty text", () => {
  const graph: ModuleGraph = { rootDir: "/project", nodes: new Map(), edges: [] };

  expect(renderText(graph)).toBe("");
});

test("omits external and unresolved edges while retaining source modules", () => {
  const graph: ModuleGraph = {
    rootDir: "/project",
    nodes: new Map<string, { id: string; absolutePath: string }>([
      ["src/entry.ts", { id: "src/entry.ts", absolutePath: "/project/src/entry.ts" }],
      [
        "src/standalone.ts",
        { id: "src/standalone.ts", absolutePath: "/project/src/standalone.ts" },
      ],
    ]),
    edges: [
      {
        from: "src/entry.ts",
        specifier: "external-package",
        kind: "import",
        typeOnly: false,
        status: "external",
      },
      {
        from: "src/entry.ts",
        specifier: "./missing.js",
        kind: "import",
        typeOnly: false,
        status: "unresolved",
      },
    ],
  };

  expect(renderText(graph)).toBe("src/entry.ts\n\nsrc/standalone.ts");
});

import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { analyze } from "../../src/index.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

const calls = [
  ['import "SPEC";', "import"],
  ['import("SPEC");', "dynamic-import"],
  ['require("SPEC");', "require"],
  ['require.resolve("SPEC");', "require-resolve"],
] as const;

for (const [call, kind] of calls) {
  test(`${kind} falls back to cwd, not the importer or ancestors`, async () => {
    const root = await createFixture({
      "project/src/entry.ts": ["local/file.js", "directory", "@local/value", "ancestor", "missing"]
        .map((specifier) => call.replace("SPEC", specifier))
        .join("\n"),
      "project/local/file.ts": 'import "transitive";',
      "project/transitive.ts": "export {};",
      "project/directory/index.ts": "export {};",
      "project/@local/value.ts": "export {};",
      "project/src/local/file.ts": "export const wrong = true;",
      "project/src/ancestor.ts": "export const wrong = true;",
      "ancestor.ts": "export const wrong = true;",
    });
    try {
      for (const includeNpm of [false, true]) {
        const result = await analyze("src/entry.ts", { cwd: join(root, "project"), includeNpm });
        expect([...result.graph.nodes.keys()]).toEqual([
          "@local/value.ts",
          "directory/index.ts",
          "local/file.ts",
          "src/entry.ts",
          "transitive.ts",
        ]);
        for (const [specifier, to] of [
          ["local/file.js", "local/file.ts"],
          ["directory", "directory/index.ts"],
          ["@local/value", "@local/value.ts"],
        ]) {
          expect(result.graph.edges).toContainEqual(
            expect.objectContaining({
              from: "src/entry.ts",
              specifier,
              to,
              kind,
              status: "internal",
            }),
          );
        }
        for (const specifier of ["ancestor", "missing"]) {
          expect(result.graph.edges).toContainEqual({
            from: "src/entry.ts",
            specifier,
            kind,
            typeOnly: false,
            status: includeNpm ? "unresolved" : "external",
          });
        }
        expect(result.warnings.map((warning) => warning.code)).toEqual(
          includeNpm ? ["unresolved-import", "unresolved-import"] : [],
        );
      }
    } finally {
      await removeFixture(root);
    }
  });
}

test.each([false, true])(
  "normal resolution wins over cwd collisions (explicit tsconfig: %s)",
  async (explicit) => {
    const root = await createFixture({
      "src/entry.ts": [
        'import "alias";',
        'require("alias");',
        'import "pkg";',
        'require("pkg");',
        'import "locked/private";',
        'import "@scope/pkg/subpath";',
        'import "#conditional";',
        'require("#conditional");',
        'import "fs";',
        'require("node:fs");',
      ].join("\n"),
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { alias: ["./mapped.ts"] } } }),
      "package.json": JSON.stringify({
        imports: { "#conditional": { import: "./esm.ts", require: "./cjs.ts" } },
      }),
      "mapped.ts": "export {};",
      "esm.ts": "export {};",
      "cjs.ts": "export {};",
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        exports: { import: "./esm.js", require: "./cjs.js" },
      }),
      "node_modules/pkg/esm.js": "export {};",
      "node_modules/pkg/cjs.js": "module.exports = {};",
      "node_modules/locked/package.json": JSON.stringify({
        name: "locked",
        exports: { ".": "./index.js" },
      }),
      "node_modules/locked/index.js": "export {};",
      "locked/private.ts": "export const wrong = true;",
      "node_modules/@scope/pkg/package.json": JSON.stringify({
        name: "@scope/pkg",
        exports: { "./subpath": "./value.js" },
      }),
      "node_modules/@scope/pkg/value.js": "export {};",
      "@scope/pkg/subpath.ts": "export const wrong = true;",
      "alias.ts": "export const wrong = true;",
      "pkg.ts": "export const wrong = true;",
      "#conditional.ts": "export const wrong = true;",
      "fs.ts": "export const wrong = true;",
      "node:fs.ts": "export const wrong = true;",
    });
    try {
      for (const includeNpm of [false, true]) {
        const result = await analyze("src/entry.ts", {
          cwd: root,
          includeNpm,
          ...(explicit ? { tsconfig: "tsconfig.json" } : {}),
        });
        expect([...result.graph.nodes.keys()]).toEqual([
          "cjs.ts",
          "esm.ts",
          "mapped.ts",
          ...(includeNpm ? ["npm:@scope/pkg", "npm:pkg"] : []),
          "src/entry.ts",
        ]);
        for (const kind of ["import", "require"] as const) {
          expect(result.graph.edges).toContainEqual(
            expect.objectContaining({ specifier: "alias", kind, to: "mapped.ts" }),
          );
          expect(result.graph.edges).toContainEqual({
            from: "src/entry.ts",
            specifier: "pkg",
            kind,
            typeOnly: false,
            status: includeNpm ? "internal" : "external",
            ...(includeNpm ? { to: "npm:pkg" } : {}),
          });
          expect(result.graph.edges).toContainEqual(
            expect.objectContaining({
              specifier: "#conditional",
              kind,
              to: kind === "import" ? "esm.ts" : "cjs.ts",
            }),
          );
        }
        expect(
          result.graph.edges
            .filter((edge) => ["fs", "node:fs"].includes(edge.specifier))
            .map((edge) => edge.status),
        ).toEqual(["external", "external"]);
        expect(result.graph.edges).toContainEqual({
          from: "src/entry.ts",
          specifier: "@scope/pkg/subpath",
          kind: "import",
          typeOnly: false,
          status: includeNpm ? "internal" : "external",
          ...(includeNpm ? { to: "npm:@scope/pkg" } : {}),
        });
        expect(result.graph.edges).toContainEqual({
          from: "src/entry.ts",
          specifier: "locked/private",
          kind: "import",
          typeOnly: false,
          status: includeNpm ? "unresolved" : "external",
        });
        expect(result.warnings.map((warning) => warning.code)).toEqual(
          includeNpm ? ["unresolved-import"] : [],
        );
      }
    } finally {
      await removeFixture(root);
    }
  },
);

test("bare fallback cannot escape cwd through traversal, symlinks, or package main", async () => {
  const root = await createFixture({
    "project/entry.ts": [
      "dir/../../outside",
      "prefix-redirect",
      "",
      "linked",
      "linked-dir/value",
      "redirect",
      "#absent",
      "file:outside",
      "data:outside",
      "https:outside",
    ]
      .map((specifier) => `import ${JSON.stringify(specifier)};`)
      .join("\n"),
    "outside.ts": "export {};",
    "outside-dir/value.ts": "export {};",
    "project/redirect/package.json": JSON.stringify({ main: "../../outside.ts" }),
    "project/prefix-redirect/package.json": JSON.stringify({
      main: "../../project-neighbor/value.ts",
    }),
    "project-neighbor/value.ts": "export {};",
    "project/index.ts": "export const wrong = true;",
    "project/#absent.ts": "export {};",
    "project/file:outside.ts": "export {};",
    "project/data:outside.ts": "export {};",
    "project/https:outside.ts": "export {};",
  });
  try {
    await symlink("../outside.ts", join(root, "project/linked.ts"));
    await symlink("../outside-dir", join(root, "project/linked-dir"));
    for (const includeNpm of [false, true]) {
      const result = await analyze("entry.ts", { cwd: join(root, "project"), includeNpm });
      expect([...result.graph.nodes.keys()]).toEqual(["entry.ts"]);
      expect(result.graph.edges.every((edge) => edge.to === undefined)).toBe(true);
      expect(result.graph.edges.find((edge) => edge.specifier === "#absent")?.status).toBe(
        "unresolved",
      );
    }
  } finally {
    await removeFixture(root);
  }
});

test("fallback honors extensions, JSON leaves, exclusions and a symlinked cwd", async () => {
  const root = await createFixture({
    "project/entry.ts": 'import "value.js"; import "settings"; import "excluded"; import "custom";',
    "project/value.ts": "export {};",
    "project/settings.json": "{}",
    "project/excluded.ts": "export {};",
    "project/custom.js": "export {};",
  });
  try {
    await symlink("project", join(root, "cwd-link"));
    const result = await analyze("entry.ts", {
      cwd: join(root, "cwd-link"),
      extensions: ["ts"],
      exclude: "excluded.ts",
    });
    expect([...result.graph.nodes.keys()]).toEqual(["entry.ts", "value.ts"]);
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({ specifier: "settings", status: "external" }),
    );
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({ specifier: "custom", status: "external" }),
    );
    expect(result.graph.edges.some((edge) => edge.specifier === "excluded")).toBe(false);
    expect(result.warnings).toEqual([]);
  } finally {
    await removeFixture(root);
  }
});

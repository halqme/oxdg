import { readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { analyze } from "../../src/index.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test(".git is excluded from discovery, explicit inputs and imports without modifying data", async () => {
  const files = {
    "project/entry.ts": [
      'import "./.git/hidden.ts";',
      'require("./nested/.git/hidden.ts");',
      'import "./file-link.ts";',
      'import "./dir-link/hidden.ts";',
      'import "./.git/visible-link.ts";',
      'import "../.git/outside.ts";',
      'import "./.github/keep.ts";',
      'import "./.git_tmp/keep.ts";',
      'import "./thing.git/keep.ts";',
      'import "fallback/.git/hidden";',
      'import "./.git/data.json";',
      'import "./.git/style.css";',
      'import "pkg/hidden";',
      'import "pkg/linked";',
    ].join("\n"),
    "project/.git/hidden.ts": "invalid syntax must not be parsed !",
    "project/.git/data.json": "{}",
    "project/.git/style.css": "body {}",
    "project/node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      exports: { "./hidden": "./.git/hidden.js", "./linked": "./linked.js" },
    }),
    "project/node_modules/pkg/.git/hidden.js": "invalid syntax must not be parsed !",
    "project/nested/.git/hidden.ts": "invalid syntax must not be parsed !",
    ".git/outside.ts": "invalid syntax must not be parsed !",
    "project/fallback/.git/hidden.ts": "invalid syntax must not be parsed !",
    "project/.github/keep.ts": "export {};",
    "project/.git_tmp/keep.ts": "export {};",
    "project/thing.git/keep.ts": "export {};",
    "project/visible.ts": "export {};",
  };
  const root = await createFixture(files);
  try {
    const cwd = join(root, "project");
    await symlink(".git/hidden.ts", join(cwd, "file-link.ts"));
    await symlink(".git/hidden.js", join(cwd, "node_modules/pkg/linked.js"));
    await symlink(".git", join(cwd, "dir-link"));
    await symlink("../visible.ts", join(cwd, ".git/visible-link.ts"));
    for (const includeNpm of [false, true]) {
      for (const input of [
        ".",
        "entry.ts",
        [
          "entry.ts",
          ".git",
          ".git/hidden.ts",
          "nested/.git",
          "file-link.ts",
          ".git/visible-link.ts",
          "../.git",
        ],
      ]) {
        const result = await analyze(input, {
          cwd,
          includeNpm,
          explain: true,
          exclude: ["!.git/", "!**/.git/**"],
        });
        const kept = [".git_tmp/keep.ts", ".github/keep.ts", "entry.ts", "thing.git/keep.ts"];
        expect([...result.graph.nodes.keys()]).toEqual(
          input === "." ? [...kept, "visible.ts"] : kept,
        );
        expect(result.graph.edges).toHaveLength(3);
        expect(result.explanations).toHaveLength(3);
        expect(
          result.graph.edges
            .map((edge) => edge.to)
            .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
        ).toEqual([".git_tmp/keep.ts", ".github/keep.ts", "thing.git/keep.ts"]);
        expect(result.explanations?.map((entry) => entry.to).sort()).toEqual([
          ".git_tmp/keep.ts",
          ".github/keep.ts",
          "thing.git/keep.ts",
        ]);
        expect(result.warnings).toEqual([]);
      }
    }
    for (const input of [
      ".git",
      ".git/hidden.ts",
      "file-link.ts",
      ".git/visible-link.ts",
      "../.git",
    ]) {
      expect(analyze(input, { cwd })).rejects.toThrow("No supported source files were found");
    }
    for (const [path, contents] of Object.entries(files)) {
      expect(await readFile(join(root, path), "utf8")).toBe(contents);
    }
  } finally {
    await removeFixture(root);
  }
});

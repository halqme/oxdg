import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { createFixture, removeFixture, writeFixtureFiles } from "../fixtures.ts";

describe("source discovery", () => {
  test("does not discover .git or npm package source files", async () => {
    const root = await createFixture({
      "src/entry.ts": "export const entry = true;\n",
      ".git/ignored.ts": "export const ignored = true;\n",
      "node_modules/pkg/dependency.ts": "export const dependency = true;\n",
    });
    await symlink("../node_modules/pkg/dependency.ts", join(root, "src/vendor.ts"));

    try {
      const defaults = await analyze(".", { cwd: root });
      const withNpm = await analyze(".", { cwd: root, includeNpm: true });

      expect([...defaults.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
      expect([...withNpm.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
    } finally {
      await removeFixture(root);
    }
  });

  test("deduplicates overlapping input paths", async () => {
    const root = await createFixture({
      "src/entry.ts": "export const entry = true;\n",
    });

    try {
      const result = await analyze(["src", "src/entry.ts"], { cwd: root });

      expect([...result.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
    } finally {
      await removeFixture(root);
    }
  });

  test("keeps repeated imports through a file symlink on the canonical module", async () => {
    const root = await createFixture({
      "src/entry.ts": 'import "./target.ts";\nimport "./alias.ts";\n',
      "src/other.ts": 'import "./alias.ts";\n',
      "src/target.ts": "export const target = true;\n",
    });
    await symlink("target.ts", join(root, "src/alias.ts"));

    try {
      const result = await analyze("src", { cwd: root });

      expect([...result.graph.nodes.keys()]).toEqual([
        "src/entry.ts",
        "src/other.ts",
        "src/target.ts",
      ]);
      expect(result.graph.edges.filter((edge) => edge.to === "src/target.ts")).toHaveLength(3);
      expect(result.warnings).toEqual([]);
    } finally {
      await removeFixture(root);
    }
  });

  test("does not follow directory symlinks", async () => {
    const outside = await mkdtemp(join(tmpdir(), "oxdg-linked-"));
    const root = await createFixture({
      "src/entry.ts": "export const entry = true;\n",
    });
    await writeFixtureFiles(outside, {
      "outside.ts": "export const outside = true;\n",
    });
    await symlink(outside, join(root, "linked-directory"));

    try {
      const result = await analyze(".", { cwd: root });

      expect([...result.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
    } finally {
      await removeFixture(root);
      await removeFixture(outside);
    }
  });
});

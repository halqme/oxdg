import { join } from "node:path";
import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { analyzePackages } from "../../src/analyzer/packages.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("loads root .gitignore for discovery and resolved imports", async () => {
  const root = await createFixture({
    ".gitignore": "dist/\n*.generated.ts\n",
    "src/entry.ts": [
      'import "../dist/bundle.js";',
      'import "./keep.ts";',
      'import "./drop.generated.ts";',
    ].join("\n"),
    "src/keep.ts": "export {};\n",
    "src/drop.generated.ts": "export {};\n",
    "dist/bundle.ts": "export {};\n",
  });
  try {
    const result = await analyze(".", { cwd: root });
    expect([...result.graph.nodes.keys()]).toEqual(["src/entry.ts", "src/keep.ts"]);
    expect(result.graph.edges).toEqual([
      expect.objectContaining({ from: "src/entry.ts", to: "src/keep.ts", status: "internal" }),
    ]);
    expect(result.warnings).toEqual([]);
  } finally {
    await removeFixture(root);
  }
});

test("applies nested .gitignore files including negations", async () => {
  const root = await createFixture({
    ".gitignore": "*.tmp.ts\n",
    "src/.gitignore": "secret.ts\n!keep.tmp.ts\n",
    "src/entry.ts": [
      'import "./secret.ts";',
      'import "./keep.tmp.ts";',
      'import "./other.tmp.ts";',
      'import "./visible.ts";',
    ].join("\n"),
    "src/secret.ts": "export {};\n",
    "src/keep.tmp.ts": "export {};\n",
    "src/other.tmp.ts": "export {};\n",
    "src/visible.ts": "export {};\n",
  });
  try {
    const result = await analyze("src", { cwd: root });
    expect([...result.graph.nodes.keys()]).toEqual([
      "src/entry.ts",
      "src/keep.tmp.ts",
      "src/visible.ts",
    ]);
    expect(
      result.graph.edges
        .map((edge) => edge.to)
        .sort((left, right) => {
          if (left === undefined) return right === undefined ? 0 : 1;
          if (right === undefined) return -1;
          return left < right ? -1 : left > right ? 1 : 0;
        }),
    ).toEqual(["src/keep.tmp.ts", "src/visible.ts"]);
  } finally {
    await removeFixture(root);
  }
});

test("does not read .gitignore files above cwd", async () => {
  const root = await createFixture({
    ".gitignore": "hidden.ts\n",
    "project/entry.ts": 'import "./hidden.ts";\nimport "./visible.ts";\n',
    "project/hidden.ts": "export {};\n",
    "project/visible.ts": "export {};\n",
  });
  try {
    const cwd = join(root, "project");
    const result = await analyze(".", { cwd });
    expect([...result.graph.nodes.keys()]).toEqual(["entry.ts", "hidden.ts", "visible.ts"]);
  } finally {
    await removeFixture(root);
  }
});

test("does not apply .gitignore patterns to modules outside cwd", async () => {
  const root = await createFixture({
    "project/.gitignore": "outside.ts\n",
    "project/entry.ts": 'import "../outside.ts";\n',
    "outside.ts": "export {};\n",
  });
  try {
    const cwd = join(root, "project");
    const result = await analyze("entry.ts", { cwd });
    expect([...result.graph.nodes.keys()]).toEqual(["../outside.ts", "entry.ts"]);
  } finally {
    await removeFixture(root);
  }
});

test("explicit path roots are analyzed even when gitignored", async () => {
  const root = await createFixture({
    ".gitignore": "dist/\n*.min.ts\n",
    "dist/entry.ts": 'import "./keep.ts";\nimport "./drop.min.ts";\n',
    "dist/keep.ts": "export {};\n",
    "dist/drop.min.ts": "export {};\n",
  });
  try {
    const result = await analyze("dist", { cwd: root });
    expect([...result.graph.nodes.keys()]).toEqual(["dist/entry.ts", "dist/keep.ts"]);
    expect(result.graph.edges).toEqual([
      expect.objectContaining({ from: "dist/entry.ts", to: "dist/keep.ts", status: "internal" }),
    ]);

    await expect(analyze(".", { cwd: root })).rejects.toThrow(
      "No supported source files were found",
    );

    const explicitFile = await analyze("dist/drop.min.ts", { cwd: root });
    expect([...explicitFile.graph.nodes.keys()]).toEqual(["dist/drop.min.ts"]);
  } finally {
    await removeFixture(root);
  }
});

test("loads nested .gitignore inside an explicit ignored root", async () => {
  const root = await createFixture({
    ".gitignore": "dist/\n",
    "dist/.gitignore": "secret.ts\n",
    "dist/entry.ts": 'import "./secret.ts";\nimport "./keep.ts";\n',
    "dist/secret.ts": "export {};\n",
    "dist/keep.ts": "export {};\n",
  });
  try {
    const result = await analyze("dist", { cwd: root });
    expect([...result.graph.nodes.keys()]).toEqual(["dist/entry.ts", "dist/keep.ts"]);
  } finally {
    await removeFixture(root);
  }
});

test("gitignore: false and --exclude remain independent filters", async () => {
  const root = await createFixture({
    ".gitignore": "ignored.ts\n",
    "src/entry.ts": 'import "./ignored.ts";\nimport "./extra.ts";\n',
    "src/ignored.ts": "export {};\n",
    "src/extra.ts": "export {};\n",
  });
  try {
    const withoutGitignore = await analyze("src", { cwd: root, gitignore: false });
    expect([...withoutGitignore.graph.nodes.keys()]).toEqual([
      "src/entry.ts",
      "src/extra.ts",
      "src/ignored.ts",
    ]);

    const withExclude = await analyze("src", {
      cwd: root,
      gitignore: false,
      exclude: "extra.ts",
    });
    expect([...withExclude.graph.nodes.keys()]).toEqual(["src/entry.ts", "src/ignored.ts"]);

    const both = await analyze("src", { cwd: root, exclude: "extra.ts" });
    expect([...both.graph.nodes.keys()]).toEqual(["src/entry.ts"]);
  } finally {
    await removeFixture(root);
  }
});

test("packages mode applies .gitignore to package sources", async () => {
  const root = await createFixture({
    ".gitignore": "packages/b/**\n",
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "packages/a/package.json": JSON.stringify({ name: "a" }),
    "packages/a/index.ts": 'import "../b/index.ts";\n',
    "packages/b/package.json": JSON.stringify({ name: "b" }),
    "packages/b/index.ts": "export {};\n",
  });
  try {
    const result = await analyzePackages(".", { cwd: root });
    expect([...result.graph.nodes.keys()]).toEqual(["a", "b"]);
    expect(result.graph.edges).toEqual([]);

    const disabled = await analyzePackages(".", { cwd: root, gitignore: false });
    expect(disabled.graph.edges).toEqual([
      expect.objectContaining({ from: "a", to: "b", status: "internal" }),
    ]);
  } finally {
    await removeFixture(root);
  }
});

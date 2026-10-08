import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { createFixture, removeFixture } from "../fixtures.ts";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../../src/cli/main.ts");

function run(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("file explanations report only source locations and support JSON", async () => {
  const cwd = await createFixture({
    "src/a.ts": [
      'const banner = "😀";',
      'import { value } from "./core.js";',
      'import type { Type } from "./core.js";',
    ].join("\n"),
    "src/core.ts": "export const value = 1; export type Type = number;",
    "src/unused.ts": "export {};",
  });
  try {
    const args = ["src", "--depends", "src/core.ts", "--explain"];
    const text = run(cwd, ...args);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain("src/a.ts -> src/core.ts");
    expect(text.stdout).toBe("src/a.ts -> src/core.ts\n  src/a.ts:2\n  src/a.ts:3\n");

    const json = run(cwd, ...args, "--json");
    const results = JSON.parse(json.stdout);
    expect(results).toHaveLength(2);
    expect(results).toEqual([
      { from: "src/a.ts", to: "src/core.ts", source: "src/a.ts", line: 2 },
      { from: "src/a.ts", to: "src/core.ts", source: "src/a.ts", line: 3 },
    ]);
    const excluded = run(cwd, ...args, "--no-type-imports", "--json");
    expect(JSON.parse(excluded.stdout)).toHaveLength(1);
    expect(run(cwd, "src", "--explain").status).toBe(2);
    expect(run(cwd, "src", "--leaves", "--explain").status).toBe(2);
    expect(run(cwd, "src", "--depends", "src/core.ts", "--explain", "--mermaid").status).toBe(2);
  } finally {
    await removeFixture(cwd);
  }
});

test("cycle explanations identify only cyclic edges", async () => {
  const cwd = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./a.js";\n',
    "src/other.ts": 'import "./a.js";\n',
  });
  try {
    const output = run(cwd, "src", "--circular", "--explain", "--json", "--fail-on-circular");
    expect(output.status).toBe(1);
    const data = JSON.parse(output.stdout);
    expect(data.map((item: { from: string }) => item.from)).toEqual(["src/a.ts", "src/b.ts"]);
  } finally {
    await removeFixture(cwd);
  }
});

test("package explanations preserve multiple source origins and unresolved workspace fallbacks", async () => {
  const cwd = await createFixture({
    "package.json": '{"workspaces":["packages/*"]}',
    "packages/app/package.json": '{"name":"@test/app"}',
    "packages/core/package.json": '{"name":"@test/core","exports":"./index.ts"}',
    "packages/app/index.ts": 'import "@test/core";\n',
    "packages/app/other.ts": 'import "@test/core";\n',
    "packages/core/index.ts": 'import "../app/index.ts";\n',
  });
  try {
    const result = run(cwd, ".", "--packages", "--depends", "@test/core", "--explain", "--json");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const data = JSON.parse(result.stdout);
    expect(data).toHaveLength(2);
    expect(data.map((item: { source: string }) => item.source)).toEqual([
      "packages/app/index.ts",
      "packages/app/other.ts",
    ]);
    expect(data).toEqual([
      { from: "@test/app", to: "@test/core", source: "packages/app/index.ts", line: 1 },
      { from: "@test/app", to: "@test/core", source: "packages/app/other.ts", line: 1 },
    ]);

    const cycles = run(cwd, ".", "--packages", "--circular", "--explain", "--json");
    expect(JSON.parse(cycles.stdout)).toHaveLength(3);
    expect(JSON.parse(cycles.stdout).map((item: { from: string }) => item.from)).toEqual([
      "@test/app",
      "@test/app",
      "@test/core",
    ]);
  } finally {
    await removeFixture(cwd);
  }
});

test("deduplicates imports from the same source line for one dependency", async () => {
  const cwd = await createFixture({
    "src/entry.ts": 'import "./core.js"; import "./core.js";\n',
    "src/core.ts": "export {};\n",
  });
  try {
    const result = run(cwd, "src", "--depends", "src/core.ts", "--explain", "--json");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { from: "src/entry.ts", to: "src/core.ts", source: "src/entry.ts", line: 1 },
    ]);
  } finally {
    await removeFixture(cwd);
  }
});

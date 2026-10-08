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

test("file explanations report only detected source lines and support JSON", async () => {
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
    expect(text.stdout).toContain('src/a.ts:2: import { value } from "./core.js";');
    expect(text.stdout).toContain('src/a.ts:3: import type { Type } from "./core.js";');
    expect(text.stdout).not.toContain("const banner");

    const json = run(cwd, ...args, "--json");
    const results = JSON.parse(json.stdout);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      from: "src/a.ts",
      to: "src/core.ts",
      source: "src/a.ts",
      line: 2,
      code: 'import { value } from "./core.js";',
    });
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
    expect(data.every((item: { to: string }) => item.to === "@test/core")).toBe(true);

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

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { adjacency, cases, compareCase, upstreamRoot } from "./compare.ts";
import provenance from "./provenance.json" with { type: "json" };
import type { ModuleGraph } from "../../src/index.ts";

for (const entry of cases) {
  const name = `${entry.id} ${entry.title}`;
  if (entry.disposition === "unsupported") {
    test.skip(`UNSUPPORTED ${name}: ${entry.reason}`, () => {});
  } else if (entry.baseline === "difference") {
    test.todo(`DIFFERENCE ${name}: ${entry.difference}; run test:madge-compat`);
  } else {
    test(`MATCH (scoped) ${name}`, async () => {
      const result = await compareCase(entry);
      expect(result).toMatchObject({ status: "match", actual: entry.expected });
    });
  }
}

async function filesUnder(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
    else files.push(path);
  }
  return files.sort();
}

test("vendored corpus is complete and byte-identical to the provenance manifest", async () => {
  expect(await filesUnder(upstreamRoot)).toEqual(Object.keys(provenance.files).sort());
  for (const [path, expectedHash] of Object.entries(provenance.files)) {
    const bytes = await readFile(join(upstreamRoot, path));
    expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(expectedHash);
  }
});

test("every upstream Mocha assertion case and manual output command has one inventory entry", async () => {
  const discovered: { id: string; source: string; line: number; title: string }[] = [];
  const sources = (await readdir(join(upstreamRoot, "test"))).filter((file) =>
    file.endsWith(".js"),
  );
  for (const file of sources.sort()) {
    const source = `test/${file}`;
    const text = await readFile(join(upstreamRoot, source), "utf8");
    let number = 0;
    for (const match of text.matchAll(/\bit\('((?:[^'\\]|\\.)*)'/g)) {
      discovered.push({
        id: `${file.slice(0, -3)}:${String(++number).padStart(2, "0")}`,
        source,
        line: text.slice(0, match.index).split("\n").length,
        title: match[1]!,
      });
    }
  }
  const source = "test/output.sh";
  const shell = await readFile(join(upstreamRoot, source), "utf8");
  let number = 0;
  for (const match of shell.matchAll(/^make_title "([^"]+)"\n([^\n]+)/gm)) {
    discovered.push({
      id: `output:${String(++number).padStart(2, "0")}`,
      source,
      line: shell.slice(0, match.index).split("\n").length + 1,
      title: match[1]!,
    });
    expect(cases.find((entry) => entry.id === discovered.at(-1)?.id)?.command).toBe(match[2]);
  }
  expect(cases.map(({ id, source, line, title }) => ({ id, source, line, title }))).toEqual(
    discovered,
  );
  for (const entry of cases) {
    if (entry.disposition === "unsupported") expect(entry.reason).toBeTruthy();
    else {
      expect(["match", "difference"]).toContain(entry.baseline!);
      expect(entry.expected).toBeDefined();
      if (entry.baseline === "difference") expect(entry.difference).toBeTruthy();
    }
  }
});

test("comparison reports unequal results as differences, not successful comparisons", async () => {
  const baseline = cases.find((entry) => entry.id === "cjs:01")!;
  expect((await compareCase(baseline)).status).toBe("match");
  const broken = await compareCase({ ...baseline, expected: { "a.js": [] } });
  expect(broken.status).toBe("difference");
  expect(broken.actual).not.toEqual(broken.expected);
});

test("unsupported cases do not execute, while invalid adapters and I/O failures are errors", async () => {
  expect(
    await compareCase({
      id: "unsupported",
      title: "unsupported",
      source: "test",
      line: 1,
      disposition: "unsupported",
      reason: "No API",
      cwd: "absent",
      input: "absent",
    }),
  ).toMatchObject({ status: "unsupported", reason: "No API" });
  const baseline = cases.find((entry) => entry.id === "cjs:01")!;
  expect((await compareCase({ ...baseline, operation: "invalid" })).status).toBe("error");
  expect((await compareCase({ ...baseline, input: "absent.js" })).status).toBe("error");
});

test("adjacency normalization preserves graph behavior across ordering and duplicate import kinds", () => {
  const graph: ModuleGraph = {
    rootDir: "/fixture",
    nodes: new Map([
      ["b.js", { id: "b.js", absolutePath: "/fixture/b.js" }],
      ["a.js", { id: "a.js", absolutePath: "/fixture/a.js" }],
    ]),
    edges: [
      {
        from: "a.js",
        to: "b.js",
        specifier: "./b",
        kind: "require",
        status: "internal",
        typeOnly: false,
      },
      {
        from: "a.js",
        to: "b.js",
        specifier: "./b.js",
        kind: "import",
        status: "internal",
        typeOnly: false,
      },
      { from: "a.js", specifier: "fs", kind: "import", status: "external", typeOnly: false },
    ],
  };
  expect(adjacency(graph)).toEqual({ "a.js": ["b.js"], "b.js": [] });
  expect(
    adjacency({
      ...graph,
      nodes: new Map([...graph.nodes].reverse()),
      edges: [...graph.edges].reverse(),
    }),
  ).toEqual(adjacency(graph));
});

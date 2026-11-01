import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { findCycles } from "../../src/graph/cycles.ts";
import { cyclicSubgraph, filterGraph, reachableSubgraph } from "../../src/graph/filter.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("analyzes cycle membership and graph filtering", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
  });

  try {
    const result = await analyze("src", { cwd: root });
    const modules = [...result.graph.nodes.keys()];

    expect(modules).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/leaf.ts"]);
    expect(findCycles(result.graph)).toEqual([{ modules: ["src/a.ts", "src/b.ts", "src/c.ts"] }]);
    expect([...cyclicSubgraph(result.graph).nodes.keys()]).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    expect([...filterGraph(result.graph, (node) => node.id !== "src/c.ts").nodes.keys()]).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/leaf.ts",
    ]);
  } finally {
    await removeFixture(root);
  }
});

test("builds the reachable subgraph from a module", async () => {
  const root = await createFixture({
    "src/entry.ts": 'import "./mid.js";\nimport "left-pad";\n',
    "src/mid.ts": 'import "./leaf.js";\nimport "./cycle-a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
    "src/cycle-a.ts": 'import "./cycle-b.js";\n',
    "src/cycle-b.ts": 'import "./cycle-a.js";\n',
    "src/other.ts": 'import "./leaf.js";\n',
    "package.json": JSON.stringify({ type: "module" }),
    "node_modules/left-pad/package.json": JSON.stringify({ name: "left-pad", main: "index.js" }),
    "node_modules/left-pad/index.js": "module.exports = function () {};\n",
  });

  try {
    const result = await analyze("src", { cwd: root, includeNpm: true });
    const reachable = reachableSubgraph(result.graph, "src/mid.ts");

    expect([...reachable.nodes.keys()]).toEqual([
      "src/cycle-a.ts",
      "src/cycle-b.ts",
      "src/leaf.ts",
      "src/mid.ts",
    ]);
    expect(
      reachable.edges.map((edge) => [edge.from, edge.to ?? edge.specifier, edge.status]),
    ).toEqual([
      ["src/cycle-a.ts", "src/cycle-b.ts", "internal"],
      ["src/cycle-b.ts", "src/cycle-a.ts", "internal"],
      ["src/mid.ts", "src/cycle-a.ts", "internal"],
      ["src/mid.ts", "src/leaf.ts", "internal"],
    ]);

    const fromEntry = reachableSubgraph(result.graph, "src/entry.ts");
    expect([...fromEntry.nodes.keys()]).toEqual([
      "npm:left-pad",
      "src/cycle-a.ts",
      "src/cycle-b.ts",
      "src/entry.ts",
      "src/leaf.ts",
      "src/mid.ts",
    ]);
    expect(fromEntry.edges.some((edge) => edge.to === "npm:left-pad")).toBe(true);

    const withoutNpm = await analyze("src", { cwd: root });
    const externalKept = reachableSubgraph(withoutNpm.graph, "src/entry.ts");
    expect([...externalKept.nodes.keys()]).toEqual([
      "src/cycle-a.ts",
      "src/cycle-b.ts",
      "src/entry.ts",
      "src/leaf.ts",
      "src/mid.ts",
    ]);
    expect(
      externalKept.edges.some(
        (edge) =>
          edge.from === "src/entry.ts" &&
          edge.specifier === "left-pad" &&
          edge.status === "external",
      ),
    ).toBe(true);

    expect([...reachableSubgraph(result.graph, "missing.ts").nodes.keys()]).toEqual([]);
  } finally {
    await removeFixture(root);
  }
});

test("finds self, independent, and multiple cycles deterministically", async () => {
  const root = await createFixture({
    "cycles/self.ts": 'import "./self.js";\n',
    "cycles/independent-a.ts": 'import "./independent-b.js";\n',
    "cycles/independent-b.ts": 'import "./independent-a.js";\n',
    "cycles/independent-c.ts": 'import "./independent-d.js";\n',
    "cycles/independent-d.ts": 'import "./independent-c.js";\n',
    "cycles/scc-a.ts": ['import "./scc-b.js";', 'import "./scc-c.js";'].join("\n"),
    "cycles/scc-b.ts": ['import "./scc-a.js";', 'import "./scc-c.js";'].join("\n"),
    "cycles/scc-c.ts": 'import "./scc-a.js";\n',
  });

  try {
    const result = await analyze("cycles", { cwd: root });
    const cycles = findCycles(result.graph);

    expect(cycles).toEqual([
      { modules: ["cycles/independent-a.ts", "cycles/independent-b.ts"] },
      { modules: ["cycles/independent-c.ts", "cycles/independent-d.ts"] },
      { modules: ["cycles/scc-a.ts", "cycles/scc-b.ts"] },
      {
        modules: ["cycles/scc-a.ts", "cycles/scc-b.ts", "cycles/scc-c.ts"],
      },
      { modules: ["cycles/scc-a.ts", "cycles/scc-c.ts"] },
      { modules: ["cycles/self.ts"] },
    ]);
    expect(new Set(cycles.map((cycle) => cycle.modules.join("\u0000"))).size).toBe(cycles.length);
  } finally {
    await removeFixture(root);
  }
});

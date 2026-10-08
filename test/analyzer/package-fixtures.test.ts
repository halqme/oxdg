import { expect, test } from "bun:test";
import { analyzePackages } from "../../src/analyzer/packages.ts";
import { findCycles } from "../../src/graph/cycles.ts";
import { findDirectDependents, findOrphans } from "../../src/graph/queries.ts";
import { fixturePath } from "../fixtures.ts";

for (const manager of ["npm", "pnpm", "bun", "yarn"]) {
  test(`${manager} workspace fixture aggregates actual imports without installed links`, async () => {
    const cwd = fixturePath(`workspace-${manager}`);
    for (const includeNpm of [false, true]) {
      const { graph, warnings } = await analyzePackages(".", { cwd, includeNpm });
      expect(warnings).toEqual([]);
      expect([...graph.nodes.keys()]).toEqual([
        "@fixture/app",
        "@fixture/core",
        "@fixture/empty",
        "@fixture/types",
      ]);
      expect(graph.edges.map(({ from, to, typeOnly }) => ({ from, to, typeOnly }))).toEqual([
        { from: "@fixture/app", to: "@fixture/core", typeOnly: false },
        { from: "@fixture/app", to: "@fixture/types", typeOnly: true },
        { from: "@fixture/core", to: "@fixture/app", typeOnly: false },
      ]);
      expect(findCycles(graph)).toEqual([{ modules: ["@fixture/app", "@fixture/core"] }]);
      expect(findDirectDependents(graph, "@fixture/core")).toEqual(["@fixture/app"]);
      expect(findOrphans(graph)).toEqual(["@fixture/empty"]);
    }

    const { graph, warnings } = await analyzePackages(".", {
      cwd,
      includeTypeImports: false,
    });
    expect(warnings).toEqual([]);
    expect(graph.edges.map(({ from, to }) => [from, to])).toEqual([
      ["@fixture/app", "@fixture/core"],
      ["@fixture/core", "@fixture/app"],
    ]);
    expect(findOrphans(graph)).toEqual(["@fixture/empty", "@fixture/types"]);
  });
}

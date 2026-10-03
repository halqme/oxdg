import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderD2 } from "../../src/render/d2.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("renders D2 graph nodes and dependencies", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
    "src/normal.ts": 'import "./leaf.js";\n',
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;

    const d2 = renderD2(graph);

    expect(d2).toContain('n0: "src/a.ts"');
    expect(d2).toContain('n0.style.stroke: "#ef4444"\nn0.style.font-color: "#b91c1c"');
    expect(d2).toContain('n3.style.stroke: "#22c55e"\nn3.style.font-color: "#15803d"');
    expect(d2).toContain('n4.style.stroke: "#3b82f6"\nn4.style.font-color: "#1d4ed8"');
  } finally {
    await removeFixture(root);
  }
});

test("escapes module paths in D2 output", async () => {
  const root = await createFixture({
    "a&b.ts": "export {};\n",
    "a<b>.ts": "export {};\n",
    'a"b.ts': "export {};\n",
  });

  try {
    const graph = (await analyze(["a&b.ts", "a<b>.ts", 'a"b.ts'], { cwd: root })).graph;
    const d2 = renderD2(graph);

    for (const module of graph.nodes.keys()) {
      expect(d2).toContain(`: ${JSON.stringify(module)}`);
    }
  } finally {
    await removeFixture(root);
  }
});

import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

function expectNodeColors(svg: string, module: string, stroke: string, text: string): void {
  const label = `>${module}</text>`;
  const labelEnd = svg.indexOf(label);
  expect(labelEnd).toBeGreaterThanOrEqual(0);
  const rectStart = svg.lastIndexOf("<rect ", labelEnd);
  const markup = svg.slice(rectStart, labelEnd + label.length);
  expect(markup).toContain(`stroke="${stroke}"`);
  expect(markup).toContain(`fill="${text}"`);
}

test("renders SVG graphs with configurable direction and node category colors", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
    "src/normal.ts": 'import "./leaf.js";\n',
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;
    const svg = renderSvg(graph, { direction: "BT" });

    expect(svg).not.toBe(renderSvg(graph));
    expect(svg).toContain("<marker");
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('rx="7" fill="#ffffff" stroke="#3b82f6" stroke-width="1"');
    expect(svg).toContain('text-anchor="middle"');
    expectNodeColors(svg, "src/normal.ts", "#3b82f6", "#1d4ed8");
    expectNodeColors(svg, "src/leaf.ts", "#22c55e", "#15803d");
    expectNodeColors(svg, "src/a.ts", "#ef4444", "#b91c1c");
    expect(svg).toContain('<g transform="translate(0 24)">');
  } finally {
    await removeFixture(root);
  }
});

test("escapes module paths in SVG output", async () => {
  const root = await createFixture({
    "a&b.ts": "export {};\n",
    "a<b>.ts": "export {};\n",
    'a"b.ts': "export {};\n",
  });

  try {
    const graph = (await analyze(["a&b.ts", "a<b>.ts", 'a"b.ts'], { cwd: root })).graph;
    const svg = renderSvg(graph);

    expect(svg).toContain(">a&amp;b.ts<");
    expect(svg).toContain(">a&lt;b&gt;.ts<");
    expect(svg).toContain(">a&quot;b.ts<");
    expect(svg).not.toContain(">a&b.ts<");
    expect(svg).not.toContain(">a<b>.ts<");
    expect(svg).not.toContain('>a"b.ts<');
  } finally {
    await removeFixture(root);
  }
});

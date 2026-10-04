import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderD2 } from "../../src/render/d2.ts";
import { renderMermaid } from "../../src/render/mermaid.ts";
import { renderSvg } from "../../src/render/svg.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("colors npm package nodes distinctly in graph renderers", async () => {
  const root = await createFixture({
    "src/index.ts": 'import "fixture-package";\n',
    "node_modules/fixture-package/index.js": "export const dependency = true;\n",
  });

  try {
    const graph = (await analyze("src/index.ts", { cwd: root, includeNpm: true })).graph;
    const mermaid = renderMermaid(graph);
    const d2 = renderD2(graph);
    const svg = renderSvg(graph);

    expect(mermaid).toContain("classDef npm fill:#ffffff,stroke:#a855f7,color:#7e22ce;");
    expect(mermaid).toContain('n0["npm:fixture-package"]');
    expect(mermaid).toContain("class n0 npm;");
    expect(mermaid).toContain("n1 --> n0");

    expect(d2).toContain('n0: "npm:fixture-package"');
    expect(d2).toContain('n0.style.stroke: "#a855f7"\nn0.style.font-color: "#7e22ce"');

    expect(svg).toContain('stroke="#a855f7"');
    expect(svg).toContain('fill="#7e22ce" font-family="sans-serif"');
    expect(svg).toContain(">npm:fixture-package</text>");
  } finally {
    await removeFixture(root);
  }
});

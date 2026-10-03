import { expect, test } from "bun:test";
import { analyze } from "../../src/analyzer/analyze.ts";
import { renderMermaid } from "../../src/render/mermaid.ts";
import { createFixture, removeFixture } from "../fixtures.ts";

test("renders Mermaid graphs with stable node IDs and configurable direction", async () => {
  const root = await createFixture({
    "src/a.ts": 'import "./b.js";\n',
    "src/b.ts": 'import "./c.js";\n',
    "src/c.ts": 'import "./a.js";\n',
    "src/leaf.ts": "export const leaf = true;\n",
    "src/normal.ts": 'import "./leaf.js";\n',
    "src/self.ts": 'import "./self.js";\n',
  });

  try {
    const graph = (await analyze("src", { cwd: root })).graph;

    const mermaid = renderMermaid(graph);

    expect(mermaid).toContain('n0["src/a.ts"]');
    expect(mermaid).toStartWith("flowchart LR");
    expect(renderMermaid(graph, { direction: "TB" })).toStartWith("flowchart TB");
    expect(mermaid).toContain("classDef normal fill:#ffffff,stroke:#3b82f6,color:#1d4ed8;");
    expect(mermaid).toContain("classDef leaf fill:#ffffff,stroke:#22c55e,color:#15803d;");
    expect(mermaid).toContain("classDef cyclic fill:#ffffff,stroke:#ef4444,color:#b91c1c;");
    expect(mermaid).toContain("class n0 cyclic;");
    expect(mermaid).toContain("class n3 leaf;");
    expect(mermaid).toContain("class n4 normal;");
    expect(mermaid).toMatch(/n0 --> n1\n\s+linkStyle \d+ stroke:#ef4444;/);
    expect(mermaid).toMatch(/n4 --> n3\n\s+linkStyle \d+ stroke:#94a3b8;/);
    expect(mermaid).toMatch(/n5 --> n5\n\s+linkStyle \d+ stroke:#ef4444;/);
  } finally {
    await removeFixture(root);
  }
});

test("escapes module paths in Mermaid output", async () => {
  const root = await createFixture({
    "a&b.ts": "export {};\n",
    "a<b>.ts": "export {};\n",
    'a"b.ts': "export {};\n",
  });

  try {
    const graph = (await analyze(["a&b.ts", "a<b>.ts", 'a"b.ts'], { cwd: root })).graph;
    const mermaid = renderMermaid(graph);

    expect(mermaid).toContain('["a&amp;b.ts"]');
    expect(mermaid).toContain('["a&lt;b&gt;.ts"]');
    expect(mermaid).toContain('["a&quot;b.ts"]');
  } finally {
    await removeFixture(root);
  }
});

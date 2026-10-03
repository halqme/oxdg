import { graphlib, layout } from "@dagrejs/dagre";
import { classifyGraph, EDGE_COLORS, isCycleEdge, NODE_STYLES } from "./node-styles.ts";
import type { GraphDirection } from "../types/render.ts";
import type { ModuleGraph } from "../types/graph.ts";

export interface SvgRenderOptions {
  direction?: GraphDirection;
}

interface LayoutEdge {
  from: string;
  to: string;
  cyclic: boolean;
}

const MIN_NODE_WIDTH = 32;
const MAX_NODE_WIDTH = 420;
const NODE_HEIGHT = 36;
const GRAPH_MARGIN = 24;
const SVG_TOP_PADDING = GRAPH_MARGIN;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll("\n", "&#10;");
}

function nodeWidth(label: string): number {
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, label.length * 8));
}

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function pathForPoints(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) {
    return "";
  }

  const [first, ...rest] = points;
  if (!first) {
    return "";
  }

  return [
    `M ${formatNumber(first.x)} ${formatNumber(first.y)}`,
    ...rest.map((point) => `L ${formatNumber(point.x)} ${formatNumber(point.y)}`),
  ].join(" ");
}

export function renderSvg(graph: ModuleGraph, options: SvgRenderOptions = {}): string {
  const direction = options.direction ?? "LR";
  const modules = [...graph.nodes.keys()].sort(compareStrings);
  const graphStyles = classifyGraph(graph);
  const nodeCategories = graphStyles.nodeCategories;
  const ids = new Map(modules.map((module, index) => [module, `n${index}`]));
  const dagreGraph = new graphlib.Graph({ directed: true });
  dagreGraph.setGraph({
    rankdir: direction,
    marginx: GRAPH_MARGIN,
    marginy: GRAPH_MARGIN,
  });
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  for (const module of modules) {
    const id = ids.get(module);
    if (id) {
      dagreGraph.setNode(id, {
        width: nodeWidth(module),
        height: NODE_HEIGHT,
      });
    }
  }

  const layoutEdges: LayoutEdge[] = [];
  const seenEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.status !== "internal" || edge.to === undefined) {
      continue;
    }
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (!from || !to) {
      continue;
    }
    const key = edgeKey(from, to);
    if (seenEdges.has(key)) {
      continue;
    }
    seenEdges.add(key);
    layoutEdges.push({ from, to, cyclic: isCycleEdge(graphStyles, edge.from, edge.to) });
    dagreGraph.setEdge(from, to);
  }

  layout(dagreGraph);

  const label = dagreGraph.graph();
  const width = Math.max(1, Math.ceil(label.width ?? 0));
  const height = Math.max(1, Math.ceil(label.height ?? 0) + SVG_TOP_PADDING);
  const elements: string[] = [];

  for (const edge of layoutEdges) {
    const points = dagreGraph.edge({ v: edge.from, w: edge.to }).points;
    const path = pathForPoints(points);
    if (path) {
      const stroke = edge.cyclic ? EDGE_COLORS.cyclic : EDGE_COLORS.normal;
      const arrowId = edge.cyclic ? "arrow-cyclic" : "arrow";
      elements.push(
        `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#${arrowId})"/>`,
      );
    }
  }

  for (const module of modules) {
    const id = ids.get(module);
    if (!id) {
      continue;
    }
    const node = dagreGraph.node(id);
    const x = node.x - node.width / 2;
    const y = node.y - node.height / 2;
    const colors = NODE_STYLES[nodeCategories.get(module) ?? "normal"];
    elements.push(
      `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(node.width)}" height="${formatNumber(node.height)}" rx="7" fill="#ffffff" stroke="${colors.stroke}" stroke-width="1"/>`,
    );
    elements.push(
      `<text x="${formatNumber(node.x)}" y="${formatNumber(node.y)}" fill="${colors.text}" font-family="sans-serif" font-size="14" text-anchor="middle" dominant-baseline="middle">${escapeXml(module)}</text>`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "  <defs>",
    '    <marker id="arrow" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">',
    `      <path d="M 0 0 L 10 3.5 L 0 7 Z" fill="${EDGE_COLORS.normal}"/>`,
    "    </marker>",
    '    <marker id="arrow-cyclic" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">',
    `      <path d="M 0 0 L 10 3.5 L 0 7 Z" fill="${EDGE_COLORS.cyclic}"/>`,
    "    </marker>",
    "  </defs>",
    `  <g transform="translate(0 ${SVG_TOP_PADDING})">`,
    ...elements.map((element) => `    ${element}`),
    "  </g>",
    "</svg>",
  ].join("\n");
}

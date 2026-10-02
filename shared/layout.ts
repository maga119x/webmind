import { descendants, type MindMap } from "./model";
export type Box = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
};
const colors = ["#2e8d77", "#568dc9", "#ca9350", "#a279b2", "#dc8073"];
export function cloudBounds(
  m: MindMap,
  boxes: Record<string, Box>,
  id: string,
): Box {
  const children = descendants(m, id)
    .map((x) => boxes[x])
    .filter(Boolean);
  const x = Math.min(...children.map((b) => b.x)),
    y = Math.min(...children.map((b) => b.y));
  return {
    ...boxes[id],
    x,
    y,
    w: Math.max(...children.map((b) => b.x + b.w)) - x,
    h: Math.max(...children.map((b) => b.y + b.h)) - y,
  };
}
export function cloudPath(b: Box) {
  return `M${b.x - 12} ${b.y - 4} Q${b.x - 25} ${b.y - 20} ${b.x + 10} ${b.y - 16} Q${b.x + b.w / 2} ${b.y - 35} ${b.x + b.w - 5} ${b.y - 16} Q${b.x + b.w + 28} ${b.y - 25} ${b.x + b.w + 18} ${b.y + 12} Q${b.x + b.w + 35} ${b.y + b.h / 2} ${b.x + b.w + 14} ${b.y + b.h - 5} Q${b.x + b.w + 25} ${b.y + b.h + 26} ${b.x + b.w - 12} ${b.y + b.h + 15} Q${b.x + b.w / 2} ${b.y + b.h + 35} ${b.x + 5} ${b.y + b.h + 15} Q${b.x - 30} ${b.y + b.h + 25} ${b.x - 17} ${b.y + b.h - 10} Q${b.x - 32} ${b.y + b.h / 2} ${b.x - 12} ${b.y - 4} Z`;
}
export function layout(m: MindMap) {
  const boxes: Record<string, Box> = {};
  const heights: Record<string, number> = {};
  const sizes: Record<string, { w: number; h: number }> = {};
  function measure(id: string): number {
    const n = m.nodes[id],
      size = n.style.size ?? (id === m.root ? 21 : 16);
    const w =
      id === m.root
        ? 248
        : Math.max(
            150,
            Math.min(
              270,
              Math.max(
                ...n.text
                  .split("\n")
                  .map((t) =>
                    [...t].reduce(
                      (v, c) => v + (/[\u0000-\u00ff]/.test(c) ? 0.58 : 1),
                      0,
                    ),
                  ),
              ) *
                size +
                48,
            ),
          );
    const lines = n.text
      .split("\n")
      .reduce(
        (a, t) =>
          a + Math.max(1, Math.ceil((t.length * size * 0.85) / (w - 32))),
        0,
      );
    const h =
      Math.max(48, lines * size * 1.45 + (id === m.root ? 42 : 26)) +
      (n.image ? 110 : 0);
    sizes[id] = { w, h };
    const children = n.folded ? [] : n.children;
    heights[id] = Math.max(
      h,
      children.reduce((a, c) => a + measure(c) + 20, 0) - 20,
    );
    return heights[id];
  }
  measure(m.root);
  function place(
    id: string,
    x: number,
    y: number,
    side: "left" | "right",
    color: string,
  ) {
    const n = m.nodes[id],
      { w, h } = sizes[id];
    boxes[id] = {
      id,
      x: x - (side === "left" ? w : 0),
      y: y - h / 2,
      w,
      h,
      color,
    };
    if (n.folded) return;
    let top = y - heights[id] / 2;
    for (const child of n.children) {
      place(
        child,
        side === "right" ? x + w + 64 : x - w - 64,
        top + heights[child] / 2,
        side,
        color,
      );
      top += heights[child] + 20;
    }
  }
  const r = sizes[m.root];
  boxes[m.root] = {
    id: m.root,
    x: -r.w / 2,
    y: -r.h / 2,
    ...r,
    color: "#244b40",
  };
  for (const side of ["left", "right"] as const) {
    const kids = m.nodes[m.root].folded
      ? []
      : m.nodes[m.root].children.filter((id) => m.nodes[id].side === side);
    const total = kids.reduce((s, id) => s + heights[id] + 28, 0) - 28;
    let top = -total / 2;
    kids.forEach((id, i) => {
      place(
        id,
        (side === "right" ? 1 : -1) * (r.w / 2 + 80),
        top + heights[id] / 2,
        side,
        colors[i % colors.length],
      );
      top += heights[id] + 28;
    });
  }
  // Manual offsets are relative to automatic layout and inherited by descendants.
  const shifted: [string, number, number][] = [[m.root, 0, 0]];
  while (shifted.length) {
    const [id, px, py] = shifted.pop()!;
    if (!boxes[id]) continue;
    const dx = px + (m.nodes[id].offset?.x ?? 0),
      dy = py + (m.nodes[id].offset?.y ?? 0);
    boxes[id].x += dx;
    boxes[id].y += dy;
    for (const child of m.nodes[id].children) shifted.push([child, dx, dy]);
  }
  const values = Object.values(boxes);
  const minX = Math.min(...values.map((b) => b.x)) - 60,
    minY = Math.min(...values.map((b) => b.y)) - 60;
  return {
    boxes,
    minX,
    minY,
    width: Math.max(...values.map((b) => b.x + b.w)) - minX + 60,
    height: Math.max(...values.map((b) => b.y + b.h)) - minY + 60,
  };
}

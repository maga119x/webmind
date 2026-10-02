import { descendants, type MindMap } from "./model";

// A selected branch carries its descendants exactly once, in document order.
export function selectionRoots(m: MindMap, ids: string[]) {
  const chosen = new Set(ids),
    result: string[] = [],
    stack = [m.root];
  while (stack.length) {
    const id = stack.pop()!;
    if (chosen.has(id)) result.push(id);
    else stack.push(...[...m.nodes[id].children].reverse());
  }
  return result;
}
export function reorderNodes(m: MindMap, ids: string[], delta: number) {
  const chosen = new Set(selectionRoots(m, ids));
  for (const p of Object.values(m.nodes)) {
    for (const side of p.id === m.root ? ["left", "right"] : ["all"]) {
      const slots = p.children
        .map((id, i) => ({ id, i }))
        .filter(({ id }) => side === "all" || m.nodes[id].side === side);
      const order = slots.map((s) => s.id);
      const indices = order.map((_, i) => i);
      if (delta > 0) indices.reverse();
      for (const i of indices) {
        const j = i + delta;
        if (
          chosen.has(order[i]) &&
          j >= 0 &&
          j < order.length &&
          !chosen.has(order[j])
        )
          [order[i], order[j]] = [order[j], order[i]];
      }
      slots.forEach((s, i) => {
        p.children[s.i] = order[i];
      });
    }
  }
}
export type Drop = {
  id: string;
  zone: "child" | "before" | "after";
  side?: "left" | "right";
};
export function moveBranches(m: MindMap, ids: string[], drop: Drop) {
  const roots = selectionRoots(m, ids),
    target = m.nodes[drop.id];
  const parent = drop.zone === "child" ? drop.id : target?.parent;
  if (
    !parent ||
    !target ||
    roots.includes(m.root) ||
    roots.some((id) => descendants(m, id).includes(drop.id))
  )
    return false;
  const side =
    parent === m.root
      ? (drop.side ?? (drop.zone === "child" ? undefined : target.side))
      : m.nodes[parent].side;
  for (const id of roots) {
    const n = m.nodes[id];
    m.nodes[n.parent!].children = m.nodes[n.parent!].children.filter(
      (x) => x !== id,
    );
  }
  const children = m.nodes[parent].children;
  const index =
    drop.zone === "child"
      ? children.length
      : children.indexOf(drop.id) + (drop.zone === "after" ? 1 : 0);
  children.splice(index, 0, ...roots);
  m.nodes[parent].folded = false;
  for (const id of roots) {
    m.nodes[id].parent = parent;
    delete m.nodes[id].offset;
    if (side)
      for (const child of descendants(m, id)) m.nodes[child].side = side;
  }
  return true;
}
export function shiftBranches(
  m: MindMap,
  ids: string[],
  dx: number,
  dy: number,
) {
  for (const id of selectionRoots(m, ids)) {
    const o = m.nodes[id].offset ?? { x: 0, y: 0 };
    m.nodes[id].offset = {
      x: Math.max(-100000, Math.min(100000, o.x + dx)),
      y: Math.max(-100000, Math.min(100000, o.y + dy)),
    };
  }
}
export function changeSide(m: MindMap, ids: string[], side: "left" | "right") {
  for (const id of selectionRoots(m, ids)) {
    if (id === m.root) continue;
    let n = m.nodes[id];
    while (n.parent && n.parent !== m.root) n = m.nodes[n.parent];
    for (const child of descendants(m, n.id)) {
      m.nodes[child].side = side;
      delete m.nodes[child].offset;
    }
  }
}
export function changeLevel(m: MindMap, ids: string[], outward: boolean) {
  const roots = selectionRoots(m, ids).filter((id) => id !== m.root);
  // Process each sibling group together so a multi-selection stays together.
  const groups = new Map<string, string[]>();
  for (const id of roots) {
    const key = m.nodes[id].parent! + ":" + m.nodes[id].side;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const group of groups.values()) {
    const n = m.nodes[group[0]],
      p = m.nodes[n.parent!];
    if (outward) {
      const siblings = p.children.filter((id) => m.nodes[id].side === n.side);
      const before = siblings[siblings.indexOf(n.id) - 1];
      if (before && !roots.includes(before))
        moveBranches(m, group, { id: before, zone: "child" });
    } else if (p.parent) {
      moveBranches(m, group, { id: p.id, zone: "after" });
    }
  }
}

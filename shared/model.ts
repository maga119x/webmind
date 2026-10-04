import { z } from "zod";
export const styleSchema = z.object({
  color: z.string().max(80).optional(),
  background: z.string().max(80).optional(),
  font: z.string().max(100).optional(),
  size: z.number().min(8).max(72).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  shape: z.enum(["fork", "bubble"]).optional(),
  edgeColor: z.string().max(80).optional(),
  edgeWidth: z.number().min(1).max(12).optional(),
  edgeStyle: z.enum(["bezier", "linear"]).optional(),
});
export const nodeSchema = z.object({
  id: z.string().min(1).max(200),
  parent: z.string().nullable(),
  children: z.array(z.string()),
  text: z.string().max(100000),
  side: z.enum(["left", "right"]),
  folded: z.boolean(),
  style: styleSchema,
  icons: z.array(z.string().max(100)).max(100),
  note: z.string().max(200000),
  rich: z.string().max(200000).optional(),
  link: z.string().max(4096).optional(),
  image: z.string().max(4096).optional(),
  cloud: z.boolean().optional(),
  offset: z
    .object({
      x: z.number().finite().min(-100000).max(100000),
      y: z.number().finite().min(-100000).max(100000),
    })
    .optional(),
  sourceXml: z.string().max(1000000).optional(),
});
export const mapSchema = z.object({
  version: z.literal(1),
  root: z.string(),
  nodes: z.record(z.string(), nodeSchema),
  arrows: z
    .array(
      z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        color: z.string().optional(),
      }),
    )
    .max(10000),
  sourceXml: z.string().max(1000000).optional(),
  warnings: z.array(z.string()).max(200),
});
export type MindNode = z.infer<typeof nodeSchema>;
export type MindMap = z.infer<typeof mapSchema>;
export type MapRecord = {
  id: string;
  storage: "local" | "drive" | "legacy";
  title: string;
  revision: string;
  updatedAt: string;
  document: MindMap;
  readOnly?: boolean;
  safeCopy?: boolean;
  // Browser-only hydration marker; never treat an unsynced draft as a clean read.
  recoveredDraft?: boolean;
};
export const uid = () => crypto.randomUUID();
export function node(
  text = "새 생각",
  parent: string | null = null,
  side: "left" | "right" = "right",
): MindNode {
  return {
    id: uid(),
    parent,
    children: [],
    text,
    side,
    folded: false,
    style: {},
    icons: [],
    note: "",
  };
}
export function emptyMap(title = "새 마인드맵"): MindMap {
  const root = node(title);
  return {
    version: 1,
    root: root.id,
    nodes: { [root.id]: root },
    arrows: [],
    warnings: [],
  };
}
export function validateMap(input: unknown): MindMap {
  const m = mapSchema.parse(input);
  const ids = Object.keys(m.nodes);
  if (ids.length > 10000 || !m.nodes[m.root] || m.nodes[m.root].parent !== null)
    throw Error("Invalid root or node count");
  const seen = new Set<string>();
  const stack: [string, number][] = [[m.root, 0]];
  while (stack.length) {
    const [id, depth] = stack.pop()!;
    const n = m.nodes[id];
    if (!n || seen.has(id) || n.id !== id || depth > 256)
      throw Error("Invalid tree");
    seen.add(id);
    for (const child of n.children) {
      if (m.nodes[child]?.parent !== id) throw Error("Invalid parent");
      stack.push([child, depth + 1]);
    }
  }
  if (
    seen.size !== ids.length ||
    m.arrows.some((a) => !m.nodes[a.from] || !m.nodes[a.to])
  )
    throw Error("Disconnected nodes or arrows");
  return m;
}
export function descendants(m: MindMap, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const x = stack.pop()!;
    if (m.nodes[x]) {
      out.push(x);
      stack.push(...m.nodes[x].children);
    }
  }
  return out;
}
export function addNode(
  m: MindMap,
  parent: string,
  text = "새 생각",
  after?: string,
) {
  const p = m.nodes[parent];
  const n = node(text, parent, p.side);
  m.nodes[n.id] = n;
  p.folded = false;
  const i = after ? p.children.indexOf(after) + 1 : p.children.length;
  p.children.splice(i, 0, n.id);
  return n.id;
}
export function removeNodes(m: MindMap, ids: string[]) {
  const deleted = new Set(
    ids.filter((x) => x !== m.root).flatMap((x) => descendants(m, x)),
  );
  for (const id of deleted) {
    const n = m.nodes[id];
    if (n?.parent && !deleted.has(n.parent))
      m.nodes[n.parent].children = m.nodes[n.parent].children.filter(
        (x) => x !== id,
      );
    delete m.nodes[id];
  }
  m.arrows = m.arrows.filter((a) => !deleted.has(a.from) && !deleted.has(a.to));
}
export function moveNode(
  m: MindMap,
  id: string,
  parent: string,
  index?: number,
) {
  if (
    !m.nodes[id] ||
    id === m.root ||
    !m.nodes[parent] ||
    descendants(m, id).includes(parent)
  )
    return false;
  const n = m.nodes[id];
  const old = m.nodes[n.parent!];
  old.children = old.children.filter((x) => x !== id);
  n.parent = parent;
  m.nodes[parent].children.splice(
    index ?? m.nodes[parent].children.length,
    0,
    id,
  );
  m.nodes[parent].folded = false;
  if (parent !== m.root)
    for (const x of descendants(m, id)) m.nodes[x].side = m.nodes[parent].side;
  delete n.offset;
  return true;
}
export function copyBranches(
  m: MindMap,
  ids: string[],
  target: MindMap,
  parent: string,
) {
  const chosen = new Set(ids);
  const roots = ids.filter((id) => {
    let p = m.nodes[id]?.parent;
    while (p) {
      if (chosen.has(p)) return false;
      p = m.nodes[p].parent;
    }
    return !!m.nodes[id];
  });
  const remap = new Map<string, string>();
  for (const r of roots)
    for (const id of descendants(m, r)) remap.set(id, uid());
  for (const [old, id] of remap) {
    const n = structuredClone(m.nodes[old]);
    n.id = id;
    n.parent = remap.get(n.parent!) ?? parent;
    n.children = n.children.map((x) => remap.get(x)!);
    n.side = target.nodes[parent].side;
    target.nodes[id] = n;
  }
  for (const r of roots) target.nodes[parent].children.push(remap.get(r)!);
  for (const a of m.arrows)
    if (remap.has(a.from) && remap.has(a.to))
      target.arrows.push({
        ...a,
        id: uid(),
        from: remap.get(a.from)!,
        to: remap.get(a.to)!,
      });
  target.nodes[parent].folded = false;
  return roots.map((x) => remap.get(x)!);
}
export function reveal(m: MindMap, id: string) {
  let p = m.nodes[id]?.parent;
  while (p) {
    m.nodes[p].folded = false;
    p = m.nodes[p].parent;
  }
}
export function demoMap() {
  const m = emptyMap("나의 새로운 아이디어");
  for (const [text, side, children] of [
    ["목표와 방향", "right", ["우리가 해결할 문제", "성공의 기준"]],
    ["실행 계획", "right", ["작게 시작하기", "다음 단계 정하기"]],
    ["영감 모으기", "left", ["좋아하는 레퍼런스", "떠오르는 생각"]],
    ["함께 생각하기", "left", ["새로운 관점", "질문을 남겨보세요"]],
  ] as const) {
    const id = addNode(m, m.root, text);
    m.nodes[id].side = side;
    for (const t of children) addNode(m, id, t);
  }
  return m;
}

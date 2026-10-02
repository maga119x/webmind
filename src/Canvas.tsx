import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { ChevronRight, ChevronDown, StickyNote, Link2 } from "lucide-react";
import { descendants, type MindMap } from "../shared/model";
import { selectionRoots, type Drop } from "../shared/movement";
import type { layout as layoutFn } from "../shared/layout";
import { cloudBounds, cloudPath } from "../shared/layout";
import { ICONS, safeRich } from "./Editor";
import ManagedImage from "./ManagedImage";
import { managedImage } from "./local-store";
type View = { x: number; y: number; scale: number };
type Props = {
  map: MindMap;
  user: string;
  layout: ReturnType<typeof layoutFn>;
  selected: string[];
  setSelected: (ids: string[]) => void;
  editing: string | null;
  setEditing: (id: string | null) => void;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  fitTrigger: number;
  focusTrigger: number;
  freeMode: boolean;
  panMode: boolean;
  multiSelect: boolean;
  lang: string;
  onText: (id: string, text: string) => void;
  onFold: (id: string) => void;
  onMove: (ids: string[], drop: Drop) => void;
  onOffset: (ids: string[], dx: number, dy: number) => void;
  onInspect: () => void;
};
export default function Canvas(p: Props) {
  const { map: m, layout: baseLayout, selected, view, setView } = p,
    ref = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ w: 1000, h: 700 }),
    [drag, setDrag] = useState<string | null>(null),
    [target, setTarget] = useState<Drop | null>(null),
    [delta, setDelta] = useState({ x: 0, y: 0 });
  const moving = new Set(
    drag
      ? selectionRoots(m, selected.includes(drag) ? selected : [drag]).flatMap(
          (id) => descendants(m, id),
        )
      : [],
  );
  const l = drag
    ? {
        ...baseLayout,
        boxes: Object.fromEntries(
          Object.entries(baseLayout.boxes).map(([id, b]) => [
            id,
            moving.has(id) ? { ...b, x: b.x + delta.x, y: b.y + delta.y } : b,
          ]),
        ),
      }
    : baseLayout;
  const lastClick = useRef({ id: "", time: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>()),
    gesture = useRef<{
      x: number;
      y: number;
      view: View;
      id: string | null;
      distance: number;
      moved: boolean;
      free?: boolean;
    } | null>(null);
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current!;
    const scale = Math.min(
      1,
      (el.clientWidth - 90) / l.width,
      (el.clientHeight - 100) / l.height,
    );
    setView({
      scale: Math.max(0.15, scale),
      x: el.clientWidth / 2 - (l.minX + l.width / 2) * scale,
      y: el.clientHeight / 2 - (l.minY + l.height / 2) * scale,
    });
  }, []);
  useEffect(() => {
    if (!p.fitTrigger) return;
    const el = ref.current!;
    {
      const scale = Math.max(
        0.15,
        Math.min(
          1,
          (el.clientWidth - 90) / l.width,
          (el.clientHeight - 100) / l.height,
        ),
      );
      setView({
        scale,
        x: el.clientWidth / 2 - (l.minX + l.width / 2) * scale,
        y: el.clientHeight / 2 - (l.minY + l.height / 2) * scale,
      });
    }
  }, [p.fitTrigger]);
  useEffect(() => {
    const b = baseLayout.boxes[selected[0]],
      el = ref.current;
    if (!b || !el) return;
    setView((v) => {
      const left = b.x * v.scale + v.x,
        top = b.y * v.scale + v.y;
      const right = left + b.w * v.scale,
        bottom = top + b.h * v.scale;
      const dx =
        left < 36
          ? 36 - left
          : right > el.clientWidth - 36
            ? el.clientWidth - 36 - right
            : 0;
      const dy =
        top < 36
          ? 36 - top
          : bottom > el.clientHeight - 80
            ? el.clientHeight - 80 - bottom
            : 0;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
  }, [selected[0], p.focusTrigger]);
  function cancelDrag() {
    for (const id of pointers.current.keys())
      if (ref.current?.hasPointerCapture(id))
        ref.current.releasePointerCapture(id);
    pointers.current.clear();
    gesture.current = null;
    setDrag(null);
    setTarget(null);
    setDelta({ x: 0, y: 0 });
  }
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      lastClick.current = { id: "", time: 0 };
      if (e.key === "Escape") cancelDrag();
    };
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node))
        lastClick.current = { id: "", time: 0 };
    };
    window.addEventListener("keydown", cancel);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("pointerdown", outside);
    };
  }, []);
  useEffect(() => {
    const el = ref.current!;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const x = e.clientX - rect.left,
          y = e.clientY - rect.top;
        setView((v) => {
          const s = Math.max(
            0.15,
            Math.min(3, v.scale * Math.exp(-e.deltaY * 0.008)),
          );
          return {
            scale: s,
            x: x - ((x - v.x) * s) / v.scale,
            y: y - ((y - v.y) * s) / v.scale,
          };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  function down(e: React.PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as HTMLElement).closest("button,textarea,a")) return;
    ref.current?.focus({ preventScroll: true });
    const el = ref.current!,
      r = el.getBoundingClientRect();
    pointers.current.set(e.pointerId, {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    });
    el.setPointerCapture(e.pointerId);
    const hit =
      (e.target as HTMLElement).closest<HTMLElement>("[data-node]")?.dataset
        .node ?? null;
    let distance = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      distance = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        view,
        id: null,
        distance,
        moved: true,
      };
      setDrag(null);
      setTarget(null);
      return;
    }
    gesture.current = {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      view,
      id: p.panMode || e.button === 1 ? null : hit,
      distance,
      moved: false,
      free: p.freeMode || e.altKey,
    };
    if (hit && !p.panMode && e.button !== 1) {
      if (p.multiSelect || e.shiftKey || e.ctrlKey || e.metaKey)
        p.setSelected(
          selected.includes(hit)
            ? selected.length > 1
              ? selected.filter((x) => x !== hit)
              : selected
            : [...selected, hit],
        );
      else if (!selected.includes(hit)) p.setSelected([hit]);
    } else if (!p.panMode && e.button !== 1) p.setSelected([m.root]);
  }
  function dropAt(
    clientX: number,
    clientY: number,
    ids: string[],
  ): Drop | null {
    const r = ref.current!.getBoundingClientRect();
    const x = (clientX - r.left - view.x) / view.scale,
      y = (clientY - r.top - view.y) / view.scale;
    const blocked = new Set(
      selectionRoots(m, ids).flatMap((id) => descendants(m, id)),
    );
    for (const b of Object.values(baseLayout.boxes)) {
      if (
        blocked.has(b.id) ||
        x < b.x - 8 ||
        x > b.x + b.w + 8 ||
        y < b.y - 8 ||
        y > b.y + b.h + 8
      )
        continue;
      return {
        id: b.id,
        zone:
          b.id === m.root
            ? "child"
            : y < b.y + b.h * 0.25
              ? "before"
              : y > b.y + b.h * 0.75
                ? "after"
                : "child",
        side:
          b.id === m.root
            ? x < b.x + b.w / 2
              ? "left"
              : "right"
            : m.nodes[b.id].side,
      };
    }
    return null;
  }
  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    const r = ref.current!.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top;
    pointers.current.set(e.pointerId, { x, y });
    const g = gesture.current;
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()],
        dist = Math.hypot(a.x - b.x, a.y - b.y),
        cx = (a.x + b.x) / 2,
        cy = (a.y + b.y) / 2;
      if (!g.distance) return;
      const scale = Math.max(
        0.15,
        Math.min(3, (g.view.scale * dist) / g.distance),
      );
      setView({
        scale,
        x: cx - ((g.x - g.view.x) * scale) / g.view.scale,
        y: cy - ((g.y - g.view.y) * scale) / g.view.scale,
      });
      return;
    }
    const dx = x - g.x,
      dy = y - g.y;
    if (Math.hypot(dx, dy) > 7) g.moved = true;
    if (g.id) {
      if (g.moved) {
        setDrag(g.id);
        setDelta({ x: dx / g.view.scale, y: dy / g.view.scale });
        setTarget(
          g.free
            ? null
            : dropAt(
                e.clientX,
                e.clientY,
                selected.includes(g.id) ? selected : [g.id],
              ),
        );
      }
    } else setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
  }
  function up(e: React.PointerEvent) {
    const g = gesture.current;
    if (g?.id && !g.moved) {
      const now = performance.now();
      if (lastClick.current.id === g.id && now - lastClick.current.time < 400) {
        p.setEditing(g.id);
        lastClick.current = { id: "", time: 0 };
      } else lastClick.current = { id: g.id, time: now };
    }
    if (g?.id && g.moved) {
      const ids = selected.includes(g.id) ? selected : [g.id];
      const drop = g.free ? null : dropAt(e.clientX, e.clientY, ids);
      const r = ref.current!.getBoundingClientRect();
      if (drop) p.onMove(ids, drop);
      else
        p.onOffset(
          ids,
          (e.clientX - r.left - g.x) / g.view.scale,
          (e.clientY - r.top - g.y) / g.view.scale,
        );
      lastClick.current = { id: "", time: 0 };
    }
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    setDrag(null);
    setTarget(null);
    setDelta({ x: 0, y: 0 });
    if (ref.current?.hasPointerCapture(e.pointerId))
      ref.current.releasePointerCapture(e.pointerId);
  }
  const visible = Object.values(l.boxes).filter(
    (b) =>
      b.x * view.scale + view.x + b.w * view.scale > -150 &&
      b.y * view.scale + view.y + b.h * view.scale > -150 &&
      b.x * view.scale + view.x < size.w + 150 &&
      b.y * view.scale + view.y < size.h + 150,
  );
  return (
    <div
      ref={ref}
      className={`canvas ${p.panMode ? "panning" : ""} ${drag ? "dragging" : ""}`}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancelDrag}
      onContextMenu={(e) => {
        e.preventDefault();
        const id = (e.target as HTMLElement).closest<HTMLElement>("[data-node]")
          ?.dataset.node;
        if (id && !selected.includes(id)) p.setSelected([id]);
        p.onInspect();
      }}
    >
      <svg
        className="connections"
        width="100%"
        height="100%"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="9"
            markerHeight="9"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8" fill="#889a9b" />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {Object.values(l.boxes)
            .filter((b) => m.nodes[b.id].cloud)
            .map((b) => (
              <path
                key={"cloud" + b.id}
                d={cloudPath(cloudBounds(m, l.boxes, b.id))}
                fill={b.color + "14"}
                stroke={b.color + "60"}
                strokeWidth="1.5"
              />
            ))}
          {Object.values(l.boxes).map((b) => {
            const n = m.nodes[b.id],
              parent = n.parent ? l.boxes[n.parent] : null;
            if (!parent) return null;
            const left = n.side === "left",
              x1 = left ? parent.x : parent.x + parent.w,
              x2 = left ? b.x + b.w : b.x,
              y1 = parent.y + parent.h / 2,
              y2 = b.y + b.h / 2,
              mid = (x1 + x2) / 2;
            return (
              <path
                key={b.id}
                d={
                  n.style.edgeStyle === "linear"
                    ? `M${x1} ${y1} L${x2} ${y2}`
                    : `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
                }
                fill="none"
                stroke={n.style.edgeColor ?? b.color}
                strokeWidth={n.style.edgeWidth ?? 2}
                opacity=".65"
              />
            );
          })}
          {m.arrows.map((a) => {
            const from = l.boxes[a.from],
              to = l.boxes[a.to];
            if (!from || !to) return null;
            return (
              <path
                key={a.id}
                d={`M${from.x + from.w / 2} ${from.y} Q${(from.x + to.x) / 2} ${Math.min(from.y, to.y) - 100} ${to.x + to.w / 2} ${to.y}`}
                stroke={a.color ?? "#889a9b"}
                strokeWidth="1.5"
                strokeDasharray="5 4"
                fill="none"
                markerEnd="url(#arrowhead)"
              />
            );
          })}
        </g>
      </svg>
      <div
        className="nodes-layer"
        style={{
          transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
        }}
      >
        {visible.map((b) => {
          const n = m.nodes[b.id],
            root = n.id === m.root;
          return (
            <div
              key={n.id}
              data-node={n.id}
              role="treeitem"
              aria-selected={selected.includes(n.id)}
              aria-label={n.text}
              className={`mind-node ${root ? "root-node" : ""} ${selected.includes(n.id) ? "selected" : ""} ${target?.id === n.id ? `drop-target drop-${target.zone}` : ""} ${moving.has(n.id) ? "node-moving" : ""} ${n.style.shape === "fork" ? "fork-node" : ""}`}
              style={
                {
                  left: b.x,
                  top: b.y,
                  width: b.w,
                  minHeight: b.h,
                  color: n.style.color,
                  background: n.style.background,
                  fontFamily: n.style.font,
                  fontSize: n.style.size ?? (root ? 21 : 16),
                  fontWeight: n.style.bold ? 700 : undefined,
                  fontStyle: n.style.italic ? "italic" : undefined,
                  "--branch-color": b.color,
                } as React.CSSProperties
              }
              onDoubleClick={() => p.setEditing(n.id)}
            >
              {p.editing === n.id ? (
                <NodeInput
                  text={n.text}
                  onCommit={(text) => {
                    p.onText(n.id, text);
                    p.setEditing(null);
                  }}
                  onCancel={() => p.setEditing(null)}
                />
              ) : (
                <>
                  <div className="node-content">
                    {n.icons.length > 0 && (
                      <span className="node-icons">
                        {n.icons.map((x, i) => (
                          <span title={x} key={i}>
                            {ICONS[x] ?? "◇"}
                          </span>
                        ))}
                      </span>
                    )}
                    {n.rich ? (
                      <span
                        className="rich-node"
                        dangerouslySetInnerHTML={{ __html: safeRich(n.rich) }}
                      />
                    ) : (
                      <span>{n.text || "…"}</span>
                    )}
                  </div>
                  {n.image &&
                    (managedImage(n.image) ? (
                      <ManagedImage user={p.user} url={n.image} />
                    ) : (
                      <span className="missing-image">
                        {p.lang === "ko"
                          ? "이미지를 연결하세요"
                          : "Relink image"}
                      </span>
                    ))}
                  {(n.note || n.link) && (
                    <span className="node-meta">
                      {n.note && (
                        <button
                          title={p.lang === "ko" ? "메모 보기" : "View note"}
                          onClick={p.onInspect}
                        >
                          <StickyNote size={13} />
                        </button>
                      )}
                      {n.link &&
                        (/^(https?:|mailto:)/i.test(n.link) ? (
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={n.link}
                          >
                            <Link2 size={13} />
                          </a>
                        ) : n.link.startsWith("#") ? (
                          <button
                            onClick={() => {
                              if (m.nodes[n.link!.slice(1)])
                                p.setSelected([n.link!.slice(1)]);
                            }}
                            title={n.link}
                          >
                            <Link2 size={13} />
                          </button>
                        ) : (
                          <button
                            onClick={p.onInspect}
                            title={
                              p.lang === "ko"
                                ? "로컬 링크 — 속성에서 확인"
                                : "Local link — view properties"
                            }
                          >
                            <Link2 size={13} />
                          </button>
                        ))}
                    </span>
                  )}
                </>
              )}
              {n.children.length > 0 && (
                <button
                  className={`fold-button ${n.side === "left" && !root ? "left" : ""}`}
                  aria-label={n.folded ? "Expand" : "Collapse"}
                  onClick={() => p.onFold(n.id)}
                >
                  {n.folded ? (
                    <span>{n.children.length}</span>
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {drag && (
        <div className="drag-hint">
          {p.lang === "ko"
            ? target
              ? `${m.nodes[target.id].text.slice(0, 20)} · ${target.zone === "child" ? "하위로 이동" : target.zone === "before" ? "앞에 삽입" : "뒤에 삽입"} · Esc 취소`
              : "자유배치 · 하위 가지도 함께 이동 · Esc 취소"
            : target
              ? `${target.zone === "child" ? "Move under" : target.zone === "before" ? "Insert before" : "Insert after"}: ${m.nodes[target.id].text.slice(0, 20)} · Esc to cancel`
              : "Free position · Move entire branch · Esc to cancel"}
        </div>
      )}
    </div>
  );
}
function NodeInput({
  text,
  onCommit,
  onCancel,
}: {
  text: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(text),
    ref = useRef<HTMLTextAreaElement>(null),
    done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  function commit() {
    if (!done.current) {
      done.current = true;
      onCommit(value);
    }
  }
  return (
    <textarea
      ref={ref}
      aria-label="Edit node"
      className="inline-editor"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
    />
  );
}

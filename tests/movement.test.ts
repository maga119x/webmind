import { describe, it, expect } from "vitest";
import { addNode, emptyMap, validateMap, copyBranches } from "../shared/model";
import {
  changeLevel,
  changeSide,
  moveBranches,
  reorderNodes,
  shiftBranches,
} from "../shared/movement";
import { layout } from "../shared/layout";
import { exportMM, importMM } from "../shared/freemind";

describe("branch movement", () => {
  it("reorders selected blocks once and never jumps across the other side", () => {
    const m = emptyMap(),
      a = addNode(m, m.root, "a"),
      left = addNode(m, m.root, "left"),
      b = addNode(m, m.root, "b"),
      c = addNode(m, m.root, "c");
    m.nodes[left].side = "left";
    reorderNodes(m, [b, a], 1);
    expect(m.nodes[m.root].children).toEqual([c, left, a, b]);
    reorderNodes(m, [a, b], -1);
    expect(m.nodes[m.root].children).toEqual([a, left, b, c]);
    reorderNodes(m, [a], -1);
    expect(m.nodes[m.root].children).toEqual([a, left, b, c]);
    expect(validateMap(m)).toBeTruthy();
  });
  it("drops before/after, preserves selection order and carries nested selections once", () => {
    const m = emptyMap(),
      a = addNode(m, m.root, "a"),
      b = addNode(m, m.root, "b"),
      c = addNode(m, m.root, "c"),
      child = addNode(m, a, "child");
    m.arrows.push({ id: "arrow", from: child, to: c });
    moveBranches(m, [b, child, a], { id: c, zone: "after" });
    expect(m.nodes[m.root].children).toEqual([c, a, b]);
    expect(m.nodes[child].parent).toBe(a);
    moveBranches(m, [b], { id: a, zone: "before" });
    expect(m.nodes[m.root].children).toEqual([c, b, a]);
    const before = structuredClone(m);
    expect(moveBranches(m, [a], { id: child, zone: "child" })).toBe(false);
    expect(m).toEqual(before);
    expect(validateMap(m)).toBeTruthy();
  });
  it("indents and outdents a multi-selection without reversing it", () => {
    const m = emptyMap(),
      a = addNode(m, m.root, "a"),
      b = addNode(m, m.root, "b"),
      c = addNode(m, m.root, "c");
    changeLevel(m, [c, b], true);
    expect(m.nodes[a].children).toEqual([b, c]);
    changeLevel(m, [c, b], false);
    expect(m.nodes[m.root].children).toEqual([a, b, c]);
    changeSide(m, [a], "left");
    moveBranches(m, [b, c], { id: a, zone: "child" });
    expect(m.nodes[b].side).toBe("left");
    moveBranches(m, [b], { id: m.root, zone: "child" });
    expect(m.nodes[b].side).toBe("left");
    changeSide(m, [m.root], "right");
    expect(m.nodes[a].side).toBe("left");
    expect(validateMap(m)).toBeTruthy();
  });
  it("offsets branches once, survives fold/unfold, schema validation, copying and XML roundtrip", () => {
    const m = emptyMap(),
      a = addNode(m, m.root, "한글"),
      b = addNode(m, a, "child"),
      c = addNode(m, m.root, "other");
    const before = layout(m);
    shiftBranches(m, [a, b], 40, -70);
    const after = layout(validateMap(m));
    expect(after.boxes[a].x - before.boxes[a].x).toBe(40);
    expect(after.boxes[b].y - before.boxes[b].y).toBeCloseTo(-70);
    expect(after.boxes[c]).toEqual(before.boxes[c]);
    const copied = copyBranches(m, [a], m, m.root)[0];
    expect(m.nodes[copied].offset).toEqual({ x: 40, y: -70 });
    m.nodes[a].folded = true;
    const restored = importMM(exportMM(m));
    expect(restored.nodes[a].offset).toEqual({ x: 40, y: -70 });
    restored.nodes[a].folded = false;
    expect(layout(restored).boxes[b]).toBeDefined();
    expect(restored.warnings).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  addNode,
  copyBranches,
  emptyMap,
  moveNode,
  removeNodes,
  validateMap,
} from "../shared/model";
import { importMM, exportMM, importText, exportText } from "../shared/freemind";
import { layout } from "../shared/layout";
describe("tree invariants", () => {
  it("rejects cycles and orphan nodes", () => {
    const m = emptyMap(),
      a = addNode(m, m.root, "a"),
      b = addNode(m, a, "b");
    expect(moveNode(m, a, b)).toBe(false);
    expect(validateMap(m)).toBeTruthy();
    m.nodes[a].parent = null;
    expect(() => validateMap(m)).toThrow();
  });
  it("moves a branch and removes dangling arrows on delete", () => {
    const m = emptyMap(),
      a = addNode(m, m.root, "a"),
      b = addNode(m, m.root, "b"),
      c = addNode(m, a, "c");
    m.arrows.push({ id: "arrow", from: c, to: b });
    moveNode(m, c, b);
    expect(m.nodes[b].children).toContain(c);
    removeNodes(m, [b]);
    expect(m.arrows).toHaveLength(0);
    expect(m.nodes[c]).toBeUndefined();
    expect(validateMap(m)).toBeTruthy();
  });
  it("copies overlapping selections only once and remaps arrows", () => {
    const m = emptyMap(),
      a = addNode(m, m.root, "a"),
      b = addNode(m, a, "b");
    m.arrows.push({ id: "a", from: a, to: b });
    const roots = copyBranches(m, [a, b], m, m.root);
    expect(roots).toHaveLength(1);
    expect(Object.keys(m.nodes)).toHaveLength(5);
    expect(m.arrows[1].from).toBe(roots[0]);
    expect(validateMap(m)).toBeTruthy();
  });
});
describe("FreeMind interchange", () => {
  const fixture = readFileSync("tests/fixtures/roundtrip.mm", "utf8");
  it("preserves Korean, multiline text, styles, notes, icons and references", () => {
    const m = importMM(fixture),
      out = exportMM(m),
      again = importMM(out);
    expect(again.nodes.left).toMatchObject({
      text: "한국어\n日本語",
      side: "left",
      folded: true,
      icons: ["idea", "full_1"],
      style: { color: "#123456", bold: true, size: 18, edgeStyle: "linear" },
    });
    expect(again.nodes.left.note).toContain("중요");
    expect(again.arrows[0]).toMatchObject({ from: "left", to: "right" });
    expect(out).toContain('CUSTOM="keep"');
    expect(out).toContain("example.extension");
    expect(out).toContain("attribute_registry");
    expect(out).toContain('custom="preserve"');
  });
  it("remaps relative images for portable bundles", () => {
    const m = importMM(fixture);
    expect(exportMM(m, { "images/photo.png": "images/1.png" })).toContain(
      'src="images/1.png"',
    );
  });
  it("keeps additional imported images and removes an explicitly deleted first image", () => {
    const m = importMM(
      '<map><node ID="r"><richcontent TYPE="NODE"><html><body><p>Label</p><img src="first.png"/><img src="second.png"/></body></html></richcontent></node></map>',
    );
    expect(m.nodes.r.text).toBe("Label");
    expect(exportMM(m)).toContain("second.png");
    m.nodes.r.image = undefined;
    const xml = exportMM(m);
    expect(xml).not.toContain("first.png");
    expect(xml).toContain("second.png");
  });
  it("rejects malformed, encrypted, duplicate-ID and entity inputs", () => {
    for (const xml of [
      "<map><node></map>",
      '<!DOCTYPE map [<!ENTITY x SYSTEM "file:///etc/passwd">]><map><node TEXT="&x;"/></map>',
      '<map><node ENCRYPTED_CONTENT="secret"/></map>',
      '<map><node ID="x"><node ID="x"/></node></map>',
    ])
      expect(() => importMM(xml)).toThrow();
  });
  it("supports indented text", () => {
    const m = importText("Root\n\tChild\n\t\tGrandchild\n\tOther");
    expect(exportText(m)).toBe("Root\n\tChild\n\t\tGrandchild\n\tOther");
  });
  it("roundtrips and lays out 5000 nodes without invalid coordinates", () => {
    const m = emptyMap("Large");
    for (let i = 0; i < 100; i++) {
      const a = addNode(m, m.root, "Branch " + i);
      m.nodes[a].side = i % 2 ? "left" : "right";
      for (let j = 0; j < 49; j++) addNode(m, a, "생각 " + j);
    }
    const started = performance.now();
    const out = importMM(exportMM(m)),
      l = layout(out);
    expect(Object.keys(out.nodes)).toHaveLength(5001);
    expect(
      Object.values(l.boxes).every(
        (b) => Number.isFinite(b.x) && Number.isFinite(b.y),
      ),
    ).toBe(true);
    console.log(
      "5001-node roundtrip + layout ms:",
      Math.round(performance.now() - started),
    );
  }, 20000);
});

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { emptyMap, node, uid, validateMap, type MindMap } from "./model";
const serializer = new XMLSerializer();
const elements = (e: any, tag?: string): any[] =>
  Array.from(e.childNodes ?? []).filter(
    (x: any) => x.nodeType === 1 && (!tag || x.nodeName === tag),
  );
const attr = (e: any, k: string) => e.getAttribute(k) || undefined;
function plainRich(e: any): string {
  if (e.nodeType === 3) return e.nodeValue ?? "";
  if (["head", "script", "style"].includes(e.nodeName?.toLowerCase()))
    return "";
  if (e.nodeName?.toLowerCase() === "br") return "\n";
  return (
    Array.from(e.childNodes ?? [])
      .map(plainRich)
      .join("") +
    (["p", "div", "li", "h1", "h2", "h3"].includes(e.nodeName?.toLowerCase())
      ? "\n"
      : "")
  );
}
function parse(xml: string) {
  if (xml.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("Unsafe or oversized XML");
  let bad = false;
  const doc = new DOMParser({
    errorHandler: {
      warning: () => {
        bad = true;
      },
      error: () => {
        bad = true;
      },
      fatalError: () => {
        bad = true;
      },
    },
  }).parseFromString(xml, "application/xml");
  if (bad || !doc.documentElement) throw Error("Invalid XML");
  return doc;
}
export function importMM(xml: string): MindMap {
  const doc = parse(xml),
    root = doc.documentElement;
  if (root.nodeName !== "map") throw Error("FreeMind map required");
  if (/\bENCRYPTED_CONTENT\s*=|<encrypted\b/i.test(xml))
    throw Error("Encrypted maps are not supported");
  const roots = elements(root, "node");
  if (roots.length !== 1) throw Error("A single root node is required");
  const m = emptyMap();
  m.nodes = {};
  const shell = root.cloneNode(true);
  for (const c of elements(shell, "node")) shell.removeChild(c);
  m.sourceXml = serializer.serializeToString(shell);
  const warnings = new Set<string>();
  let count = 0;
  function walk(
    e: any,
    parent: string | null,
    side: "left" | "right",
    depth: number,
  ): string {
    if (++count > 10000 || depth > 256)
      throw Error("Map exceeds node/depth limits");
    const n = node(
      attr(e, "TEXT") ?? "",
      parent,
      attr(e, "POSITION") === "left" ? "left" : side,
    );
    n.id = attr(e, "ID") ?? uid();
    if (m.nodes[n.id]) throw Error("Duplicate node ID");
    m.nodes[n.id] = n;
    n.folded = attr(e, "FOLDED") === "true";
    if (attr(e, "WEBMIND_DX") || attr(e, "WEBMIND_DY")) {
      const x = Number(attr(e, "WEBMIND_DX") ?? 0),
        y = Number(attr(e, "WEBMIND_DY") ?? 0);
      if (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Math.abs(x) <= 100000 &&
        Math.abs(y) <= 100000
      )
        n.offset = { x, y };
    }
    n.style = {
      color: attr(e, "COLOR"),
      background: attr(e, "BACKGROUND_COLOR"),
      shape: attr(e, "STYLE") === "bubble" ? "bubble" : "fork",
    };
    n.link = attr(e, "LINK");
    const font = elements(e, "font")[0];
    if (font) {
      n.style.font = attr(font, "NAME");
      const size = Number(attr(font, "SIZE"));
      if (size >= 8 && size <= 72) n.style.size = size;
      n.style.bold = attr(font, "BOLD") === "true";
      n.style.italic = attr(font, "ITALIC") === "true";
    }
    const edge = elements(e, "edge")[0];
    if (edge) {
      n.style.edgeColor = attr(edge, "COLOR");
      const width = Number(attr(edge, "WIDTH"));
      if (width >= 1 && width <= 12) n.style.edgeWidth = width;
      n.style.edgeStyle =
        attr(edge, "STYLE") === "linear" ? "linear" : "bezier";
    }
    n.icons = elements(e, "icon").map((x) => attr(x, "BUILTIN") ?? "");
    n.cloud = !!elements(e, "cloud").length;
    for (const rich of elements(e, "richcontent")) {
      const content = elements(rich)
        .map((x) => serializer.serializeToString(x))
        .join("");
      if (attr(rich, "TYPE") === "NOTE") n.note = content;
      else if (attr(rich, "TYPE") === "NODE") {
        n.rich = content;
        n.text = plainRich(rich)
          .split("\n")
          .map((s) => s.replace(/[\t ]+/g, " ").trim())
          .filter(Boolean)
          .join("\n");
        const img = rich.getElementsByTagName("img")[0];
        if (img) {
          n.image = attr(img, "src");
          if (n.image)
            warnings.add(
              "외부/로컬 이미지 경로가 있습니다. 표시하려면 이미지를 직접 연결하세요.",
            );
        }
        if (rich.getElementsByTagName("img").length > 1)
          warnings.add(
            "한 노드에 여러 이미지가 있습니다. 첫 이미지를 편집하며 나머지는 원본 XML에 보존합니다.",
          );
      }
    }
    for (const a of elements(e, "arrowlink"))
      m.arrows.push({
        id: attr(a, "ID") ?? uid(),
        from: n.id,
        to: attr(a, "DESTINATION") ?? "",
        color: attr(a, "COLOR"),
      });
    const known = new Set([
      "node",
      "font",
      "edge",
      "icon",
      "cloud",
      "richcontent",
      "arrowlink",
    ]);
    if (
      elements(e).some((x) => !known.has(x.nodeName)) ||
      Array.from(e.attributes).some(
        (a: any) =>
          ![
            "ID",
            "TEXT",
            "POSITION",
            "FOLDED",
            "COLOR",
            "BACKGROUND_COLOR",
            "STYLE",
            "LINK",
            "CREATED",
            "MODIFIED",
            "WEBMIND_DX",
            "WEBMIND_DY",
          ].includes(a.name),
      )
    )
      warnings.add(
        "지원하지 않는 확장 데이터는 보존됩니다. 해당 기능의 동작은 재현되지 않을 수 있습니다.",
      );
    const shallow = e.cloneNode(true);
    for (const c of elements(shallow, "node")) shallow.removeChild(c);
    n.sourceXml = serializer.serializeToString(shallow);
    n.children = elements(e, "node").map((c) =>
      walk(c, n.id, n.side, depth + 1),
    );
    return n.id;
  }
  m.root = walk(roots[0], null, "right", 0);
  const valid = m.arrows.filter((a) => m.nodes[a.to]);
  if (valid.length !== m.arrows.length)
    warnings.add("대상이 없는 연결선은 원본 확장 데이터에 남겨두었습니다.");
  m.arrows = valid;
  m.warnings = [...warnings];
  return validateMap(m);
}
export function exportMM(
  m: MindMap,
  imagePaths: Record<string, string> = {},
): string {
  validateMap(m);
  const doc = parse(m.sourceXml ?? '<map version="1.0.1"/>'),
    root = doc.documentElement;
  function build(id: string): any {
    const n = m.nodes[id];
    const e = n.sourceXml
      ? doc.importNode(parse(n.sourceXml).documentElement, true)
      : doc.createElement("node");
    const set = (el: any, k: string, v: unknown) => {
      if (v !== undefined && v !== null && v !== "")
        el.setAttribute(k, String(v));
      else el.removeAttribute(k);
    };
    for (const c of elements(e, "node")) e.removeChild(c);
    set(e, "ID", id);
    set(e, "TEXT", n.rich ? undefined : n.text);
    set(e, "POSITION", n.parent === m.root ? n.side : undefined);
    set(e, "FOLDED", n.folded ? "true" : undefined);
    set(e, "WEBMIND_DX", n.offset?.x);
    set(e, "WEBMIND_DY", n.offset?.y);
    set(e, "COLOR", n.style.color);
    set(e, "BACKGROUND_COLOR", n.style.background);
    set(e, "STYLE", n.style.shape);
    set(e, "LINK", n.link);
    const one = (tag: string) => {
      let x = elements(e, tag)[0];
      if (!x) {
        x = doc.createElement(tag);
        e.appendChild(x);
      }
      return x;
    };
    const f = one("font");
    set(f, "NAME", n.style.font);
    set(f, "SIZE", n.style.size);
    set(f, "BOLD", n.style.bold ? "true" : undefined);
    set(f, "ITALIC", n.style.italic ? "true" : undefined);
    const edge = one("edge");
    set(edge, "COLOR", n.style.edgeColor);
    set(edge, "WIDTH", n.style.edgeWidth);
    set(edge, "STYLE", n.style.edgeStyle);
    for (const x of elements(e, "icon")) e.removeChild(x);
    for (const icon of n.icons) {
      const x = doc.createElement("icon");
      x.setAttribute("BUILTIN", icon);
      e.appendChild(x);
    }
    if (n.cloud) one("cloud");
    else for (const x of elements(e, "cloud")) e.removeChild(x);
    for (const x of elements(e, "richcontent"))
      if (["NODE", "NOTE"].includes(attr(x, "TYPE") ?? "")) e.removeChild(x);
    function rich(type: string, html: string) {
      const x = doc.createElement("richcontent");
      x.setAttribute("TYPE", type);
      try {
        x.appendChild(doc.importNode(parse(html).documentElement, true));
      } catch {
        const h = doc.createElement("html"),
          b = doc.createElement("body");
        b.textContent = html;
        h.appendChild(b);
        x.appendChild(h);
      }
      e.appendChild(x);
      return x;
    }
    if (n.note)
      rich(
        "NOTE",
        /^\s*<html[\s>]/i.test(n.note)
          ? n.note
          : `<html><body>${escapeXML(n.note)}</body></html>`,
      );
    let r: any;
    if (n.rich) r = rich("NODE", n.rich);
    // Only the first imported image is editable. Keep additional images intact.
    const previousImage = r?.getElementsByTagName("img")[0];
    if (previousImage && !n.image)
      previousImage.parentNode.removeChild(previousImage);
    if (n.image) {
      if (!r)
        r = rich(
          "NODE",
          `<html><body><p>${escapeXML(n.text)}</p></body></html>`,
        );
      const img = previousImage ?? doc.createElement("img");
      img.setAttribute("src", imagePaths[n.image] ?? n.image);
      const body = r.getElementsByTagName("body")[0] ?? r;
      if (!previousImage) body.appendChild(img);
    }
    const oldArrows = elements(e, "arrowlink");
    for (const a of oldArrows) e.removeChild(a);
    for (const a of m.arrows.filter((a) => a.from === id)) {
      const x =
        oldArrows.find((x) => attr(x, "ID") === a.id) ??
        doc.createElement("arrowlink");
      set(x, "ID", a.id);
      set(x, "DESTINATION", a.to);
      set(x, "COLOR", a.color ?? "#64748b");
      e.appendChild(x);
    }
    for (const a of oldArrows)
      if (!m.nodes[attr(a, "DESTINATION") ?? ""]) e.appendChild(a);
    for (const child of n.children) e.appendChild(build(child));
    return e;
  }
  root.appendChild(build(m.root));
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    serializer.serializeToString(doc)
  );
}
export const escapeXML = (v: string) =>
  v.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function exportText(m: MindMap) {
  const out: string[] = [];
  function walk(id: string, d: number) {
    const n = m.nodes[id];
    out.push("\t".repeat(d) + n.text.replace(/\n/g, " "));
    n.children.forEach((x) => walk(x, d + 1));
  }
  walk(m.root, 0);
  return out.join("\n");
}
export function importText(text: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((x) => x.trim());
  if (!lines.length) throw Error("Empty text");
  const m = emptyMap(lines[0].trim());
  const stack = [m.root];
  for (const line of lines.slice(1)) {
    const indent = line.match(/^\s*/)?.[0] ?? "";
    const level = Math.min(
      255,
      stack.length,
      Math.max(1, indent.replace(/ {2}/g, "\t").length),
    );
    const parent = stack[Math.min(level - 1, stack.length - 1)];
    const n = node(line.trim(), parent);
    m.nodes[n.id] = n;
    m.nodes[parent].children.push(n.id);
    stack[level] = n.id;
    stack.length = level + 1;
  }
  return validateMap(m);
}

/** A clipboard can contain several sibling roots; a file has one root. */
export function importOutline(text: string) {
  return importText(
    "Clipboard\n" +
      text
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => "\t" + line)
        .join("\n"),
  );
}

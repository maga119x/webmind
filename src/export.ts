import { imageBlob, managedImage } from "./local-store";
import { zipSync, strToU8 } from "fflate";
import { layout, cloudBounds, cloudPath } from "../shared/layout";
import DOMPurify from "dompurify";
import { exportMM, exportText, escapeXML } from "../shared/freemind";
import type { MindMap } from "../shared/model";
export function download(data: BlobPart, name: string, type = "text/plain") {
  const blob = new Blob([data], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const ext = (mime: string) =>
  ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  })[mime] ?? "png";
export async function exportBundle(m: MindMap, title: string, user = "guest") {
  const files: Record<string, Uint8Array> = {},
    paths: Record<string, string> = {};
  for (const n of Object.values(m.nodes)) {
    if (managedImage(n.image) && !paths[n.image]) {
      const blob = await imageBlob(user, n.image);
      const path = `images/${Object.keys(paths).length + 1}.${ext(blob.type)}`;
      paths[n.image] = path;
      files[path] = new Uint8Array(await blob.arrayBuffer());
    }
  }
  files["map.mm"] = strToU8(exportMM(m, paths));
  download(zipSync(files) as BlobPart, `${title}.zip`, "application/zip");
}
export async function svgMap(m: MindMap, user = "guest") {
  const l = layout(m),
    out: string[] = [];
  for (const b of Object.values(l.boxes).filter((b) => m.nodes[b.id].cloud))
    out.push(
      `<path d="${cloudPath(cloudBounds(m, l.boxes, b.id))}" fill="#e4f1f0" stroke="#ceded7"/>`,
    );
  for (const b of Object.values(l.boxes)) {
    const n = m.nodes[b.id];
    if (n.parent && l.boxes[n.parent]) {
      const p = l.boxes[n.parent];
      out.push(
        `<path d="M${p.x + p.w / 2},${p.y + p.h / 2} C${(p.x + b.x) / 2},${p.y + p.h / 2} ${(p.x + b.x) / 2},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h / 2}" fill="none" stroke="${escapeXML(n.style.edgeColor ?? b.color)}" stroke-width="${n.style.edgeWidth ?? 2}"/>`,
      );
    }
    out.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="${escapeXML(n.style.background ?? "#ffffff")}" stroke="${escapeXML(b.color)}"/>`,
    );
    const size = n.style.size ?? 16,
      capacity = Math.max(6, Math.floor((b.w - 24) / (size * 0.85)));
    const lines = (
      n.icons.length
        ? n.icons
            .map(
              (icon) =>
                ({
                  idea: "💡",
                  button_ok: "✓",
                  button_cancel: "×",
                  help: "?",
                  star: "★",
                })[icon] ?? (icon.startsWith("full_") ? icon.slice(5) : "◇"),
            )
            .join(" ") +
          " " +
          n.text
        : n.text
    )
      .split("\n")
      .flatMap((s) =>
        Array.from(
          { length: Math.max(1, Math.ceil(s.length / capacity)) },
          (_, i) => s.slice(i * capacity, (i + 1) * capacity),
        ),
      );
    out.push(
      `<text x="${b.x + 14}" y="${b.y + 24}" font-family="${escapeXML(n.style.font ?? "sans-serif")}" font-size="${size}" font-weight="${n.style.bold ? "bold" : "normal"}" font-style="${n.style.italic ? "italic" : "normal"}" fill="${escapeXML(n.style.color ?? "#20382f")}">${lines.map((s, i) => `<tspan x="${b.x + 14}" dy="${i ? size * 1.45 : 0}">${escapeXML(s)}</tspan>`).join("")}</text>`,
    );
    if (managedImage(n.image)) {
      const blob = await imageBlob(user, n.image);
      const data = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.readAsDataURL(blob);
      });
      out.push(
        `<image href="${data}" x="${b.x + 12}" y="${b.y + b.h - 106}" width="${b.w - 24}" height="96"/>`,
      );
    }
  }
  for (const a of m.arrows) {
    const f = l.boxes[a.from],
      t = l.boxes[a.to];
    if (f && t)
      out.push(
        `<path d="M${f.x + f.w / 2} ${f.y + f.h / 2} Q${(f.x + t.x) / 2} ${Math.min(f.y, t.y) - 80} ${t.x + t.w / 2} ${t.y + t.h / 2}" stroke="${escapeXML(a.color ?? "#76869a")}" fill="none" marker-end="url(#arrow)"/>`,
      );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="${l.minX} ${l.minY} ${l.width} ${l.height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#76869a"/></marker></defs><rect x="${l.minX}" y="${l.minY}" width="${l.width}" height="${l.height}" fill="#f7f9f8"/>${out.join("")}</svg>`;
}
export async function exportFile(
  m: MindMap,
  title: string,
  kind: string,
  user = "guest",
) {
  title = title.replace(/[<>:"/\\|?*]/g, "_");
  if (kind === "mm")
    return download(exportMM(m), title + ".mm", "application/xml");
  if (kind === "zip") return exportBundle(m, title, user);
  if (kind === "txt") return download(exportText(m), title + ".txt");
  if (kind === "html") {
    const images: Record<string, string> = {};
    for (const n of Object.values(m.nodes))
      if (managedImage(n.image) && !images[n.image]) {
        const blob = await imageBlob(user, n.image);
        images[n.image] = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(Error("Image export failed"));
          reader.readAsDataURL(blob);
        });
      }
    const walk = (id: string): string => {
      const n = m.nodes[id];
      const label = n.rich
        ? DOMPurify.sanitize(n.rich, {
            ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "span", "br", "p"],
            ALLOWED_ATTR: [],
          })
        : escapeXML(n.text);
      const link =
        n.link && /^(https?:|mailto:)/i.test(n.link)
          ? ` <a href="${escapeXML(n.link)}" rel="noopener noreferrer">↗</a>`
          : "";
      const note = n.note
        ? `<div class="note">${DOMPurify.sanitize(n.note, { ALLOWED_TAGS: ["p", "br", "b", "strong", "em", "i", "ul", "ol", "li"], ALLOWED_ATTR: [] })}</div>`
        : "";
      const image =
        n.image && images[n.image]
          ? `<img src="${images[n.image]}" alt="" style="max-width:300px;max-height:200px"/>`
          : "";
      return `<li>${n.children.length ? `<details open><summary>${label}${link}</summary>${note}${image}<ul>${n.children.map(walk).join("")}</ul></details>` : label + link + note + image}</li>`;
    };
    return download(
      `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeXML(title)}</title><style>body{max-width:960px;margin:4rem auto;font:17px/1.8 system-ui;padding:20px;color:#20382f}summary{cursor:pointer}li{margin:8px}ul{border-left:1px solid #ccd9d1}</style><h1>${escapeXML(title)}</h1><ul>${walk(m.root)}</ul></html>`,
      title + ".html",
      "text/html",
    );
  }
  const svg = await svgMap(m, user);
  if (kind === "svg") return download(svg, title + ".svg", "image/svg+xml");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(2, 8192 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(img.width * scale);
    canvas.height = Math.ceil(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (kind === "print") {
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;width:0;height:0;border:0";
      document.body.appendChild(frame);
      const d = frame.contentDocument!;
      d.open();
      d.write(
        `<html><title>${escapeXML(title)}</title><style>@page{size:landscape;margin:10mm}img{max-width:100%;max-height:95vh;object-fit:contain}</style><img src="${canvas.toDataURL()}"/></html>`,
      );
      d.close();
      frame.contentWindow!.onafterprint = () => frame.remove();
      setTimeout(() => frame.contentWindow!.print(), 300);
      return;
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(Error("Export failed")))),
    );
    download(blob, title + ".png", "image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

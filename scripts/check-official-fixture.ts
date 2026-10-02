import { readFileSync, writeFileSync } from "node:fs";
import { importMM, exportMM } from "../shared/freemind";
const input = process.argv[2];
if (!input) throw Error("Pass an official FreeMind .mm fixture");
const source = readFileSync(input, "utf8");
const map = importMM(source);
const exported = exportMM(map);
const roundtrip = importMM(exported);
if (Object.keys(map.nodes).length !== Object.keys(roundtrip.nodes).length)
  throw Error("Node count changed");
for (const id of Object.keys(map.nodes)) {
  const a = map.nodes[id],
    b = roundtrip.nodes[id];
  if (
    a.text !== b.text ||
    a.parent !== b.parent ||
    JSON.stringify(a.children) !== JSON.stringify(b.children) ||
    a.note !== b.note
  )
    throw Error("Content mismatch: " + id);
}
writeFileSync(".browser/official-roundtrip.mm", exported);
console.log({
  nodes: Object.keys(map.nodes).length,
  arrows: map.arrows.length,
  warnings: map.warnings.length,
  output: ".browser/official-roundtrip.mm",
});

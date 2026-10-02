export function plainNote(note: string) {
  return /^\s*<html[\s>]/i.test(note)
    ? (new DOMParser().parseFromString(note, "text/html").body.textContent ??
        "")
    : note;
}
export function replaceLiteral(
  text: string,
  query: string,
  replacement: string,
) {
  if (!query) return text;
  return text.replace(
    new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    () => replacement,
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Minus,
  Undo2,
  Redo2,
  Search,
  Download,
  Upload,
  ChevronDown,
  ChevronRight,
  Settings2,
  Maximize,
  Move,
  PanelRightClose,
  MousePointer2,
  GitBranch,
  FileText,
  Check,
  CloudOff,
  Copy,
  Scissors,
  Trash2,
  Link2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  X,
  HelpCircle,
  ImagePlus,
  Save,
  Menu,
} from "lucide-react";
import DOMPurify from "dompurify";
import {
  addNode,
  copyBranches,
  descendants,
  emptyMap,
  removeNodes,
  reveal,
  uid,
  validateMap,
  type MindMap,
  type MindNode,
  type MapRecord,
} from "../shared/model";
import { importMM, importText, importOutline } from "../shared/freemind";
import { layout } from "../shared/layout";
import {
  changeLevel,
  changeSide,
  moveBranches,
  reorderNodes,
  selectionRoots,
  shiftBranches,
} from "../shared/movement";
import { api } from "./api";
import { storeImage } from "./local-store";
import { pickDriveFile } from "./drive";
import { usePersistence } from "./persistence";
import { exportFile } from "./export";
import Canvas from "./Canvas";
import { plainNote, replaceLiteral } from "./text";
export const ICONS: Record<string, string> = {
  idea: "💡",
  yes: "✓",
  button_ok: "✅",
  button_cancel: "❌",
  help: "❓",
  messagebox_warning: "⚠️",
  bookmark: "🔖",
  pencil: "✏️",
  calendar: "📅",
  clock: "🕒",
  flag: "🚩",
  star: "⭐",
  full_1: "①",
  full_2: "②",
  full_3: "③",
  full_4: "④",
  full_5: "⑤",
  full_6: "⑥",
  full_7: "⑦",
  full_8: "⑧",
  full_9: "⑨",
  attach: "📎",
  ksmiletris: "🙂",
};
export const safeRich = (html: string) =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "b",
      "strong",
      "em",
      "i",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "span",
      "div",
      "h1",
      "h2",
      "h3",
      "blockquote",
    ],
    ALLOWED_ATTR: [],
  });
type Props = {
  user: string;
  initial: MapRecord;
  lang: "ko" | "en";
  onNew: () => void;
  onLogin: () => void;
  onCopy: (title: string, document: MindMap) => void;
  onSaveDrive: (record: MapRecord) => void;
  onConnect: () => void;
  onSnapshot: (record: MapRecord) => void;
  driveConnected: boolean;
};
export default function Editor({
  user,
  initial,
  lang,
  onNew,
  onLogin,
  onCopy,
  onSaveDrive,
  onConnect,
  onSnapshot,
  driveConnected,
}: Props) {
  const { record, remoteEpoch, change, status, flush, latest, retry } =
      usePersistence(user, initial),
    m = record.document;
  useEffect(() => onSnapshot(record), [record]);
  const t = (ko: string, en: string) => (lang === "ko" ? ko : en);
  const [selected, setSelected] = useState([m.root]),
    [editing, setEditing] = useState<string | null>(null),
    [inspector, setInspector] = useState(false),
    [find, setFind] = useState(false),
    [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState(""),
    [resultIndex, setResultIndex] = useState(0),
    [message, setMessage] = useState(""),
    [menu, setMenu] = useState(false),
    [help, setHelp] = useState(false),
    [panMode, setPanMode] = useState(false),
    [freeMode, setFreeMode] = useState(false),
    [multiSelect, setMultiSelect] = useState(false),
    [view, setView] = useState({ x: 0, y: 0, scale: 1 }),
    [fit, setFit] = useState(0),
    [focusTrigger, setFocusTrigger] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    undo = useRef<MindMap[]>([]),
    redo = useRef<MindMap[]>([]),
    clipboard = useRef<{ map: MindMap; ids: string[] } | null>(null);
  const selectedNode = m.nodes[selected[0]] ?? m.nodes[m.root];
  useEffect(() => {
    if (m.warnings.length) setMessage(m.warnings.join("\n"));
  }, [initial.id, remoteEpoch]);
  useEffect(() => {
    if (!remoteEpoch) return;
    undo.current = [];
    redo.current = [];
    setEditing(null);
    setSelected([m.root]);
    setFit((f) => f + 1);
  }, [remoteEpoch]);
  const l = useMemo(() => layout(m), [m]);
  function mutate(fn: (map: MindMap) => void) {
    if (record.storage === "legacy") {
      setMessage(
        t(
          "읽기 전용입니다. Drive로 이전하거나 복사본을 만드세요.",
          "Read only. Migrate to Drive or make a copy.",
        ),
      );
      return;
    }
    try {
      const next = structuredClone(m);
      fn(next);
      validateMap(next);
      if (JSON.stringify(next) === JSON.stringify(m)) return;
      undo.current.push(m);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
      change(next);
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  function update(patch: Partial<MindNode>) {
    mutate((next) => {
      for (const id of selected)
        if (next.nodes[id]) Object.assign(next.nodes[id], patch);
    });
  }
  function style(patch: Partial<MindNode["style"]>) {
    mutate((next) => {
      for (const id of selected)
        if (next.nodes[id]) Object.assign(next.nodes[id].style, patch);
    });
  }
  function add(sibling = false) {
    let id = "";
    mutate((next) => {
      const parent = sibling
        ? (selectedNode.parent ?? m.root)
        : selectedNode.id;
      id = addNode(
        next,
        parent,
        t("새 생각", "New thought"),
        sibling ? selectedNode.id : undefined,
      );
      if (sibling && parent === m.root && selectedNode.id !== m.root)
        next.nodes[id].side = selectedNode.side;
    });
    if (id) {
      setSelected([id]);
      setEditing(id);
    }
  }
  function history(back = true) {
    if (record.storage === "legacy") return;
    const from = back ? undo : redo,
      to = back ? redo : undo;
    const next = from.current.pop();
    if (next) {
      to.current.push(m);
      change(next);
      setSelected([next.nodes[selected[0]] ? selected[0] : next.root]);
    }
  }
  function copy(cut = false) {
    clipboard.current = { map: structuredClone(m), ids: [...selected] };
    void navigator.clipboard
      ?.writeText(selected.map((id) => m.nodes[id]?.text ?? "").join("\n"))
      .catch(() => {});
    if (cut) mutate((next) => removeNodes(next, selected));
    setMessage(
      t(
        cut ? "잘라냈습니다." : "복사했습니다.",
        cut ? "Cut to clipboard." : "Copied.",
      ),
    );
  }
  async function paste() {
    try {
      if (clipboard.current) {
        const c = clipboard.current;
        mutate((next) => copyBranches(c.map, c.ids, next, selectedNode.id));
      } else {
        const text = await navigator.clipboard.readText();
        const pasted = importOutline(text);
        mutate((next) =>
          copyBranches(
            pasted,
            pasted.nodes[pasted.root].children,
            next,
            selectedNode.id,
          ),
        );
      }
    } catch {
      setMessage(
        t(
          "브라우저의 붙여넣기 기능을 사용하세요.",
          "Use your browser paste command.",
        ),
      );
    }
  }
  function reorder(delta: number) {
    mutate((next) => reorderNodes(next, selected, delta));
  }
  function horizontalMove(direction: "left" | "right") {
    mutate((next) => {
      const ids = selectionRoots(next, selected);
      const top = ids.filter((id) => next.nodes[id].parent === next.root);
      changeSide(next, top, direction);
      const nested = ids.filter(
        (id) => next.nodes[id].parent && next.nodes[id].parent !== next.root,
      );
      for (const side of ["left", "right"] as const)
        changeLevel(
          next,
          nested.filter((id) => next.nodes[id].side === side),
          side === direction,
        );
    });
  }
  function resetPosition(all = false) {
    mutate((next) => {
      const ids = all
        ? Object.keys(next.nodes)
        : selectionRoots(next, selected).flatMap((id) => descendants(next, id));
      for (const id of ids) delete next.nodes[id].offset;
    });
  }
  const results = useMemo(
    () =>
      query
        ? Object.values(m.nodes)
            .filter((n) =>
              `${n.text} ${n.note}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((n) => n.id)
        : [],
    [m, query],
  );
  function searchNext(index = resultIndex) {
    if (!results.length) return;
    const i = ((index % results.length) + results.length) % results.length,
      id = results[i];
    mutate((next) => reveal(next, id));
    setSelected([id]);
    setResultIndex(i);
    setFocusTrigger((f) => f + 1);
  }
  useEffect(() => {
    function keys(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const el = e.target as HTMLElement;
      if (el.closest('input,textarea,select,button,a,[contenteditable="true"]'))
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Tab" || e.key === "Insert") {
        e.preventDefault();
        add();
      } else if (e.key === "Enter") {
        e.preventDefault();
        add(true);
      } else if (e.key === "F2") {
        e.preventDefault();
        setEditing(selectedNode.id);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        mutate((next) => removeNodes(next, selected));
        setSelected([selectedNode.parent ?? m.root]);
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        history(!e.shiftKey);
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        history(false);
      } else if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copy();
      } else if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        copy(true);
      } else if (mod && e.key.toLowerCase() === "v") {
        if (clipboard.current) {
          e.preventDefault();
          void paste();
        }
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFind(true);
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(Object.keys(l.boxes));
      } else if (e.key === " ") {
        e.preventDefault();
        update({ folded: !selectedNode.folded });
      } else if (
        (mod || e.altKey) &&
        e.shiftKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.altKey ? 1 : 10;
        mutate((next) =>
          shiftBranches(
            next,
            selected,
            e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
            e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
          ),
        );
      } else if (
        (mod || e.altKey) &&
        ["ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        reorder(e.key === "ArrowUp" ? -1 : 1);
      } else if (
        (mod || e.altKey) &&
        ["ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        horizontalMove(e.key === "ArrowLeft" ? "left" : "right");
      } else if (e.key === "Home") {
        e.preventDefault();
        setSelected([m.root]);
      } else if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
      ) {
        e.preventDefault();
        const p = selectedNode.parent ? m.nodes[selectedNode.parent] : null;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const side = e.key === "ArrowLeft" ? "left" : "right";
          if (p && side !== selectedNode.side) setSelected([p.id]);
          else {
            const child = selectedNode.children.find(
              (id) => p || m.nodes[id].side === side,
            );
            if (child) {
              if (selectedNode.folded) update({ folded: false });
              setSelected([child]);
            }
          }
        } else if (p) {
          const siblings = p.children.filter(
            (id) => p.id !== m.root || m.nodes[id].side === selectedNode.side,
          );
          const i = siblings.indexOf(selectedNode.id);
          setSelected([
            siblings[
              Math.max(
                0,
                Math.min(
                  siblings.length - 1,
                  i + (e.key === "ArrowUp" ? -1 : 1),
                ),
              )
            ],
          ]);
        }
      } else if (e.key === "Escape") {
        setEditing(null);
        setMenu(false);
        setFind(false);
      }
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,[contenteditable="true"]',
        )
      )
        return;
      if (!e.clipboardData) return;
      e.preventDefault();
      try {
        let text = e.clipboardData.getData("text/plain");
        const html = e.clipboardData.getData("text/html");
        if (html) {
          const doc = new DOMParser().parseFromString(
            DOMPurify.sanitize(html),
            "text/html",
          );
          const lis = [...doc.querySelectorAll("li")];
          if (lis.length)
            text = lis
              .map((li) => {
                let d = 0,
                  p = li.parentElement;
                while (p) {
                  if (p.tagName === "UL" || p.tagName === "OL") d++;
                  p = p.parentElement;
                }
                const copy = li.cloneNode(true) as HTMLElement;
                copy.querySelectorAll("ul,ol").forEach((x) => x.remove());
                return (
                  "\t".repeat(Math.max(0, d - 1)) +
                  (copy.textContent ?? "").trim()
                );
              })
              .join("\n");
        }
        if (text) {
          const pasted = importOutline(text);
          mutate((next) =>
            copyBranches(
              pasted,
              pasted.nodes[pasted.root].children,
              next,
              selectedNode.id,
            ),
          );
        }
      } catch (e: any) {
        setMessage(e.message);
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  });
  async function importFile(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      const next = file.name.toLowerCase().endsWith(".mm")
        ? importMM(text)
        : importText(text);
      if (
        !confirm(
          t(
            "현재 내용을 가져온 문서로 바꿀까요? 실행 취소할 수 있습니다.",
            "Replace this map with the imported document? You can undo.",
          ),
        )
      )
        return;
      undo.current.push(m);
      redo.current = [];
      change(next, file.name.replace(/\.[^.]+$/, ""));
      setSelected([next.root]);
      setFit((f) => f + 1);
      setMessage(
        next.warnings.join("\n") || t("문서를 가져왔습니다.", "Map imported."),
      );
    } catch (e: any) {
      setMessage(e.message);
    }
    if (input.current) input.current.value = "";
  }
  async function uploadImage(file?: File) {
    if (!file) return;
    if (record.storage === "legacy") return;
    try {
      const reference = await storeImage(user, file);
      update({ image: reference });
    } catch (e: any) {
      setMessage(
        e?.message ??
          t(
            "이미지를 이 기기에 저장하지 못했습니다.",
            "Could not store the image on this device.",
          ),
      );
    }
    if (imageInput.current) imageInput.current.value = "";
  }
  async function doExport(kind: string) {
    try {
      const warnings = [...m.warnings];
      if (
        ["mm", "zip"].includes(kind) &&
        Object.values(m.nodes).some((n) => n.offset)
      )
        warnings.push(
          t(
            "자유배치 위치는 WebMind 확장으로 보존됩니다. FreeMind에서는 자동배치되므로 같은 모양이 필요하면 SVG 또는 PNG로 내보내세요.",
            "Free positions are saved as WebMind extensions. FreeMind uses automatic layout; export SVG or PNG to keep the exact appearance.",
          ),
        );
      if (warnings.length) setMessage(warnings.join("\n"));
      await exportFile(m, record.title, kind, user);
    } catch (e: any) {
      setMessage(e.message);
    }
    setMenu(false);
  }
  const statuses: Record<string, string> = {
    saved: t("Google Drive 저장 완료", "Saved to Google Drive"),
    readonly: t("이전 서버 문서 · 읽기 전용", "Legacy document · read only"),
    connect: t(
      "Drive 재연결 필요 · 변경은 기기에 보관됨",
      "Reconnect Drive · changes kept on device",
    ),
    missing: t(
      "Drive 파일이 없거나 접근할 수 없습니다",
      "Drive file missing or inaccessible",
    ),
    "safe-copy": t(
      "변경본을 별도 Drive 파일로 저장했습니다",
      "Saved changes as a separate Drive file",
    ),
    "rate-limit": t(
      "Drive 요청 제한 · 재시도 대기",
      "Drive rate limit · retry pending",
    ),
    saving: t("저장 중…", "Saving…"),
    pending: t("저장 대기 중", "Unsaved changes"),
    local: t("이 기기에 저장됨", "Saved on this device"),
    offline: t("연결 대기 · 기기에 보관됨", "Offline · saved on device"),
    session: t("세션 만료 · 다시 로그인", "Session expired · sign in"),
    conflict: t(
      "Drive 저장본이 변경되었습니다. 현재 작업은 이 기기에 보관 중입니다.",
      "The Drive file changed. Your current work is kept on this device.",
    ),
    quota: t("저장 용량 한도에 도달했습니다", "Storage limit reached"),
    "storage-error": t(
      "기기 저장 실패 · 파일을 내보내세요",
      "Local storage failed · export a copy",
    ),
  };
  return (
    <main className="workspace">
      <div className="document-bar">
        <div className="document-identity">
          <span className="doc-symbol">
            <GitBranch size={22} />
          </span>
          <div>
            <input
              className="document-title"
              aria-label={t("문서 제목", "Map title")}
              value={record.title}
              maxLength={200}
              readOnly={record.storage === "legacy"}
              onChange={(e) =>
                change(m, e.target.value || t("제목 없음", "Untitled"))
              }
            />
            <span className={`save-status ${status}`}>
              <span className="status-dot" />
              {statuses[status]}
            </span>
          </div>
        </div>
        <div className="document-actions">
          {record.storage !== "drive" && (
            <button onClick={() => onSaveDrive(record)}>
              {record.storage === "legacy"
                ? t("Drive로 이전", "Migrate to Drive")
                : t("Drive에 저장", "Save to Drive")}
            </button>
          )}
          {record.storage === "legacy" && (
            <button
              onClick={() => onCopy(record.title + t(" 복사본", " copy"), m)}
            >
              {t("편집할 복사본", "Make an editable copy")}
            </button>
          )}
          <button
            onClick={() => input.current?.click()}
            title={t("가져오기", "Import")}
          >
            <Upload size={16} />
            <span>{t("가져오기", "Import")}</span>
          </button>
          <div className="dropdown">
            <button className="bordered" onClick={() => setMenu(!menu)}>
              <Download size={16} />
              {t("내보내기", "Export")}
              <ChevronDown size={14} />
            </button>
            {menu && (
              <div className="dropdown-menu">
                {[
                  ["mm", "FreeMind (.mm)"],
                  ["zip", t("이미지 포함 (.zip)", "With images (.zip)")],
                  ["txt", t("들여쓰기 텍스트", "Indented text")],
                  ["svg", "SVG"],
                  ["png", "PNG"],
                  ["html", t("접이식 HTML", "Foldable HTML")],
                  ["print", t("인쇄 / PDF", "Print / PDF")],
                ].map(([kind, label]) => (
                  <button key={kind} onClick={() => doExport(kind)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="icon-button"
            onClick={() => setHelp(true)}
            aria-label={t("도움말", "Help")}
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </div>
      <div className="editor-toolbar">
        <div className="tool-group">
          <button
            title={t("실행 취소 Ctrl+Z", "Undo Ctrl+Z")}
            onClick={() => history()}
            disabled={!undo.current.length}
          >
            <Undo2 size={18} />
          </button>
          <button
            title={t("다시 실행 Ctrl+Y", "Redo Ctrl+Y")}
            onClick={() => history(false)}
            disabled={!redo.current.length}
          >
            <Redo2 size={18} />
          </button>
        </div>
        <div className="tool-group">
          <button className="add-tool" onClick={() => add()}>
            <Plus size={18} />
            <span>{t("하위 생각", "Child node")}</span>
            <kbd>Tab</kbd>
          </button>
          <button
            onClick={() => add(true)}
            title={t("같은 수준 생각 Enter", "Sibling Enter")}
          >
            <GitBranch size={18} />
          </button>
        </div>
        <div className="tool-group">
          <button title={t("복사", "Copy")} onClick={() => copy()}>
            <Copy size={17} />
          </button>
          <button title={t("붙여넣기", "Paste")} onClick={() => paste()}>
            <FileText size={17} />
          </button>
          <button
            title={t("접기/펼치기 Space", "Fold/unfold Space")}
            onClick={() => update({ folded: !selectedNode.folded })}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="toolbar-spacer" />
        <button
          className={find ? "active" : ""}
          title={t("검색 Ctrl+F", "Search Ctrl+F")}
          onClick={() => setFind(!find)}
        >
          <Search size={18} />
        </button>
        <button
          className={inspector ? "active" : ""}
          onClick={() => setInspector(!inspector)}
        >
          <Settings2 size={18} />
          <span>{t("스타일", "Style")}</span>
        </button>
      </div>
      <div className="editor-body">
        <section
          className="canvas-area"
          aria-label={t("마인드맵 편집기", "Mind map editor")}
        >
          {find && (
            <div className="find-panel">
              <div>
                <Search size={17} />
                <input
                  autoFocus
                  placeholder={t("생각 검색", "Find a thought")}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setResultIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") searchNext(resultIndex + 1);
                  }}
                />
                <span>
                  {results.length
                    ? t(
                        `${resultIndex + 1} / ${results.length}`,
                        `${resultIndex + 1} / ${results.length}`,
                      )
                    : "0"}
                </span>
                <button onClick={() => searchNext(resultIndex + 1)}>
                  <ChevronDown size={17} />
                </button>
                <button onClick={() => setFind(false)}>
                  <X size={17} />
                </button>
              </div>
              <div>
                <input
                  placeholder={t("바꿀 내용", "Replace with")}
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                />
                <button
                  disabled={!query}
                  onClick={() =>
                    mutate((next) => {
                      for (const id of results) {
                        const n = next.nodes[id];
                        n.text = replaceLiteral(n.text, query, replacement);
                        n.rich = undefined;
                        n.note = replaceLiteral(
                          plainNote(n.note),
                          query,
                          replacement,
                        );
                      }
                    })
                  }
                >
                  {t("모두 바꾸기", "Replace all")}
                </button>
              </div>
            </div>
          )}
          <Canvas
            map={m}
            user={user}
            layout={l}
            selected={selected}
            setSelected={setSelected}
            editing={editing}
            setEditing={setEditing}
            view={view}
            setView={setView}
            fitTrigger={fit}
            focusTrigger={focusTrigger}
            freeMode={freeMode}
            panMode={panMode}
            multiSelect={multiSelect}
            lang={lang}
            onText={(id, text) =>
              mutate((next) => {
                next.nodes[id].text = text;
                next.nodes[id].rich = undefined;
              })
            }
            onFold={(id) =>
              mutate((next) => {
                next.nodes[id].folded = !next.nodes[id].folded;
              })
            }
            onMove={(ids, drop) =>
              mutate((next) => {
                moveBranches(next, ids, drop);
              })
            }
            onOffset={(ids, dx, dy) =>
              mutate((next) => shiftBranches(next, ids, dx, dy))
            }
            onInspect={() => setInspector(true)}
          />
          <div className="canvas-label">
            <span />{" "}
            {t("생각을 자유롭게 펼쳐보세요", "MAKE ROOM FOR YOUR IDEAS")}
          </div>
          <div className="canvas-bottom">
            <div className="view-tools">
              <button
                className={freeMode ? "active" : ""}
                aria-pressed={freeMode}
                title={t(
                  "자유배치: 겹쳐 놓아도 부모 유지",
                  "Free positioning: keep parent when overlapping",
                )}
                onClick={() => {
                  setFreeMode(!freeMode);
                  setPanMode(false);
                }}
              >
                <Move size={17} /> {t("자유배치", "Free position")}
              </button>
              <button
                className={!panMode && !freeMode ? "active" : ""}
                title={t("선택", "Select")}
                onClick={() => {
                  setPanMode(false);
                  setFreeMode(false);
                }}
              >
                <MousePointer2 size={17} />
              </button>
              <button
                className={panMode ? "active" : ""}
                title={t("화면 이동", "Pan")}
                onClick={() => {
                  setPanMode(true);
                  setFreeMode(false);
                }}
              >
                <Move size={17} />
              </button>
              <i />
              <button
                aria-label={t("축소", "Zoom out")}
                onClick={() =>
                  setView({ ...view, scale: Math.max(0.15, view.scale / 1.2) })
                }
              >
                <Minus size={17} />
              </button>
              <span>{Math.round(view.scale * 100)}%</span>
              <button
                aria-label={t("확대", "Zoom in")}
                onClick={() =>
                  setView({ ...view, scale: Math.min(3, view.scale * 1.2) })
                }
              >
                <Plus size={17} />
              </button>
              <button
                title={t("전체 보기", "Fit map")}
                onClick={() => {
                  setSelected([m.root]);
                  setFit((f) => f + 1);
                }}
              >
                <Maximize size={17} />
              </button>
            </div>
            <span className="canvas-hint">
              {t(
                "더블클릭으로 편집 · Tab으로 생각 추가",
                "Double-click to edit · Tab to add a thought",
              )}
            </span>
          </div>
        </section>
        {inspector && (
          <aside className="inspector">
            <div className="inspector-heading">
              <h3>{t("생각 다듬기", "Shape your thought")}</h3>
              <button onClick={() => setInspector(false)} aria-label="Close">
                <PanelRightClose size={18} />
              </button>
            </div>
            <div className="inspector-scroll">
              <button
                className={multiSelect ? "wide active" : "wide bordered"}
                onClick={() => setMultiSelect(!multiSelect)}
              >
                {t("여러 생각 선택", "Select multiple")}
                {multiSelect ? " ✓" : ""}
              </button>
              <div className="selected-count">
                {selected.length > 1
                  ? t(
                      `${selected.length}개 선택됨`,
                      `${selected.length} selected`,
                    )
                  : t("선택한 생각", "SELECTED THOUGHT")}
              </div>
              <textarea
                aria-label={t("노드 내용", "Node text")}
                className="node-text-field"
                value={selectedNode.text}
                onChange={(e) =>
                  update({ text: e.target.value, rich: undefined })
                }
              />
              <section>
                <h4>{t("텍스트와 모양", "Text & shape")}</h4>
                <div className="field-row">
                  <select
                    aria-label={t("글꼴", "Font")}
                    value={selectedNode.style.font ?? "sans-serif"}
                    onChange={(e) => style({ font: e.target.value })}
                  >
                    <option value="sans-serif">Sans serif</option>
                    <option value="serif">Serif</option>
                    <option value="monospace">Monospace</option>
                    {selectedNode.style.font &&
                      !["sans-serif", "serif", "monospace"].includes(
                        selectedNode.style.font,
                      ) && <option>{selectedNode.style.font}</option>}
                  </select>
                  <input
                    aria-label={t("글자 크기", "Font size")}
                    type="number"
                    min="8"
                    max="72"
                    value={selectedNode.style.size ?? 16}
                    onChange={(e) =>
                      style({ size: Number(e.target.value) || 16 })
                    }
                  />
                </div>
                <div className="field-row">
                  <button
                    className={selectedNode.style.bold ? "active" : ""}
                    onClick={() => style({ bold: !selectedNode.style.bold })}
                  >
                    <b>B</b>
                  </button>
                  <button
                    className={selectedNode.style.italic ? "active" : ""}
                    onClick={() =>
                      style({ italic: !selectedNode.style.italic })
                    }
                  >
                    <i>I</i>
                  </button>
                  <label
                    className="color-field"
                    title={t("글자 색", "Text color")}
                  >
                    A
                    <input
                      type="color"
                      aria-label={t("글자 색", "Text color")}
                      value={selectedNode.style.color ?? "#243b33"}
                      onChange={(e) => style({ color: e.target.value })}
                    />
                  </label>
                  <label
                    className="color-field"
                    title={t("배경 색", "Background")}
                  >
                    ▣
                    <input
                      type="color"
                      aria-label={t("배경 색", "Background")}
                      value={selectedNode.style.background ?? "#ffffff"}
                      onChange={(e) => style({ background: e.target.value })}
                    />
                  </label>
                </div>
                <div className="field-row">
                  <select
                    aria-label={t("노드 모양", "Node shape")}
                    value={selectedNode.style.shape ?? "bubble"}
                    onChange={(e) => style({ shape: e.target.value as any })}
                  >
                    <option value="bubble">{t("둥근 상자", "Bubble")}</option>
                    <option value="fork">{t("밑줄", "Fork")}</option>
                  </select>
                  <button
                    className={selectedNode.cloud ? "active" : ""}
                    onClick={() => update({ cloud: !selectedNode.cloud })}
                  >
                    {t("구름 영역", "Cloud")}
                  </button>
                </div>
              </section>
              <section>
                <h4>{t("아이콘", "Icons")}</h4>
                <div className="icon-grid">
                  {Object.entries(ICONS).map(([key, emoji]) => (
                    <button
                      key={key}
                      title={key}
                      aria-label={key}
                      className={
                        selectedNode.icons.includes(key) ? "active" : ""
                      }
                      onClick={() =>
                        update({
                          icons: selectedNode.icons.includes(key)
                            ? selectedNode.icons.filter((x) => x !== key)
                            : [...selectedNode.icons, key],
                        })
                      }
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                {selectedNode.icons
                  .filter((x) => !ICONS[x])
                  .map((x) => (
                    <button
                      key={x}
                      onClick={() =>
                        update({
                          icons: selectedNode.icons.filter((v) => v !== x),
                        })
                      }
                    >
                      {x} ×
                    </button>
                  ))}
              </section>
              <section>
                <h4>{t("가지와 연결", "Branches & connections")}</h4>
                <div className="field-row">
                  <label className="color-field">
                    {t("색", "Color")}
                    <input
                      type="color"
                      value={selectedNode.style.edgeColor ?? "#639580"}
                      onChange={(e) => style({ edgeColor: e.target.value })}
                    />
                  </label>
                  <input
                    aria-label={t("가지 두께", "Branch width")}
                    type="number"
                    min="1"
                    max="12"
                    value={selectedNode.style.edgeWidth ?? 2}
                    onChange={(e) =>
                      style({ edgeWidth: Number(e.target.value) || 2 })
                    }
                  />
                  <select
                    aria-label={t("가지 형태", "Branch shape")}
                    value={selectedNode.style.edgeStyle ?? "bezier"}
                    onChange={(e) =>
                      style({ edgeStyle: e.target.value as any })
                    }
                  >
                    <option value="bezier">{t("곡선", "Curve")}</option>
                    <option value="linear">{t("직선", "Line")}</option>
                  </select>
                </div>
                <select
                  aria-label={t("연결선 추가", "Add arrow")}
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      mutate((next) =>
                        next.arrows.push({
                          id: uid(),
                          from: selectedNode.id,
                          to: e.target.value,
                        }),
                      );
                  }}
                >
                  <option value="">
                    {t("다른 생각에 화살표 연결…", "Connect an arrow to…")}
                  </option>
                  {Object.values(m.nodes)
                    .filter((n) => n.id !== selectedNode.id)
                    .map((n) => (
                      <option value={n.id} key={n.id}>
                        {n.text.slice(0, 45)}
                      </option>
                    ))}
                </select>
                {m.arrows
                  .filter((a) => a.from === selectedNode.id)
                  .map((a) => (
                    <button
                      className="arrow-row"
                      key={a.id}
                      onClick={() =>
                        mutate((next) => {
                          next.arrows = next.arrows.filter(
                            (x) => x.id !== a.id,
                          );
                        })
                      }
                    >
                      ↗ {m.nodes[a.to]?.text.slice(0, 20)} <X size={14} />
                    </button>
                  ))}
              </section>
              <section>
                <h4>{t("메모와 링크", "Notes & links")}</h4>
                <textarea
                  aria-label={t("메모", "Note")}
                  placeholder={t(
                    "생각에 맥락을 더하세요…",
                    "Add a little context…",
                  )}
                  value={plainNote(selectedNode.note)}
                  onChange={(e) => update({ note: e.target.value })}
                />
                <RichEditor
                  key={selectedNode.id}
                  value={selectedNode.rich ?? ""}
                  fallback={selectedNode.text}
                  onChange={(rich, text) => update({ rich, text })}
                  lang={lang}
                />
                <label className="link-field">
                  <Link2 size={16} />
                  <input
                    aria-label={t("링크", "Link")}
                    placeholder="https://…"
                    value={selectedNode.link ?? ""}
                    onChange={(e) => update({ link: e.target.value })}
                  />
                </label>
                <button
                  className="wide bordered"
                  onClick={() => imageInput.current?.click()}
                >
                  <ImagePlus size={17} />
                  {t("이미지 연결", "Attach image")}
                </button>
                {driveConnected && record.storage === "drive" && (
                  <button
                    className="wide bordered"
                    onClick={async () => {
                      try {
                        const fileId = await pickDriveFile(true);
                        if (fileId) {
                          const result = await api<{ url: string }>(
                            `/api/maps/${record.id}/assets/relink`,
                            {
                              method: "POST",
                              body: JSON.stringify({ fileId }),
                            },
                          );
                          update({ image: result.url });
                        }
                      } catch (e: any) {
                        setMessage(e.message);
                      }
                    }}
                  >
                    {t("Drive 이미지 연결", "Attach Drive image")}
                  </button>
                )}
                {driveConnected && record.storage === "drive" && (
                  <button
                    title={t(
                      "외부 .mm 파일에 이미지를 추가할 때 파일이 들어 있는 폴더를 선택하세요. 폴더 안의 기존 파일은 각각 연결해야 합니다.",
                      "Select the folder containing an external .mm file before adding images. Existing files still need individual access.",
                    )}
                    onClick={async () => {
                      try {
                        await pickDriveFile("folder");
                      } catch (e: any) {
                        setMessage(e.message);
                      }
                    }}
                  >
                    {t("첨부 폴더 접근 허용", "Allow attachment folder access")}
                  </button>
                )}
                {selectedNode.image && (
                  <button
                    className="wide"
                    onClick={() => update({ image: undefined })}
                  >
                    {t("이미지 제거", "Remove image")}
                  </button>
                )}
              </section>
              <section>
                <h4>{t("위치와 편집", "Position & editing")}</h4>
                <p className="movement-help">
                  {t(
                    "빈 공간으로 끌면 자유배치합니다. 다른 노드의 가운데는 하위로, 위·아래 가장자리는 앞·뒤로 이동합니다.",
                    "Drag to empty space to position freely. Drop in the center to reparent, or on the top/bottom edge to reorder.",
                  )}
                </p>
                <div className="field-row">
                  <button
                    onClick={() =>
                      mutate((next) => changeLevel(next, selected, false))
                    }
                  >
                    {t("한 단계 밖으로", "Outdent")}
                  </button>
                  <button
                    onClick={() =>
                      mutate((next) => changeLevel(next, selected, true))
                    }
                  >
                    {t("한 단계 안으로", "Indent")}
                  </button>
                </div>
                <div className="field-row">
                  <button onClick={() => resetPosition()}>
                    {t("선택 가지 자동배치", "Reset branch layout")}
                  </button>
                  <button onClick={() => resetPosition(true)}>
                    {t("전체 자동배치", "Reset all layout")}
                  </button>
                </div>
                <div className="field-row">
                  {(["left", "up", "down", "right"] as const).map(
                    (direction, i) => (
                      <button
                        key={direction}
                        title={t(
                          [
                            "위치 왼쪽으로 10",
                            "위치 위로 10",
                            "위치 아래로 10",
                            "위치 오른쪽으로 10",
                          ][i],
                          `Nudge ${direction} 10`,
                        )}
                        onClick={() =>
                          mutate((next) =>
                            shiftBranches(
                              next,
                              selected,
                              direction === "left"
                                ? -10
                                : direction === "right"
                                  ? 10
                                  : 0,
                              direction === "up"
                                ? -10
                                : direction === "down"
                                  ? 10
                                  : 0,
                            ),
                          )
                        }
                      >
                        {["←", "↑", "↓", "→"][i]}
                      </button>
                    ),
                  )}
                </div>
                <div className="field-row">
                  <button
                    title={t("위로", "Move up")}
                    onClick={() => reorder(-1)}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    title={t("아래로", "Move down")}
                    onClick={() => reorder(1)}
                  >
                    <ArrowDown size={17} />
                  </button>
                  <button
                    title={t("왼쪽 가지", "Left branch")}
                    onClick={() =>
                      mutate((next) => {
                        changeSide(next, selected, "left");
                      })
                    }
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <button
                    title={t("오른쪽 가지", "Right branch")}
                    onClick={() =>
                      mutate((next) => {
                        changeSide(next, selected, "right");
                      })
                    }
                  >
                    <ArrowRight size={17} />
                  </button>
                </div>
                <select
                  aria-label={t("부모 변경", "Move under")}
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      mutate((next) => {
                        moveBranches(next, selected, {
                          id: e.target.value,
                          zone: "child",
                        });
                      });
                  }}
                >
                  <option value="">
                    {t("다른 생각 아래로 이동…", "Move under another thought…")}
                  </option>
                  {Object.values(m.nodes)
                    .filter(
                      (n) =>
                        !selected.some((id) =>
                          descendants(m, id).includes(n.id),
                        ),
                    )
                    .map((n) => (
                      <option value={n.id} key={n.id}>
                        {n.text.slice(0, 45)}
                      </option>
                    ))}
                </select>
                <div className="field-row">
                  <button onClick={() => copy(true)}>
                    <Scissors size={16} />
                    {t("잘라내기", "Cut")}
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      mutate((next) => removeNodes(next, selected));
                      setSelected([m.root]);
                    }}
                  >
                    <Trash2 size={16} />
                    {t("삭제", "Delete")}
                  </button>
                </div>
              </section>
            </div>
          </aside>
        )}
      </div>
      <footer className="status-bar">
        <span>
          {Object.keys(m.nodes).length} {t("개의 생각", "thoughts")}
          <i /> {selected.length} {t("개 선택", "selected")}
        </span>
        <span>
          FreeMind compatible <span className="footer-brand">webmind</span>
        </span>
      </footer>
      <nav className="mobile-tools">
        <button onClick={() => add()}>
          <Plus size={20} />
          {t("하위", "Child")}
        </button>
        <button onClick={() => add(true)}>
          <GitBranch size={20} />
          {t("형제", "Sibling")}
        </button>
        <button onClick={() => setEditing(selectedNode.id)}>
          <FileText size={20} />
          {t("편집", "Edit")}
        </button>
        <button onClick={() => update({ folded: !selectedNode.folded })}>
          <ChevronRight size={20} />
          {t("접기", "Fold")}
        </button>
        <button onClick={() => setInspector(!inspector)}>
          <Settings2 size={20} />
          {t("속성", "Style")}
        </button>
      </nav>
      {[
        "conflict",
        "session",
        "quota",
        "storage-error",
        "connect",
        "missing",
      ].includes(status) && (
        <div className="save-alert" role="alert">
          <CloudOff size={20} />
          <span>{statuses[status]}</span>
          {status === "conflict" && (
            <button
              onClick={() =>
                void latest()
                  .then((backup) => {
                    if (backup)
                      setMessage(
                        t(
                          `현재 작업은 내 마인드맵의 ‘${backup.title}’에 보관했습니다.`,
                          `Your work is kept as ‘${backup.title}’ in My maps.`,
                        ),
                      );
                  })
                  .catch((e) => setMessage(e.message))
              }
            >
              {t(
                "최신본 열기 · 작업은 복구본 보관",
                "Open latest · keep recovery copy",
              )}
            </button>
          )}
          {["connect", "missing", "quota"].includes(status) && (
            <button onClick={status === "connect" ? onConnect : retry}>
              {t(
                status === "connect" ? "Drive 재연결" : "재시도",
                status === "connect" ? "Reconnect Drive" : "Retry",
              )}
            </button>
          )}
          <button onClick={() => doExport("zip")}>
            {t("다운로드", "Download")}
          </button>
          {status === "conflict" ? (
            <button
              onClick={() =>
                onCopy(record.title + t(" 충돌 복사본", " conflict copy"), m)
              }
            >
              {t("복사본 저장", "Save a copy")}
            </button>
          ) : status === "session" ? (
            <button onClick={onLogin}>{t("로그인", "Sign in")}</button>
          ) : (
            <button onClick={() => doExport("zip")}>
              {t("파일로 보관", "Export backup")}
            </button>
          )}
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button onClick={() => setMessage("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <div className="overlay">
          <section
            className="dialog help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("사용 안내", "Help")}
          >
            <button
              className="close"
              onClick={() => setHelp(false)}
              aria-label="Close"
            >
              <X />
            </button>
            <h2>
              {t("생각의 속도로 편집하세요", "Edit at the speed of thought")}
            </h2>
            {[
              ["Tab / Insert", t("하위 생각 추가", "Add child")],
              ["Enter", t("같은 수준 생각 추가", "Add sibling")],
              ["F2 / Double-click", t("내용 편집", "Edit text")],
              ["Space", t("접기 / 펼치기", "Fold / unfold")],
              ["Ctrl/Cmd + Z", t("실행 취소", "Undo")],
              [
                "Ctrl/Cmd + C / X / V",
                t("복사 / 잘라내기 / 붙여넣기", "Copy / cut / paste"),
              ],
              ["Ctrl/Cmd + F", t("검색", "Search")],
              ["Shift + click", t("여러 생각 선택", "Select multiple")],
              [
                "← / ↑ / ↓ / →",
                t("화면 방향으로 선택 이동", "Navigate in visual direction"),
              ],
              ["Home", t("중심 생각 선택", "Select root")],
              [
                "Ctrl/Cmd 또는 Alt + ↑ / ↓",
                t("형제 순서 변경", "Reorder siblings"),
              ],
              [
                "Ctrl/Cmd 또는 Alt + ← / →",
                t("좌우 가지 / 계층 이동", "Change side / indent or outdent"),
              ],
              [
                "Ctrl/Cmd + Shift + 방향키",
                t("자유 위치 10씩 이동", "Nudge position by 10"),
              ],
              [
                "Alt + Shift + 방향키",
                t("자유 위치 1씩 이동", "Nudge position by 1"),
              ],
              [
                "Alt + drag / 자유배치",
                t(
                  "부모를 유지하며 자유배치",
                  "Free position without reparenting",
                ),
              ],
              ["Esc", t("드래그 취소", "Cancel drag")],
            ].map(([key, desc]) => (
              <div className="shortcut" key={key}>
                <span>{desc}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
            <p>
              {t(
                "모바일에서는 생각을 누른 뒤 아래 메뉴에서 편집하세요. 두 손가락으로 확대하거나 배경을 끌어 화면을 이동합니다.",
                "On mobile, select a thought and use the bottom toolbar. Pinch to zoom and drag the background to pan.",
              )}
            </p>
            <button
              className="primary"
              onClick={() => {
                setHelp(false);
                onNew();
              }}
            >
              {t("새 마인드맵 만들기", "Create a new map")}
            </button>
          </section>
        </div>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept=".mm,.txt"
        onChange={(e) => importFile(e.target.files?.[0])}
      />
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => uploadImage(e.target.files?.[0])}
      />
    </main>
  );
}
function RichEditor({
  value,
  fallback,
  onChange,
  lang,
}: {
  value: string;
  fallback: string;
  onChange: (html: string, text: string) => void;
  lang: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current)
      ref.current.innerHTML = value
        ? safeRich(value)
        : DOMPurify.sanitize(fallback);
  }, [value, open]);
  function save() {
    const el = ref.current!;
    const clean = safeRich(el.innerHTML);
    const doc = new DOMParser().parseFromString(
      `<html><body>${clean}</body></html>`,
      "text/html",
    );
    onChange(
      new XMLSerializer().serializeToString(doc.documentElement),
      el.textContent ?? "",
    );
  }
  return (
    <div className="rich-section">
      <button className="wide" onClick={() => setOpen(!open)}>
        {lang === "ko" ? "리치 텍스트 편집" : "Edit rich text"}
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div className="field-row">
            {[
              ["bold", "B"],
              ["italic", "I"],
              ["underline", "U"],
              ["insertUnorderedList", "•"],
            ].map(([cmd, label]) => (
              <button
                key={cmd}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  document.execCommand(cmd);
                  save();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            ref={ref}
            className="rich-input"
            contentEditable
            suppressContentEditableWarning
            onBlur={save}
            onPaste={(e) => {
              e.preventDefault();
              document.execCommand(
                "insertText",
                false,
                e.clipboardData.getData("text/plain"),
              );
            }}
          />
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  ArrowRight,
  Plus,
  FolderOpen,
  LogOut,
  Search,
  X,
  Mail,
  FilePlus2,
  Copy,
  Trash2,
} from "lucide-react";
import { api, authClient } from "./api";
import {
  demoMap,
  emptyMap,
  type MapRecord,
  type MindMap,
} from "../shared/model";
import { recover } from "./persistence";
import {
  localMaps,
  newLocal,
  readLocal,
  deleteLocal,
  localize,
  saveToDrive,
  putLocal,
  cachedRemoteMaps,
  putRemote,
  readRemote,
} from "./local-store";
import { pickDriveFile, type DriveStatus } from "./drive";
import Editor from "./Editor";
const noDrive: DriveStatus = {
  configured: false,
  googleLogin: false,
  pickerConfigured: false,
  connected: false,
  conditionalVerified: false,
};
export default function App() {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user.id ?? "guest";
  const [record, setRecord] = useState<MapRecord | null>(null),
    [auth, setAuth] = useState(false),
    [library, setLibrary] = useState(false),
    [maps, setMaps] = useState<MapRecord[]>([]),
    [filter, setFilter] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [drive, setDrive] = useState(noDrive),
    [googleLogin, setGoogleLogin] = useState(false),
    [emailAuthEnabled, setEmailAuthEnabled] = useState(true),
    [lang, setLang] = useState<"ko" | "en">(() =>
      localStorage.getItem("webmind-language") === "en" ? "en" : "ko",
    );
  const current = useRef<MapRecord | null>(null),
    operation = useRef<{ signature: string; id: string } | null>(null);
  const t = (ko: string, en: string) => (lang === "ko" ? ko : en);
  const owner = useRef(user);
  owner.current = user;
  useEffect(() => {
    api<{ googleLogin: boolean; emailAuthEnabled?: boolean }>("/api/config")
      .then((c) => {
        setGoogleLogin(c.googleLogin);
        setEmailAuthEnabled(c.emailAuthEnabled !== false);
      })
      .catch(() => {});
    if (new URLSearchParams(location.search).has("driveError"))
      setError(
        "Google Drive 연결을 완료하지 못했습니다. 권한과 운영 설정을 확인하고 다시 연결하세요.",
      );
    if (new URLSearchParams(location.search).has("driveConnected"))
      history.replaceState({}, "", location.pathname);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem("webmind-language", lang);
  }, [lang]);
  async function rows(account = user) {
    const local = await localMaps(account);
    if (account === "guest") return local;
    const remote = await api<MapRecord[]>("/api/maps").catch(() =>
      cachedRemoteMaps(account),
    );
    return [...local, ...remote];
  }
  async function load(r: MapRecord, account = user) {
    if (r.storage === "local")
      return recover(account, await readLocal(account, r.id));
    try {
      const remote = await api<MapRecord>(`/api/maps/${r.id}`);
      if (remote.storage === "drive") await putRemote(account, remote);
      return recover(account, remote);
    } catch (e) {
      const cached = await readRemote(account, r.id);
      if (cached) return recover(account, cached);
      throw e;
    }
  }

  useEffect(() => {
    if (isPending) return;
    let active = true;
    setRecord(null);
    current.current = null;
    setDrive(noDrive);
    setLibrary(false);
    operation.current = null;
    (async () => {
      let local = await localMaps(user),
        all = local;
      if (user !== "guest") {
        const status = await api<DriveStatus>("/api/drive/status").catch(
          () => noDrive,
        );
        if (active) setDrive(status);
        try {
          all = [...local, ...(await api<MapRecord[]>("/api/maps"))];
        } catch (e: any) {
          all = [...local, ...(await cachedRemoteMaps(user))];
          if (active) setError(e.message);
        }
      }
      if (!all.length) {
        const title = t(
          user === "guest" ? "아이디어의 시작" : "나의 첫 마인드맵",
          user === "guest" ? "A new idea" : "My first mind map",
        );
        if (user === "guest") {
          const demo = await recover("guest", {
            id: "demo",
            storage: "local",
            title,
            revision: "0",
            updatedAt: new Date().toISOString(),
            document: demoMap(),
          });
          await putLocal(user, demo);
          all = [demo];
        } else all = [await newLocal(user, title, emptyMap(title))];
      }
      if (active) {
        setMaps(all);
        const preferred = localStorage.getItem("webmind-last:" + user);
        const r = await load(
          all.find((r) => r.id === preferred) ?? all[0],
          user,
        );
        if (active) {
          setRecord(r);
          current.current = r;
        }
      }
    })().catch((e: any) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [user, isPending]);
  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('[aria-modal="true"]');
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement;
    const items = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'input,button,select,textarea,a[href],[tabindex="0"]',
        ),
      ].filter((e) => !e.hasAttribute("disabled") && e.offsetParent !== null);
    (dialog.querySelector<HTMLElement>("input") ?? items()[0])?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAuth(false);
        setLibrary(false);
      }
      if (e.key === "Tab") {
        const list = items(),
          first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [auth, library]);
  async function task(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function openLibrary() {
    setLibrary(true);
    await task(async () => {
      setMaps(await rows());
      if (user !== "guest") setDrive(await api("/api/drive/status"));
    });
  }
  function show(r: MapRecord) {
    if (owner.current !== user) return;
    setRecord(r);
    current.current = r;
    setLibrary(false);
  }
  async function create(
    title = t("새 마인드맵", "New mind map"),
    document = emptyMap(title),
    forceLocal = false,
  ) {
    await task(async () => {
      if (drive.connected && !forceLocal)
        show(await saveToDrive(user, title, document, crypto.randomUUID()));
      else show(await newLocal(user, title, await localize(user, document)));
    });
  }
  async function connect() {
    if (!session) {
      setAuth(true);
      setLibrary(false);
      return;
    }
    await task(async () => {
      const r = await api<{ url: string }>("/api/drive/connect", {
        method: "POST",
      });
      location.assign(r.url);
    });
  }
  async function toDrive(r: MapRecord) {
    if (!drive.connected) {
      await connect();
      return;
    }
    await task(async () => {
      const signature = JSON.stringify([r.id, r.title, r.document]);
      if (operation.current?.signature !== signature)
        operation.current = { signature, id: crypto.randomUUID() };
      const result =
        r.storage === "legacy"
          ? await api<MapRecord>(`/api/maps/${r.id}/migrate`, {
              method: "POST",
            })
          : await saveToDrive(user, r.title, r.document, operation.current.id);
      operation.current = null;
      show(result);
    });
  }
  return (
    <>
      <header className="app-header">
        <a className="brand" href="/" aria-label="WebMind">
          <span className="brand-icon">
            <BrainCircuit size={23} />
          </span>
          WebMind<span className="brand-tag">SPACE FOR IDEAS</span>
        </a>
        <div className="header-actions">
          <a
            className="info-link"
            href="/about.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("소개", "About")}
          </a>
          <button
            onClick={openLibrary}
            aria-label={t("내 마인드맵", "My maps")}
          >
            <FolderOpen size={17} />
            <span>{t("내 마인드맵", "My maps")}</span>
          </button>
          <button
            className="language"
            onClick={() => setLang(lang === "ko" ? "en" : "ko")}
          >
            {lang === "ko" ? "EN" : "한국어"}
          </button>
          {session ? (
            <button
              aria-label={t("로그아웃", "Sign out")}
              onClick={async () => {
                await authClient.signOut();
                setRecord(null);
              }}
            >
              <span className="avatar">{session.user.name.slice(0, 1)}</span>
              <LogOut size={16} />
            </button>
          ) : (
            <button className="primary small" onClick={() => setAuth(true)}>
              {emailAuthEnabled || googleLogin
                ? t("로그인 / 가입", "Sign in / Join")
                : t("저장 안내", "Storage info")}
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </header>
      {record ? (
        <Editor
          key={user + record.id}
          user={user}
          initial={record}
          lang={lang}
          onNew={() => create()}
          onLogin={() => setAuth(true)}
          onCopy={(title, document) => create(title, document)}
          onSaveDrive={toDrive}
          onConnect={connect}
          onSnapshot={(r) => {
            current.current = r;
            localStorage.setItem("webmind-last:" + user, r.id);
          }}
          driveConnected={drive.connected}
        />
      ) : (
        <div className="loading">
          {t("작업 공간을 준비하고 있습니다…", "Preparing your workspace…")}
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          {error}
          <button onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {auth && (
        <AuthDialog
          lang={lang}
          googleLogin={googleLogin}
          emailAuthEnabled={emailAuthEnabled}
          onClose={() => setAuth(false)}
        />
      )}
      {new URLSearchParams(location.search).has("token") && (
        <AuthDialog
          lang={lang}
          reset
          emailAuthEnabled={emailAuthEnabled}
          onClose={() => {
            history.replaceState({}, "", location.pathname);
            location.reload();
          }}
        />
      )}
      {library && (
        <div className="overlay">
          <section
            className="dialog library"
            role="dialog"
            aria-modal="true"
            aria-label={t("내 마인드맵", "My maps")}
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">YOUR WORKSPACE</span>
                <h2>{t("내 마인드맵", "My maps")}</h2>
              </div>
              <button aria-label="Close" onClick={() => setLibrary(false)}>
                <X />
              </button>
            </div>
            <section className="drive-settings">
              <strong>Google Drive</strong>
              <p>
                {drive.connected
                  ? drive.email
                  : t(
                      "문서는 이 기기에 저장됩니다. Drive를 연결하면 여러 기기에서 열 수 있습니다.",
                      "Documents stay on this device. Connect Drive to access them across devices.",
                    )}
              </p>
              <div className="field-row">
                <button
                  disabled={busy || (!!session && !drive.configured)}
                  onClick={connect}
                >
                  {drive.connected
                    ? t("재연결", "Reconnect")
                    : t("Drive 연결", "Connect Drive")}
                </button>
                {drive.connected && (
                  <>
                    <button
                      disabled={busy || !drive.pickerConfigured}
                      onClick={() =>
                        task(async () => {
                          setLibrary(false);
                          const fileId = await pickDriveFile();
                          if (fileId)
                            show(
                              await api("/api/drive/open", {
                                method: "POST",
                                body: JSON.stringify({ fileId }),
                              }),
                            );
                        })
                      }
                    >
                      {t("Drive에서 열기", "Open from Drive")}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        task(async () => {
                          await api("/api/drive/disconnect", {
                            method: "POST",
                          });
                          setDrive({ ...drive, connected: false });
                          setMaps(await rows());
                        })
                      }
                    >
                      {t("연결 해제", "Disconnect")}
                    </button>
                  </>
                )}
                <button disabled={busy} onClick={openLibrary}>
                  {t("새로고침", "Refresh")}
                </button>
              </div>
              {session && !drive.configured && (
                <small>
                  {t(
                    "운영자가 Google OAuth와 Picker 설정을 등록하면 연결할 수 있습니다.",
                    "Google OAuth and Picker configuration is required.",
                  )}
                </small>
              )}
              {drive.connected && !drive.conditionalVerified && (
                <small>
                  {t(
                    "원본 보호 모드: 변경은 별도 파일로 저장됩니다.",
                    "Original protection: changes are saved as separate files.",
                  )}
                </small>
              )}
              {session && googleLogin && (
                <button
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      const r = await authClient.linkSocial({
                        provider: "google",
                        callbackURL: location.origin,
                      });
                      if (r.error) throw Error(r.error.message);
                    })
                  }
                >
                  {t("Google 로그인 계정 연결", "Link Google sign-in")}
                </button>
              )}
              {session && (
                <button
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      const guest = await localMaps("guest");
                      for (const r of guest)
                        await newLocal(
                          user,
                          r.title,
                          await localize(user, r.document, "guest"),
                        );
                      setMaps(await rows());
                    })
                  }
                >
                  {t(
                    "이 기기의 게스트 문서 가져오기",
                    "Import guest documents from this device",
                  )}
                </button>
              )}
            </section>
            <div className="library-tools">
              <label className="search-field">
                <Search size={17} />
                <input
                  placeholder={t("문서 검색", "Search maps")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={busy}
                onClick={() => create()}
              >
                <Plus size={17} />
                {t("새 문서", "New map")}
              </button>
              <button
                disabled={busy}
                onClick={() => create(undefined, undefined, true)}
              >
                {t("로컬 문서", "Local map")}
              </button>
            </div>
            <div className="map-list">
              {maps
                .filter((m) =>
                  m.title.toLowerCase().includes(filter.toLowerCase()),
                )
                .map((m) => (
                  <div className="map-row" key={m.storage + ":" + m.id}>
                    <button
                      className="map-open"
                      disabled={busy}
                      onClick={() => task(async () => show(await load(m)))}
                    >
                      <FilePlus2 />
                      <span>
                        <strong>{m.title}</strong>
                        <small>
                          {m.storage === "drive"
                            ? "Google Drive"
                            : m.storage === "legacy"
                              ? t(
                                  "이전 서버 문서 · 읽기 전용",
                                  "Legacy · read only",
                                )
                              : t("로컬", "Local")}{" "}
                          ·{" "}
                          {new Date(m.updatedAt).toLocaleString(
                            lang === "ko" ? "ko-KR" : "en-US",
                          )}
                        </small>
                      </span>
                    </button>
                    {m.storage === "legacy" && (
                      <button
                        disabled={busy || !drive.connected}
                        onClick={() =>
                          task(async () =>
                            show(
                              await api(`/api/maps/${m.id}/migrate`, {
                                method: "POST",
                              }),
                            ),
                          )
                        }
                      >
                        {t("이전", "Migrate")}
                      </button>
                    )}
                    <button
                      aria-label={t("복제", "Duplicate")}
                      disabled={busy}
                      onClick={() =>
                        task(async () => {
                          const r = await load(m);
                          await create(
                            r.title + t(" 복사본", " copy"),
                            r.document,
                          );
                        })
                      }
                    >
                      <Copy size={16} />
                    </button>
                    {m.storage !== "legacy" && (
                      <button
                        aria-label={t("삭제", "Delete")}
                        disabled={busy}
                        onClick={() => {
                          if (
                            !confirm(
                              m.storage === "drive"
                                ? t(
                                    "Drive 휴지통으로 이동할까요?",
                                    "Move to Drive trash?",
                                  )
                                : t(
                                    "이 기기에서 문서를 삭제할까요?",
                                    "Delete this local document?",
                                  ),
                            )
                          )
                            return;
                          void task(async () => {
                            if (m.storage === "local")
                              await deleteLocal(user, m.id);
                            else
                              await api(`/api/maps/${m.id}`, {
                                method: "DELETE",
                              });
                            setMaps(await rows());
                            if (current.current?.id === m.id)
                              await create(undefined, undefined, true);
                          });
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function AuthDialog({
  lang,
  onClose,
  reset = false,
  googleLogin = false,
  emailAuthEnabled = true,
}: {
  lang: "ko" | "en";
  onClose: () => void;
  reset?: boolean;
  googleLogin?: boolean;
  emailAuthEnabled?: boolean;
}) {
  const [mode, setMode] = useState(reset ? "reset" : "login"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const t = (ko: string, en: string) => (lang === "ko" ? ko : en);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const fd = new FormData(e.currentTarget),
      email = String(fd.get("email") ?? ""),
      password = String(fd.get("password") ?? "");
    try {
      let r: any;
      if (mode === "signup")
        r = await authClient.signUp.email({
          email,
          password,
          name: String(fd.get("name")),
          callbackURL: location.origin,
        });
      else if (mode === "forgot")
        r = await authClient.requestPasswordReset({
          email,
          redirectTo: location.origin,
        });
      else if (mode === "reset")
        r = await authClient.resetPassword({
          newPassword: password,
          token: new URLSearchParams(location.search).get("token") ?? "",
        });
      else r = await authClient.signIn.email({ email, password });
      if (r.error) throw Error(r.error.message);
      if (mode === "login" || mode === "reset") onClose();
      else
        setMessage(
          t(
            "메일함에서 안내 링크를 확인하세요.",
            "Check your inbox for the next step.",
          ),
        );
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay">
      <section
        className="dialog auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("계정", "Account")}
      >
        <button className="close" aria-label="Close" onClick={onClose}>
          <X />
        </button>
        <span className="auth-mark">
          <BrainCircuit size={30} />
        </span>
        <h2>
          {!emailAuthEnabled && !googleLogin
            ? t("이 기기에서 시작하세요", "Start on this device")
            : mode === "signup"
              ? t("생각이 머무는 나만의 공간", "A home for your ideas")
              : mode === "forgot" || mode === "reset"
                ? t("비밀번호 재설정", "Reset password")
                : t("다시 만나서 반가워요", "Welcome back")}
        </h2>
        <p>
          {!emailAuthEnabled && !googleLogin
            ? t(
                "로그인 없이 문서를 편집하고 이 브라우저에 저장할 수 있습니다. 다른 기기로 옮길 때는 ZIP으로 다운로드하세요. 계정과 Drive 연결은 현재 준비 중입니다.",
                "Edit and save documents in this browser without an account. Download a ZIP to move your work to another device. Accounts and Drive connection are not available yet.",
              )
            : t(
                "여러 기기에서 마인드맵을 이어서 편집하세요.",
                "Keep your ideas in sync across your devices.",
              )}
        </p>
        {googleLogin && !reset && (
          <button
            className="wide bordered"
            onClick={async () => {
              const r = await authClient.signIn.social({
                provider: "google",
                callbackURL: location.origin,
              });
              if (r.error) setMessage(r.error.message ?? "Google 로그인 실패");
            }}
          >
            Google로 로그인
          </button>
        )}
        {emailAuthEnabled && (
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                {t("이름", "Name")}
                <input
                  name="name"
                  required
                  autoComplete="name"
                  maxLength={80}
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                {t("이메일", "Email")}
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label>
                {t("비밀번호 (10자 이상)", "Password (10+ characters)")}
                <input
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                />
              </label>
            )}
            <button disabled={busy} className="primary">
              {busy
                ? t("처리 중…", "Working…")
                : mode === "signup"
                  ? t("계정 만들기", "Create account")
                  : mode === "forgot"
                    ? t("재설정 메일 보내기", "Send reset email")
                    : mode === "reset"
                      ? t("비밀번호 변경", "Update password")
                      : t("로그인", "Sign in")}
              <ArrowRight size={17} />
            </button>
          </form>
        )}
        {!emailAuthEnabled && (
          <button className="primary wide" onClick={onClose}>
            {t("편집 계속하기", "Continue editing")}
          </button>
        )}
        {message && (
          <p role="status" className="form-message">
            <Mail size={18} />
            {message}
          </p>
        )}
        {emailAuthEnabled && (
          <div className="auth-links">
            <button
              onClick={() => {
                setMode(mode === "signup" ? "login" : "signup");
                setMessage("");
              }}
            >
              {mode === "signup"
                ? t("이미 계정이 있어요", "Already have an account?")
                : t("새 계정 만들기", "Create an account")}
            </button>
            <button onClick={() => setMode("forgot")}>
              {t("비밀번호를 잊었나요?", "Forgot password?")}
            </button>
          </div>
        )}
        <p className="privacy-link">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            {t("개인정보처리방침", "Privacy policy")}
          </a>
        </p>
      </section>
    </div>
  );
}

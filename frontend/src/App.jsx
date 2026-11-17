import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import DocumentEditor from "./DocumentEditor.jsx";

const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const WS_URL = (import.meta.env.VITE_WS_URL || "ws://127.0.0.1:1234").replace(/\/$/, "");
const TOKEN_KEY = "giay_access_token";
const USER_KEY = "giay_username";
const FORMATTING_KEY = "giay_formatting_preferences";
const DEFAULT_FORMATTING = {
  fontFamily: "Arial",
  fontSize: "12",
  color: "#202124",
  bold: false,
  italic: false,
  underline: false,
  alignment: "left",
};

function loadFormattingPreferences() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(FORMATTING_KEY) || "{}");
    return { ...DEFAULT_FORMATTING, ...saved };
  } catch {
    return DEFAULT_FORMATTING;
  }
}

async function request(path, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof URLSearchParams)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    let message = `Yêu cầu thất bại (${response.status})`;
    try {
      const body = await response.json(); 
      message = body.detail || message;
    } catch {
      // Keep the HTTP status message when the server does not return JSON.
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function documentDate(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function documentPreview(content) {
  if (!content) return "";
  return new DOMParser().parseFromString(content, "text/html").body.textContent || "";
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "Đã xảy ra lỗi, vui lòng thử lại.";
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        await request("/api/auth/register", null, {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
      }

      const form = new URLSearchParams({ username, password });
      const result = await request("/api/auth/login", null, {
        method: "POST",
        body: form,
      });
      onAuthenticated(result.access_token, username);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand-mark">idoc</div>
        <p className="eyebrow">KHÔNG GIAN GHI CHÉP</p>
        <h1>{mode === "login" ? "Chào mừng." : "Tạo tài khoản."}</h1>
        <p className="muted">
          {mode === "login" ? "Đăng nhập để mở tài liệu của bạn." : "Bắt đầu viết cùng idoc."}
        </p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            Tên đăng nhập
            <input
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>
          <label>
            Mật khẩu
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" disabled={busy} type="submit">
            {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Đăng ký"}
          </button>
        </form>
        <button
          className="text-button auth-switch"
          onClick={() => {
            setError("");
            setMode(mode === "login" ? "register" : "login");
          }}
          type="button"
        >
          {mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}
        </button>
      </div>
    </main>
  );
}

function Editor({ document, token, onDocumentUpdated, isOwner }) {
  const [content, setContent] = useState(document.content || "");
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState("connecting");
  const [saveState, setSaveState] = useState("saved");
  const [error, setError] = useState("");
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [visibility, setVisibility] = useState(document.visibility || "private");
  const [publicRole, setPublicRole] = useState(document.public_role || "viewer");
  const [shareUsername, setShareUsername] = useState("");
  const [shareRole, setShareRole] = useState("viewer");
  const [sharedUsers, setSharedUsers] = useState([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const textareaRef = useRef(null);
  const yTextRef = useRef(null);
  const readyRef = useRef(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    setVisibility(document.visibility || "private");
    setPublicRole(document.public_role || "viewer");
  }, [document.id, document.visibility, document.public_role]);

  useEffect(() => {
    if (!permissionsOpen || !isOwner) return undefined;
    let active = true;
    setLoadingShares(true);
    request(`/api/documents/${document.id}/shares`, token)
      .then((users) => {
        if (active) setSharedUsers(users);
      })
      .catch((loadError) => {
        if (active) setPermissionMessage(`Không thể tải danh sách chia sẻ: ${getErrorMessage(loadError)}`);
      })
      .finally(() => {
        if (active) setLoadingShares(false);
      });

    return () => {
      active = false;
    };
  }, [document.id, isOwner, permissionsOpen, token]);

  useEffect(() => {
    const yDoc = new Y.Doc();
    const yText = yDoc.getText("content");
    const socket = new WebSocket(
      `${WS_URL}/ws/documents/${encodeURIComponent(document.id)}?token=${encodeURIComponent(token)}`
    );
    socket.binaryType = "arraybuffer";
    yTextRef.current = yText;
    readyRef.current = false;
    setContent(document.content || "");
    setReady(false);
    setConnection("connecting");
    setSaveState("saved");
    setError("");

    const markReady = () => {
      if (readyRef.current) return;
      if (yText.length === 0 && document.content) {
        yText.insert(0, document.content);
      }
      readyRef.current = true;
      setReady(true);
      setContent(yText.toString());
    };
    const fallbackTimer = window.setTimeout(markReady, 1800);
    const onTextChange = () => {
      if (!readyRef.current) return;
      const nextContent = yText.toString();
      setContent(nextContent);
      setSaveState("saving");
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(async () => {
        try {
          const updated = await request(`/api/documents/${document.id}`, token, {
            method: "PUT",
            body: JSON.stringify({ content: nextContent }),
          });
          setSaveState("saved");
          setError("");
          onDocumentUpdated(updated);
        } catch (saveError) {
          setSaveState("error");
          setError(`Không thể lưu tài liệu: ${getErrorMessage(saveError)}`);
        }
      }, 700);
    };
    const onUpdate = (update, origin) => {
      if (origin === "remote" || socket.readyState !== WebSocket.OPEN) return;
      socket.send(update);
    };
    const onOpen = () => {
      setConnection("connected");
      socket.send(Y.encodeStateAsUpdate(yDoc));
    };
    const onMessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      try {
        Y.applyUpdate(yDoc, new Uint8Array(event.data), "remote");
      } catch {
        setError("Không thể đồng bộ dữ liệu tài liệu.");
        return;
      }
      window.clearTimeout(fallbackTimer);
      markReady();
    };
    const onClose = () => setConnection("disconnected");

    yText.observe(onTextChange);
    yDoc.on("update", onUpdate);
    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(saveTimerRef.current);
      yText.unobserve(onTextChange);
      yDoc.off("update", onUpdate);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.close();
      yDoc.destroy();
      yTextRef.current = null;
      readyRef.current = false;
    };
  }, [document.id, token, onDocumentUpdated]);

  function updateText(event) {
    const yText = yTextRef.current;
    if (!yText || !readyRef.current) return;
    const previous = yText.toString();
    const next = event.target.value;
    if (previous === next) return;

    let prefix = 0;
    while (
      prefix < previous.length &&
      prefix < next.length &&
      previous[prefix] === next[prefix]
    ) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < previous.length - prefix &&
      suffix < next.length - prefix &&
      previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    yText.doc.transact(() => {
      const removedLength = previous.length - prefix - suffix;
      if (removedLength > 0) yText.delete(prefix, removedLength);
      const insertedText = next.slice(prefix, next.length - suffix);
      if (insertedText) yText.insert(prefix, insertedText);
    });
  }

  async function saveVisibility(event) {
    event.preventDefault();
    setPermissionBusy(true);
    setPermissionMessage("");
    try {
      const updated = await request(`/api/documents/${document.id}/visibility`, token, {
        method: "PATCH",
        body: JSON.stringify({
          visibility,
          public_role: visibility === "public" ? publicRole : null,
        }),
      });
      onDocumentUpdated(updated);
      setPermissionMessage("Đã cập nhật quyền truy cập.");
    } catch (permissionError) {
      setPermissionMessage(getErrorMessage(permissionError));
    } finally {
      setPermissionBusy(false);
    }
  }

  async function shareDocument(event) {
    event.preventDefault();
    setPermissionBusy(true);
    setPermissionMessage("");
    try {
      await request(`/api/documents/${document.id}/share`, token, {
        method: "POST",
        body: JSON.stringify({ username: shareUsername.trim(), role: shareRole }),
      });
      const users = await request(`/api/documents/${document.id}/shares`, token);
      setSharedUsers(users);
      setPermissionMessage(`Đã chia sẻ tài liệu với ${shareUsername.trim()}.`);
      setShareUsername("");
    } catch (permissionError) {
      setPermissionMessage(getErrorMessage(permissionError));
    } finally {
      setPermissionBusy(false);
    }
  }

  const statusLabel = {
    connecting: "Đang kết nối",
    connected: "Đã kết nối",
    disconnected: "Ngoại tuyến",
  }[connection];

  return (
    <section className="editor-panel">
      <div className="editor-toolbar">
        <div className="editor-title">
          <span className="file-icon" aria-hidden="true">▤</span>
          <span>{document.title}</span>
        </div>
        <div className="toolbar-actions">
          {isOwner && (
            <button
              aria-expanded={permissionsOpen}
              className="permission-toggle"
              onClick={() => {
                setPermissionsOpen((open) => !open);
                setPermissionMessage("");
              }}
              type="button"
            >
              Quyền truy cập
            </button>
          )}
          <div className="editor-status">
            <span className={`connection-dot ${connection}`} />
            <span>{statusLabel}</span>
            <span className="status-divider">·</span>
            <span>{saveState === "saving" ? "Đang lưu…" : saveState === "error" ? "Lỗi lưu" : "Đã lưu"}</span>
          </div>
        </div>
      </div>
      {permissionsOpen && isOwner && (
        <section className="permissions-panel" aria-label="Quyền truy cập tài liệu">
          <form className="permission-section" onSubmit={saveVisibility}>
            <div>
              <h2>Truy cập công khai</h2>
              <p>Cho phép mọi người có liên kết xem tài liệu.</p>
            </div>
            <label className="permission-control">
              <span>Chế độ</span>
              <select onChange={(event) => setVisibility(event.target.value)} value={visibility}>
                <option value="private">Riêng tư</option>
                <option value="public">Công khai</option>
              </select>
            </label>
            {visibility === "public" && (
              <label className="permission-control">
                <span>Quyền công khai</span>
                <select onChange={(event) => setPublicRole(event.target.value)} value={publicRole}>
                  <option value="viewer">Chỉ xem</option>
                  <option value="editor">Được chỉnh sửa</option>
                </select>
              </label>
            )}
            <button className="small-primary-button" disabled={permissionBusy} type="submit">
              Lưu quyền
            </button>
          </form>
          <form className="permission-section share-form" onSubmit={shareDocument}>
            <div>
              <h2>Chia sẻ với người dùng</h2>
              <p>Nhập tên đăng nhập để cấp hoặc cập nhật quyền.</p>
            </div>
            <label className="permission-control">
              <span>Tên đăng nhập</span>
              <input
                onChange={(event) => setShareUsername(event.target.value)}
                required
                value={shareUsername}
              />
            </label>
            <label className="permission-control">
              <span>Quyền</span>
              <select onChange={(event) => setShareRole(event.target.value)} value={shareRole}>
                <option value="viewer">Chỉ xem</option>
                <option value="editor">Được chỉnh sửa</option>
              </select>
            </label>
            <button className="small-primary-button" disabled={permissionBusy} type="submit">
              Chia sẻ
            </button>
          </form>
          <div className="shared-users">
            <h2>Người được phép truy cập</h2>
            {loadingShares ? (
              <p>Đang tải danh sách…</p>
            ) : sharedUsers.length ? (
              <ul>
                {sharedUsers.map((user) => (
                  <li key={user.username}>
                    <span className="shared-user-avatar">{user.username.slice(0, 1).toUpperCase()}</span>
                    <span className="shared-user-name">{user.username}</span>
                    <span className="shared-user-role">
                      {user.role === "editor" ? "Được chỉnh sửa" : "Chỉ xem"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Chưa chia sẻ với người dùng nào.</p>
            )}
          </div>
          {permissionMessage && <p className="permission-message" role="status">{permissionMessage}</p>}
        </section>
      )}
      {error && <p className="editor-error" role="alert">{error}</p>}
      <div className="paper">
        <p className="paper-kicker">TÀI LIỆU</p>
        <h1>{document.title}</h1>
        <textarea
          aria-label="Nội dung tài liệu"
          disabled={!ready}
          onChange={updateText}
          placeholder={ready ? "Bắt đầu viết…" : "Đang mở tài liệu…"}
          ref={textareaRef}
          spellCheck="false"
          value={content}
        />
        <div className="word-count">
          {content.trim() ? content.trim().split(/\s+/).length : 0} từ
        </div>
      </div>
    </section>
  );
}

function HomePage({
  documents,
  ownedDocumentIds,
  loading,
  creating,
  onCreateDocument,
  onOpenDocument,
}) {
  return (
    <section className="home-page" aria-labelledby="home-title">
      <header className="home-header">
        <div>
          <p className="eyebrow">KHÔNG GIAN GHI CHÉP</p>
          <h1 id="home-title">Tài liệu của bạn</h1>
          <p className="home-subtitle">Tất cả tài liệu bạn sở hữu và được chia sẻ ở cùng một nơi.</p>
        </div>
        <button className="primary-button" disabled={creating} onClick={onCreateDocument} type="button">
          + &nbsp; Tạo tài liệu
        </button>
      </header>

      <section className="home-library" aria-labelledby="home-library-title">
        <div className="home-library-heading">
          <h2 id="home-library-title">Tất cả tài liệu</h2>
          {!loading && <span className="home-document-count">{documents.length}</span>}
        </div>
        {loading ? (
          <p className="home-empty-message">Đang tải tài liệu…</p>
        ) : documents.length ? (
          <div className="home-document-grid">
            {documents.map((document) => (
              <button
                aria-label={`Mở tài liệu ${document.title}`}
                className="home-document-card"
                key={document.id}
                onClick={() => onOpenDocument(document.id)}
                type="button"
              >
                <span className="home-card-topline">
                  <span className="home-document-icon" aria-hidden="true">▤</span>
                  <span className="home-document-date">{documentDate(document.updated_at)}</span>
                </span>
                <span className="home-document-title">{document.title}</span>
                <span className="home-document-preview">
                  {documentPreview(document.content).trim() || "Tài liệu chưa có nội dung."}
                </span>
                <span className="home-document-owner">
                  {ownedDocumentIds.has(document.id) ? "Của bạn" : "Được chia sẻ"}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="home-empty-state">
            <div className="empty-illustration" aria-hidden="true">
              <span className="illustration-sheet" />
              <span className="illustration-lines" />
              <span className="illustration-pencil">✳</span>
            </div>
            <h2>Chưa có tài liệu nào</h2>
            <p className="home-empty-message">Tạo tài liệu đầu tiên để bắt đầu ghi lại ý tưởng của bạn.</p>
            <button className="primary-button" disabled={creating} onClick={onCreateDocument} type="button">
              + &nbsp; Tạo tài liệu
            </button>
          </div>
        )}
      </section>
    </section>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [username, setUsername] = useState(() => localStorage.getItem(USER_KEY) || "");
  const [documents, setDocuments] = useState([]);
  const [formatting, setFormatting] = useState(loadFormattingPreferences);
  const [ownedDocumentIds, setOwnedDocumentIds] = useState(() => new Set());
  const [activeDocument, setActiveDocument] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [editingDocumentId, setEditingDocumentId] = useState(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState(null);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const onDocumentUpdated = useCallback((updated) => {
    setActiveDocument((current) => current?.id === updated.id
      ? { ...updated, access_role: updated.access_role || current.access_role }
      : current);
    setDocuments((current) =>
      current.map((document) => document.id === updated.id
        ? { ...updated, access_role: updated.access_role || document.access_role }
        : document),
    );
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await request("/api/documents/", token);
      setDocuments([...result.owned, ...result.shared]);
      setOwnedDocumentIds(new Set(result.owned.map((document) => document.id)));
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) loadDocuments();
  }, [token, loadDocuments]);

  useEffect(() => {
    sessionStorage.setItem(FORMATTING_KEY, JSON.stringify(formatting));
  }, [formatting]);

  function authenticate(accessToken, name) {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(USER_KEY, name);
    setToken(accessToken);
    setUsername(name);
  }

  async function openDocument(id) {
    setError("");
    try {
      const result = await request(`/api/documents/${id}`, token);
      setActiveDocument(result);
    } catch (openError) {
      setError(getErrorMessage(openError));
    }
  }

  function goHome() {
    setActiveDocument(null);
    setEditingDocumentId(null);
    setContextMenu(null);
    setError("");
  }

  function startRenaming(event, document) {
    event.stopPropagation();
    setEditingDocumentId(document.id);
    setTitleDraft(document.title);
    setError("");
  }

  async function saveTitle(event, document) {
    event?.preventDefault();
    event?.stopPropagation();
    const title = titleDraft.trim();
    if (!title) {
      setError("Tên tài liệu không được để trống.");
      return;
    }
    if (title === document.title) {
      setEditingDocumentId(null);
      return;
    }

    setSavingTitle(true);
    setError("");
    try {
      const updated = await request(`/api/documents/${document.id}`, token, {
        method: "PUT",
        body: JSON.stringify({ title }),
      });
      onDocumentUpdated(updated);
      setEditingDocumentId(null);
    } catch (renameError) {
      setError(`Không thể đổi tên tài liệu: ${getErrorMessage(renameError)}`);
    } finally {
      setSavingTitle(false);
    }
  }

  async function deleteDocument(document) {
    setContextMenu(null);
    // if (!window.confirm(`Xóa tài liệu "${document.title}"? Thao tác này không thể hoàn tác.`)) return;
    setDeletingDocumentId(document.id);
    setError("");
    try {
      await request(`/api/documents/${document.id}`, token, { method: "DELETE" });
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setOwnedDocumentIds((current) => {
        const next = new Set(current);
        next.delete(document.id);
        return next;
      });
      setActiveDocument((current) => current?.id === document.id ? null : current);
    } catch (deleteError) {
      setError(`Không thể xóa tài liệu: ${getErrorMessage(deleteError)}`);
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function createDocument() {
    setCreating(true);
    setError("");
    try {
      const result = await request("/api/documents/", token, {
        method: "POST",
        body: JSON.stringify({ title: "Tài liệu chưa có tiêu đề" }),
      });
      setDocuments((current) => [result, ...current]);
      setOwnedDocumentIds((current) => new Set([...current, result.id]));
      setActiveDocument({ ...result, access_role: "editor" });
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setCreating(false);
    }
  }

  async function logout() {
    try {
      await request("/api/auth/logout", token, { method: "POST" });
    } catch (logoutError) {
      setError(`Không thể đăng xuất khỏi máy chủ: ${getErrorMessage(logoutError)}`);
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      setToken("");
      setUsername("");
      setFormatting(DEFAULT_FORMATTING);
      setDocuments([]);
      setOwnedDocumentIds(new Set());
      setActiveDocument(null);
    }
  }

  if (!token) return <AuthScreen onAuthenticated={authenticate} />;

  return (
    <main
      className={`workspace ${activeDocument ? "editor-workspace" : ""}`}
      onClick={() => contextMenu && setContextMenu(null)}
    >
      <aside className="sidebar">
        <button
          aria-current={activeDocument ? undefined : "page"}
          aria-label="Về trang chủ"
          className="sidebar-brand"
          onClick={goHome}
          title="Trang chủ"
          type="button"
        >
          <span className="brand-mark small" aria-hidden="true">idoc</span>
          <span>idoc</span>
        </button>
        <div className="sidebar-section">
          <div className="section-heading">
            <span>{activeDocument ? "Document tabs" : "TÀI LIỆU CỦA BẠN"}</span>
            <button
              aria-label="Tạo tài liệu mới"
              className="icon-button"
              disabled={creating}
              onClick={createDocument}
              title="Tạo tài liệu mới"
              type="button"
            >
              +
            </button>
          </div>
          <button className="new-document" disabled={creating} onClick={createDocument} type="button">
            <span>＋</span> Tài liệu mới
          </button>
          <div className="document-list">
            {loading ? (
              <p className="list-hint">Đang tải tài liệu…</p>
            ) : documents.length ? (
              documents.map((document) => (
                <div
                  className={`document-item ${activeDocument?.id === document.id ? "active" : ""}`}
                  key={document.id}
                  onContextMenu={(event) => {
                    if (!ownedDocumentIds.has(document.id)) return;
                    event.preventDefault();
                    setContextMenu({
                      document,
                      x: Math.min(event.clientX, window.innerWidth - 180),
                      y: Math.min(event.clientY, window.innerHeight - 60),
                    });
                  }}
                >
                  {editingDocumentId === document.id ? (
                    <form
                      className="rename-form"
                      onSubmit={(event) => saveTitle(event, document)}
                    >
                      <input
                        aria-label="Tên tài liệu"
                        autoFocus
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setEditingDocumentId(null);
                        }}
                        value={titleDraft}
                      />
                      <button aria-label="Lưu tên" disabled={savingTitle} type="submit">✓</button>
                    </form>
                  ) : (
                    <>
                      <button
                        className="document-open-button"
                        onClick={() => openDocument(document.id)}
                        type="button"
                      >
                        <span className="document-item-icon">▤</span>
                        <span className="document-item-copy">
                          <span className="document-item-title">{document.title}</span>
                          <span className="document-item-date">{documentDate(document.updated_at)}</span>
                        </span>
                      </button>
                      <button
                        aria-label={`Đổi tên ${document.title}`}
                        className="rename-button"
                        onClick={(event) => startRenaming(event, document)}
                        title="Đổi tên"
                        type="button"
                      >
                        ✎
                      </button>
                    </>
                  )}
                </div>
              ))
            ) : (
              <p className="list-hint">Chưa có tài liệu nào.</p>
            )}
          </div>
        </div>
        {contextMenu && ownedDocumentIds.has(contextMenu.document.id) && (
          <div
            className="document-context-menu"
            onClick={(event) => event.stopPropagation()}
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="delete-document-action"
              disabled={deletingDocumentId === contextMenu.document.id}
              onClick={() => deleteDocument(contextMenu.document)}
              role="menuitem"
              type="button"
            >
              <span aria-hidden="true"></span>
              {deletingDocumentId === contextMenu.document.id ? "Đang xóa…" : "Xóa tài liệu"}
            </button>
          </div>
        )}
        <div className="sidebar-footer">
          <div className="user-avatar">{username.slice(0, 1).toUpperCase() || "B"}</div>
          <span className="user-name">{username}</span>
          <button className="text-button logout-button" onClick={logout} type="button">
            Đăng xuất
          </button>
        </div>
      </aside>

      <div className={`main-area ${activeDocument ? "" : "main-area-home"}`}>
        {error && <div className="global-error" role="alert">{error}</div>}
        {activeDocument ? (
          <DocumentEditor
            document={activeDocument}
            isOwner={ownedDocumentIds.has(activeDocument.id)}
            onDocumentUpdated={onDocumentUpdated}
            formatting={formatting}
            onFormattingChange={setFormatting}
            token={token}
            username={username}
          />
        ) : (
          <HomePage
            documents={documents}
            ownedDocumentIds={ownedDocumentIds}
            loading={loading}
            creating={creating}
            onCreateDocument={createDocument}
            onOpenDocument={openDocument}
          />
        )}
      </div>
    </main>
  );
}

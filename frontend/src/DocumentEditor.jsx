import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import * as Y from "yjs";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";

const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const WS_URL = (import.meta.env.VITE_WS_URL || "ws://127.0.0.1:1234").replace(/\/$/, "");
const FONT_FAMILIES = ["Arial", "Georgia", "Times New Roman", "Verdana", "Courier New"];

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (element) => element.style.fontSize || null,
          renderHTML: (attributes) => attributes.fontSize
            ? { style: `font-size: ${attributes.fontSize}` }
            : {},
        },
      },
    }];
  },
});

function colorForUser(name) {
  let hash = 2166136261;
  for (const character of name || "user") {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  }
  return `hsl(${hash % 360}, 72%, 42%)`;
}

function renderCollaborativeCursor(user) {
  const name = user.name || "Người dùng";
  const color = user.color || colorForUser(name);
  const caret = document.createElement("span");
  caret.classList.add("collaboration-cursor__caret");
  caret.style.borderColor = color;
  caret.setAttribute("aria-label", `Con trỏ của ${name}`);

  const label = document.createElement("span");
  label.classList.add("collaboration-cursor__label");
  label.style.backgroundColor = color;
  label.textContent = name;
  caret.append(label);
  return caret;
}

function initialContentAsHtml(content) {
  const value = content || "";
  if (!value) return "";
  if (/<\/?[a-z][\s\S]*>/i.test(value)) return value;
  return value
    .split(/\r?\n/)
    .map((line) => `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`)
    .join("");
}

function awarenessPayload(awareness, clientIds) {
  return JSON.stringify({
    type: "awareness",
    update: Array.from(encodeAwarenessUpdate(awareness, clientIds)),
  });
}

function applyStoredTextFormatting(editor, formatting) {
  const requestedSize = Number(formatting.fontSize);
  const fontSize = Number.isFinite(requestedSize) && requestedSize >= 8 && requestedSize <= 96
    ? requestedSize
    : 12;
  const chain = editor.chain()
    .setFontFamily(formatting.fontFamily)
    .setColor(formatting.color)
    .setMark("textStyle", { fontSize: `${fontSize}px` });

  for (const mark of ["bold", "italic", "underline"]) {
    if (formatting[mark]) chain.setMark(mark);
    else chain.unsetMark(mark);
  }

  chain.run();
}

function applyStoredAlignment(editor, alignment) {
  if (!editor.isActive({ textAlign: alignment })) {
    editor.chain().setTextAlign(alignment).run();
  }
}

function FormattingToolbar({ editor, canEdit, formatting, onFormattingChange }) {
  if (!editor) return null;

  const format = (updates, action) => {
    if (!canEdit) return;
    onFormattingChange((current) => ({ ...current, ...updates }));
    action().run();
  };
  const toggleMark = (mark) => {
    const enabled = !formatting[mark];
    if (!canEdit) return;
    onFormattingChange((current) => ({ ...current, [mark]: enabled }));
    const chain = editor.chain().focus();
    if (enabled) chain.setMark(mark);
    else chain.unsetMark(mark);
    chain.run();
  };

  return (
    <div className="format-toolbar" aria-label="Thanh công cụ định dạng">
      <label className="format-control">
        <span className="visually-hidden">Font chữ</span>
        <select
          aria-label="Font chữ"
          disabled={!canEdit}
          onChange={(event) => format(
            { fontFamily: event.target.value },
            () => editor.chain().focus().setFontFamily(event.target.value),
          )}
          value={formatting.fontFamily}
        >
          {FONT_FAMILIES.map((font) => <option key={font} value={font}>{font}</option>)}
        </select>
      </label>
      <label className="format-control font-size-control">
        <span className="visually-hidden">Cỡ chữ</span>
        <input
          aria-label="Cỡ chữ"
          disabled={!canEdit}
          max="96"
          min="8"
          onChange={(event) => onFormattingChange((current) => ({
            ...current,
            fontSize: event.target.value,
          }))}
          onBlur={() => {
            const size = Number(formatting.fontSize);
            if (canEdit && Number.isFinite(size) && size >= 8 && size <= 96) {
              editor.chain().focus().setMark("textStyle", { fontSize: `${size}px` }).run();
            } else if (canEdit) {
              onFormattingChange((current) => ({ ...current, fontSize: "12" }));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          type="number"
          value={formatting.fontSize}
        />
      </label>
      <span className="toolbar-separator" />
      <button aria-label="In đậm" className={formatting.bold ? "selected" : ""} disabled={!canEdit} onClick={() => toggleMark("bold")} type="button"><strong>B</strong></button>
      <button aria-label="In nghiêng" className={formatting.italic ? "selected" : ""} disabled={!canEdit} onClick={() => toggleMark("italic")} type="button"><em>I</em></button>
      <button aria-label="Gạch chân" className={formatting.underline ? "selected" : ""} disabled={!canEdit} onClick={() => toggleMark("underline")} type="button"><u>U</u></button>
      <label className="color-control">
        <span className="visually-hidden">Màu chữ</span>
        <input
          aria-label="Màu chữ"
          disabled={!canEdit}
          onChange={(event) => format(
            { color: event.target.value },
            () => editor.chain().focus().setColor(event.target.value),
          )}
          type="color"
          value={formatting.color}
        />
      </label>
      <span className="toolbar-separator" />
      <button aria-label="Căn trái" className={formatting.alignment === "left" ? "selected" : ""} disabled={!canEdit} onClick={() => format({ alignment: "left" }, () => editor.chain().focus().setTextAlign("left"))} type="button">☰</button>
      <button aria-label="Căn giữa" className={formatting.alignment === "center" ? "selected" : ""} disabled={!canEdit} onClick={() => format({ alignment: "center" }, () => editor.chain().focus().setTextAlign("center"))} type="button">≡</button>
      <button aria-label="Căn phải" className={formatting.alignment === "right" ? "selected" : ""} disabled={!canEdit} onClick={() => format({ alignment: "right" }, () => editor.chain().focus().setTextAlign("right"))} type="button">☷</button>
      <span className="toolbar-separator" />
      <button aria-label="Hoàn tác" disabled={!canEdit || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} type="button">↶</button>
      <button aria-label="Làm lại" disabled={!canEdit || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} type="button">↷</button>
    </div>
  );
}

function CollaborativeCanvas({
  yDoc,
  awareness,
  document,
  username,
  canEdit,
  formatting,
  onFormattingChange,
  onSaveState,
}) {
  const provider = useMemo(() => ({ awareness }), [awareness]);
  const user = useMemo(() => ({ name: username, color: colorForUser(username) }), [username]);
  const formattingRef = useRef(formatting);
  formattingRef.current = formatting;
  const editor = useEditor({
    editable: canEdit,
    extensions: [
      StarterKit.configure({ history: false }),
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      FontFamily.configure({ types: ["textStyle"] }),
      FontSize,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Collaboration.configure({ document: yDoc, field: "default" }),
      CollaborationCursor.configure({ provider, user, render: renderCollaborativeCursor }),
    ],
    onCreate: ({ editor: currentEditor }) => {
      if (canEdit && currentEditor.isEmpty && document.content) {
        currentEditor.commands.setContent(initialContentAsHtml(document.content));
      }
      if (canEdit) {
        applyStoredTextFormatting(currentEditor, formattingRef.current);
        if (currentEditor.isEmpty) applyStoredAlignment(currentEditor, formattingRef.current.alignment);
      }
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      if (canEdit && currentEditor.state.selection.empty) {
        applyStoredTextFormatting(currentEditor, formattingRef.current);
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (canEdit && currentEditor.isEmpty) {
        applyStoredTextFormatting(currentEditor, formattingRef.current);
        applyStoredAlignment(currentEditor, formattingRef.current.alignment);
      }
      if (canEdit) onSaveState(currentEditor.getHTML());
    },
  }, [yDoc, awareness, canEdit, document.id]);

  useEffect(() => {
    if (editor) editor.setEditable(canEdit);
  }, [canEdit, editor]);

  return (
    <>
      <FormattingToolbar
        editor={editor}
        canEdit={canEdit}
        formatting={formatting}
        onFormattingChange={onFormattingChange}
      />
      <div className={`paper ${canEdit ? "" : "paper-read-only"}`}>
        <EditorContent editor={editor} aria-label="Nội dung tài liệu" />
        {!canEdit && editor?.isEmpty && document.content && (
          <div className="legacy-read-only-content">
            {new DOMParser().parseFromString(document.content, "text/html").body.textContent}
          </div>
        )}
        <div className="word-count">
          {editor?.getText().trim() ? editor.getText().trim().split(/\s+/).length : 0} từ
        </div>
      </div>
    </>
  );
}

export default function DocumentEditor({
  document,
  token,
  username,
  onDocumentUpdated,
  isOwner,
  formatting,
  onFormattingChange,
}) {
  const [connection, setConnection] = useState("connecting");
  const [saveState, setSaveState] = useState("saved");
  const [error, setError] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(document.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [visibility, setVisibility] = useState(document.visibility || "private");
  const [publicRole, setPublicRole] = useState(document.public_role || "viewer");
  const [shareUsername, setShareUsername] = useState("");
  const [shareRole, setShareRole] = useState("viewer");
  const [sharedUsers, setSharedUsers] = useState([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const [syncDoc, setSyncDoc] = useState(null);
  const yDocRef = useRef(null);
  const awarenessRef = useRef(null);
  const socketRef = useRef(null);
  const readyRef = useRef(false);
  const saveTimerRef = useRef(null);
  const onDocumentUpdatedRef = useRef(onDocumentUpdated);
  onDocumentUpdatedRef.current = onDocumentUpdated;
  const canEdit = document.access_role === "editor";

  useEffect(() => {
    setVisibility(document.visibility || "private");
    setPublicRole(document.public_role || "viewer");
  }, [document.id, document.visibility, document.public_role]);

  useEffect(() => {
    setTitleDraft(document.title);
    setEditingTitle(false);
    setTitleError("");
  }, [document.id, document.title]);

  useEffect(() => {
    if (!permissionsOpen || !isOwner) return undefined;
    let active = true;
    setLoadingShares(true);
    fetch(`${API_URL}/api/documents/${document.id}/shares`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải danh sách chia sẻ.");
        return response.json();
      })
      .then((users) => {
        if (active) setSharedUsers(users);
      })
      .catch((loadError) => {
        if (active) setPermissionMessage(loadError.message);
      })
      .finally(() => {
        if (active) setLoadingShares(false);
      });

    return () => {
      active = false;
    };
  }, [document.id, isOwner, permissionsOpen, token]);

  const saveContent = useCallback((html) => {
    setSaveState("saving");
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`${API_URL}/api/documents/${document.id}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: html }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.detail || `Lỗi lưu tài liệu (${response.status})`);
        }
        const updated = await response.json();
        setSaveState("saved");
        setError("");
        onDocumentUpdatedRef.current(updated);
      } catch (saveError) {
        setSaveState("error");
        setError(`Không thể lưu tài liệu: ${saveError.message}`);
      }
    }, 650);
  }, [document.id, token]);

  useEffect(() => {
    const yDoc = new Y.Doc();
    const awareness = new Awareness(yDoc);
    const socket = new WebSocket(
      `${WS_URL}/ws/documents/${encodeURIComponent(document.id)}?token=${encodeURIComponent(token)}`
    );
    socket.binaryType = "arraybuffer";
    yDocRef.current = yDoc;
    awarenessRef.current = awareness;
    socketRef.current = socket;
    readyRef.current = false;
    setSyncDoc(null);
    setConnection("connecting");
    setSaveState("saved");
    setError("");
    awareness.setLocalStateField("user", { name: username, color: colorForUser(username) });

    const sendAwareness = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(awarenessPayload(awareness, [yDoc.clientID]));
      }
    };
    const onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === "remote" || socket.readyState !== WebSocket.OPEN) return;
      const clients = [...added, ...updated, ...removed];
      if (clients.length) {
        socket.send(awarenessPayload(awareness, clients));
      }
    };
    const onDocumentUpdate = (update, origin) => {
      if (origin !== "remote" && socket.readyState === WebSocket.OPEN && canEdit) {
        socket.send(update);
      }
    };
    const onOpen = () => {
      setConnection("connected");
      sendAwareness();
      socket.send(JSON.stringify({ type: "awareness-request" }));
    };
    const onMessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        try {
          Y.applyUpdate(yDoc, new Uint8Array(event.data), "remote");
          if (!readyRef.current) {
            readyRef.current = true;
            setSyncDoc({ documentId: document.id, yDoc });
          }
        } catch {
          setError("Không thể đồng bộ nội dung tài liệu.");
        }
        return;
      }

      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "awareness") {
          applyAwarenessUpdate(awareness, Uint8Array.from(payload.update), "remote");
        } else if (payload.type === "awareness-request") {
          sendAwareness();
        } else if (payload.type === "error") {
          setError(payload.message);
        }
      } catch {
        setError("Không thể đồng bộ con trỏ cộng tác.");
      }
    };
    const onClose = () => setConnection("disconnected");
    const keepAwarenessAlive = window.setInterval(sendAwareness, 15000);

    yDoc.on("update", onDocumentUpdate);
    awareness.on("update", onAwarenessUpdate);
    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);

    return () => {
      window.clearTimeout(saveTimerRef.current);
      window.clearInterval(keepAwarenessAlive);
      yDoc.off("update", onDocumentUpdate);
      awareness.off("update", onAwarenessUpdate);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.close();
      awareness.destroy();
      yDoc.destroy();
      yDocRef.current = null;
      awarenessRef.current = null;
      socketRef.current = null;
      readyRef.current = false;
    };
  }, [canEdit, document.id, token, username]);

  async function saveVisibility(event) {
    event.preventDefault();
    setPermissionBusy(true);
    setPermissionMessage("");
    try {
      const response = await fetch(`${API_URL}/api/documents/${document.id}/visibility`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          visibility,
          public_role: visibility === "public" ? publicRole : null,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || "Không thể cập nhật quyền.");
      }
      onDocumentUpdated(await response.json());
      setPermissionMessage("Đã cập nhật quyền truy cập.");
    } catch (permissionError) {
      setPermissionMessage(permissionError.message);
    } finally {
      setPermissionBusy(false);
    }
  }

  async function shareDocument(event) {
    event.preventDefault();
    setPermissionBusy(true);
    setPermissionMessage("");
    try {
      const response = await fetch(`${API_URL}/api/documents/${document.id}/share`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: shareUsername.trim(), role: shareRole }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || "Không thể chia sẻ tài liệu.");
      }
      const usersResponse = await fetch(`${API_URL}/api/documents/${document.id}/shares`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!usersResponse.ok) throw new Error("Đã chia sẻ nhưng không thể tải lại danh sách.");
      setSharedUsers(await usersResponse.json());
      setPermissionMessage(`Đã chia sẻ tài liệu với ${shareUsername.trim()}.`);
      setShareUsername("");
    } catch (permissionError) {
      setPermissionMessage(permissionError.message);
    } finally {
      setPermissionBusy(false);
    }
  }

  async function saveTitle(event) {
    event.preventDefault();
    const title = titleDraft.trim();
    if (!title) {
      setTitleError("Tên tài liệu không được để trống.");
      return;
    }
    if (title === document.title) {
      setEditingTitle(false);
      return;
    }

    setSavingTitle(true);
    setTitleError("");
    try {
      const response = await fetch(`${API_URL}/api/documents/${document.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || `Không thể đổi tên (${response.status})`);
      }
      onDocumentUpdated(await response.json());
      setEditingTitle(false);
    } catch (renameError) {
      setTitleError(renameError.message);
    } finally {
      setSavingTitle(false);
    }
  }

  return (
    <section className="editor-panel">
      <header className="document-header">
        <div className="document-heading">
          <span className="file-icon" aria-hidden="true">▤</span>
          {editingTitle ? (
            <form className="document-title-form" onSubmit={saveTitle}>
              <input
                aria-label="Tên tài liệu"
                autoFocus
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setTitleDraft(document.title);
                    setEditingTitle(false);
                  }
                }}
                value={titleDraft}
              />
              <button aria-label="Lưu tên tài liệu" disabled={savingTitle} type="submit">✓</button>
            </form>
          ) : (
            <>
              <h1>{document.title}</h1>
              {canEdit && (
                <button
                  aria-label="Đổi tên tài liệu"
                  className="document-title-edit"
                  onClick={() => {
                    setTitleDraft(document.title);
                    setTitleError("");
                    setEditingTitle(true);
                  }}
                  title="Đổi tên tài liệu"
                  type="button"
                >
                  ✎
                </button>
              )}
            </>
          )}
        </div>
        <div className="document-header-actions">
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
          <span className={`connection-dot ${connection}`} />
          <span>{connection === "connected" ? "Đã kết nối" : connection === "connecting" ? "Đang kết nối" : "Mất kết nối"}</span>
          <span className="status-divider">·</span>
          <span>{saveState === "saving" ? "Đang lưu…" : saveState === "error" ? "Lỗi lưu" : "Đã lưu"}</span>
          {!canEdit && <span className="read-only-badge">Chỉ xem</span>}
        </div>
      </header>

      {titleError && <p className="editor-error title-error" role="alert">{titleError}</p>}
      {permissionsOpen && isOwner && (
        <section className="permissions-panel" aria-label="Quyền truy cập tài liệu">
          <form className="permission-section" onSubmit={saveVisibility}>
            <div>
              <h2>Truy cập công khai</h2>
              <p>Cho phép mọi người có liên kết xem hoặc chỉnh sửa tài liệu.</p>
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
            <button className="small-primary-button" disabled={permissionBusy} type="submit">Lưu quyền</button>
          </form>
          <form className="permission-section share-form" onSubmit={shareDocument}>
            <div>
              <h2>Chia sẻ với người dùng</h2>
              <p>Nhập tên đăng nhập và cấp quyền xem hoặc chỉnh sửa.</p>
            </div>
            <label className="permission-control">
              <span>Tên đăng nhập</span>
              <input onChange={(event) => setShareUsername(event.target.value)} required value={shareUsername} />
            </label>
            <label className="permission-control">
              <span>Quyền</span>
              <select onChange={(event) => setShareRole(event.target.value)} value={shareRole}>
                <option value="viewer">Chỉ xem</option>
                <option value="editor">Được chỉnh sửa</option>
              </select>
            </label>
            <button className="small-primary-button" disabled={permissionBusy} type="submit">Chia sẻ</button>
          </form>
          <div className="shared-users">
            <h2>Người được phép truy cập</h2>
            {loadingShares ? <p>Đang tải danh sách…</p> : sharedUsers.length ? (
              <ul>
                {sharedUsers.map((user) => (
                  <li key={user.username}>
                    <span className="shared-user-avatar">{user.username.slice(0, 1).toUpperCase()}</span>
                    <span className="shared-user-name">{user.username}</span>
                    <span className="shared-user-role">{user.role === "editor" ? "Được chỉnh sửa" : "Chỉ xem"}</span>
                  </li>
                ))}
              </ul>
            ) : <p>Chưa chia sẻ với người dùng nào.</p>}
          </div>
          {permissionMessage && <p className="permission-message" role="status">{permissionMessage}</p>}
        </section>
      )}
      {error && <p className="editor-error" role="alert">{error}</p>}
      {syncDoc?.documentId === document.id ? (
        <CollaborativeCanvas
          awareness={awarenessRef.current}
          canEdit={canEdit}
          document={document}
          formatting={formatting}
          onFormattingChange={onFormattingChange}
          onSaveState={saveContent}
          username={username}
          yDoc={syncDoc.yDoc}
          key={document.id}
        />
      ) : (
        <div className="editor-loading">Đang mở tài liệu…</div>
      )}
    </section>
  );
}

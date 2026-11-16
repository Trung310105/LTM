from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from . import auth, crud, models
from .connection_manager import DocumentConnectionManager
from .database import SessionLocal
from .sync_manager import YjsDocumentStore


connection_manager = DocumentConnectionManager()
document_store = YjsDocumentStore()


def _has_access(document: models.Document, user_id: str) -> bool:
    if document.owner_id == user_id or document.visibility == "public":
        return True
    return any(collaborator.user_id == user_id for collaborator in document.collaborators)


def _authorize(document_id: str, token: Optional[str]) -> bool:
    db: Session = SessionLocal()
    try:
        document = crud.get_document(db, document_id)
        if document is None:
            return False
        if token is None:
            return True
        try:
            user = auth.get_current_user_from_token(token, db)
        except Exception:
            return False
        return _has_access(document, user.id)
    finally:
        db.close()


async def document_websocket(websocket: WebSocket, document_id: str) -> None:
    token = websocket.query_params.get("token")
    valid = await run_in_threadpool(_authorize, document_id, token)
    if not valid:
        await websocket.close(code=1008, reason="Invalid document or access denied")
        return

    await websocket.accept()
    await connection_manager.connect(document_id, websocket)
    try:
        await websocket.send_bytes(await document_store.initial_update(document_id))
        while True:
            message = await websocket.receive()
            if message.get("bytes") is not None:
                update = message["bytes"]
                if not update:
                    continue
                try:
                    await document_store.apply_and_persist(document_id, update)
                except (ValueError, RuntimeError):
                    await websocket.send_json(
                        {"type": "error", "message": "Invalid Yjs update"}
                    )
                    continue
                await connection_manager.broadcast(document_id, update, websocket)
            elif message.get("text") is not None:
                if message["text"] == "ping":
                    await websocket.send_text("pong")
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await connection_manager.disconnect(document_id, websocket)

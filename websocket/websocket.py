import json
from typing import Optional

from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from backend import auth, crud
from .connection_manager import DocumentConnectionManager
from backend.database import SessionLocal
from .sync_manager import YjsDocumentStore


connection_manager = DocumentConnectionManager()
document_store = YjsDocumentStore()


def _authorize(document_id: str, token: Optional[str]) -> Optional[bool]:
    if not token:
        return None
    db: Session = SessionLocal()
    try:
        document = crud.get_document(db, document_id)
        if document is None:
            return None
        try:
            user = auth.get_current_user_from_token(token, db)
        except HTTPException:
            return None
        role = crud.get_document_access_role(document, user.id)
        if role is None:
            return None
        return role == "editor"
    finally:
        db.close()


async def document_websocket(websocket: WebSocket, document_id: str) -> None:
    token = websocket.query_params.get("token")
    can_edit = await run_in_threadpool(_authorize, document_id, token)
    if can_edit is None:
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
                latest_permission = await run_in_threadpool(
                    _authorize, document_id, token
                )
                if latest_permission is not True:
                    await websocket.close(code=1008, reason="Read-only access")
                    return
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
                    continue
                try:
                    payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue
                if payload.get("type") in {"awareness", "awareness-request"}:
                    await connection_manager.broadcast_text(
                        document_id, message["text"], websocket
                    )
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await connection_manager.disconnect(document_id, websocket)

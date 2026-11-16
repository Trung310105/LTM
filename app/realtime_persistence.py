import json
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from . import models


def get_saved_state(db: Session, document_id: str) -> Optional[bytes]:
    state = (
        db.query(models.DocumentYjsState)
        .filter(models.DocumentYjsState.document_id == document_id)
        .first()
    )
    return bytes(state.state) if state else None


def save_state(
    db: Session,
    document_id: str,
    state_bytes: bytes,
    content: str,
) -> None:
    state = (
        db.query(models.DocumentYjsState)
        .filter(models.DocumentYjsState.document_id == document_id)
        .first()
    )
    if state is None:
        state = models.DocumentYjsState(document_id=document_id)
        db.add(state)

    state.state = state_bytes
    state.updated_at = datetime.utcnow()

    document = (
        db.query(models.Document)
        .filter(models.Document.id == document_id)
        .first()
    )
    if document is None:
        raise ValueError(f"Document {document_id} no longer exists")

    # Keep the existing REST API useful while the authoritative collaborative
    # state remains the Yjs update stored above.
    document.content = content
    document.updated_at = datetime.utcnow()
    db.commit()


def document_content_from_ytext(ytext) -> str:
    value = ytext.to_json()
    return json.loads(value)

from sqlalchemy.orm import Session
from datetime import datetime
from . import models, schemas


def create_document(db: Session, doc: schemas.DocumentCreate):
    db_doc = models.Document(title=doc.title, owner_id=doc.owner_id)
    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)
    return db_doc

def get_all_documents(db: Session):
    return db.query(models.Document).order_by(models.Document.updated_at.desc()).all()


def get_document(db: Session, document_id: str):
    return db.query(models.Document).filter(models.Document.id == document_id).first()


def update_document(db: Session, document_id: str, doc_update: schemas.DocumentUpdate):
    db_doc = db.query(models.Document).filter(models.Document.id == document_id).first()
    if db_doc:
        if doc_update.title is not None:
            db_doc.title = doc_update.title
        if doc_update.content is not None:
            db_doc.content = doc_update.content

        db_doc.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_doc)
    return db_doc


def delete_document(db: Session, document_id: str):
    db_doc = db.query(models.Document).filter(models.Document.id == document_id).first()
    if db_doc:
        db.delete(db_doc)
        db.commit()
        return True
    return False


def get_user_documents(db: Session, user_id: str):
    owned_docs = db.query(models.Document).filter(models.Document.owner_id == user_id).all()
    shared_links = db.query(models.DocumentShare).filter(models.DocumentShare.user_id == user_id).all()
    shared_docs = [link.document for link in shared_links]
    return {"owned": owned_docs, "shared": shared_docs}



def get_document_versions(db: Session, document_id: str):
    return db.query(models.DocumentVersion) \
        .filter(models.DocumentVersion.document_id == document_id) \
        .order_by(models.DocumentVersion.created_at.desc()) \
        .all()


def save_document_version(db: Session, document_id: str, user_id: str, current_content: str):
    version = models.DocumentVersion(
        document_id=document_id,
        user_id=user_id,
        content_snapshot=current_content
    )
    db.add(version)
    doc = db.query(models.Document).filter(models.Document.id == document_id).first()
    if doc:
        doc.content = current_content
        doc.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(version)
    return version


def restore_version(db: Session, document_id: str, version_id: str):
    old_version = db.query(models.DocumentVersion).filter(models.DocumentVersion.id == version_id).first()
    if not old_version:
        return None
    doc = db.query(models.Document).filter(models.Document.id == document_id).first()
    if doc:
        doc.content = old_version.content_snapshot
        doc.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(doc)
    return doc


def get_user_by_username(db: Session, username: str):
    return db.query(models.User).filter(models.User.username == username).first()

def create_user(db: Session, user: schemas.UserCreate):
    db_user = models.User(username=user.username)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def share_document(db: Session, document_id: str, target_user_id: str, role: str):
    existing_share = db.query(models.DocumentShare).filter(
        models.DocumentShare.document_id == document_id,
        models.DocumentShare.user_id == target_user_id
    ).first()

    if existing_share:
        existing_share.role = role
        db.commit()
        db.refresh(existing_share)
        return existing_share

    new_share = models.DocumentShare(
        document_id=document_id,
        user_id=target_user_id,
        role=role
    )
    db.add(new_share)
    db.commit()
    db.refresh(new_share)
    return new_share


def update_document_visibility(db: Session, document_id: str, visibility_data: schemas.DocumentVisibilityUpdate):
    db_doc = db.query(models.Document).filter(models.Document.id == document_id).first()
    if db_doc:
        db_doc.visibility = visibility_data.visibility
        db_doc.public_role = visibility_data.public_role
        db_doc.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_doc)
    return db_doc
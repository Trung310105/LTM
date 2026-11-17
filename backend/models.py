from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from .database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)

    owned_documents = relationship("Document", back_populates="owner")


class Document(Base):
    __tablename__ = "documents"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False)
    content = Column(Text, default="")  # HTML snapshot; the collaborative structure is stored in yjs_state.
    owner_id = Column(String, ForeignKey("users.id"))
    visibility = Column(String, default="private")
    public_role = Column(String, default=None)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="owned_documents")
    collaborators = relationship("DocumentShare", back_populates="document", cascade="all, delete-orphan")
    versions = relationship("DocumentVersion", back_populates="document", cascade="all, delete-orphan")
    yjs_state = relationship(
        "DocumentYjsState",
        back_populates="document",
        cascade="all, delete-orphan",
        uselist=False,
    )

class DocumentShare(Base):
    __tablename__ = "document_shares"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id = Column(String, ForeignKey("documents.id"))
    user_id = Column(String, ForeignKey("users.id"))
    role = Column(String, default="editor")

    document = relationship("Document", back_populates="collaborators")


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id = Column(String, ForeignKey("documents.id"))
    user_id = Column(String, ForeignKey("users.id"))
    content_snapshot = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="versions")


class DocumentYjsState(Base):
    __tablename__ = "document_yjs_states"
    document_id = Column(String, ForeignKey("documents.id"), primary_key=True)
    state = Column(LargeBinary, nullable=False, default=b"")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    document = relationship("Document", back_populates="yjs_state")


class TokenBlacklist(Base):
    __tablename__ = "token_blacklist"
    token = Column(String, primary_key=True, index=True)
    blacklisted_on = Column(DateTime, default=datetime.utcnow)
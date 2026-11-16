from fastapi import FastAPI, Depends, HTTPException, WebSocket, status
from fastapi.security import OAuth2PasswordRequestForm, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import timedelta
from typing import List
from fastapi.responses import RedirectResponse
from . import models, schemas, crud, auth
from .database import engine, get_db
from .websocket import document_websocket

models.Base.metadata.create_all(bind=engine)
app = FastAPI(title="Collaborative Editor API (Secured)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws/documents/{document_id}")
async def document_sync_websocket(websocket: WebSocket, document_id: str):
    await document_websocket(websocket, document_id)

# python -m uvicorn app.main:app --reload

@app.get("/", tags=["Root"])
def read_root():
    return RedirectResponse(url="/docs")


@app.post("/api/auth/register", response_model=schemas.UserResponse, tags=["Auth"])
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username đã tồn tại")

    hashed_pwd = auth.get_password_hash(user.password)
    db_user = models.User(username=user.username, hashed_password=hashed_pwd)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@app.post("/api/auth/login", response_model=schemas.Token, tags=["Auth"])
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Sai username hoặc password")

    access_token = auth.create_access_token(
        data={"sub": user.id}, expires_delta=timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/api/auth/logout", tags=["Auth"])
def logout(credentials: HTTPAuthorizationCredentials = Depends(auth.security), db: Session = Depends(get_db)):
    token = credentials.credentials
    is_blacklisted = db.query(models.TokenBlacklist).filter(models.TokenBlacklist.token == token).first()
    if not is_blacklisted:
        blacklisted_token = models.TokenBlacklist(token=token)
        db.add(blacklisted_token)
        db.commit()

    return {"message": "Đăng xuất thành công!"}



def check_document_access(db_doc, user_id: str, required_role: str = "viewer"):
    if db_doc.owner_id == user_id:
        return True
    if db_doc.visibility == "public":
        if required_role == "viewer": return True
        if required_role == "editor" and db_doc.public_role == "editor": return True
    for collaborator in db_doc.collaborators:
        if collaborator.user_id == user_id:
            if required_role == "viewer": return True
            if required_role == "editor" and collaborator.role == "editor": return True
    return False


@app.post("/api/documents/", response_model=schemas.DocumentResponse, tags=["Documents"])
def create_new_document(doc: schemas.DocumentCreate, db: Session = Depends(get_db),
                        current_user: models.User = Depends(auth.get_current_user)):
    doc.owner_id = current_user.id
    return crud.create_document(db=db, doc=doc)


@app.get("/api/documents/", response_model=schemas.UserDocumentsResponse, tags=["Documents"])
def get_documents_list(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    return crud.get_user_documents(db=db, user_id=current_user.id)


@app.get("/api/documents/{document_id}", response_model=schemas.DocumentResponse, tags=["Documents"])
def open_document(document_id: str, db: Session = Depends(get_db),
                  current_user: models.User = Depends(auth.get_current_user)):
    db_doc = crud.get_document(db, document_id)
    if not db_doc: raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    if not check_document_access(db_doc, current_user.id, "viewer"):
        raise HTTPException(status_code=403, detail="Bạn không có quyền xem tài liệu này")
    return db_doc


@app.put("/api/documents/{document_id}", response_model=schemas.DocumentResponse, tags=["Documents"])
def update_document(document_id: str, doc_update: schemas.DocumentUpdate, db: Session = Depends(get_db),
                    current_user: models.User = Depends(auth.get_current_user)):
    db_doc = crud.get_document(db, document_id)
    if not db_doc: raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    if not check_document_access(db_doc, current_user.id, "editor"):
        raise HTTPException(status_code=403, detail="Bạn không có quyền sửa")
    return crud.update_document(db, document_id, doc_update)


@app.delete("/api/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Documents"])
def delete_document(document_id: str, db: Session = Depends(get_db),
                    current_user: models.User = Depends(auth.get_current_user)):
    db_doc = crud.get_document(db, document_id=document_id)
    if not db_doc: raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu để xóa")
    if db_doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Chỉ người tạo ra tài liệu mới được phép xóa")
    crud.delete_document(db, document_id=document_id)
    return None


@app.post("/api/documents/{document_id}/share", tags=["Documents"])
def share_document(document_id: str, share_data: schemas.ShareCreate, db: Session = Depends(get_db),
                   current_user: models.User = Depends(auth.get_current_user)):
    db_doc = crud.get_document(db, document_id=document_id)
    if not db_doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    if db_doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Chỉ chủ sở hữu mới có quyền chia sẻ")

    target_user = crud.get_user_by_username(db, username=share_data.username)
    if not target_user:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy người dùng có tên '{share_data.username}'")

    if target_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Bạn không thể tự chia sẻ cho chính mình")

    return crud.share_document(db=db, document_id=document_id, target_user_id=target_user.id, role=share_data.role)


@app.post("/api/documents/{document_id}/versions", response_model=schemas.DocumentVersionResponse,
          tags=["Version History"])
def create_document_version(document_id: str, version_data: schemas.VersionCreate, db: Session = Depends(get_db),
                            current_user: models.User = Depends(auth.get_current_user)):
    db_doc = crud.get_document(db, document_id=document_id)
    if not db_doc: raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    if not check_document_access(db_doc, current_user.id, "editor"):
        raise HTTPException(status_code=403, detail="Không có quyền sửa")

    version_data.user_id = current_user.id
    return crud.save_document_version(
        db=db,
        document_id=document_id,
        user_id=version_data.user_id,
        current_content=version_data.content_snapshot
    )


@app.get("/api/documents/{document_id}/history", response_model=List[schemas.DocumentVersionResponse],
         tags=["Version History"])
def get_document_history(document_id: str, db: Session = Depends(get_db),
                         current_user: models.User = Depends(auth.get_current_user)):
    db_doc = crud.get_document(db, document_id=document_id)
    if not db_doc: raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    if not check_document_access(db_doc, current_user.id, "viewer"):
        raise HTTPException(status_code=403, detail="Không có quyền xem lịch sử")
    return crud.get_document_versions(db=db, document_id=document_id)


@app.post("/api/documents/{document_id}/restore/{version_id}", response_model=schemas.DocumentResponse,
          tags=["Version History"])
def restore_document_to_version(document_id: str, version_id: str, db: Session = Depends(get_db),
                                current_user: models.User = Depends(auth.get_current_user)):
    db_doc = crud.get_document(db, document_id=document_id)
    if not db_doc: raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")
    if not check_document_access(db_doc, current_user.id, "editor"):
        raise HTTPException(status_code=403, detail="Không có quyền khôi phục tài liệu")

    restored_doc = crud.restore_version(db=db, document_id=document_id, version_id=version_id)
    if not restored_doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy mốc lịch sử để khôi phục")
    return restored_doc


@app.patch("/api/documents/{document_id}/visibility", response_model=schemas.DocumentResponse, tags=["Documents"])
def change_document_visibility(document_id: str, visibility_data: schemas.DocumentVisibilityUpdate,
                               db: Session = Depends(get_db),
                               current_user: models.User = Depends(auth.get_current_user)):
    db_doc = crud.get_document(db, document_id=document_id)
    if not db_doc:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu")

    if db_doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Chỉ chủ sở hữu tài liệu mới có quyền thay đổi trạng thái chia sẻ")

    if visibility_data.visibility == "public" and not visibility_data.public_role:
        raise HTTPException(status_code=400, detail="Vui lòng xác định quyền (viewer/editor) khi bật chế độ Public")

    return crud.update_document_visibility(db, document_id=document_id, visibility_data=visibility_data)
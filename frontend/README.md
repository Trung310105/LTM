# Frontend

Frontend React/Vite cho API tài liệu và máy chủ WebSocket FastAPI.

## Chạy ứng dụng

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

## Chạy backend

Từ thư mục `LTM`, cài đặt dependencies:

```powershell
pip install -r backend/requirements.txt
```

Chạy API và WebSocket trong hai terminal riêng:

```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```powershell
python -m uvicorn websocket.ws_main:app --host 127.0.0.1 --port 1234
```

Frontend mặc định gọi API tại `http://127.0.0.1:8000` và WebSocket tại
`ws://127.0.0.1:1234`. Có thể đổi các địa chỉ này trong `.env`.

## Soạn thảo và đồng bộ

Editor dùng Yjs/Tiptap để đồng bộ nội dung rich text, định dạng chữ và vị trí
con trỏ cộng tác. Quyền xem/chỉnh sửa được kiểm tra trên cả API lẫn WebSocket;
tài liệu chỉ xem không bật con trỏ soạn thảo hay gửi thay đổi nội dung.
Định dạng đang chọn được giữ trong phiên làm việc, kể cả khi xóa nội dung hoặc
chuyển tài liệu. Có thể đổi tên tài liệu từ tiêu đề ở thanh trên cùng.

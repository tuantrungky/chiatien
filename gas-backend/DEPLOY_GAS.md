# Hướng Dẫn Deploy Backend Google Apps Script (GAS)

Tài liệu này hướng dẫn từng bước thiết lập Google Sheet, Google Drive, Google OAuth Client ID, Gemini API Key và deploy mã nguồn trong `/gas-backend` lên Google Apps Script làm REST API cho ứng dụng **Quản lý Lịch Cầu Lông & Chia Tiền Ăn Nhậu**.

---

## Bước 1: Chuẩn bị Google Sheet & Google Drive

1. Truy cập [Google Sheets](https://sheets.google.com) và tạo một file mới, đặt tên ví dụ: **`CLB Cầu Lông & Nhậu - DB`**.
2. Truy cập [Google Drive](https://drive.google.com) và tạo một thư mục mới để lưu ảnh hóa đơn, ví dụ: **`CLB_Hoa_Don`**.
3. Mở thư mục `CLB_Hoa_Don`, copy **Folder ID** trên thanh địa chỉ URL:
   - Ví dụ URL là `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz`
   - Thì `ROOT_DRIVE_FOLDER_ID` là `1AbCdEfGhIjKlMnOpQrStUvWxYz`.

---

## Bước 2: Lấy Gemini API Key & Google Client ID

### 2.1. Lấy `GEMINI_API_KEY`
1. Truy cập [Google AI Studio](https://aistudio.google.com/apikey).
2. Bấm **Create API key**, chọn project Google Cloud (hoặc tạo mới) và copy chuỗi khóa `AIza...`.

### 2.2. Lấy `GOOGLE_CLIENT_ID` (cho Google Identity Services)
1. Truy cập [Google Cloud Console](https://console.cloud.google.com/) -> chọn Project -> vào **APIs & Services** -> **Credentials**.
2. Nếu chưa có OAuth consent screen: vào **OAuth consent screen**, chọn **External**, điền tên ứng dụng (VD: `CLB Cau Long`), email hỗ trợ và lưu.
3. Vào **Credentials** -> **+ Create Credentials** -> **OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: thêm các domain của Frontend:
     - `http://localhost:5173` (để dev local)
     - `https://<ten-app-cua-ban>.vercel.app` (sau khi deploy Vercel)
   - Bấm **Create** và copy **Client ID** (dạng `1234567890-xxxx.apps.googleusercontent.com`).

---

## Bước 3: Tạo Google Apps Script & Copy 5 file code

1. Mở file Google Sheet bạn vừa tạo ở Bước 1.
2. Trên thanh menu, chọn **Tiện ích mở rộng (Extensions)** -> **Apps Script**.
3. Trong trình soạn thảo Apps Script:
   - Đổi tên project thành `CaulongNhau-Backend`.
   - Với file mặc định `Code.gs`: xóa hết nội dung cũ và dán toàn bộ nội dung file `gas-backend/Code.gs`.
   - Bấm dấu **`+`** bên cạnh mục **Files** -> chọn **Script** để tạo thêm lần lượt 4 file (không cần gõ đuôi `.gs`, GAS tự thêm):
     1. `AuthService` -> dán nội dung `gas-backend/AuthService.gs`
     2. `DriveService` -> dán nội dung `gas-backend/DriveService.gs`
     3. `GeminiService` -> dán nội dung `gas-backend/GeminiService.gs`
     4. `SheetService` -> dán nội dung `gas-backend/SheetService.gs`
4. Nhấn **Ctrl + S** (hoặc biểu tượng đĩa mềm) để lưu toàn bộ 5 file.

---

## Bước 4: Cấu hình Script Properties (Biến môi trường bảo mật)

1. Ở thanh menu trái của Apps Script IDE, bấm biểu tượng **Project Settings** (bánh răng ⚙️).
2. Kéo xuống mục **Script Properties** -> bấm **Add script property** và thêm đủ các cặp key-value sau:

| Property | Giá trị cần điền | Ghi chú |
| :--- | :--- | :--- |
| `GOOGLE_CLIENT_ID` | `123456...apps.googleusercontent.com` | Phải khớp tuyệt đối với `VITE_GOOGLE_CLIENT_ID` ở Frontend |
| `GEMINI_API_KEY` | `AIzaSy...` | API key lấy ở Google AI Studio |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model Gemini hỗ trợ đọc ảnh hóa đơn (Vision) |
| `ROOT_DRIVE_FOLDER_ID` | `1AbCdEf...` | ID thư mục `CLB_Hoa_Don` trên Google Drive |
| `FIREBASE_WEB_API_KEY` | `AIzaSy...` | *(Chỉ khi dùng Firebase)* Web API Key của Firebase project, để GAS xác thực Firebase ID Token (cho `parseBillAI`, `exportRawTables`, `importRawTables`). Xem [FIREBASE_HYBRID_GUIDE](../docs/FIREBASE_HYBRID_GUIDE.md) |

3. Bấm **Save script properties**.

> **Lưu ý:** Nếu bạn tạo Apps Script độc lập (không đi từ menu Extensions của Google Sheet), cần thêm property `SPREADSHEET_ID` với ID của Google Sheet. Nếu mở từ menu Extensions của Sheet thì không bắt buộc.

---

## Bước 5: Chạy hàm `setupDatabase()` (Khởi tạo / Nâng cấp lên 10 tabs)

1. Quay lại tab **Editor** (`</>`), chọn file **`SheetService.gs`**.
2. Trên thanh công cụ phía trên, ở dropdown chọn hàm (bên cạnh nút Run/Debug), chọn **`setupDatabase`**.
3. Bấm **Run**.
4. Lần đầu chạy, Google sẽ hiện hộp thoại yêu cầu **Review permissions**:
   - Chọn tài khoản Google của bạn.
   - Nếu thấy cảnh báo *"Google hasn't verified this app"*, bấm **Advanced** -> **Go to CaulongNhau-Backend (unsafe)** -> **Allow**.
5. Mở lại Google Sheet sẽ thấy đủ **10 tabs**: `Members`, `Sessions`, `Attendance`, `Session_Items`, `Schedule`, `Monthly_Bills`, `Monthly_Dues`, `Settlements`, `Settings`, `Editors` với dòng header đã đóng băng, định dạng plain text `@` cho cột mã/ngày/SĐT/STK/`issued_at` và `Settings` có sẵn cấu hình mặc định (hàm chạy idempotent, an toàn khi nâng cấp từ bản cũ; tab `Fund_Ledger` lịch sử nếu còn sẽ được giữ nguyên, không bị xóa).

---

## Bước 6: Khởi tạo dữ liệu ban đầu trên Google Sheet

1. Mở tab **`Editors`**, thêm dòng đầu tiên (Row 2) cho tài khoản quản lý của bạn:
   - `email`: email Google viết thường toàn bộ (VD: `tuan.ha@gmail.com`)
   - `name`: `Tuấn`
   - `role`: `ADMIN`
   - `is_active`: `TRUE`
   - `added_at`: `2026-11-25T15:00:00+07:00`
2. Mở tab **`Members`**, thêm dòng đầu tiên (Row 2) cho Thủ quỹ:
   - `member_id`: `MEM_001`
   - `name`: `Nguyễn Anh Tuấn`
   - `aliases`: `Tuấn, Thủ quỹ`
   - `type`: `MAIN`
   - `bank_bin`: `970436` (VD Vietcombank; xem mã BIN VietQR ngân hàng tương ứng)
   - `bank_name`: `Vietcombank`
   - `account_no`: `'0123456789` (gõ dấu nháy đơn `'` phía trước để giữ số `0` đầu)
   - `account_name`: `NGUYEN ANH TUAN`
   - `is_active`: `TRUE`
3. Mở tab **`Settings`**, tìm dòng `treasurer_member_id` và điền cột `value` là **`MEM_001`**, đồng thời cập nhật `court_price_per_hour`, `shuttle_price`, `guest_fee` nếu cần (hoặc chỉnh trực tiếp trong trang **Cài đặt** trên Web App).

---

## Bước 7: Deploy thành Web App

1. Trên góc phải Apps Script IDE, bấm nút **Deploy** -> **New deployment**.
2. Bấm biểu tượng bánh răng bên cạnh **Select type** -> chọn **Web app**.
3. Điền cấu hình:
   - **Description**: `v2.4 - Hybrid Firebase Auth, Privacy (members_private) & Math.ceil`
   - **Execute as**: **Me** *(rất quan trọng: giúp Viewer không cần đăng nhập vẫn đọc được dữ liệu thông qua quyền của bạn)*
   - **Who has access**: **Anyone** *(bắt buộc để Frontend trên Vercel gọi được mà không bị chặn trang đăng nhập Google)*
4. Bấm **Deploy** -> copy **Web app URL** (có dạng `https://script.google.com/macros/s/AKfycb.../exec`).
5. Dán URL này vào biến môi trường **`VITE_GAS_API_URL`** của Frontend.

> **⚠️ Quan trọng khi cập nhật code sau này:**
> Mỗi lần bạn sửa code trong `.gs`, nếu chỉ bấm Save thì Web App URL cũ vẫn chạy code cũ. Bạn phải vào **Deploy** -> **Manage deployments** -> bấm biểu tượng bút chì (Edit) -> chọn **New version** -> **Deploy** thì thay đổi mới có hiệu lực (URL `/exec` sẽ giữ nguyên không đổi).

---

## Bước 8: Kiểm tra nhanh API sau khi Deploy

Mở trực tiếp trên trình duyệt (hoặc chạy PowerShell/curl):
```text
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?action=getAll
```
Nếu nhận được JSON dạng:
```json
{
  "ok": true,
  "data": {
    "bootstrap": { "settings": { "club_name": "CLB Cầu Lông & Nhậu" }, "members": [ ... ] },
    "dashboard": { ... },
    "sessions": [ ... ],
    "debts": { "badminton": { ... }, "drinking": { ... } },
    "schedule": { ... },
    "monthlyBill": { ... },
    "guestStats": { ... }
  },
  "meta": { "timestamp": "..." },
  "error": null
}
```
là Backend GAS đã sẵn sàng hoạt động!

# CLB Cầu Lông & Nhậu — Web App Quản Lý Quỹ & Chia Tiền

Ứng dụng Web **Mobile-first** quản lý Quỹ Cầu Lông (`BADMINTON`) và Chia tiền Ăn nhậu (`DRINKING`), tích hợp **VietQR**, thuật toán **Debt Simplification** (cấn trừ nợ vòng tròn), **Google Drive** lưu hóa đơn và **Gemini AI** (đọc hóa đơn & điểm danh bằng giọng nói tiếng Việt).

- **Frontend (`/frontend`):** React + Vite + TypeScript + Tailwind CSS + Recharts + PWA (deploy **Vercel**).
- **Backend (`/gas-backend`):** Google Apps Script (`Code.gs`, `AuthService.gs`, `SheetService.gs`, `DriveService.gs`, `GeminiService.gs`) làm REST API và proxy bảo mật `GEMINI_API_KEY`.
- **Database:** 1 file Google Sheets gồm 7 tabs (`Members`, `Sessions`, `Attendance`, `Fund_Ledger`, `Settlements`, `Settings`, `Editors`).

> Chi tiết nghiệp vụ, schema 7 tabs và API Contract xem tại [SPEC.md](./SPEC.md).

---

## Hướng Dẫn Triển Khai Từ A–Z

### Bước 1 — Chuẩn bị Google Sheet & Google Drive
1. Truy cập [Google Sheets](https://sheets.google.com) và tạo một bảng tính mới (VD: `CLB Cầu Lông & Nhậu - DB`).
2. Truy cập [Google Drive](https://drive.google.com) và tạo một thư mục mới để lưu ảnh hóa đơn (VD: `CLB_Hoa_Don`).
3. Mở thư mục `CLB_Hoa_Don` và copy **Folder ID** trên thanh URL:
   - URL dạng `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz`
   - Thì **`ROOT_DRIVE_FOLDER_ID`** là `1AbCdEfGhIjKlMnOpQrStUvWxYz`.
4. Truy cập [Google AI Studio](https://aistudio.google.com/apikey), bấm **Create API key** để lấy **`GEMINI_API_KEY`**.

---

### Bước 2 — Triển khai Google Apps Script (`/gas-backend`)
*(Xem hướng dẫn chi tiết thêm tại [gas-backend/DEPLOY_GAS.md](./gas-backend/DEPLOY_GAS.md))*

1. Mở file Google Sheet ở Bước 1 -> menu **Tiện ích mở rộng (Extensions)** -> **Apps Script**.
2. Dán toàn bộ code từ thư mục `/gas-backend` vào Apps Script IDE:
   - File `Code.gs` <- `gas-backend/Code.gs`
   - Tạo thêm 4 file Script (`AuthService`, `DriveService`, `GeminiService`, `SheetService`) và dán nội dung 4 file `.gs` tương ứng.
3. Vào **Project Settings (⚙️)** -> **Script Properties** -> thêm các biến sau:
   - `GEMINI_API_KEY`: API key từ Google AI Studio.
   - `GEMINI_MODEL`: `gemini-2.5-flash`
   - `ROOT_DRIVE_FOLDER_ID`: Folder ID ở Bước 1.
   - `GOOGLE_CLIENT_ID`: *(Sẽ điền ngay sau khi hoàn tất Bước 3 bên dưới)*.
4. Mở file `SheetService.gs`, chọn hàm **`setupDatabase`** trên thanh công cụ và bấm **Run** (cấp quyền truy cập Sheet & Drive cho script). Script sẽ tự tạo đủ **7 tabs**, đóng băng header và điền cấu hình mặc định vào `Settings`.
5. Quay lại Google Sheet:
   - Vào tab **`Editors`**, thêm dòng đầu tiên cho chính bạn:
     - `email`: email Google viết thường toàn bộ
     - `name`: Tên của bạn
     - `role`: **`ADMIN`**
     - `is_active`: **`TRUE`**
   - Vào tab **`Members`**, thêm ít nhất 1 dòng Thủ quỹ (`member_id = MEM_001`, `type = MAIN`, kèm `bank_bin`, `bank_name`, `account_no`, `account_name`, `is_active = TRUE`).
   - Vào tab **`Settings`**, điền `value` cho dòng `treasurer_member_id` là `MEM_001`.
6. Bấm **Deploy** -> **New deployment** -> chọn loại **Web app**:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
7. Bấm **Deploy** và lưu lại **Web App URL** (kết thúc bằng `/exec`).

> **⚠️ Lưu ý cực kỳ quan trọng khi cập nhật code GAS:**
> Mỗi lần chỉnh sửa code `.gs`, bạn **KHÔNG** tạo deployment mới mà phải vào **Deploy** -> **Manage deployments** -> bấm biểu tượng bút chì (**Edit**) -> ở mục *Version* chọn **New version** -> bấm **Deploy** để giữ nguyên Web App URL cho Frontend.

---

### Bước 3 — Cấu hình Google Cloud Console (OAuth Client ID)
1. Truy cập [Google Cloud Console](https://console.cloud.google.com/) -> chọn/tạo Project -> **APIs & Services** -> **OAuth consent screen**:
   - Chọn **External**, điền tên app (VD: `CLB Cau Long`), email hỗ trợ và lưu.
2. Vào **Credentials** -> **+ Create Credentials** -> **OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: thêm cả local dev lẫn domain Vercel:
     - `http://localhost:5173`
     - `https://<ten-du-an-cua-ban>.vercel.app`
3. Copy **Client ID** (dạng `1234567890-xxxx.apps.googleusercontent.com`).
4. Quay lại **GAS Script Properties** (Bước 2.3) để dán **`GOOGLE_CLIENT_ID`** này vào và lưu lại.

---

### Bước 4 — Deploy Frontend lên Vercel
1. Push toàn bộ source code lên GitHub repository của bạn.
2. Truy cập [Vercel](https://vercel.com) -> **Add New...** -> **Project** -> Import GitHub repo vừa tạo.
3. Trong phần **Configure Project**:
   - **Root Directory:** bấm **Edit** và chọn **`frontend`**.
   - **Framework Preset:** `Vite` (Vercel tự nhận diện).
   - **Environment Variables:** thêm 3 biến:
     | Name | Value |
     | :--- | :--- |
     | `VITE_GAS_API_URL` | Web App URL `/exec` từ Bước 2.7 |
     | `VITE_GOOGLE_CLIENT_ID` | Client ID từ Bước 3.3 |
     | `VITE_USE_MOCK` | `false` |
4. Bấm **Deploy**. File `frontend/vercel.json` đã cấu hình sẵn SPA rewrite `/(.*) -> /index.html` nên reload trang không bị lỗi 404.
5. Nếu domain `.vercel.app` mới tạo khác với domain bạn nhập trước ở Bước 3.2, hãy quay lại Google Cloud Console bổ sung đúng domain đó vào **Authorized JavaScript origins**.

> **Mẹo dùng như App trên điện thoại:** Mở link Vercel bằng Chrome (Android) hoặc Safari (iOS) -> bấm **"Thêm vào màn hình chính" (Add to Home Screen)** để cài đặt icon app PWA.

---

### Bước 5 — Checklist Nghiệm Thu (Smoke Test)
Sau khi deploy xong, kiểm tra nhanh 6 bài test thực tế sau:

- [ ] **1. Luồng Viewer ẩn danh & VietQR:** Mở link Vercel bằng **Tab ẩn danh** trên điện thoại -> thấy ngay số dư quỹ, lịch sử buổi chơi, bảng công nợ tối ưu và bấm mở được ảnh **VietQR** đúng số tiền/STK/nội dung không dấu; không thấy các nút Tạo/Sửa/Xóa/Gạch nợ.
- [ ] **2. Đăng nhập Editor Google:** Bấm **"Đăng nhập Editor"** ở góc phải header -> chọn tài khoản Google có trong tab `Editors` -> xuất hiện đủ 5 tab (`Tổng quan`, `Công nợ`, `Tạo buổi`, `Quỹ`, `Cài đặt`). Thử đăng nhập bằng 1 Gmail không có trong `Editors` -> bị từ chối quyền (`403`).
- [ ] **3. Quét ảnh hóa đơn AI (`parseBillAI`):** Vào **Tạo buổi** -> chụp/chọn 1 ảnh hóa đơn -> kiểm tra thấy ảnh được lưu vào subfolder `YYYY-MM` trên Google Drive (`ROOT_DRIVE_FOLDER_ID`) và tự điền đúng `Tổng tiền` + `Tóm tắt món`.
- [ ] **4. Điểm danh bằng Micro & Tạo vãng lai mới (`parseVoiceAttendanceAI`):** Bấm nút **Nói điểm danh** đọc tiếng Việt (VD: *"Hôm nay có Tuấn, Hùng, thêm vãng lai Nam"*) -> bấm **AI phân tích điểm danh** -> kiểm tra tự tick thành viên cũ và hiện **Nam** trong mục vãng lai mới -> bấm **Lưu buổi** và kiểm tra `Nam` tự xuất hiện trong tab `Members`.
- [ ] **5. Thống kê Vãng lai theo tháng:** Vào tab **Quỹ** -> **Thống kê Vãng lai** -> kiểm tra `Nam` hiển thị đúng số buổi, badge ngày đã đi và trạng thái nợ phí buổi vừa tạo.
- [ ] **6. Xác nhận thanh toán & Cộng quỹ tự động:** Vào tab **Công nợ** -> bấm **"Xác nhận đã chuyển"** trên lệnh tối ưu (hoặc **"Đã thu"** trên dòng vãng lai) -> kiểm tra công nợ giảm về `0`, tab `Settlements` có dòng đối soát mới và phí vãng lai Cầu lông được tự động cộng vào `Fund_Ledger` (`GUEST_FEE`).

---

## Chạy Dev Local với Mock Data
```bash
cd frontend
npm install
# Đảm bảo .env.local có VITE_USE_MOCK=true
npm run dev
```

Chạy unit test & build kiểm tra:
```bash
cd frontend
npm test
npm run build
```

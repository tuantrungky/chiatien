# CLB Cầu Lông & Nhậu — Web App Quản Lý Lịch & Chia Tiền

Ứng dụng Web **Mobile-first** quản lý **Lịch Cầu Lông**, **Hóa đơn Cầu lông theo tháng** (tự động cấn trừ dư/thiếu, góp ống cầu và tiền vãng lai sang tháng sau) và **Chia tiền Ăn nhậu** (hỗ trợ cả ra quán & góp món tại nhà, làm tròn lên `Math.ceil` toàn dự án để người ứng tiền không bị hụt), tích hợp **VietQR**, thuật toán **Debt Simplification** tách biệt hoàn toàn Cầu lông / Ăn nhậu, **Google Drive** lưu hóa đơn và **Gemini AI** đọc ảnh hóa đơn.

- **Frontend (`/frontend`):** React + Vite + TypeScript + Tailwind CSS + Recharts + PWA (deploy **Vercel**).
- **Backend & Storage (Hybrid):** **Cloud Firestore + Firebase Auth** làm database chính (realtime, tự gia hạn phiên) + **Google Apps Script (`/gas-backend`)** làm proxy bảo mật `GEMINI_API_KEY`, upload Google Drive và đồng bộ 2 chiều với **Google Sheets (10 tabs)**.
- **Database (10 bảng + vùng riêng tư):** `Members` (trên Firestore tách `members` công khai cho App/VietQR và `members_private` ẩn `phone`/`email` khỏi Viewer), `Sessions`, `Attendance`, `Session_Items`, `Schedule`, `Monthly_Bills`, `Monthly_Dues`, `Settlements`, `Settings`, `Editors` *(tab `Fund_Ledger` cũ trên Sheet nếu còn chỉ giữ làm kho lưu trữ, app không đọc/ghi)*.
- Logic nghiệp vụ dùng chung ở [domainEngine.ts](./frontend/src/services/domainEngine.ts) (Firebase/Mock) và song song ở [SheetService.gs](./gas-backend/SheetService.gs) (GAS) — hai nơi giữ parity 1–1.

> **Tài liệu chính:**
> - Đặc tả nguồn chân lý: [SPEC.md](./SPEC.md)
> - Thiết lập Firebase & vận hành Hybrid: [docs/FIREBASE_HYBRID_GUIDE.md](./docs/FIREBASE_HYBRID_GUIDE.md)
> - Triển khai GAS Backend: [gas-backend/DEPLOY_GAS.md](./gas-backend/DEPLOY_GAS.md)
> - Kiến trúc Hybrid (ADR): [docs/adr/0001-firebase-hybrid.md](./docs/adr/0001-firebase-hybrid.md)
> - Lịch sử audit & quy tắc đã chốt: [docs/CHANGELOG_AUDIT.md](./docs/CHANGELOG_AUDIT.md)
> - Nợ kỹ thuật & lộ trình tương lai: [docs/ROADMAP.md](./docs/ROADMAP.md)

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
   - `FIREBASE_WEB_API_KEY`: *(Chỉ khi dùng Firebase — xem docs/FIREBASE_HYBRID_GUIDE.md)*.
4. Mở file `SheetService.gs`, chọn hàm **`setupDatabase`** trên thanh công cụ và bấm **Run** (cấp quyền truy cập Sheet & Drive cho script). Script sẽ tự tạo / nâng cấp đủ **10 tabs** hoạt động, đóng băng header, đặt định dạng plain text `@` cho cột mã/ngày/SĐT/STK/issued_at và điền cấu hình mặc định vào `Settings`.
5. Quay lại Google Sheet:
   - Vào tab **`Editors`**, thêm dòng đầu tiên cho chính bạn (`email` viết thường, `name`, `role = ADMIN`, `is_active = TRUE`).
   - Vào tab **`Members`**, thêm ít nhất 1 dòng Thủ quỹ (`member_id = MEM_001`, `type = MAIN`, kèm `bank_bin`, `bank_name`, `account_no` nhớ giữ số `0` đầu, `account_name`, `is_active = TRUE`).
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
   - **Environment Variables:** thêm các biến:
     | Name | Value |
     | :--- | :--- |
     | `VITE_GAS_API_URL` | Web App URL `/exec` từ Bước 2.7 |
     | `VITE_GOOGLE_CLIENT_ID` | Client ID từ Bước 3.3 |
     | `VITE_USE_MOCK` | `false` (**bắt buộc**; `true` bỏ qua mọi provider khác) |
     | `VITE_DB_PROVIDER` | `gas` (ban đầu) hoặc `firebase` sau khi migrate |
     | `VITE_FIREBASE_*` (6 biến) | *(Tùy chọn)* xem [FIREBASE_HYBRID_GUIDE](./docs/FIREBASE_HYBRID_GUIDE.md) |
4. Bấm **Deploy**. File `frontend/vercel.json` đã cấu hình sẵn SPA rewrite `/(.*) -> /index.html` nên reload trang không bị lỗi 404.
5. Nếu domain `.vercel.app` mới tạo khác với domain bạn nhập trước ở Bước 3.2, hãy quay lại Google Cloud Console bổ sung đúng domain đó vào **Authorized JavaScript origins**.

> **Mẹo dùng như App trên điện thoại:** Mở link Vercel bằng Chrome (Android) hoặc Safari (iOS) -> bấm **"Thêm vào màn hình chính" (Add to Home Screen)** để cài đặt icon app PWA.

---

### Bước 5 — Checklist Nghiệm Thu (Smoke Test)
Sau khi deploy xong, kiểm tra nhanh các bài test thực tế sau:

- [ ] **1. Luồng Viewer ẩn danh & VietQR:** Mở link Vercel bằng **Tab ẩn danh** -> thấy ngay Tổng quan, Lịch tháng, Công nợ tách riêng Cầu lông / Ăn nhậu, Tháng cầu và mở được ảnh **VietQR** đúng số tiền/STK/nội dung không dấu; không thấy các nút Tạo/Sửa/Xóa/Gạch nợ.
- [ ] **2. Đăng nhập Editor & `localStorage`:** Bấm **"Đăng nhập Editor"** -> chọn tài khoản Google trong tab `Editors` -> giữ phiên đăng nhập trong `localStorage` khi mở lại trình duyệt. Thử Gmail ngoài `Editors` -> bị từ chối (`403`).
- [ ] **3. Lịch tháng & Tạo buổi Cầu lông chi tiết:** Tạo lịch tháng trên tab **Lịch** -> bấm **"Điểm danh & Ghi buổi"** -> kiểm tra công thức `Tiền sân (+ Sân thêm giờ) + Tiền cầu + Chi phí khác`, tick tay & thêm nhanh vãng lai, sau khi lưu **KHÔNG** phát sinh chuyển khoản chéo giữa các thành viên `MAIN`.
- [ ] **4. Hóa đơn Cầu lông tháng & Chuyển dư:** Vào tab **Tháng cầu** -> Phát hành hóa đơn tháng -> đánh dấu thành viên đã đóng -> thử Chốt tháng và kiểm tra `carry_out = carry_in + billed_total + guest_income - actual_cost`.
- [ ] **5. Buổi Ăn nhậu góp món & Tách nợ:** Tạo buổi Ăn nhậu kiểu `HOME` hoặc `RESTAURANT` có thành viên góp món (`Session_Items`) -> kiểm tra nợ tối ưu **chỉ nằm ở nhóm Ăn nhậu** và cấn trừ đúng `per_person - contributed_amount`.

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

# Hướng Dẫn Thiết Lập Firebase & Triển Khai Hybrid (Zero-Downtime)

Tài liệu này hướng dẫn từng bước thiết lập **Cloud Firestore + Firebase Auth** miễn phí (gói **Spark \$0/tháng**, không cần thẻ tín dụng) và chuyển đổi dữ liệu từ Google Sheets sang Firebase an toàn tuyệt đối.

---

## Bước 1 — Cấu hình Firebase Console

1. Truy cập [Firebase Console](https://console.firebase.google.com/) và mở Project bạn đã tạo Firestore.
2. **Đảm bảo Firestore nằm ở khu vực `asia-southeast1` (Singapore)** (độ trễ từ Việt Nam chỉ ~30–50ms).
3. **Bật đăng nhập Google (Firebase Auth):**
   - Menu bên trái: **Authentication** → **Sign-in method** → **Add new provider** → chọn **Google** → **Enable** → nhập Email hỗ trợ → **Save**.
   - Chuyển sang tab **Settings** → **Authorized domains** → thêm domain Vercel của bạn (VD: `caulong-nhau.vercel.app`) — `localhost` đã có sẵn mặc định.
4. **Dán Security Rules:**
   - Menu bên trái: **Firestore Database** → tab **Rules**.
   - Copy toàn bộ nội dung file [firestore.rules](../firebase/firestore.rules) dán vào trình soạn thảo và bấm **Publish**.
5. **Tạo Composite Indexes (khuyến nghị tạo trước để không bị lỗi thiếu index khi query):**
   - Trong **Firestore Database** → tab **Indexes** → **Add index** (3 index theo file [firestore.indexes.json](../firebase/firestore.indexes.json)):
     - Collection `attendance`: `session_type` (Ascending), `is_paid` (Ascending)
     - Collection `monthly_dues`: `month` (Ascending), `is_paid` (Ascending)
     - Collection `settlements`: `is_reconciled` (Ascending), `settled_at` (Descending)
   *(Hoặc nếu bỏ qua bước này, lần đầu app chạy query sẽ báo link tạo index 1 chạm trong Console DevTools — bấm vào link đó là Firebase tự tạo).*
6. **Lấy `firebaseConfig` & `Web API Key`:**
   - Bấm biểu tượng bánh răng ⚙️ cạnh *Project Overview* → **Project settings** → mục **General**:
     - Lưu lại **`Web API Key`** (dùng cho GAS bước 2).
     - Cuộn xuống **Your apps** → chọn biểu tượng Web `</>` → đăng ký app (VD: `caulong-nhau-web`, không cần tick Firebase Hosting) → copy 6 giá trị `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.

---

## Bước 2 — Cập nhật Google Apps Script (GAS)

1. Mở trình soạn thảo Apps Script của file Google Sheet hiện tại.
2. Cập nhật nội dung 3 file vừa nâng cấp:
   - `AuthService.gs` ← [gas-backend/AuthService.gs](../gas-backend/AuthService.gs)
   - `Code.gs` ← [gas-backend/Code.gs](../gas-backend/Code.gs)
   - `SheetService.gs` ← [gas-backend/SheetService.gs](../gas-backend/SheetService.gs)
3. Vào **Project Settings (⚙️)** → **Script Properties** → thêm biến mới:
   - `FIREBASE_WEB_API_KEY`: dán `Web API Key` lấy ở Bước 1.6.
4. Bấm **Deploy** → **Manage deployments** → biểu tượng bút chì (**Edit**) → *Version* chọn **New version** → **Deploy** (giữ nguyên URL `/exec` cũ).

---

## Bước 3 — Quy Trình Migrate Không Gián Đoạn (Zero-Downtime)

1. **Cập nhật biến môi trường trên Vercel (hoặc `frontend/.env.local` để test trước):**
   - Thêm 6 biến `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
   - Trong đợt deploy đầu tiên, đặt tạm:
     - `VITE_DB_PROVIDER=gas`
     - `VITE_USE_MOCK=false`
   *(Nhờ vậy mọi thành viên CLB vẫn dùng Google Sheets bình thường trong lúc bạn chuẩn bị dữ liệu trên Firebase).*
2. **Pull dữ liệu từ Google Sheets sang Firebase:**
   - Mở web đã deploy, đăng nhập bằng tài khoản **ADMIN** (bấm *Đăng nhập bằng Google*).
   - Vào **Quản trị & Cài đặt** → tab **Database & Sync**.
   - Bấm nút **Pull: Google Sheet → Firebase**. Hệ thống sẽ kéo toàn bộ **10 bảng** sang Firestore (và tự tách `phone`/`email` sang `members_private`).
   - Bấm **So sánh dữ liệu** để xác nhận tất cả 10 bảng có chênh lệch = `0`.
   - *(Nếu Firestore đã có dữ liệu chạy trước bản cập nhật bảo mật)* Hãy đảm bảo đã publish [firestore.rules](../firebase/firestore.rules) mới **trước**, sau đó bấm nút **Tách SĐT/Email sang vùng riêng tư** để chuyển toàn bộ SĐT/Email sang `members_private` và ẩn khỏi Viewer công khai.
3. **Đối chiếu chéo số liệu:**
   - Ngay trong tab **Database & Sync**, bấm chuyển nguồn cục bộ sang **Firebase** (chỉ ảnh hưởng trình duyệt của bạn).
   - Kiểm tra Tổng quan, Công nợ Cầu lông / Ăn nhậu, Lịch tháng, Tháng cầu — đối chiếu với lúc chọn **Google Sheets** đảm bảo khớp từng đồng.
   - Thử tạo/sửa 1 buổi nháp hoặc thử **Quét hóa đơn AI** (ảnh vẫn tự lưu lên Google Drive như cũ).
4. **Chính thức chuyển Production sang Firebase:**
   - Vào Vercel → đổi `VITE_DB_PROVIDER=firebase` → **Redeploy**.
   - Trên máy Admin, bấm **Theo .env** trong tab *Database & Sync* để bỏ override cục bộ.

---

> **Lưu ý `VITE_USE_MOCK`:** nếu `VITE_USE_MOCK=true`, app luôn chạy Mock và bỏ qua `VITE_DB_PROVIDER`. Trên Vercel phải để `false`.
> **Quyền riêng tư (`members_private`):** Security Rules ẩn `phone` và `email` khỏi Viewer công khai (chỉ giữ công khai thông tin ngân hàng cho VietQR); chỉ Editor/Admin hoặc chính thành viên đã xác minh email mới truy cập được `members_private`.
> **Thứ tự deploy an toàn khi nâng cấp:** (1) Publish `firebase/firestore.rules` trên Firebase Console trước → (2) Deploy GAS → (3) Deploy Frontend → (4) Admin chạy **Tách SĐT/Email sang vùng riêng tư** (hoặc Pull).

## Vận Hành Hằng Ngày & Sao Lưu Định Kỳ

- **Hằng ngày:** Mọi thao tác đọc/ghi chạy trực tiếp trên **Cloud Firestore** (tốc độ ~100ms, cập nhật real-time giữa các máy qua `_meta/sync_state`, phiên đăng nhập Google tự gia hạn không hết hạn mỗi giờ). Ảnh hóa đơn và AI OCR vẫn dùng GAS + Google Drive miễn phí.
- **Cuối tháng (hoặc khi cần xuất Excel/đối soát):** Admin vào **Cài đặt → Database & Sync → Push: Firebase → Google Sheet** để đồng bộ toàn bộ 10 bảng về Google Sheet (tự gộp `members` + `members_private` vào tab `Members`, không đụng tab `Fund_Ledger` lịch sử nếu còn).
- **Dự phòng khẩn cấp:** Nếu có sự cố bất khả kháng, chỉ cần đổi `VITE_DB_PROVIDER=gas` trên Vercel hoặc chọn **Google Sheets** trong *Database & Sync*.

# ADR-0001: Kiến Trúc Database Hybrid — Cloud Firestore (Chính) & Google Sheets (Sao Lưu / Dự Phòng)

- **Trạng thái:** Đã chấp nhận & Đã triển khai (2026-11)
- **Tài liệu vận hành:** [FIREBASE_HYBRID_GUIDE.md](../FIREBASE_HYBRID_GUIDE.md)
- **Security Rules chuẩn (Single Source of Truth):** [firebase/firestore.rules](../../firebase/firestore.rules)

---

## 1. Bối Cảnh & Quyết Định Kiến Trúc

Hệ thống ban đầu chỉ chạy trên Google Sheets + Google Apps Script (GAS), gặp các giới hạn: độ trễ 1.5–5 giây, không tự cập nhật real-time giữa các thiết bị, phiên Google Identity Services hết hạn sau 1 giờ, và giới hạn 95 KB của GAS `CacheService`.

Dự án đã chọn mô hình **Hybrid** với các quyết định sau:

| Hạng mục | Quyết định |
| :--- | :--- |
| **Database chính (Production)** | **Cloud Firestore** (gói miễn phí Spark, khu vực `asia-southeast1` Singapore, bật `persistentLocalCache` IndexedDB). |
| **Đồng bộ Google Sheets** | **Manual Push / Pull 2 chiều theo yêu cầu** bởi `ADMIN` trong `Cài đặt → Database & Sync` (không chạy auto-mirror ngầm trên mỗi lần ghi). |
| **Ảnh hóa đơn & Gemini OCR (`parseBillAI`)** | **Giữ nguyên GAS** (`DriveService.gs` + `GeminiService.gs`) làm proxy miễn phí, lưu ảnh vào Google Drive theo thư mục `YYYY-MM`. |
| **Chuyển đổi nguồn dữ liệu** | Cấu hình mặc định qua `VITE_DB_PROVIDER` (`firebase` \| `gas` \| `mock`), kết hợp **Admin Runtime Switcher** lưu cục bộ ở `localStorage` (`cln_db_provider_override_v1`) để đối chiếu số liệu hoặc fallback khẩn cấp. |
| **Xác thực (Auth)** | **Firebase Auth (Google Sign-In)** tự gia hạn token. [AuthService.gs](../../gas-backend/AuthService.gs) chấp nhận song song cả Firebase ID Token (verify qua `identitytoolkit accounts:lookup` dùng `FIREBASE_WEB_API_KEY`) lẫn GIS ID Token cũ. |
| **Logic nghiệp vụ dùng chung** | [domainEngine.ts](../../frontend/src/services/domainEngine.ts) (pure TypeScript cho `FirebaseProvider` & `MockProvider`) phải giữ **100% parity** với [SheetService.gs](../../gas-backend/SheetService.gs) (`GasProvider`). |

---

## 2. Ánh Xạ Dữ Liệu (10 Bảng Nghiệp Vụ + `members_private` + `_meta`)

Từ đợt Audit v2.4 (2026-11-27), hệ thống sử dụng **10 bảng** nghiệp vụ (đã gỡ bỏ `fund_ledger` legacy; tab `Fund_Ledger` trên Google Sheet nếu có chỉ giữ làm kho lưu trữ lịch sử, không đọc/ghi).

| Firestore Collection | Document ID | Tab Google Sheet | Ghi chú thiết kế |
| :--- | :--- | :--- | :--- |
| `members` | `{member_id}` | `Members` (phần công khai) | Công khai tên, loại, thông tin ngân hàng VietQR, `has_email`. **Không lưu `phone`/`email`**. |
| `members_private` | `{member_id}` | `Members` (`phone`, `email`) | Chỉ Editor/Admin đọc ghi; Member đã xác minh email chỉ tự đọc/liên kết `email` của chính mình. Sync tự tách khi Pull và gộp lại khi Push. |
| `sessions` | `{session_id}` | `Sessions` | Query theo cutoff 6 tháng + tải bù buổi còn nợ. |
| `attendance` | `{attendance_id}` | `Attendance` | Index `session_id`, `is_paid`, `session_date`, `paid_at`, composite `(session_type, is_paid)`. |
| `session_items` | `{item_id}` | `Session_Items` | Chỉ đọc on-demand khi xem/sửa/undo buổi nhậu. |
| `schedule` | `{plan_id}` | `Schedule` | Thêm trường dẫn xuất `month` (`YYYY-MM`) để query theo tháng. |
| `monthly_bills` | `{month}` (`YYYY-MM`) | `Monthly_Bills` | Đọc O(1) theo tháng. |
| `monthly_dues` | `{due_id}` | `Monthly_Dues` | Có trường `issued_at` cố định để tính ngày quá hạn chính xác; composite `(month, is_paid)`. |
| `settlements` | `{settlement_id}` | `Settlements` | Cột `source_ledger_ids` lưu `REC:SET_1,SET_2` cho đợt chốt ăn nhậu; composite `(is_reconciled, settled_at DESC)`. |
| `settings` | `club` *(1 doc)* | `Settings` | Lưu `SettingsMap` + mảng `raw` → tốn 1 read. |
| `editors` | `{email}` *(lowercase)* | `Editors` | Doc ID là email để Security Rules kiểm tra `isEditor()` / `isAdmin()` O(1). |
| `_meta` | `sync_state` *(1 doc)* | *(Firestore-only)* | Listener `onSnapshot` duy nhất báo thay đổi real-time (`dataRevision`, `lastPullFromSheetAt`, `lastPushToSheetAt`). |

---

## 3. Rủi Ro & Giới Hạn Kỹ Thuật Cần Lưu Ý

1. **Xung đột ghi đồng thời trên Firestore:** `FirebaseProvider` hiện đọc `fetchScopedDataset()` rồi ghi bằng `writeBatch` (chia chunk 450 ops) mà chưa dùng `runTransaction` xuyên nhiều collection. Với quy mô CLB 2–3 Editor rủi ro thấp, nhưng nếu cần tăng tính chặt chẽ nên tránh bấm đúp hoặc bổ sung khóa lạc quan theo `dataRevision` (xem [ROADMAP.md](../ROADMAP.md)).
2. **Giới hạn 6 phút của GAS khi Push toàn bộ bảng:** `importRawTablesRecord` ghi đè tuần tự 10 tab Google Sheets trong 1 request POST. Nếu dữ liệu tích lũy quá lớn qua nhiều năm, cần tách thành API ghi theo từng bảng.
3. **Tính toàn vẹn schema:** Firestore Security Rules kiểm tra phân quyền vai trò (`isEditor`, `isAdmin`, `isSignedIn` với `email_verified == true`), không kiểm tra chéo công thức số tiền phía server — tin tưởng code client của Editor/Admin đã xác thực.

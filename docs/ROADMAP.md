# Lộ Trình Kỹ Thuật & Phát Triển Tương Lai (Roadmap)

Tài liệu theo dõi **Nợ kỹ thuật cần dọn dẹp** và **Lộ trình mở rộng sản phẩm** của hệ thống **CLB Cầu Lông & Nhậu** (kiến trúc chính: **Cloud Firestore + Firebase Auth** kết hợp backup/AI proxy qua **Google Apps Script**).

---

## 1. Nợ Kỹ Thuật & Tối Ưu Codebase (Ưu tiên trung hạn)

- [ ] **Tách monolith Backend GAS:** Tách [SheetService.gs](../gas-backend/SheetService.gs) (>4.500 dòng) thành các module nhỏ (`SchemaService.gs`, `SessionService.gs`, `MonthlyBillService.gs`, `DebtService.gs`, `SyncService.gs`) để dễ bảo trì trên Apps Script IDE.
- [ ] **Chia chunk khi Push `importRawTables` lên GAS:** Hiện `importRawTablesRecord` ghi tuần tự 10 tab trong 1 request; khi dữ liệu lớn dần qua nhiều năm cần tách gọi từng bảng để tránh nguy cơ chạm giới hạn 6 phút của GAS.
- [ ] **Tách nhỏ các Modal trong Pages:** Tách các modal ở `MonthlyBadmintonPage.tsx`, `CreateSessionPage.tsx`, `DebtsAndSessionsPage.tsx`, `SettingsPage.tsx` thành component con riêng.
- [ ] **Tối ưu bundle Frontend:** Dynamic import phần `mockProvider` / `mockData` khi `VITE_USE_MOCK=true` để giảm kích thước bundle production.
- [ ] **Dọn `icon.svg` (chỉ làm khi bỏ khỏi PWA manifest):** Không xóa [frontend/public/icon.svg](../frontend/public/icon.svg) vì [manifest.json](../frontend/public/manifest.json) vẫn đang tham chiếu trực tiếp tới `/icon.svg`. Nếu muốn bỏ, phải cập nhật `manifest.json` trước.
- [ ] **Giảm rủi ro xung đột ghi đồng thời trên Firestore:** Bổ sung `runTransaction` hoặc cơ chế kiểm tra `dataRevision` lạc quan cho các thao tác nhạy cảm (`confirmPayment`, `undoSettlement`, `issueMonthlyBill`).

---

## 2. Lộ Trình Sản Phẩm (v3.0+ — Multi-Tenant trên Hệ Sinh Thái Firebase)

> Kiến trúc lưu trữ đã chốt sử dụng **Cloud Firestore + Firebase Auth** (đã loại bỏ phương án chuyển sang Supabase khỏi lộ trình).

- [ ] **Kiến trúc Multi-Tenant & Multi-User Hub (`/groups`):**
  - Mỗi nhóm (`clubs/{clubId}/...`) có không gian dữ liệu và danh sách `editors` riêng.
  - Tài khoản người dùng lưu thông tin ngân hàng cá nhân 1 lần dùng cho nhiều nhóm.
  - Tạo nhóm mới, quản lý danh sách nhóm và tạo link mời tham gia 1 chạm (`.../join/<slug>`).
- [ ] **Hệ thống "Plugin Luật chia tiền" cho nhiều môn thể thao:**
  - Cầu lông / Pickleball / Tennis (hóa đơn tháng + góp vật tư + vãng lai + buổi phát sinh).
  - Bóng đá (chia thắng–thua 60/40 hoặc 70/30, tiền trọng tài, quỹ phạt).
  - Ăn nhậu / Du lịch / Sự kiện (chia theo trọng số nhóm có/không uống bia, người lớn/trẻ em).
- [ ] **Tự động đối soát VietQR (Webhook SePay / Casso qua Cloud Functions / Vercel API):** Gắn mã giao dịch duy nhất trong nội dung chuyển khoản → khi tiền vào tài khoản Thủ quỹ tự động gạch nợ không cần bấm tay.
- [ ] **Voting đi sân trước buổi chơi & Tổng kết cuối tháng/năm ("Club Wrapped").**

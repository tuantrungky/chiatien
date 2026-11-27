# AUDIT_CHECKLIST.md — Theo Dõi Cải Tiến & Lộ Trình Dự Án Lông Ca Club

Tài liệu ghi nhận toàn bộ kết quả **Audit dự án (2026-11-26)** gồm các lỗi/điểm yếu tồn đọng cần giải quyết ngay ở core hiện tại (**Phần A**), nợ kỹ thuật cần dọn dẹp (**Phần B**), và lộ trình nâng cấp thành nền tảng đa nhóm / đa môn thể thao (**Phần C**).

---

## Phần A — Sửa tồn đọng & Hoàn thiện Core (Hướng A — Đã hoàn thành v2.3 — 2026-11-26)

### A1. Hiệu năng & Toàn vẹn dữ liệu Backend GAS
- [x] **Tối ưu `getAllData()` đọc Google Sheet 1 lần/tab (`_SHEET_CACHE_`):** Thay vì đọc lặp lại cùng một tab ~15–20 lần qua các hàm con, dùng request-scoped read cache trong `getAllData()` (`beginSheetCache_` / `endSheetCache_`) và tự xóa cache sau khi ghi (`invalidateSheetCache_`) -> tăng tốc tải `getAll` gấp **3–4 lần**. *(v2.3 — 2026-11-26)*
- [x] **Giữ kích thước `getAll` dưới ngưỡng 95 KB của GAS `CacheService`:** Lọc danh sách `sessions` trả về trong `getAllData()` (giữ các buổi trong **6 tháng gần nhất** + mọi buổi vẫn còn `Attendance` chưa thanh toán) để không bị tràn cache sau nhiều tháng sử dụng. *(v2.3 — 2026-11-26)*
- [x] **Tự động chuyển tiếp phần dư góp cầu (`carry_over_credits`):** Khi người góp ống cầu có số tiền lớn hơn phần đóng tháng (`credit_amount > base_amount`), tự động lưu phần dư vào `Monthly_Bills.carry_over_credits` để gộp vào `prevMonthContributions` trừ tiếp ở tháng sau nữa. *(v2.3 — 2026-11-26)*
- [x] **Sửa dư ảo đầu tháng khi chưa nhập từng buổi:** Khi tháng đang `OPEN`, chưa chốt `actual_cost_override` và tổng các buổi đã nhập nhỏ hơn `estimate` chủ sân, tạm dùng `estimate` để tính dự kiến chuyển sang tháng sau (`is_projected_cost = true`) thay vì hiện số dư ảo gây hiểu nhầm. *(v2.3 — 2026-11-26)*
- [x] **Bổ sung nút "Hoàn tác gạch nợ" (`undoSettlement`):** Cho phép Editor hoàn tác các giao dịch đã xác nhận thanh toán ở cả nhóm Cầu lông lẫn Ăn nhậu khi bấm nhầm (khôi phục `Attendance.is_paid = false` / `Monthly_Dues.is_paid = false`, xóa `Settlements` tương ứng, cân bằng lại `net_amount`). *(v2.3 — 2026-11-26)*

### A2. Định danh người dùng, Tự nhắc nợ & Cảnh báo quá hạn
- [x] **Đăng nhập Google cho mọi thành viên (`verifyUserToken` & `Members.email`):** Mở rộng luồng đăng nhập để ngoài Editor/Admin, các thành viên bình thường cũng đăng nhập được; lần đầu vào sẽ hỏi **"Bạn là ai trong CLB?"** (`MemberIdentityModal`, không hỏi lại các Editor) và lưu `email` vào tab `Members` trên Google Sheet (`linkMemberEmail`). *(v2.3 — 2026-11-26)*
- [x] **Bộ lọc "Tôi đang nợ gì?" & Cho phép xem nợ cả CLB để nhắc nhau:** Chọn tên mình (`MyDebtFilterBar` tự nhận diện nếu đã đăng nhập hoặc chọn tay lưu `localStorage`), hiển thị nổi bật thẻ công nợ cá nhân + nút **VietQR 1 chạm**, đồng thời cho chuyển nhanh giữa *"Chỉ xem của tôi"* và *"Cả CLB (nhắc nhau)"*. *(v2.3 — 2026-11-26)*
- [x] **Cảnh báo quá hạn theo mốc 10 / 15 / 20 / 30+ ngày (`OverdueBadge` & `utils/overdue.ts`):** Tính số ngày nợ quá hạn và đổi màu rõ rệt theo cấp độ: *(v2.3 — 2026-11-26)*
  - `10–14 ngày`: badge vàng (`⏰ Quá X ngày`)
  - `15–19 ngày`: badge cam + viền nổi bật (`⚠️ Quá X ngày`)
  - `20–29 ngày`: badge đỏ **nhấp nháy** (`🔥 Quá X ngày`, `animate-pulse`)
  - `>= 30 ngày`: badge đỏ thẫm **nhấp nháy** (`🚨 Quá 1 tháng (X ngày)`, `animate-pulse`)

### A3. UX/UI, Chia sẻ Zalo & Điều hướng
- [x] **Nút "Copy tin nhắn Zalo" (`utils/zaloShare.ts`):** Xuất sẵn mẫu tin nhắn gọn đẹp gồm chi tiết tiền sân/cầu, danh sách chưa đóng (kèm cảnh báo quá hạn, chú thích trừ góp cầu), STK Thủ quỹ và link trực tiếp vào app ở `MonthlyBadmintonPage` & `DebtsAndSessionsPage`. *(v2.3 — 2026-11-26)*
- [x] **Tích hợp `react-router-dom`:** Gắn URL thật cho từng màn hình (`/`, `/calendar`, `/debts`, `/monthly`, `/create`, `/settings`) để nút Back trên điện thoại hoạt động tự nhiên và gửi được link trực tiếp qua Zalo. *(v2.3 — 2026-11-26)*
- [x] **Bật nút "Quét hóa đơn AI" cho cả buổi Cầu lông:** Dùng chung khối chụp/nén ảnh + `parseBillAI` ở `CreateSessionPage` cho cả `BADMINTON` và `DRINKING`. *(v2.3 — 2026-11-26)*
- [x] **Dọn trùng nút tạo buổi ở `DebtsAndSessionsPage`:** Gỡ cặp nút `+ Buổi cầu / + Buổi nhậu` bị lặp cạnh bộ lọc ở sub-tab Lịch sử (vì đã có cặp nút lớn ở đầu trang và FAB). *(v2.3 — 2026-11-26)*

---

## Phần B — Nợ kỹ thuật & Tối ưu Codebase (Làm dần ở đợt dọn code tiếp theo)

- [ ] **Tách monolith Backend GAS:** Tách `SheetService.gs` (>3.000 dòng) thành các module nhỏ (`SchemaService.gs`, `SessionService.gs`, `MonthlyBillService.gs`, `DebtService.gs`) để dễ bảo trì trên Apps Script IDE.
- [ ] **Tách Mock Engine khỏi `api.ts`:** Tách phần giả lập mock (~600 dòng) sang `mockApi.ts` và dynamic import khi `VITE_USE_MOCK=true` để giảm kích thước bundle production.
- [ ] **Tách nhỏ các Modal trong Pages:** Tách các modal ở `MonthlyBadmintonPage.tsx`, `CreateSessionPage.tsx`, `DebtsAndSessionsPage.tsx`, `SettingsPage.tsx` thành component con riêng.
- [ ] **Gỡ bỏ hoàn toàn legacy `Fund_Ledger`:** Sau khi xác nhận CLB không còn cần tra cứu dữ liệu lịch sử cũ trước v2, gỡ `Fund_Ledger`, `source_ledger_ids` và các type legacy khỏi `SPEC.md`, `SheetService.gs`, `types/index.ts`.
- [x] **Dọn file thừa:** Đã xóa các file `.gitkeep` (2026-11-27). **Không xóa `frontend/public/icon.svg`** vì `manifest.json` vẫn tham chiếu; chỉ xóa sau khi bỏ khỏi manifest.
- [ ] **Quyết định làm rõ (chưa chốt):** làm tròn `ceil` (tiền cầu/phát sinh) vs `round` (ăn nhậu); `members` (email/SĐT/STK) đang công khai cho Viewer; gỡ hay giữ `fund_ledger`.
- [x] **Chuyển DB sang Firebase Hybrid** (Firestore chính, Sheets backup/fallback) — xem `docs/FIREBASE_HYBRID_GUIDE.md`.

---

## Phần C — Lộ trình Tương lai: Đa Nhóm, Đa Môn & Đa Người Dùng (v3.0+)

- [ ] **Phương án dài hạn (chỉ khi Firebase Spark không đủ): Supabase (PostgreSQL + Auth + Storage + RLS).** *Hiện tại đã chốt Firebase Firestore làm DB chính (v2.4).*
  - Giải quyết triệt để giới hạn của GAS/Sheets (cold start, khóa `LockService`, giới hạn cache 95KB, phiên Google 1h trên iOS Safari, thiếu phân tách dữ liệu đa nhóm).
  - Bổ sung Realtime subscription: Thủ quỹ bấm *"Đã thu"* là màn hình thành viên tự cập nhật ngay.
- [ ] **Kiến trúc Multi-Tenant & Multi-User Hub (`/groups`):**
  - Tài khoản `users` lưu 1 lần thông tin ngân hàng cá nhân, tham gia nhiều nhóm khác nhau không cần khai báo lại STK.
  - Mỗi user tự tạo nhóm mới, quản lý danh sách nhóm của mình, tạo link mời tham gia 1 chạm (`.../join/<slug>`).
- [ ] **Hệ thống "Plugin Luật chia tiền" cho nhiều môn thể thao:**
  - Cầu lông / Pickleball / Tennis (hóa đơn tháng + góp vật tư + vãng lai + buổi phát sinh).
  - Bóng đá (chia thắng–thua 60/40 hoặc 70/30, tiền trọng tài, quỹ phạt đi muộn/thẻ).
  - Ăn nhậu / Du lịch / Sự kiện (chia theo trọng số nhóm có/không uống bia, người lớn/trẻ em).
- [ ] **Tự động đối soát VietQR (Webhook SePay / Casso):** Gắn mã giao dịch duy nhất trong nội dung chuyển khoản -> khi tiền vào tài khoản Thủ quỹ tự động gạch nợ không cần bấm tay.
- [ ] **Voting đi sân trước buổi chơi & Tổng kết cuối tháng/năm ("Club Wrapped").**

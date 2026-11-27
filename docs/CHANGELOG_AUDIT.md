# Lịch Sử Audit, Sửa Lỗi Kế Toán & Đồng Bộ Logic

Tài liệu lưu trữ toàn bộ các đợt audit đã hoàn thành của dự án **CLB Cầu Lông & Nhậu**, gộp từ `AUDIT_CHECKLIST.md` (Phần A), `CALCULATION_AUDIT_CHECKLIST.md` và đợt **Deep Audit v2.4 (2026-11-27)**.

---

## Đợt 3 — Deep Audit Toàn Diện, Chuẩn Hóa `Math.ceil`, Bảo Mật `members_private` & Gỡ `fund_ledger` (v2.4 — 2026-11-27)

### 1. Quyết định nghiệp vụ & kiến trúc đã chốt
- **Primary Database:** **Cloud Firestore + Firebase Auth** là nguồn dữ liệu chính; Google Sheets đóng vai trò backup/fallback và đồng bộ 2 chiều qua `ADMIN`.
- **Làm tròn lên (`Math.ceil`) toàn dự án:** Chuyển cả chia tiền **Ăn nhậu** (`drinkingSplit.ts` & `buildDrinkingSplitRows_`) từ `Math.round` sang `Math.ceil` theo `rounding_unit` để người ứng tiền không bao giờ bị hụt; phần dư làm tròn cộng về người góp nhiều nhất (ưu tiên `payerId` nếu hòa) giữ bất biến $\sum \text{net\_amount} = 0$.
- **Bảo mật riêng tư (`members_private`):** Ẩn hoàn toàn `phone` và `email` khỏi Viewer công khai (tách collection `members_private/{member_id}` trên Firestore và strip PII ở GAS `doGet`); giữ công khai thông tin ngân hàng cho VietQR. Yêu cầu `email_verified == true` trong [firestore.rules](../firebase/firestore.rules).
- **Gỡ `fund_ledger` legacy:** Bỏ hoàn toàn khỏi schema hoạt động, Sync (còn **10 bảng**), Rules và Types; **giữ nguyên** cột `Settlements.source_ledger_ids` đang tái dùng cho mã `REC:` chốt đợt ăn nhậu. Không xóa tab `Fund_Ledger` lịch sử nếu đang có trên Google Sheet.

### 2. Lỗi kế toán & lệch parity GAS ↔ DomainEngine đã sửa
- [x] **B1:** `SheetService.gs` (`updateSessionRecord` `DRINKING`) kiểm tra người tham gia rỗng trước khi xóa `Attendance`/`Session_Items`.
- [x] **B2:** Sửa lỗi đếm trùng 2 lần ở `buildDashboardData`, `getDashboardData`, `DashboardPage.tsx` — không cộng lại chi phí buổi `MONTHLY` thuộc tháng đã tính `monthlyBillCostInPeriod`.
- [x] **B3:** `issueMonthlyBill` tính `nextActualCost` & `carry_out` theo `estimate` mới phát hành (thay vì `estimate` cũ = 0); khi tháng trước đang `OPEN`, `buildMonthlyBillData`/`getMonthlyBillData` lấy `carry_out` tính live của tháng trước làm `carry_in`.
- [x] **B4:** Lưu `issued_at` trực tiếp trên từng dòng `Monthly_Dues` (bổ sung cột `issued_at` vào `SHEET_SCHEMA.Monthly_Dues`), không để `saveMonthlyContributions` làm reset số ngày quá hạn của cả CLB.
- [x] **B5 & B6:** `confirmPayment` chỉ ghi các dòng thực sự được gạch nợ vào `source_attendance_ids`, lọc bỏ dòng chủ nợ (`net_amount <= 0`) trong `ITEMS`, và từ chối tạo `Settlement` ảo khi không có dòng nào cập nhật.
- [x] **B7:** `planCloseMonth` loại chuỗi rỗng `""` cho `actualCostOverride` và `carryOutOverride` để tránh ép thành `0`.
- [x] **B8:** Tách `members_private`, strip PII trên `doGet` GAS & `MockProvider`, cập nhật `MemberIdentityModal.tsx` (bỏ tìm/hiện email người khác), thêm nút migrate 1 chạm trên `SettingsPage.tsx` và action `getMembersPrivate`.
- [x] **P1–P9:** Khử trùng `memberIds` ở GS; đồng bộ fallback `courtFee`/`venueTotalOverride` ở TS; xóa `closed_at` khi re-issue; đồng bộ `guestFee` fallback khi sửa buổi; kiểm tra `row.session_id === sessionId` trước khi reset `Schedule` khi xóa buổi; đồng bộ `Schedule` khi sửa buổi; ghi dòng mới trước khi xóa dòng cũ trong GS `updateSessionRecord`; thống nhất `toBank`, `recentSettlements` (limit 30), `isSplitFromMultipleTransfers`, `transferContent`, `guestStats` sort, `paidImmediately === true`, và ép `String()` các cột text khi Pull Sheet → Firebase.

---

## Đợt 2 — Audit & Đồng Bộ Logic Tính Toán (2026-11-27)

### Quy tắc nghiệp vụ đã chốt
- **A1 — Tháng tính tiền Vãng lai (`guest_income`):** Giữ tính theo ngày thực thu (`paid_at`) cho quỹ bù trừ tháng; tách hiển thị rõ 2 số trên tab *Thống kê Vãng lai* (`Phát sinh theo buổi trong tháng` vs `Thực thu tính quỹ tháng này`).
- **A2 — Người góp ống cầu không đánh `MAIN` tháng này:** Vẫn chia toàn bộ tiền góp cầu vào tổng chia cho nhóm `MAIN`, tạo mục `refundCredits` (**khoản Thủ quỹ hoàn riêng**) và trừ khỏi `carry_out`.
- **A3 — Chi phí `Sân thêm giờ` trong tháng `OPEN`:** Toàn bộ `Sân thêm giờ` dồn sang `prevOvertimeFee` tháng kế tiếp.
- **A4 — Sửa buổi đã có đối soát (`settlement_id`):** Cho phép sửa thông tin phi tài chính (*Tiêu đề, Ghi chú, Ảnh hóa đơn/AI summary*), khóa số tiền, ngày, người trả, người tham gia và món góp.
- **A5 — Tạo/sửa buổi cố định rơi vào tháng `CLOSED`:** Hiện hộp thoại xác nhận cảnh báo trước khi lưu, không chặn cứng.
- **#1–#7:** Cộng hóa đơn tháng vào KPI & biểu đồ (trừ `WEEK`); `oldPaidMap` chỉ giữ `is_paid = true` khi khớp tiền; chỉ fallback góp cầu khi chưa phát hành; hoàn tác nhanh `Đã thu` cầu tháng; hiển thị bù sai số làm tròn nhậu; mã hóa `REC:SET_1,SET_2` trong `source_ledger_ids`; ghi chú hoàn góp cầu trong tin nhắn Zalo.

---

## Đợt 1 — Sửa Tồn Đọng & Hoàn Thiện Core (v2.3 — 2026-11-26)

- [x] Tối ưu `getAllData()` GAS đọc mỗi tab Google Sheet 1 lần/request (`_SHEET_CACHE_`), giữ payload dưới 95 KB `CacheService` (cắt gọn buổi >6 tháng đã thanh toán xong).
- [x] Tự động chuyển tiếp phần dư góp cầu (`carry_over_credits`), sửa dư ảo đầu tháng (`is_projected_cost`), bổ sung nút **Hoàn tác gạch nợ** (`undoSettlement`).
- [x] Đăng nhập Google cho mọi thành viên (`verifyUserToken` & `MemberIdentityModal`), bộ lọc `"Tôi đang nợ gì?"` & cảnh báo quá hạn 10 / 15 / 20 / 30+ ngày (`OverdueBadge`).
- [x] Nút **Copy tin nhắn Zalo** (`utils/zaloShare.ts`), tích hợp `react-router-dom`, bật quét hóa đơn AI cho cả buổi Cầu lông.

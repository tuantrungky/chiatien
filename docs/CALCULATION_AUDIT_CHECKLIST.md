# Checklist Audit & Đồng Bộ Logic Tính Toán — Lông Ca Club

Ngày lập: 2026-11-27  
Mục tiêu: Sửa toàn bộ lỗi logic kế toán, đồng bộ chéo 1–1 giữa **Frontend Utils**, **DomainEngine (Firebase/Mock)**, **Google Apps Script (`SheetService.gs`)**, và **UI**.

---

## 1. Quy tắc nghiệp vụ đã chốt với người dùng

- **A1 — Tháng tính tiền Vãng lai (`guest_income`)**: Giữ tính theo ngày thực thu (`paid_at`) cho quỹ bù trừ tháng; tách hiển thị rõ **2 số** trên tab *Thống kê Vãng lai* (`Phát sinh theo buổi trong tháng` vs `Thực thu tính quỹ tháng này`).
- **A2 — Người góp ống cầu không đánh `MAIN` tháng này**: Vẫn chia toàn bộ tiền góp cầu vào tổng chia cho nhóm `MAIN`, tạo mục ghi chú **khoản Thủ quỹ hoàn riêng cho người góp**, và trừ khoản hoàn này khỏi `carry_out` để quỹ không dư ảo. (Người góp là `MAIN` mà góp vượt `perMember` tiếp tục chuyển sang `carryOverCredits` tháng sau.)
- **A3 — Chi phí `Sân thêm giờ` trong tháng `OPEN`**: Giữ nguyên cách cũ — tháng đang mở tính theo `estimate` chủ sân, toàn bộ `Sân thêm giờ` dồn sang `prevOvertimeFee` tháng kế tiếp (thêm chú thích rõ trên UI).
- **A4 — Sửa buổi đã có đối soát (`settlement_id`)**: Cho phép sửa thông tin phi tài chính (*Tiêu đề, Ghi chú, Ảnh hóa đơn/AI summary*), giữ khóa số tiền, ngày, người trả, danh sách tham gia và món góp.
- **A5 — Thêm/sửa buổi cố định rơi vào tháng đã Chốt (`CLOSED`)**: Hiện hộp thoại xác nhận cảnh báo trước khi lưu, không chặn cứng (bảo toàn `carry_out` đã chốt tay).
- **#1 — Tổng quan `Chi Cầu lông (kỳ)` & Biểu đồ**: Cộng thêm chi phí hóa đơn tháng (`actual_cost`) của các tháng đã phát hành nằm trong kỳ vào KPI & biểu đồ (trừ kỳ `WEEK`).
- **#2 — `Sửa / Chia lại tháng` (`oldPaidMap`)**: Chỉ giữ `is_paid = true` khi `oldPaidAmount === netAmount` (hoặc `netAmount === 0`); nếu số tiền mới khác số đã đóng, bỏ `is_paid` và ghi chú chênh lệch.
- **#3 — Sửa lại hóa đơn tháng đã xóa khoản trừ góp cầu**: Chỉ fallback `prevMonthContributions` khi hóa đơn chưa phát hành (`dues.length === 0 && !Array.isArray(parsedDetail.appliedCredits)`).
- **#4 — Hoàn tác nhanh `Đã thu` tiền cầu tháng**: Hiện thanh hoàn tác nhanh ngay trên trang Công nợ khi vừa gạch nợ cầu tháng.
- **#5 — Minh bạch bù sai số làm tròn Ăn nhậu**: Hiển thị rõ số tiền bù làm tròn và tên người được bù trên form chia nhậu.
- **#6 — Sync 2 chiều Firebase ↔ Sheet cho giao dịch chốt đợt**: Dùng cột sẵn có `source_ledger_ids` (định dạng `REC:SET_1,SET_2`) thay vì thêm trường mới.
- **#7 — Tin nhắn Zalo hóa đơn tháng**: Bổ sung dòng ghi chú khoản hoàn góp cầu (nếu có người góp không đánh `MAIN`).

---

## 2. Ma trận Kiểm Tra Chéo Module (Cross-Module Parity Matrix)

| Nghiệp vụ | Frontend Utils | DomainEngine (Firebase/Mock) | GAS Backend (`SheetService.gs`) | UI / Hook |
|---|---|---|---|---|
| **Hóa đơn tháng, `refundCredits`, `oldPaidMap`, `syncMemberTypes`, `scheduleConfig`** | `monthlyBill.ts` (`calculateDetailedMonthlyBill`) | `domainEngine.ts` (`planIssueMonthlyBill`, `buildMonthlyBillData`) | `SheetService.gs` (`issueMonthlyBillRecord`, `getMonthlyBillData`) | `MonthlyBadmintonPage.tsx`, `zaloShare.ts` |
| **Vãng lai (`session_date` vs `paid_at`)** | — | `domainEngine.ts` (`buildMonthlyBillData`, `buildGuestStatsData`) | `SheetService.gs` (`getMonthlyBillData`, `getGuestStatsData`) | `MonthlyBadmintonPage.tsx` |
| **Gạch nợ & Hoàn tác (`Undo`) Ăn nhậu** | — | `domainEngine.ts` (`planConfirmPayment`, `planUndoSettlement`) + `firebaseProvider.ts` | `SheetService.gs` (`confirmPaymentRecord`, `undoSettlementRecord`) | `DebtsAndSessionsPage.tsx` |
| **Tối ưu nợ Ăn nhậu & Lệch sổ** | `debtSimplifier.ts` (`simplifyDebts`) | `domainEngine.ts` (`buildDebtsData`) | `SheetService.gs` (`computeDebtsData`) | `useClubData.ts`, `DashboardPage.tsx`, `DebtsAndSessionsPage.tsx` |
| **Chi phí kỳ, Sửa metadata buổi, Tháng `CLOSED`, Làm tròn** | `drinkingSplit.ts` (`calculateDrinkingSplit`) | `domainEngine.ts` (`buildDashboardData`, `planUpdateSession`, `buildAllData`) | `SheetService.gs` (`getDashboardData`, `updateSessionRecord`, `getAllData`), `Code.gs` (`bootstrap`) | `DashboardPage.tsx`, `CreateSessionPage.tsx`, `App.tsx` |

---

## 3. Danh sách công việc theo dõi

### Bước 1–2: Checklist & Types
- [x] Tạo file checklist `docs/CALCULATION_AUDIT_CHECKLIST.md`
- [x] Cập nhật `frontend/src/types/index.ts` (`closedMonths`, `refundCredits`, `refundCreditsTotal`, `refund_credits_total`, `collectedInMonthAmount`, `unreconciledSettlements`, `imbalanceAmount`, `isSplitFromMultipleTransfers`, `monthlyBillCostInPeriod`)

### Bước 3: Nhóm A — Hóa đơn tháng, Góp cầu, Vãng lai & Zalo
- [x] Cập nhật `calculateDetailedMonthlyBill` trong `frontend/src/utils/monthlyBill.ts` (`refundCredits`, `refundCreditsTotal`, `carryOut`)
- [x] Đồng bộ `planIssueMonthlyBill`, `buildMonthlyBillData`, `buildGuestStatsData`, `buildAllData`, `planCloseMonth` trong `frontend/src/services/domainEngine.ts` (`syncMemberTypes`, `scheduleConfig`, `oldPaidMap`, `refundCredits`, `issued_at`, `collectedInMonthAmount`, `closedMonths`)
- [x] Đồng bộ `fetchBootstrap` trong `frontend/src/services/providers/firebaseProvider.ts` (`closedMonths`)
- [x] Đồng bộ `issueMonthlyBillRecord`, `getMonthlyBillData`, `getGuestStatsData`, `closeMonthRecord`, `getAllData` trong `gas-backend/SheetService.gs` và `bootstrap` trong `gas-backend/Code.gs`
- [x] Cập nhật `buildMonthlyBillZaloMessage` trong `frontend/src/utils/zaloShare.ts` (hiển thị hoàn góp cầu nếu có)
- [x] Cập nhật `frontend/src/pages/MonthlyBadmintonPage.tsx` (fix `appliedCredits: []`, hiển thị `refundCredits`, chú thích thêm giờ A3, 2 dòng Vãng lai A1)

### Bước 4: Nhóm B — Gạch nợ, Hoàn tác Ăn nhậu & Tối ưu nợ
- [x] Cập nhật `simplifyDebts` trong `frontend/src/utils/debtSimplifier.ts` (`imbalanceAmount`, `isSplitFromMultipleTransfers`)
- [x] Thêm helper `encodeReconciledIds` / `parseReconciledIds` (`REC:...` vào `source_ledger_ids`) đồng bộ ở `domainEngine.ts` & `SheetService.gs`
- [x] Sửa `planConfirmPayment` & `confirmPaymentRecord` (phân bổ `ITEMS` cho nhiều chủ nợ giữ `Σ net = 0`; lưu `REC:` khi chốt đợt `SIMPLIFIED_TRANSFER`)
- [x] Sửa `planUndoSettlement`, `undoSettlementRecord`, `firebaseProvider.ts` (replay `ITEMS` theo buổi bảo toàn giao dịch khác; mở lại đợt chốt `SIMPLIFIED_TRANSFER`)
- [x] Cập nhật `buildDebtsData`, `computeDebtsData`, `useClubData.ts` (`unreconciledSettlements`, `imbalanceAmount`)
- [x] Cập nhật `DebtsAndSessionsPage.tsx` & `DashboardPage.tsx` (banner lệch sổ, ghi chú tách lệnh chuyển, chọn đúng chủ nợ khi bấm `Đã thu` nhậu, hoàn tác nhanh gạch nợ cầu tháng)

### Bước 5: Nhóm C & D — Tổng quan kỳ, Làm tròn nhậu, Sửa buổi & Cảnh báo tháng `CLOSED`
- [x] Cập nhật `buildDashboardData` (`domainEngine.ts`), `getDashboardData` (`SheetService.gs`), `DashboardPage.tsx` (cộng chi phí hóa đơn tháng vào KPI & biểu đồ khi `periodType !== 'WEEK'`)
- [x] Cập nhật `drinkingSplit.ts` (`roundingAdjustment`, `roundingAdjustedMemberId`) & hiển thị chú thích trên `CreateSessionPage.tsx`
- [x] Cho phép sửa metadata buổi đã có `settlement_id` trên `planUpdateSession` (`domainEngine.ts`), `updateSessionRecord` (`SheetService.gs`) & `CreateSessionPage.tsx`
- [x] Cảnh báo xác nhận khi tạo/sửa buổi cố định rơi vào tháng `CLOSED` trên `App.tsx` & `CreateSessionPage.tsx`

### Bước 6: Kiểm thử & Đối chiếu chéo
- [x] Bổ sung unit test trong `monthlyBill.test.ts`, `debtSimplifier.test.ts`, `drinkingSplit.test.ts`, `domainEngine.test.ts`
- [x] Chạy `npm --prefix frontend test` (13/13 file, 57/57 test pass; cập nhật 2026-11-27: 58/58) và `npm --prefix frontend run build` (`tsc -b && vite build` exit 0)
- [x] Kiểm tra chéo 1–1 lần cuối giữa `domainEngine.ts` và `SheetService.gs` và cập nhật toàn bộ checkbox `[x]`
- [x] Tạo walkthrough tổng kết

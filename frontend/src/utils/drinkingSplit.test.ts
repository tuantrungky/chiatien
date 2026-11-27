import { describe, expect, it } from 'vitest';
import { calculateDrinkingSplit } from './drinkingSplit';

describe('drinkingSplit', () => {
  it('Ở nhà góp món: chia đều tổng các món góp, tổng số dư = 0', () => {
    // 4 người: A góp lẩu 400k, B góp bia 200k, C góp đồ nướng 200k, D không góp -> tổng 800k -> 200k/người
    const res = calculateDrinkingSplit(
      ['A', 'B', 'C', 'D'],
      [
        { member_id: 'A', kind: 'ITEM', item_name: 'Nồi lẩu', amount: 400000 },
        { member_id: 'B', kind: 'ITEM', item_name: 'Thùng bia', amount: 200000 },
        { member_id: 'C', kind: 'ITEM', item_name: 'Đồ nướng', amount: 200000 },
      ],
      1000
    );

    expect(res.totalAmount).toBe(800000);
    expect(res.perPersonAmount).toBe(200000);

    const byId = new Map(res.splits.map((s) => [s.memberId, s]));
    expect(byId.get('A')?.netAmount).toBe(-200000); // được nhận 200k
    expect(byId.get('B')?.netAmount).toBe(0);
    expect(byId.get('B')?.isPaid).toBe(true);
    expect(byId.get('C')?.netAmount).toBe(0);
    expect(byId.get('D')?.netAmount).toBe(200000); // phải trả 200k

    const totalNet = res.splits.reduce((acc, s) => acc + s.netAmount, 0);
    expect(totalNet).toBe(0);
  });

  it('Ra quán (BILL + ITEM) có làm tròn lẻ vẫn giữ tổng số dư bằng 0', () => {
    // 3 người: A trả bill 1.000.000, B mang thêm trái cây 100.000 -> tổng 1.100.000 -> 367.000/người
    const res = calculateDrinkingSplit(
      ['A', 'B', 'C'],
      [
        { member_id: 'A', kind: 'BILL', item_name: 'Hóa đơn quán', amount: 1000000 },
        { member_id: 'B', kind: 'ITEM', item_name: 'Trái cây', amount: 100000 },
      ],
      1000
    );

    expect(res.totalAmount).toBe(1100000);
    expect(res.perPersonAmount).toBe(367000);
    const totalNet = res.splits.reduce((acc, s) => acc + s.netAmount, 0);
    expect(totalNet).toBe(0);

    const byId = new Map(res.splits.map((s) => [s.memberId, s]));
    expect(byId.get('B')?.netAmount).toBe(267000);
    expect(byId.get('C')?.netAmount).toBe(367000);
    expect(byId.get('A')?.netAmount).toBe(-634000);
    expect(res.roundingAdjustment).toBe(-1000);
    expect(res.roundingAdjustedMemberId).toBe('A');
  });
});

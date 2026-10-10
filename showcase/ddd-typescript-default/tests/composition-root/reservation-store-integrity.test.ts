import assert from "node:assert/strict";
import { test } from "node:test";
import { MemberId, Reservation, ReservationId, RoomId } from "@acme/reservation-domain";
import { InMemoryReservationRepository } from "@acme/reservation-interface-adapter";

function reserve(member = 2, room = 3, start = 1000, end = 2000): Reservation {
  const result = Reservation.reserve(ReservationId.of(1), MemberId.of(member), RoomId.of(room), start, end);
  if (!result.ok) assert.fail("有効な予約を生成できない");
  return result.value;
}

test("識別子と番号が同じでも生成イベントと業務属性が違うスナップショットを保存しない", () => {
  for (const interval of [1, 3]) {
    for (const [member, room, start, end] of [[99, 3, 1000, 2000], [2, 99, 1000, 2000], [2, 3, 1100, 2000], [2, 3, 1000, 2100]]) {
      const repository = new InMemoryReservationRepository(interval);
      const original = reserve();
      const result = repository.store(original.reservedEvent(), reserve(member, room, start, end));

      assert.equal(result.ok, false);
      assert.deepEqual(repository.findById(ReservationId.of(1)), { ok: true, value: undefined });
      assert.equal(repository.store(original.reservedEvent(), original).ok, true);
    }
  }
});

test("取消イベントと異なる業務属性のスナップショットを拒否し、正しい取消を保存できる", () => {
  for (const interval of [1, 3]) {
    for (const [member, room, start, end] of [[99, 3, 1000, 2000], [2, 99, 1000, 2000], [2, 3, 1100, 2000], [2, 3, 1000, 2100]]) {
      const repository = new InMemoryReservationRepository(interval);
      const original = reserve();
      assert.equal(repository.store(original.reservedEvent(), original).ok, true);
      const cancelled = original.cancel();
      const mismatched = reserve(member, room, start, end).cancel();
      if (!cancelled.ok || !mismatched.ok) assert.fail("取消できない");

      assert.equal(repository.store(cancelled.value.event, mismatched.value.reservation).ok, false);
      const unchanged = repository.findById(ReservationId.of(1));
      if (!unchanged.ok || unchanged.value === undefined) assert.fail("保存状態を読めない");
      assert.equal(unchanged.value.memberId().value(), 2);
      assert.equal(unchanged.value.status(), "confirmed");
      assert.equal(unchanged.value.sequenceNumber(), 1);
      assert.equal(repository.store(cancelled.value.event, cancelled.value.reservation).ok, true);
    }
  }
});

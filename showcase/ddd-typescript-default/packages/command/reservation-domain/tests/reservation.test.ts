import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MemberId,
  Reservation,
  ReservationId,
  RoomId,
} from "@acme/reservation-domain";

const startsAt = 1_800_000_000_000;
const endsAt = 1_800_003_600_000;

function createConfirmedReservation(): Reservation {
  const reserved = Reservation.reserve(
    ReservationId.of(1),
    MemberId.of(2),
    RoomId.of(3),
    startsAt,
    endsAt,
  );

  assert.equal(reserved.ok, true);
  if (!reserved.ok) {
    assert.fail("有効な時間帯の予約生成に失敗しました");
  }
  return reserved.value;
}

test("会員が会議室を有効な時間帯で予約すると確定済み予約になる", () => {
  const reservationId = ReservationId.of(1);
  const memberId = MemberId.of(2);
  const roomId = RoomId.of(3);

  const reserved = Reservation.reserve(
    reservationId,
    memberId,
    roomId,
    startsAt,
    endsAt,
  );

  assert.equal(reserved.ok, true);
  if (!reserved.ok) {
    assert.fail("有効な予約生成に失敗しました");
  }
  assert.equal(reserved.value.id().equals(reservationId), true);
  assert.equal(reserved.value.memberId().equals(memberId), true);
  assert.equal(reserved.value.roomId().equals(roomId), true);
  assert.equal(reserved.value.startsAt(), startsAt);
  assert.equal(reserved.value.endsAt(), endsAt);
  assert.equal(reserved.value.status(), "confirmed");
});

test("終了時刻が開始時刻以前の予約を拒否する", () => {
  for (const invalidEndsAt of [startsAt, startsAt - 1]) {
    const reserved = Reservation.reserve(
      ReservationId.of(1),
      MemberId.of(2),
      RoomId.of(3),
      startsAt,
      invalidEndsAt,
    );

    assert.deepEqual(reserved, {
      ok: false,
      error: "invalid-time-slot",
    });
  }
});

test("有限値でない開始時刻または終了時刻を拒否する", () => {
  const invalidTimeSlots = [
    { startsAt: Number.NaN, endsAt },
    { startsAt, endsAt: Number.POSITIVE_INFINITY },
  ];

  for (const timeSlot of invalidTimeSlots) {
    const reserved = Reservation.reserve(
      ReservationId.of(1),
      MemberId.of(2),
      RoomId.of(3),
      timeSlot.startsAt,
      timeSlot.endsAt,
    );

    assert.deepEqual(reserved, {
      ok: false,
      error: "invalid-time-slot",
    });
  }
});

test("確定済み予約を取り消すと取消済み予約とイベントを返す", () => {
  const reservation = createConfirmedReservation();

  const cancelled = reservation.cancel();

  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) {
    assert.fail("確定済み予約の取消に失敗しました");
  }
  assert.equal(cancelled.value.reservation.status(), "cancelled");
  assert.equal(
    cancelled.value.event.reservationId.equals(ReservationId.of(1)),
    true,
  );
  assert.equal(reservation.status(), "confirmed");
});

test("取消済み予約の再取消を拒否する", () => {
  const firstCancellation = createConfirmedReservation().cancel();
  assert.equal(firstCancellation.ok, true);
  if (!firstCancellation.ok) {
    assert.fail("確定済み予約の取消に失敗しました");
  }

  const secondCancellation = firstCancellation.value.reservation.cancel();

  assert.deepEqual(secondCancellation, {
    ok: false,
    error: "already-cancelled",
  });
});

test("イベント再生は生成時の属性と取消後の状態を復元する", () => {
  const original = createConfirmedReservation();
  const cancelled = original.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");
  for (const history of [[original.reservedEvent()], [original.reservedEvent(), cancelled.value.event]]) {
    const restored = Reservation.restore(ReservationId.of(1), history);
    assert.equal(restored.memberId().equals(original.memberId()), true);
    assert.equal(restored.roomId().equals(original.roomId()), true);
    assert.equal(restored.startsAt(), startsAt);
    assert.equal(restored.endsAt(), endsAt);
    assert.equal(restored.status(), history.length === 1 ? "confirmed" : "cancelled");
  }
});

test("イベント再生は欠落・重複・別予約の履歴を拒否する", () => {
  const original = createConfirmedReservation();
  const cancelled = original.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");
  const birth = original.reservedEvent();
  const cancellation = cancelled.value.event;
  for (const history of [[], [cancellation], [birth, birth], [birth, cancellation, cancellation]]) {
    assert.throws(() => Reservation.restore(original.id(), history));
  }
  assert.throws(() => Reservation.restore(ReservationId.of(2), [birth]));
});

test("イベント再生は時間帯の不変条件を検証する", () => {
  const original = createConfirmedReservation();
  for (const endsAt of [original.startsAt(), Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = { ...original.reservedEvent(), endsAt };
    assert.throws(() => Reservation.restore(original.id(), [invalid]));
  }
});

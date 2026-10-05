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
  assert.equal(reserved.value.sequenceNumber(), 1);
  assert.equal(reserved.value.reservedEvent().sequenceNumber, 1);
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
  assert.equal(cancelled.value.event.sequenceNumber, 2);
  assert.equal(cancelled.value.reservation.sequenceNumber(), 2);
  assert.equal(reservation.status(), "confirmed");
  assert.equal(reservation.sequenceNumber(), 1);
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

test("スナップショットに続く取消イベントを再生すると取消後の予約になる", () => {
  const snapshot = createConfirmedReservation();
  const cancelled = snapshot.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");

  const replayed = Reservation.replay([cancelled.value.event], snapshot);

  assert.equal(replayed.status(), "cancelled");
  assert.equal(replayed.sequenceNumber(), 2);
  assert.equal(replayed.memberId().equals(snapshot.memberId()), true);
  assert.equal(replayed.roomId().equals(snapshot.roomId()), true);
  assert.equal(replayed.startsAt(), startsAt);
  assert.equal(replayed.endsAt(), endsAt);
  assert.equal(Reservation.replay([], snapshot), snapshot);
});

test("イベント再生はスナップショットに続かない履歴を拒否する", () => {
  const snapshot = createConfirmedReservation();
  const cancelled = snapshot.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");
  const cancellation = cancelled.value.event;
  const other = Reservation.reserve(ReservationId.of(2), MemberId.of(2), RoomId.of(3), startsAt, endsAt);
  if (!other.ok) assert.fail("予約生成に失敗しました");
  const otherCancelled = other.value.cancel();
  if (!otherCancelled.ok) assert.fail("取消に失敗しました");

  for (const events of [
    [snapshot.reservedEvent()],
    [cancellation, cancellation],
    [otherCancelled.value.event],
    [{ ...cancellation, sequenceNumber: 3 }],
  ]) {
    assert.throws(() => Reservation.replay(events, snapshot));
  }
  assert.throws(() =>
    Reservation.replay([{ ...cancellation, sequenceNumber: 3 }], cancelled.value.reservation),
  );
});

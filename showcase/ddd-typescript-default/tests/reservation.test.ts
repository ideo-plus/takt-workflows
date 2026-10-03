import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MemberId,
  Reservation,
  ReservationId,
  RoomId,
  TimeSlot,
} from "@acme/reservation-domain";

const expectedStartsAt = 1_791_018_000_000;
const expectedEndsAt = 1_791_021_600_000;

function createReservationInput() {
  return {
    reservationId: ReservationId.of("reservation-1"),
    memberId: MemberId.of("member-1"),
    roomId: RoomId.of("room-1"),
    startsAt: new Date("2026-10-03T09:00:00.000Z"),
    endsAt: new Date("2026-10-03T10:00:00.000Z"),
  };
}

function reserveConfirmedReservation(): Reservation {
  const input = createReservationInput();
  const result = Reservation.reserve(
    input.reservationId,
    input.memberId,
    input.roomId,
    input.startsAt,
    input.endsAt,
  );

  if (!result.ok) {
    assert.fail(`予約の作成に失敗しました: ${result.error}`);
  }

  return result.value;
}

describe("Reservation", () => {
  test("予約識別子から保存用データを生成する", () => {
    const id = ReservationId.of("reservation-1");

    assert.deepEqual(id.toSnapshot(), { id: "reservation-1" });
  });

  test("会員識別子から保存用データを生成する", () => {
    const memberId = MemberId.of("member-1");

    assert.deepEqual(memberId.toSnapshot(), { memberId: "member-1" });
  });

  test("部屋識別子から保存用データを生成する", () => {
    const roomId = RoomId.of("room-1");

    assert.deepEqual(roomId.toSnapshot(), { roomId: "room-1" });
  });

  test("時間枠から保存用データを生成する", () => {
    const slot = TimeSlot.create(
      new Date("2026-10-03T09:00:00.000Z"),
      new Date("2026-10-03T10:00:00.000Z"),
    );
    if (!slot.ok) assert.fail("有効な時間枠の作成に失敗しました");

    assert.deepEqual(slot.value.toSnapshot(), {
      startsAt: expectedStartsAt,
      endsAt: expectedEndsAt,
    });
  });

  test("時間枠の公開ファクトリは有効な時刻を保持し、不正な終了日時を拒否する", () => {
    const slot = TimeSlot.create(
      new Date("2026-10-03T09:00:00.000Z"),
      new Date("2026-10-03T10:00:00.000Z"),
    );
    if (!slot.ok) assert.fail("有効な時間枠の作成に失敗しました");
    assert.equal(slot.value.startsAt(), expectedStartsAt);
    assert.equal(slot.value.endsAt(), expectedEndsAt);
    assert.deepEqual(
      TimeSlot.create(new Date(expectedStartsAt), new Date(Number.NaN)),
      { ok: false, error: "invalid-time-slot" },
    );
  });

  test("保存された取消済み予約を復元し、破損した時間枠と状態を拒否する", () => {
    const reservation = reserveConfirmedReservation();
    const cancelled = reservation.cancel();
    if (!cancelled.ok) assert.fail("取消に失敗しました");
    const snapshot = cancelled.value.reservation.toSnapshot();

    const restored = Reservation.restore(snapshot);

    assert.deepEqual(restored.toSnapshot(), snapshot);
    assert.deepEqual(restored.cancel(), { ok: false, error: "already-cancelled" });
    assert.throws(() => Reservation.restore({ ...snapshot, endsAt: snapshot.startsAt }));
    assert.throws(() => Reservation.restore({ ...snapshot, startsAt: Number.NaN }));
    assert.throws(() => Reservation.restore({ ...snapshot, startsAt: snapshot.startsAt + 0.5 }));
    assert.throws(() =>
      Reservation.restore({ ...snapshot, status: "unknown" } as unknown as Parameters<typeof Reservation.restore>[0]),
    );
  });

  test("会員が部屋を有効な時間枠で予約すると確定予約になる", () => {
    const input = createReservationInput();
    const result = Reservation.reserve(
      input.reservationId,
      input.memberId,
      input.roomId,
      input.startsAt,
      input.endsAt,
    );

    if (!result.ok) {
      assert.fail(`予約の作成に失敗しました: ${result.error}`);
    }
    assert.deepEqual(result.value.toSnapshot(), {
      id: "reservation-1",
      memberId: "member-1",
      roomId: "room-1",
      startsAt: expectedStartsAt,
      endsAt: expectedEndsAt,
      status: "confirmed",
    });
  });

  test("終了日時が開始日時と同じ時間枠を拒否する", () => {
    const input = createReservationInput();
    const result = Reservation.reserve(
      input.reservationId,
      input.memberId,
      input.roomId,
      input.startsAt,
      new Date(input.startsAt.getTime()),
    );

    assert.deepEqual(result, { ok: false, error: "invalid-time-slot" });
  });

  test("終了日時が開始日時より前の時間枠を拒否する", () => {
    const input = createReservationInput();
    const result = Reservation.reserve(
      input.reservationId,
      input.memberId,
      input.roomId,
      input.startsAt,
      new Date("2026-10-03T08:59:59.999Z"),
    );

    assert.deepEqual(result, { ok: false, error: "invalid-time-slot" });
  });

  test("無効な日時を含む時間枠を拒否する", () => {
    const input = createReservationInput();
    const result = Reservation.reserve(
      input.reservationId,
      input.memberId,
      input.roomId,
      new Date(Number.NaN),
      input.endsAt,
    );

    assert.deepEqual(result, { ok: false, error: "invalid-time-slot" });
  });

  test("確定予約を取り消すと新しい取消済み予約と取消イベントを返す", () => {
    const reservation = reserveConfirmedReservation();

    const result = reservation.cancel();

    if (!result.ok) {
      assert.fail(`予約の取消に失敗しました: ${result.error}`);
    }
    assert.deepEqual(result.value.reservation.toSnapshot(), {
      id: "reservation-1",
      memberId: "member-1",
      roomId: "room-1",
      startsAt: expectedStartsAt,
      endsAt: expectedEndsAt,
      status: "cancelled",
    });
    assert.ok(result.value.event);
    assert.equal(result.value.event.reservationId.toString(), "reservation-1");
    assert.equal(reservation.toSnapshot().status, "confirmed");
  });

  test("取消済み予約の再取消は失敗する", () => {
    const reservation = reserveConfirmedReservation();
    const firstCancellation = reservation.cancel();
    if (!firstCancellation.ok) {
      assert.fail(`予約の取消に失敗しました: ${firstCancellation.error}`);
    }

    const secondCancellation = firstCancellation.value.reservation.cancel();

    assert.deepEqual(secondCancellation, {
      ok: false,
      error: "already-cancelled",
    });
  });

  test("予約後に入力日時を変更しても保持した時間枠は変わらない", () => {
    const input = createReservationInput();
    const result = Reservation.reserve(
      input.reservationId,
      input.memberId,
      input.roomId,
      input.startsAt,
      input.endsAt,
    );
    if (!result.ok) {
      assert.fail(`予約の作成に失敗しました: ${result.error}`);
    }

    input.startsAt.setUTCFullYear(2030);
    input.endsAt.setUTCFullYear(2030);

    const snapshot = result.value.toSnapshot();
    assert.equal(snapshot.startsAt, expectedStartsAt);
    assert.equal(snapshot.endsAt, expectedEndsAt);
  });
});

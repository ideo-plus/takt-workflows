import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MemberId,
  Reservation,
  ReservationId,
  RoomId,
} from "@acme/reservation-domain";
import { InMemoryReservationRepository } from "@acme/reservation-interface-adapter";
import { CancelReservationUseCase } from "@acme/reservation-use-case";

const expectedStartsAt = 1_791_018_000_000;
const expectedEndsAt = 1_791_021_600_000;

function createConfirmedReservation(reservationId: ReservationId): Reservation {
  const result = Reservation.reserve(
    reservationId,
    MemberId.of("member-1"),
    RoomId.of("room-1"),
    new Date("2026-10-03T09:00:00.000Z"),
    new Date("2026-10-03T10:00:00.000Z"),
  );

  if (!result.ok) {
    assert.fail(`予約の作成に失敗しました: ${result.error}`);
  }

  return result.value;
}

function storeConfirmedReservation(
  repository: InMemoryReservationRepository,
  reservationId: ReservationId,
): void {
  const stored = repository.store(createConfirmedReservation(reservationId));
  if (!stored.ok) {
    assert.fail(`予約の保存に失敗しました: ${stored.error.message}`);
  }
}

describe("CancelReservationUseCase", () => {
  test("IDで予約を取り消し、変更後の状態をインメモリリポジトリへ保存する", () => {
    const reservationId = ReservationId.of("reservation-1");
    const repository = new InMemoryReservationRepository();
    storeConfirmedReservation(repository, reservationId);
    const useCase = new CancelReservationUseCase(repository);

    const result = useCase.execute(reservationId);

    if (!result.ok) {
      assert.fail(`予約の取消に失敗しました: ${String(result.error)}`);
    }
    assert.ok(result.value);
    assert.equal(result.value.reservationId.toString(), "reservation-1");

    const found = repository.findById(reservationId);
    if (!found.ok) {
      assert.fail(`予約の読込に失敗しました: ${found.error.message}`);
    }
    assert.notEqual(found.value, undefined);
    assert.deepEqual(found.value?.toSnapshot(), {
      id: "reservation-1",
      memberId: "member-1",
      roomId: "room-1",
      startsAt: expectedStartsAt,
      endsAt: expectedEndsAt,
      status: "cancelled",
    });
  });

  test("同じ予約を二度取り消すと二度目は失敗する", () => {
    const reservationId = ReservationId.of("reservation-1");
    const repository = new InMemoryReservationRepository();
    storeConfirmedReservation(repository, reservationId);
    const useCase = new CancelReservationUseCase(repository);

    const firstCancellation = useCase.execute(reservationId);
    assert.equal(firstCancellation.ok, true);

    const secondCancellation = useCase.execute(reservationId);

    assert.deepEqual(secondCancellation, {
      ok: false,
      error: "already-cancelled",
    });
  });

  test("存在しない予約IDの取消は失敗し、既存予約を変更しない", () => {
    const existingReservationId = ReservationId.of("reservation-1");
    const missingReservationId = ReservationId.of("reservation-missing");
    const repository = new InMemoryReservationRepository();
    storeConfirmedReservation(repository, existingReservationId);
    const useCase = new CancelReservationUseCase(repository);

    const result = useCase.execute(missingReservationId);

    assert.deepEqual(result, {
      ok: false,
      error: "reservation-not-found",
    });

    const found = repository.findById(existingReservationId);
    if (!found.ok) {
      assert.fail(`予約の読込に失敗しました: ${found.error.message}`);
    }
    assert.equal(found.value?.toSnapshot().status, "confirmed");
  });
});

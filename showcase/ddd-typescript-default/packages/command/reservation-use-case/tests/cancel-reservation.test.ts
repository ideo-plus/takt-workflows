import assert from "node:assert/strict";
import { test } from "node:test";
import { MemberId, Reservation, ReservationId, RoomId } from "@acme/reservation-domain";
import { CancelReservationUseCase } from "@acme/reservation-use-case";
import type { ReservationRepository, RepositoryError } from "@acme/reservation-use-case";

test("読込失敗は保存せずに呼出側へ返す", () => {
  const error: RepositoryError = { kind: "repository-error", message: "読込失敗" };
  const repository: ReservationRepository = {
    findById() { return { ok: false, error }; },
    store() { assert.fail("読込失敗後に保存してはいけません"); },
  };
  const useCase = new CancelReservationUseCase(repository);

  assert.deepEqual(useCase.execute(ReservationId.of(1)), { ok: false, error });
});

test("保存失敗では成功イベントを返さず、保存された予約は確定済みのままである", () => {
  const reserved = Reservation.reserve(
    ReservationId.of(1), MemberId.of(2), RoomId.of(3), 100, 200,
  );
  if (!reserved.ok) assert.fail("予約生成に失敗しました");
  const reservation = reserved.value;
  const error: RepositoryError = { kind: "repository-error", message: "保存失敗" };
  const repository: ReservationRepository = {
    findById() { return { ok: true, value: reservation }; },
    store() { return { ok: false, error }; },
  };
  const useCase = new CancelReservationUseCase(repository);

  assert.deepEqual(useCase.execute(ReservationId.of(1)), { ok: false, error });
  assert.equal(reservation.status(), "confirmed");
  assert.deepEqual(useCase.execute(ReservationId.of(1)), { ok: false, error });
});

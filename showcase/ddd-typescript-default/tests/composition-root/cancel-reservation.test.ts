import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MemberId,
  Reservation,
  ReservationId,
  RoomId,
} from "@acme/reservation-domain";
import { InMemoryReservationRepository } from "@acme/reservation-interface-adapter";
import { CancelReservationUseCase } from "@acme/reservation-use-case";

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

test("インメモリ実装は保存した予約を同じ値の予約IDで読み込める", () => {
  const repository = new InMemoryReservationRepository();
  const reservation = createConfirmedReservation();

  const stored = repository.store(reservation.id(), reservation.reservedEvent());
  const found = repository.findById(ReservationId.of(1));

  assert.deepEqual(stored, { ok: true, value: undefined });
  assert.equal(found.ok, true);
  if (!found.ok) {
    assert.fail("保存した予約の読込に失敗しました");
  }
  assert.notEqual(found.value, undefined);
  if (found.value === undefined) {
    assert.fail("保存した予約が見つかりませんでした");
  }
  assert.equal(found.value.id().equals(ReservationId.of(1)), true);
  assert.equal(found.value.memberId().equals(MemberId.of(2)), true);
  assert.equal(found.value.roomId().equals(RoomId.of(3)), true);
  assert.equal(found.value.startsAt(), startsAt);
  assert.equal(found.value.endsAt(), endsAt);
  assert.equal(found.value.status(), "confirmed");
});

test("取消ユースケースは変更後の予約を保存し、同じ予約の再取消を拒否する", () => {
  const repository = new InMemoryReservationRepository();
  const stored = storeNew(repository, createConfirmedReservation());
  assert.deepEqual(stored, { ok: true, value: undefined });
  const useCase = new CancelReservationUseCase(repository);

  const firstCancellation = useCase.execute(ReservationId.of(1));
  const afterFirstCancellation = repository.findById(ReservationId.of(1));
  const secondCancellation = useCase.execute(ReservationId.of(1));
  const afterSecondCancellation = repository.findById(ReservationId.of(1));

  assert.equal(firstCancellation.ok, true);
  if (!firstCancellation.ok) {
    assert.fail("保存済み予約の取消に失敗しました");
  }
  assert.equal(
    firstCancellation.value.reservationId.equals(ReservationId.of(1)),
    true,
  );
  assert.equal(afterFirstCancellation.ok, true);
  if (!afterFirstCancellation.ok || afterFirstCancellation.value === undefined) {
    assert.fail("取消後の予約を読み込めませんでした");
  }
  assert.equal(afterFirstCancellation.value.status(), "cancelled");
  assert.deepEqual(secondCancellation, {
    ok: false,
    error: "already-cancelled",
  });
  assert.equal(afterSecondCancellation.ok, true);
  if (!afterSecondCancellation.ok || afterSecondCancellation.value === undefined) {
    assert.fail("再取消後の予約を読み込めませんでした");
  }
  assert.equal(afterSecondCancellation.value.status(), "cancelled");
});

test("取消ユースケースは指定IDの予約が存在しないと失敗する", () => {
  const repository = new InMemoryReservationRepository();
  const stored = storeNew(repository, createConfirmedReservation());
  assert.deepEqual(stored, { ok: true, value: undefined });
  const useCase = new CancelReservationUseCase(repository);

  const cancellation = useCase.execute(ReservationId.of(2));
  const existingReservation = repository.findById(ReservationId.of(1));

  assert.deepEqual(cancellation, {
    ok: false,
    error: "reservation-not-found",
  });
  assert.equal(existingReservation.ok, true);
  if (!existingReservation.ok || existingReservation.value === undefined) {
    assert.fail("既存予約を読み込めませんでした");
  }
  assert.equal(existingReservation.value.status(), "confirmed");
});

function storeNew(repository: InMemoryReservationRepository, reservation: Reservation) {
  return repository.store(reservation.id(), reservation.reservedEvent());
}

test("取消イベントを保存するまで既存履歴と確定状態は変わらない", () => {
  const repository = new InMemoryReservationRepository();
  const reservation = createConfirmedReservation();
  assert.equal(storeNew(repository, reservation).ok, true);
  const before = repository.eventsFor(reservation.id());
  const cancelled = reservation.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");
  assert.deepEqual(repository.eventsFor(reservation.id()), before);
  const unsaved = repository.findById(reservation.id());
  if (!unsaved.ok || !unsaved.value) assert.fail("読込に失敗しました");
  assert.equal(unsaved.value.status(), "confirmed");
  assert.equal(repository.store(reservation.id(), cancelled.value.event).ok, true);
  const after = repository.eventsFor(reservation.id());
  assert.equal(after.length, 2);
  assert.equal(after[0], before[0]);
  assert.equal(after[1]?.kind, "cancelled");
});

test("重複・別ID・生成前の取消イベントの拒否で履歴を変更しない", () => {
  const repository = new InMemoryReservationRepository();
  const reservation = createConfirmedReservation();
  const cancelled = reservation.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");
  assert.equal(repository.store(reservation.id(), cancelled.value.event).ok, false);
  assert.deepEqual(repository.eventsFor(reservation.id()), []);
  assert.equal(storeNew(repository, reservation).ok, true);
  const before = repository.eventsFor(reservation.id());
  assert.equal(storeNew(repository, reservation).ok, false);
  assert.equal(repository.store(ReservationId.of(2), reservation.reservedEvent()).ok, false);
  assert.deepEqual(repository.eventsFor(reservation.id()), before);
  assert.deepEqual(repository.eventsFor(ReservationId.of(2)), []);
  assert.equal(repository.store(reservation.id(), cancelled.value.event).ok, true);
  const after = repository.eventsFor(reservation.id());
  assert.equal(repository.store(reservation.id(), cancelled.value.event).ok, false);
  assert.deepEqual(repository.eventsFor(reservation.id()), after);
});

test("外部のイベントオブジェクトや返した履歴から保存済みイベントを変更できない", () => {
  const repository = new InMemoryReservationRepository();
  const reservation = createConfirmedReservation();
  const input = { ...reservation.reservedEvent() };
  assert.equal(repository.store(reservation.id(), input).ok, true);
  input.endsAt += 100;
  const found = repository.findById(reservation.id());
  if (!found.ok || !found.value) assert.fail("読込に失敗しました");
  assert.equal(found.value.endsAt(), reservation.endsAt());
  const history = repository.eventsFor(reservation.id());
  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(history[0]), true);
});

test("未存在と再取消の失敗ではどの予約の履歴も増えない", () => {
  const repository = new InMemoryReservationRepository();
  const reservation = createConfirmedReservation();
  assert.equal(storeNew(repository, reservation).ok, true);
  const useCase = new CancelReservationUseCase(repository);
  const before = repository.eventsFor(reservation.id());
  assert.equal(useCase.execute(ReservationId.of(2)).ok, false);
  assert.deepEqual(repository.eventsFor(reservation.id()), before);
  assert.deepEqual(repository.eventsFor(ReservationId.of(2)), []);
  assert.equal(useCase.execute(reservation.id()).ok, true);
  const after = repository.eventsFor(reservation.id());
  assert.equal(useCase.execute(reservation.id()).ok, false);
  assert.deepEqual(repository.eventsFor(reservation.id()), after);
});

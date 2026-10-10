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

function createConfirmedReservation(roomId = RoomId.of(3)): Reservation {
  const reserved = Reservation.reserve(
    ReservationId.of(1),
    MemberId.of(2),
    roomId,
    startsAt,
    endsAt,
  );

  assert.equal(reserved.ok, true);
  if (!reserved.ok) {
    assert.fail("有効な時間帯の予約生成に失敗しました");
  }
  return reserved.value;
}

function storeNew(repository: InMemoryReservationRepository, reservation: Reservation) {
  return repository.store(reservation.reservedEvent(), reservation);
}

function load(repository: InMemoryReservationRepository, id: ReservationId): Reservation {
  const found = repository.findById(id);
  if (!found.ok || found.value === undefined) {
    assert.fail("保存した予約を読み込めませんでした");
  }
  return found.value;
}

test("インメモリ実装は保存した予約を同じ値の予約IDで読み込み、未保存の予約IDは undefined を返す", () => {
  const repository = new InMemoryReservationRepository(10);
  const reservation = createConfirmedReservation();

  const stored = storeNew(repository, reservation);
  const found = load(repository, ReservationId.of(1));

  assert.deepEqual(stored, { ok: true, value: undefined });
  assert.equal(found.id().equals(ReservationId.of(1)), true);
  assert.equal(found.memberId().equals(MemberId.of(2)), true);
  assert.equal(found.roomId().equals(RoomId.of(3)), true);
  assert.equal(found.startsAt(), startsAt);
  assert.equal(found.endsAt(), endsAt);
  assert.equal(found.status(), "confirmed");
  assert.equal(found.sequenceNumber(), 1);
  assert.deepEqual(repository.findById(ReservationId.of(2)), { ok: true, value: undefined });
});

test("取消ユースケースは変更後の予約を保存し、同じ予約の再取消を拒否する", () => {
  const repository = new InMemoryReservationRepository(10);
  const stored = storeNew(repository, createConfirmedReservation());
  assert.deepEqual(stored, { ok: true, value: undefined });
  const useCase = new CancelReservationUseCase(repository);

  const firstCancellation = useCase.execute(ReservationId.of(1));
  const afterFirstCancellation = load(repository, ReservationId.of(1));
  const secondCancellation = useCase.execute(ReservationId.of(1));
  const afterSecondCancellation = load(repository, ReservationId.of(1));

  assert.equal(firstCancellation.ok, true);
  if (!firstCancellation.ok) {
    assert.fail("保存済み予約の取消に失敗しました");
  }
  assert.equal(
    firstCancellation.value.reservationId.equals(ReservationId.of(1)),
    true,
  );
  assert.equal(firstCancellation.value.sequenceNumber, 2);
  assert.equal(afterFirstCancellation.status(), "cancelled");
  assert.equal(afterFirstCancellation.sequenceNumber(), 2);
  assert.deepEqual(secondCancellation, {
    ok: false,
    error: "already-cancelled",
  });
  assert.equal(afterSecondCancellation.status(), "cancelled");
  assert.equal(afterSecondCancellation.sequenceNumber(), 2);
});

test("取消ユースケースは指定IDの予約が存在しないと失敗する", () => {
  const repository = new InMemoryReservationRepository(10);
  const stored = storeNew(repository, createConfirmedReservation());
  assert.deepEqual(stored, { ok: true, value: undefined });
  const useCase = new CancelReservationUseCase(repository);

  const cancellation = useCase.execute(ReservationId.of(2));

  assert.deepEqual(cancellation, {
    ok: false,
    error: "reservation-not-found",
  });
  assert.equal(load(repository, ReservationId.of(1)).status(), "confirmed");
  assert.deepEqual(repository.findById(ReservationId.of(2)), { ok: true, value: undefined });
});

test("取消がスナップショット保存間隔に達しなくても取消後の業務状態を読み込める", () => {
  const repository = new InMemoryReservationRepository(10);
  const reservation = createConfirmedReservation();
  assert.equal(storeNew(repository, reservation).ok, true);
  const cancelled = reservation.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");

  assert.equal(repository.store(cancelled.value.event, cancelled.value.reservation).ok, true);
  const found = load(repository, ReservationId.of(1));

  assert.equal(found.status(), "cancelled");
  assert.equal(found.sequenceNumber(), 2);
  assert.equal(found.roomId().equals(RoomId.of(3)), true);
});

test("間隔1でも保存した取消後の業務状態を読み込める", () => {
  const repository = new InMemoryReservationRepository(1);
  const reservation = createConfirmedReservation();
  assert.equal(storeNew(repository, reservation).ok, true);
  const cancelled = reservation.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");

  assert.equal(repository.store(cancelled.value.event, cancelled.value.reservation).ok, true);
  const found = load(repository, ReservationId.of(1));

  assert.equal(found.status(), "cancelled");
  assert.equal(found.roomId().equals(RoomId.of(3)), true);
});

test("スナップショットがイベント直後の予約でない保存を拒否し、何も保存しない", () => {
  const repository = new InMemoryReservationRepository(10);
  const reservation = createConfirmedReservation();
  const other = Reservation.reserve(ReservationId.of(2), MemberId.of(2), RoomId.of(3), startsAt, endsAt);
  if (!other.ok) assert.fail("予約生成に失敗しました");
  const cancelled = reservation.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");

  assert.equal(repository.store(reservation.reservedEvent(), other.value).ok, false);
  assert.equal(repository.store(other.value.reservedEvent(), reservation).ok, false);
  assert.deepEqual(repository.findById(ReservationId.of(1)), { ok: true, value: undefined });
  assert.deepEqual(repository.findById(ReservationId.of(2)), { ok: true, value: undefined });
  assert.equal(storeNew(repository, reservation).ok, true);
  assert.equal(repository.store(cancelled.value.event, reservation).ok, false);
  assert.equal(load(repository, ReservationId.of(1)).status(), "confirmed");
});

test("保存済みの履歴に続かないイベントを拒否する", () => {
  const repository = new InMemoryReservationRepository(10);
  const reservation = createConfirmedReservation();
  const cancelled = reservation.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");

  assert.equal(repository.store(cancelled.value.event, cancelled.value.reservation).ok, false);
  assert.deepEqual(repository.findById(ReservationId.of(1)), { ok: true, value: undefined });
  assert.equal(storeNew(repository, reservation).ok, true);
  assert.equal(storeNew(repository, reservation).ok, false);
  assert.equal(repository.store(cancelled.value.event, cancelled.value.reservation).ok, true);
  assert.equal(repository.store(cancelled.value.event, cancelled.value.reservation).ok, false);
  const found = load(repository, ReservationId.of(1));
  assert.equal(found.status(), "cancelled");
  assert.equal(found.sequenceNumber(), 2);
});

test("取消イベントを保存するまで保存済みの予約は確定のままである", () => {
  const repository = new InMemoryReservationRepository(10);
  const reservation = createConfirmedReservation();
  assert.equal(storeNew(repository, reservation).ok, true);
  const cancelled = reservation.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");

  assert.equal(load(repository, reservation.id()).status(), "confirmed");
  assert.equal(repository.store(cancelled.value.event, cancelled.value.reservation).ok, true);
  assert.equal(load(repository, reservation.id()).status(), "cancelled");
});

test("保存後に入力イベントを変更しても読込結果は変わらない", () => {
  const repository = new InMemoryReservationRepository(10);
  const reservation = createConfirmedReservation();
  assert.equal(storeNew(repository, reservation).ok, true);
  const cancelled = reservation.cancel();
  if (!cancelled.ok) assert.fail("取消に失敗しました");
  const input = { ...cancelled.value.event };

  assert.equal(repository.store(input, cancelled.value.reservation).ok, true);
  input.sequenceNumber = 99;
  const found = load(repository, reservation.id());

  assert.equal(found.status(), "cancelled");
  assert.equal(found.sequenceNumber(), 2);
});

test("未存在と再取消の失敗では保存済みの予約が変わらない", () => {
  const repository = new InMemoryReservationRepository(10);
  const reservation = createConfirmedReservation();
  assert.equal(storeNew(repository, reservation).ok, true);
  const useCase = new CancelReservationUseCase(repository);

  assert.equal(useCase.execute(ReservationId.of(2)).ok, false);
  assert.equal(load(repository, reservation.id()).sequenceNumber(), 1);
  assert.deepEqual(repository.findById(ReservationId.of(2)), { ok: true, value: undefined });
  assert.equal(useCase.execute(reservation.id()).ok, true);
  assert.equal(useCase.execute(reservation.id()).ok, false);
  const found = load(repository, reservation.id());
  assert.equal(found.status(), "cancelled");
  assert.equal(found.sequenceNumber(), 2);
});

test("スナップショットの間隔は1以上の整数に限る", () => {
  for (const interval of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new InMemoryReservationRepository(interval), RangeError);
  }
});

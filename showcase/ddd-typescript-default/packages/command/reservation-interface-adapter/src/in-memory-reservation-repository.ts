import { Reservation } from "@acme/reservation-domain";
import type { ReservationId, ReservationEvent } from "@acme/reservation-domain";
import type { ReservationRepository, RepositoryError } from "@acme/reservation-use-case";
import type { Result } from "@acme/language-extensions";

export class InMemoryReservationRepository implements ReservationRepository {
  readonly #events: Map<number, readonly ReservationEvent[]> = new Map();
  readonly #snapshots: Map<number, Reservation> = new Map();
  readonly #snapshotInterval: number;

  constructor(snapshotInterval: number) {
    if (!Number.isSafeInteger(snapshotInterval) || snapshotInterval < 1) {
      throw new RangeError("スナップショットの間隔は1以上の整数です");
    }
    this.#snapshotInterval = snapshotInterval;
  }

  findById(id: ReservationId): Result<Reservation | undefined, RepositoryError> {
    const snapshot = this.#snapshots.get(id.value());
    if (snapshot === undefined) return { ok: true, value: undefined };
    const events = (this.#events.get(id.value()) ?? [])
      .filter((event) => event.sequenceNumber > snapshot.sequenceNumber());
    try {
      return { ok: true, value: Reservation.replay(events, snapshot) };
    } catch {
      return { ok: false, error: { kind: "repository-error", message: "予約のイベント履歴が不正です" } };
    }
  }

  store(event: ReservationEvent, snapshot: Reservation): Result<void, RepositoryError> {
    if (!event.reservationId.equals(snapshot.id()) || event.sequenceNumber !== snapshot.sequenceNumber()) {
      return { ok: false, error: { kind: "repository-error", message: "スナップショットがイベント直後の予約ではありません" } };
    }
    const key = event.reservationId.value();
    const previous = this.#events.get(key) ?? [];
    if (event.sequenceNumber !== (previous[previous.length - 1]?.sequenceNumber ?? 0) + 1) {
      return { ok: false, error: { kind: "repository-error", message: "イベントが保存済みの履歴に続いていません" } };
    }
    const persisted: ReservationEvent = Object.freeze({ ...event });
    this.#events.set(key, Object.freeze([...previous, persisted]));
    if (event.sequenceNumber === 1 || event.sequenceNumber % this.#snapshotInterval === 0) {
      this.#snapshots.set(key, snapshot);
    }
    return { ok: true, value: undefined };
  }
}

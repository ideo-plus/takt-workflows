import { Reservation } from "@acme/reservation-domain";
import type { ReservationId, ReservationEvent } from "@acme/reservation-domain";
import type { ReservationRepository, RepositoryError } from "@acme/reservation-use-case";
import type { Result } from "@acme/language-extensions";

export class InMemoryReservationRepository implements ReservationRepository {
  readonly #events: Map<number, readonly ReservationEvent[]> = new Map();

  findById(id: ReservationId): Result<Reservation | undefined, RepositoryError> {
    const events = this.#events.get(id.value());
    if (events === undefined) return { ok: true, value: undefined };
    try {
      return { ok: true, value: Reservation.restore(id, events) };
    } catch {
      return { ok: false, error: { kind: "repository-error", message: "予約のイベント履歴が不正です" } };
    }
  }

  store(id: ReservationId, event: ReservationEvent): Result<void, RepositoryError> {
    if (!event.reservationId.equals(id)) {
      return { ok: false, error: { kind: "repository-error", message: "予約IDがイベントと一致しません" } };
    }
    const previous = this.#events.get(id.value()) ?? [];
    const persisted: ReservationEvent = Object.freeze({ ...event });
    const next: readonly ReservationEvent[] = Object.freeze([...previous, persisted]);
    try {
      Reservation.restore(id, next);
    } catch {
      return { ok: false, error: { kind: "repository-error", message: "予約のイベント順序が不正です" } };
    }
    this.#events.set(id.value(), next);
    return { ok: true, value: undefined };
  }

  eventsFor(id: ReservationId): readonly ReservationEvent[] {
    return Object.freeze([...(this.#events.get(id.value()) ?? [])]);
  }
}

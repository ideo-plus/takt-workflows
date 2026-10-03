import { Reservation } from "@acme/reservation-domain";
import type { ReservationId, ReservationSnapshot } from "@acme/reservation-domain";
import type {
  FindReservationResult,
  ReservationRepository,
  StoreReservationResult,
} from "@acme/reservation-use-case";

export class InMemoryReservationRepository implements ReservationRepository {
  readonly #records: Map<string, ReservationSnapshot> = new Map();

  findById(id: ReservationId): FindReservationResult {
    const snapshot: ReservationSnapshot | undefined = this.#records.get(id.toString());
    if (snapshot === undefined) return { ok: true, value: undefined };
    return { ok: true, value: Reservation.restore(snapshot) };
  }

  store(reservation: Reservation): StoreReservationResult {
    const snapshot: ReservationSnapshot = reservation.toSnapshot();
    this.#records.set(snapshot.id, snapshot);
    return { ok: true, value: undefined };
  }
}

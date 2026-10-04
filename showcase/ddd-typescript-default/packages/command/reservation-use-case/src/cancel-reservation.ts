import type {
  Reservation, ReservationId, ReservationCancelled,
  CancelReservationError, CancelReservationOutcome,
} from "@acme/reservation-domain";
import type { Result } from "@acme/language-extensions";
import type { ReservationRepository, RepositoryError } from "./reservation-repository.ts";

export type CancelReservationFailure =
  | "reservation-not-found"
  | CancelReservationError
  | RepositoryError;

export class CancelReservationUseCase {
  readonly #reservationRepository: ReservationRepository;

  constructor(reservationRepository: ReservationRepository) {
    this.#reservationRepository = reservationRepository;
  }

  execute(reservationId: ReservationId): Result<ReservationCancelled, CancelReservationFailure> {
    const found: Result<Reservation | undefined, RepositoryError> =
      this.#reservationRepository.findById(reservationId);
    if (!found.ok) return found;
    if (found.value === undefined) return { ok: false, error: "reservation-not-found" };
    const reservation: Reservation = found.value;
    const cancelled: Result<CancelReservationOutcome, CancelReservationError> = reservation.cancel();
    if (!cancelled.ok) return cancelled;
    const outcome: CancelReservationOutcome = cancelled.value;
    const stored: Result<void, RepositoryError> = this.#reservationRepository.store(reservationId, outcome.event);
    if (!stored.ok) return stored;
    return { ok: true, value: outcome.event };
  }
}

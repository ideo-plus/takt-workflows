import type { Result } from "@acme/language-extensions";
import type {
  CancelReservationError,
  CancelReservationResult,
  Reservation,
  ReservationCancelled,
  ReservationId,
} from "@acme/reservation-domain";
import type {
  FindReservationResult,
  RepositoryError,
  ReservationRepository,
  StoreReservationResult,
} from "./reservation-repository.ts";

export type CancelReservationFailure =
  | "reservation-not-found"
  | CancelReservationError
  | RepositoryError;
export type CancelReservationUseCaseResult = Result<ReservationCancelled, CancelReservationFailure>;

export class CancelReservationUseCase {
  readonly #reservationRepository: ReservationRepository;

  constructor(reservationRepository: ReservationRepository) {
    this.#reservationRepository = reservationRepository;
  }

  execute(id: ReservationId): CancelReservationUseCaseResult {
    const found: FindReservationResult = this.#reservationRepository.findById(id);
    if (!found.ok) return found;
    if (found.value === undefined) {
      return { ok: false, error: "reservation-not-found" };
    }
    const reservation: Reservation = found.value;
    const cancelled: CancelReservationResult = reservation.cancel();
    if (!cancelled.ok) return cancelled;
    const stored: StoreReservationResult = this.#reservationRepository.store(
      cancelled.value.reservation,
    );
    if (!stored.ok) return stored;
    return { ok: true, value: cancelled.value.event };
  }
}

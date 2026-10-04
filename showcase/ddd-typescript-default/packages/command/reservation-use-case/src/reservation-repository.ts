import type { Reservation, ReservationId, ReservationEvent } from "@acme/reservation-domain";
import type { Result } from "@acme/language-extensions";

export type RepositoryError = {
  readonly kind: "repository-error";
  readonly message: string;
};

export interface ReservationRepository {
  findById(reservationId: ReservationId): Result<Reservation | undefined, RepositoryError>;
  store(reservationId: ReservationId, event: ReservationEvent): Result<void, RepositoryError>;
}

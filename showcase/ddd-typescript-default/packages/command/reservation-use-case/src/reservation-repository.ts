import type { Reservation, ReservationId } from "@acme/reservation-domain";
import type { Result } from "@acme/language-extensions";

export type RepositoryError = {
  readonly kind: "repository-error";
  readonly message: string;
};

export type FindReservationResult = Result<Reservation | undefined, RepositoryError>;
export type StoreReservationResult = Result<void, RepositoryError>;

export interface ReservationRepository {
  findById(id: ReservationId): Result<Reservation | undefined, RepositoryError>;
  store(reservation: Reservation): Result<void, RepositoryError>;
}

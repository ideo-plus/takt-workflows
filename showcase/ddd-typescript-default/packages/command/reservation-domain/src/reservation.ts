import type { Result } from "@acme/language-extensions";
import type { MemberId } from "./member-id.ts";
import type { RoomId } from "./room-id.ts";
import type { ReservationId } from "./reservation/reservation-id.ts";

export { ReservationId } from "./reservation/reservation-id.ts";
export type { ParseReservationIdError } from "./reservation/reservation-id.ts";

export type ReserveReservationError = "invalid-time-slot";
export type CancelReservationError = "already-cancelled";
export type ReservationStatus = "confirmed" | "cancelled";
export type ReservationReserved = {
  readonly kind: "reserved";
  readonly reservationId: ReservationId;
  readonly sequenceNumber: number;
  readonly memberId: MemberId;
  readonly roomId: RoomId;
  readonly startsAt: number;
  readonly endsAt: number;
};
export type ReservationCancelled = {
  readonly kind: "cancelled";
  readonly reservationId: ReservationId;
  readonly sequenceNumber: number;
};
export type ReservationEvent = ReservationReserved | ReservationCancelled;
export type CancelReservationOutcome = {
  readonly reservation: Reservation;
  readonly event: ReservationCancelled;
};

export class Reservation {
  readonly #reserved: ReservationReserved;
  readonly #sequenceNumber: number;
  readonly #status: ReservationStatus;

  private constructor(reserved: ReservationReserved, sequenceNumber: number, status: ReservationStatus) {
    this.#reserved = reserved;
    this.#sequenceNumber = sequenceNumber;
    this.#status = status;
  }

  static reserve(
    id: ReservationId, memberId: MemberId, roomId: RoomId,
    startsAt: number, endsAt: number,
  ): Result<Reservation, ReserveReservationError> {
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) {
      return { ok: false, error: "invalid-time-slot" };
    }
    const event: ReservationReserved = Object.freeze({
      kind: "reserved", reservationId: id, sequenceNumber: 1, memberId, roomId, startsAt, endsAt,
    });
    return { ok: true, value: Reservation.fromReserved(event) };
  }

  static replay(events: readonly ReservationEvent[], snapshot: Reservation): Reservation {
    let reservation = snapshot;
    for (const event of events) {
      if (event.kind !== "cancelled" || !event.reservationId.equals(reservation.id()) ||
          event.sequenceNumber !== reservation.#sequenceNumber + 1 ||
          reservation.#status !== "confirmed") {
        throw new Error("予約のイベント履歴が不正です");
      }
      reservation = reservation.applyCancelled(event);
    }
    return reservation;
  }

  private static fromReserved(event: ReservationReserved): Reservation {
    return new Reservation(event, event.sequenceNumber, "confirmed");
  }

  private applyCancelled(event: ReservationCancelled): Reservation {
    return new Reservation(this.#reserved, event.sequenceNumber, "cancelled");
  }

  cancel(): Result<CancelReservationOutcome, CancelReservationError> {
    if (this.#status === "cancelled") {
      return { ok: false, error: "already-cancelled" };
    }
    const event: ReservationCancelled = Object.freeze({
      kind: "cancelled", reservationId: this.#reserved.reservationId,
      sequenceNumber: this.#sequenceNumber + 1,
    });
    return { ok: true, value: { reservation: this.applyCancelled(event), event } };
  }

  reservedEvent(): ReservationReserved { return this.#reserved; }
  id(): ReservationId { return this.#reserved.reservationId; }
  sequenceNumber(): number { return this.#sequenceNumber; }
  memberId(): MemberId { return this.#reserved.memberId; }
  roomId(): RoomId { return this.#reserved.roomId; }
  startsAt(): number { return this.#reserved.startsAt; }
  endsAt(): number { return this.#reserved.endsAt; }
  status(): ReservationStatus { return this.#status; }
}

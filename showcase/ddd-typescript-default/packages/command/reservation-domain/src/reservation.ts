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
  readonly memberId: MemberId;
  readonly roomId: RoomId;
  readonly startsAt: number;
  readonly endsAt: number;
};
export type ReservationCancelled = {
  readonly kind: "cancelled";
  readonly reservationId: ReservationId;
};
export type ReservationEvent = ReservationReserved | ReservationCancelled;
export type CancelReservationOutcome = {
  readonly reservation: Reservation;
  readonly event: ReservationCancelled;
};

export class Reservation {
  readonly #reserved: ReservationReserved;
  readonly #status: ReservationStatus;

  private constructor(reserved: ReservationReserved, status: ReservationStatus) {
    this.#reserved = reserved;
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
      kind: "reserved", reservationId: id, memberId, roomId, startsAt, endsAt,
    });
    return { ok: true, value: Reservation.fromReserved(event) };
  }

  static restore(id: ReservationId, events: readonly ReservationEvent[]): Reservation {
    const first = events[0];
    if (!first || first.kind !== "reserved" || !first.reservationId.equals(id)) {
      throw new Error("予約のイベント履歴が不正です");
    }
    let reservation = Reservation.fromReserved(first);
    for (const event of events.slice(1)) {
      if (event.kind !== "cancelled" || !event.reservationId.equals(id) ||
          reservation.#status !== "confirmed") {
        throw new Error("予約のイベント履歴が不正です");
      }
      reservation = reservation.applyCancelled(event);
    }
    return reservation;
  }

  private static fromReserved(event: ReservationReserved): Reservation {
    if (!Number.isFinite(event.startsAt) || !Number.isFinite(event.endsAt) ||
        event.endsAt <= event.startsAt) {
      throw new Error("予約のイベント履歴が不正です");
    }
    return new Reservation(Object.freeze({ ...event }), "confirmed");
  }

  private applyCancelled(_event: ReservationCancelled): Reservation {
    return new Reservation(this.#reserved, "cancelled");
  }

  cancel(): Result<CancelReservationOutcome, CancelReservationError> {
    if (this.#status === "cancelled") {
      return { ok: false, error: "already-cancelled" };
    }
    const event: ReservationCancelled = Object.freeze({
      kind: "cancelled", reservationId: this.#reserved.reservationId,
    });
    return { ok: true, value: { reservation: this.applyCancelled(event), event } };
  }

  reservedEvent(): ReservationReserved { return this.#reserved; }
  id(): ReservationId { return this.#reserved.reservationId; }
  memberId(): MemberId { return this.#reserved.memberId; }
  roomId(): RoomId { return this.#reserved.roomId; }
  startsAt(): number { return this.#reserved.startsAt; }
  endsAt(): number { return this.#reserved.endsAt; }
  status(): ReservationStatus { return this.#status; }
}

import type { Result } from "@acme/language-extensions";
import { MemberId } from "./member-id.ts";
import { RoomId } from "./room-id.ts";
import { ReservationId } from "./reservation/reservation-id.ts";
import { TimeSlot } from "./reservation/time-slot.ts";
import type { CreateTimeSlotResult } from "./reservation/time-slot.ts";

export type ReserveReservationError = "invalid-time-slot";
export type CancelReservationError = "already-cancelled";

export type CancelReservationResult = Result<CancelReservationOutcome, CancelReservationError>;

export type ReservationCancelled = { readonly reservationId: ReservationId };
export type CancelReservationOutcome = {
  readonly reservation: Reservation;
  readonly event: ReservationCancelled;
};

export type ReservationSnapshot = {
  readonly id: string;
  readonly memberId: string;
  readonly roomId: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly status: "confirmed" | "cancelled";
};

export class Reservation {
  readonly #id: ReservationId;
  readonly #memberId: MemberId;
  readonly #roomId: RoomId;
  readonly #slot: TimeSlot;
  readonly #status: "confirmed" | "cancelled";

  private constructor(
    id: ReservationId,
    memberId: MemberId,
    roomId: RoomId,
    slot: TimeSlot,
    status: "confirmed" | "cancelled",
  ) {
    this.#id = id;
    this.#memberId = memberId;
    this.#roomId = roomId;
    this.#slot = slot;
    this.#status = status;
  }

  static reserve(
    id: ReservationId,
    memberId: MemberId,
    roomId: RoomId,
    startsAt: Date,
    endsAt: Date,
  ): Result<Reservation, ReserveReservationError> {
    const slot: CreateTimeSlotResult = TimeSlot.create(startsAt, endsAt);
    if (!slot.ok) return { ok: false, error: "invalid-time-slot" };
    return {
      ok: true,
      value: new Reservation(id, memberId, roomId, slot.value, "confirmed"),
    };
  }

  static restore(snapshot: ReservationSnapshot): Reservation {
    if (
      typeof snapshot.id !== "string" ||
      typeof snapshot.memberId !== "string" ||
      typeof snapshot.roomId !== "string" ||
      !Number.isInteger(snapshot.startsAt) ||
      !Number.isInteger(snapshot.endsAt) ||
      (snapshot.status !== "confirmed" && snapshot.status !== "cancelled")
    ) {
      throw new Error("予約の保存状態が破損しています");
    }
    const slot: CreateTimeSlotResult = TimeSlot.create(
      new Date(snapshot.startsAt),
      new Date(snapshot.endsAt),
    );
    if (!slot.ok) {
      throw new Error("予約の保存状態が破損しています");
    }
    return new Reservation(
      ReservationId.of(snapshot.id),
      MemberId.of(snapshot.memberId),
      RoomId.of(snapshot.roomId),
      slot.value,
      snapshot.status,
    );
  }

  cancel(): Result<CancelReservationOutcome, CancelReservationError> {
    if (this.#status === "cancelled") {
      return { ok: false, error: "already-cancelled" };
    }
    const reservation: Reservation = new Reservation(
      this.#id,
      this.#memberId,
      this.#roomId,
      this.#slot,
      "cancelled",
    );
    const event: ReservationCancelled = { reservationId: this.#id };
    return { ok: true, value: { reservation, event } };
  }

  toSnapshot(): ReservationSnapshot {
    return Object.assign(
      { status: this.#status },
      this.#id.toSnapshot(),
      this.#memberId.toSnapshot(),
      this.#roomId.toSnapshot(),
      this.#slot.toSnapshot(),
    );
  }
}

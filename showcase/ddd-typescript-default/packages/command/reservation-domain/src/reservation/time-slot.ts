import type { Result } from "@acme/language-extensions";

export type CreateTimeSlotError = "invalid-time-slot";
export type CreateTimeSlotResult = Result<TimeSlot, CreateTimeSlotError>;

export class TimeSlot {
  readonly #startsAt: number;
  readonly #endsAt: number;

  private constructor(startsAt: number, endsAt: number) {
    this.#startsAt = startsAt;
    this.#endsAt = endsAt;
  }

  static create(startsAt: Date, endsAt: Date): Result<TimeSlot, CreateTimeSlotError> {
    const start: number = startsAt.getTime();
    const end: number = endsAt.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { ok: false, error: "invalid-time-slot" };
    }
    return { ok: true, value: new TimeSlot(start, end) };
  }

  startsAt(): number {
    return this.#startsAt;
  }

  endsAt(): number {
    return this.#endsAt;
  }

  toSnapshot(): { readonly startsAt: number; readonly endsAt: number } {
    return { startsAt: this.#startsAt, endsAt: this.#endsAt };
  }
}

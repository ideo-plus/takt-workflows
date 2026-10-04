import type { Result } from "@acme/language-extensions";

export type ParseReservationIdError = "invalid-id";

export class ReservationId {
  readonly #value: number;

  private constructor(value: number) {
    this.#value = value;
  }

  static of(value: number): ReservationId {
    const result = ReservationId.parse(value);
    if (!result.ok) throw new Error("ReservationId is outside its domain");
    return result.value;
  }

  static parse(value: number): Result<ReservationId, ParseReservationIdError> {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return { ok: false, error: "invalid-id" };
    }
    return { ok: true, value: new ReservationId(value) };
  }

  equals(other: ReservationId): boolean {
    return this.#value === other.#value;
  }

  value(): number {
    return this.#value;
  }
}

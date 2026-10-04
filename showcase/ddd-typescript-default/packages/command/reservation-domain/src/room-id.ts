import type { Result } from "@acme/language-extensions";

export type ParseRoomIdError = "invalid-id";

export class RoomId {
  readonly #value: number;

  private constructor(value: number) {
    this.#value = value;
  }

  static of(value: unknown): RoomId {
    const result = RoomId.parse(value);
    if (!result.ok) throw new Error("RoomId is outside its domain");
    return result.value;
  }

  static parse(value: unknown): Result<RoomId, ParseRoomIdError> {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return { ok: false, error: "invalid-id" };
    }
    return { ok: true, value: new RoomId(value) };
  }

  equals(other: RoomId): boolean {
    return this.#value === other.#value;
  }

  value(): number {
    return this.#value;
  }
}

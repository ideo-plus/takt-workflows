import type { Result } from "@acme/language-extensions";

export type ParseMemberIdError = "invalid-id";

export class MemberId {
  readonly #value: number;

  private constructor(value: number) {
    this.#value = value;
  }

  static of(value: number): MemberId {
    const result = MemberId.parse(value);
    if (!result.ok) throw new Error("MemberId is outside its domain");
    return result.value;
  }

  static parse(value: number): Result<MemberId, ParseMemberIdError> {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return { ok: false, error: "invalid-id" };
    }
    return { ok: true, value: new MemberId(value) };
  }

  equals(other: MemberId): boolean {
    return this.#value === other.#value;
  }

  value(): number {
    return this.#value;
  }
}

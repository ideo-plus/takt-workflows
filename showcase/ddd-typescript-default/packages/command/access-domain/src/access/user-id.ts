import type { Result } from "@acme/language-extensions";

export type ParseUserIdError = "invalid-id";

export class UserId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static of(value: string): UserId {
    const result = UserId.parse(value);
    if (!result.ok) throw new Error("UserId requires a string");
    return result.value;
  }

  static parse(value: string): Result<UserId, ParseUserIdError> {
    if (typeof value !== "string") return { ok: false, error: "invalid-id" };
    return { ok: true, value: new UserId(value) };
  }

  equals(other: UserId): boolean {
    return this.#value === other.#value;
  }

  value(): string {
    return this.#value;
  }
}

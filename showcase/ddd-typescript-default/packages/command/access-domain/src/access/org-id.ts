import type { Result } from "@acme/language-extensions";

export type ParseOrgIdError = "invalid-id";

export class OrgId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static of(value: string): OrgId {
    const result = OrgId.parse(value);
    if (!result.ok) throw new Error("OrgId requires a string");
    return result.value;
  }

  static parse(value: string): Result<OrgId, ParseOrgIdError> {
    if (typeof value !== "string") return { ok: false, error: "invalid-id" };
    return { ok: true, value: new OrgId(value) };
  }

  equals(other: OrgId): boolean {
    return this.#value === other.#value;
  }

  value(): string {
    return this.#value;
  }
}

export class ReservationId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static of(value: string): ReservationId {
    return new ReservationId(value);
  }

  toString(): string {
    return this.#value;
  }

  toSnapshot(): { readonly id: string } {
    return { id: this.#value };
  }
}

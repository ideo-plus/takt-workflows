export class MemberId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static of(value: string): MemberId {
    return new MemberId(value);
  }

  toSnapshot(): { readonly memberId: string } {
    return { memberId: this.#value };
  }
}

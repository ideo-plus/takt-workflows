export class RoomId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static of(value: string): RoomId {
    return new RoomId(value);
  }

  toSnapshot(): { readonly roomId: string } {
    return { roomId: this.#value };
  }
}

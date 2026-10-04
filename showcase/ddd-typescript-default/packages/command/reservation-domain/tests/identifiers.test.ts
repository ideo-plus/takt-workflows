import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MemberId,
  ReservationId,
  RoomId,
} from "@acme/reservation-domain";

type ParseIdentifierResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: "invalid-id" };

type ComparableIdentifier<T> = {
  equals(other: T): boolean;
  value(): number;
};

type IdentifierFactory<T extends ComparableIdentifier<T>> = {
  of(value: unknown): T;
  parse(value: unknown): ParseIdentifierResult<T>;
};

function verifyIdentifierContract<T extends ComparableIdentifier<T>>(
  name: string,
  factory: IdentifierFactory<T>,
): void {
  test(`${name}.parseは1以上の整数を受け入れる`, () => {
    for (const value of [1, 2]) {
      const parsed = factory.parse(value);

      assert.equal(parsed.ok, true);
      if (parsed.ok) {
        assert.equal(parsed.value.equals(factory.of(value)), true);
        assert.equal(parsed.value.value(), value);
        assert.equal(parsed.value.equals(factory.of(value + 1)), false);
      }
    }
  });

  test(`${name}.parseは正の整数でない入力を拒否する`, () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      assert.deepEqual(factory.parse(value), {
        ok: false,
        error: "invalid-id",
      });
    }
  });

  test(`${name}.ofは正の整数でない値を例外で拒否する`, () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      assert.throws(() => factory.of(value));
    }
  });
}

verifyIdentifierContract("ReservationId", ReservationId);
verifyIdentifierContract("MemberId", MemberId);
verifyIdentifierContract("RoomId", RoomId);

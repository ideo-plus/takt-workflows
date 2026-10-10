import assert from "node:assert/strict";
import { test } from "node:test";
import { Organization, User } from "@acme/access-domain";

function changesOnReread<T extends object>(event: T, property: keyof T): T {
  const copy = { ...event };
  let read = false;
  Object.defineProperty(copy, property, {
    enumerable: true,
    get() {
      if (read) throw new Error("入力値を再読込しました");
      read = true;
      return event[property];
    },
  });
  return copy;
}

test("利用組織の履歴を一度取得した値で検証し復元する", () => {
  const expected = { kind: "created" as const, organizationId: "", sequenceNumber: 1, active: true };
  for (const property of Object.keys(expected) as (keyof typeof expected)[]) {
    const restored = Organization.replay([changesOnReread(expected, property)]);
    assert.deepEqual(restored.createdEvent(), expected);
    assert.equal(restored.isActive(), true);
    assert.equal(restored.isIdentifiedBy(""), true);
  }
});

test("利用者の履歴を一度取得した値で検証し復元する", () => {
  const expected = { kind: "created" as const, userId: "", organizationId: "", sequenceNumber: 1, available: true };
  for (const property of Object.keys(expected) as (keyof typeof expected)[]) {
    const restored = User.replay([changesOnReread(expected, property)]);
    assert.deepEqual(restored.createdEvent(), expected);
    assert.equal(restored.isAvailable(), true);
  }
});

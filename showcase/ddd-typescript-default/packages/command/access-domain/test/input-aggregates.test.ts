import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Organization, User } from "@acme/access-domain";

function createOrganization(id: string, active: boolean): Organization {
  const created = Organization.create(id, active);
  if (!created.ok) {
    throw new Error(`利用組織のテスト入力を構築できませんでした: ${created.error}`);
  }
  return created.value;
}

function createUser(
  id: string,
  organizationId: string,
  available: boolean,
): User {
  const created = User.create(id, organizationId, available);
  if (!created.ok) {
    throw new Error(`利用者のテスト入力を構築できませんでした: ${created.error}`);
  }
  return created.value;
}

describe("取得済みの利用組織と利用者", () => {
  test("空文字を含む基本型の現在入力から完全な集約を構築できる", () => {
    const organization = createOrganization("", false);
    const user = createUser("", "", false);

    assert.deepStrictEqual(
      {
        organizationActive: organization.isActive(),
        organizationIdentityMatches: organization.isIdentifiedBy(""),
        userAvailable: user.isAvailable(),
        userBelongsToOrganization: user.belongsTo(organization),
        organizationCreatedEvent: organization.createdEvent(),
        userCreatedEvent: user.createdEvent(),
      },
      {
        organizationActive: false,
        organizationIdentityMatches: true,
        userAvailable: false,
        userBelongsToOrganization: true,
        organizationCreatedEvent: {
          kind: "created",
          organizationId: "",
          sequenceNumber: 1,
          active: false,
        },
        userCreatedEvent: {
          kind: "created",
          userId: "",
          sequenceNumber: 1,
          organizationId: "",
          available: false,
        },
      },
    );
  });

  test("利用組織の基本型に合わない入力を業務上の失敗として返す", () => {
    const invalidId = Organization.create(
      // @ts-expect-error 実行時境界で文字列以外の識別子を拒否することを確認する。
      42,
      true,
    );
    const invalidActive = Organization.create(
      "organization-a",
      // @ts-expect-error 実行時境界で真偽値以外の状態を拒否することを確認する。
      "active",
    );

    assert.deepStrictEqual(
      [invalidId, invalidActive],
      [
        { ok: false, error: "invalid-input" },
        { ok: false, error: "invalid-input" },
      ],
    );
  });

  test("利用者の基本型に合わない入力を業務上の失敗として返す", () => {
    const invalidId = User.create(
      // @ts-expect-error 実行時境界で文字列以外の識別子を拒否することを確認する。
      42,
      "organization-a",
      true,
    );
    const invalidOrganizationId = User.create(
      "user-a",
      // @ts-expect-error 実行時境界で文字列以外の所属組織識別子を拒否することを確認する。
      42,
      true,
    );
    const invalidAvailable = User.create(
      "user-a",
      "organization-a",
      // @ts-expect-error 実行時境界で真偽値以外の状態を拒否することを確認する。
      "available",
    );

    assert.deepStrictEqual(
      [invalidId, invalidOrganizationId, invalidAvailable],
      [
        { ok: false, error: "invalid-input" },
        { ok: false, error: "invalid-input" },
        { ok: false, error: "invalid-input" },
      ],
    );
  });

  test("同じ識別子を持つ別の利用組織インスタンスにも所属すると判断する", () => {
    const originalOrganization = createOrganization("organization-a", true);
    const sameOrganization = createOrganization("organization-a", false);
    const otherOrganization = createOrganization("organization-b", true);
    const user = createUser("user-a", "organization-a", true);

    assert.deepStrictEqual(
      {
        belongsToOriginal: user.belongsTo(originalOrganization),
        belongsToSameIdentity: user.belongsTo(sameOrganization),
        belongsToOtherIdentity: user.belongsTo(otherOrganization),
        inactiveIdentityMatches: sameOrganization.isIdentifiedBy("organization-a"),
      },
      {
        belongsToOriginal: true,
        belongsToSameIdentity: true,
        belongsToOtherIdentity: false,
        inactiveIdentityMatches: true,
      },
    );
  });

  test("利用組織を生成イベントから復元して同じ判断を行える", () => {
    const original = createOrganization("organization-a", false);
    const createdEvent = structuredClone(original.createdEvent());

    const restored = Organization.replay([createdEvent]);

    assert.deepStrictEqual(
      {
        active: restored.isActive(),
        identityMatches: restored.isIdentifiedBy("organization-a"),
        createdEvent: restored.createdEvent(),
      },
      {
        active: false,
        identityMatches: true,
        createdEvent,
      },
    );
  });

  test("利用者を生成イベントから復元して同じ判断を行える", () => {
    const organization = createOrganization("organization-a", true);
    const original = createUser("user-a", "organization-a", false);
    const createdEvent = structuredClone(original.createdEvent());

    const restored = User.replay([createdEvent]);

    assert.deepStrictEqual(
      {
        available: restored.isAvailable(),
        belongsToOrganization: restored.belongsTo(organization),
        createdEvent: restored.createdEvent(),
      },
      {
        available: false,
        belongsToOrganization: true,
        createdEvent,
      },
    );
  });

  test("利用組織の欠落・重複・不正な生成履歴を復元しない", () => {
    const event = createOrganization("organization-a", true).createdEvent();

    assert.throws(() => Organization.replay([]));
    assert.throws(() => Organization.replay([event, event]));
    assert.throws(() => Organization.replay([{ ...event, sequenceNumber: 2 }]));
    assert.throws(() => Organization.replay([{
      ...event,
      // @ts-expect-error 履歴境界で基本型に合わない状態を拒否する。
      active: "active",
    }]));
  });

  test("利用者の欠落・重複・不正な生成履歴を復元しない", () => {
    const event = createUser("user-a", "organization-a", true).createdEvent();

    assert.throws(() => User.replay([]));
    assert.throws(() => User.replay([event, event]));
    assert.throws(() => User.replay([{ ...event, sequenceNumber: 0 }]));
    assert.throws(() => User.replay([{
      ...event,
      // @ts-expect-error 履歴境界で基本型に合わない所属識別子を拒否する。
      organizationId: 42,
    }]));
  });

  test("復元元と公開されたイベントの変更が利用組織へ波及しない", () => {
    const event = structuredClone(createOrganization("organization-a", true).createdEvent());
    const expected = structuredClone(event);
    const restored = Organization.replay([event]);

    Reflect.set(event, "organizationId", "organization-b");
    Reflect.set(event, "active", false);
    Reflect.set(restored.createdEvent(), "active", false);

    assert.equal(restored.isActive(), true);
    assert.equal(restored.isIdentifiedBy("organization-a"), true);
    assert.deepStrictEqual(restored.createdEvent(), expected);
  });

  test("復元元と公開されたイベントの変更が利用者へ波及しない", () => {
    const organization = createOrganization("organization-a", true);
    const event = structuredClone(createUser("user-a", "organization-a", true).createdEvent());
    const expected = structuredClone(event);
    const restored = User.replay([event]);

    Reflect.set(event, "organizationId", "organization-b");
    Reflect.set(event, "available", false);
    Reflect.set(restored.createdEvent(), "available", false);

    assert.equal(restored.isAvailable(), true);
    assert.equal(restored.belongsTo(organization), true);
    assert.deepStrictEqual(restored.createdEvent(), expected);
  });
});

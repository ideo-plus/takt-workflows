import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AccessEligibility,
  Organization,
  User,
} from "@acme/access-domain";

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

function observeInputs(organization: Organization, user: User) {
  const sameOrganization = createOrganization("organization-a", true);
  const otherOrganization = createOrganization("organization-b", true);

  return {
    organizationActive: organization.isActive(),
    organizationMatchesSameIdentity:
      organization.isIdentifiedBy("organization-a"),
    organizationMatchesOtherIdentity:
      organization.isIdentifiedBy("organization-b"),
    userAvailable: user.isAvailable(),
    userBelongsToSameIdentity: user.belongsTo(sameOrganization),
    userBelongsToOtherIdentity: user.belongsTo(otherOrganization),
    organizationCreatedEvent: structuredClone(organization.createdEvent()),
    userCreatedEvent: structuredClone(user.createdEvent()),
  };
}

const eligibilityExamples = [
  {
    name: "有効な組織に所属する利用可能な利用者を許可する",
    organizationActive: true,
    membershipMatches: true,
    userAvailable: true,
    expected: { ok: true, value: true },
  },
  {
    name: "利用者だけが利用不可なら利用不可を理由に拒否する",
    organizationActive: true,
    membershipMatches: true,
    userAvailable: false,
    expected: { ok: false, error: "user-unavailable" },
  },
  {
    name: "所属先だけが違えば所属相違を理由に拒否する",
    organizationActive: true,
    membershipMatches: false,
    userAvailable: true,
    expected: { ok: false, error: "organization-mismatch" },
  },
  {
    name: "所属相違と利用不可が同時に成立すれば所属相違を理由に拒否する",
    organizationActive: true,
    membershipMatches: false,
    userAvailable: false,
    expected: { ok: false, error: "organization-mismatch" },
  },
  {
    name: "組織だけが無効なら組織無効を理由に拒否する",
    organizationActive: false,
    membershipMatches: true,
    userAvailable: true,
    expected: { ok: false, error: "organization-inactive" },
  },
  {
    name: "組織無効と利用不可が同時に成立すれば組織無効を理由に拒否する",
    organizationActive: false,
    membershipMatches: true,
    userAvailable: false,
    expected: { ok: false, error: "organization-inactive" },
  },
  {
    name: "組織無効と所属相違が同時に成立すれば組織無効を理由に拒否する",
    organizationActive: false,
    membershipMatches: false,
    userAvailable: true,
    expected: { ok: false, error: "organization-inactive" },
  },
  {
    name: "三つの拒否条件が同時に成立すれば組織無効を理由に拒否する",
    organizationActive: false,
    membershipMatches: false,
    userAvailable: false,
    expected: { ok: false, error: "organization-inactive" },
  },
];

describe("利用資格判定", () => {
  for (const example of eligibilityExamples) {
    test(example.name, () => {
      const organization = createOrganization(
        "organization-a",
        example.organizationActive,
      );
      const organizationId = example.membershipMatches
        ? "organization-a"
        : "organization-b";
      const user = createUser("user-a", organizationId, example.userAvailable);
      const accessEligibility = AccessEligibility.create();

      const result = accessEligibility.assess(organization, user);

      assert.deepStrictEqual(result, example.expected);
    });
  }

  test("判定の前後で利用組織と利用者の状態および生成イベント情報を変えない", () => {
    const organization = createOrganization("organization-a", true);
    const user = createUser("user-a", "organization-a", true);
    const accessEligibility = AccessEligibility.create();
    const before = observeInputs(organization, user);

    accessEligibility.assess(organization, user);

    assert.deepStrictEqual(observeInputs(organization, user), before);
  });

  test("別の利用者を拒否した後も同じ許可入力の結果を維持する", () => {
    const organization = createOrganization("organization-a", true);
    const allowedUser = createUser("user-allowed", "organization-a", true);
    const unrelatedUser = createUser("user-other", "organization-b", false);
    const accessEligibility = AccessEligibility.create();

    const before = accessEligibility.assess(organization, allowedUser);
    const unrelated = accessEligibility.assess(organization, unrelatedUser);
    const after = accessEligibility.assess(organization, allowedUser);

    assert.deepStrictEqual(
      [before, unrelated, after],
      [
        { ok: true, value: true },
        { ok: false, error: "organization-mismatch" },
        { ok: true, value: true },
      ],
    );
  });

  test("別の利用者を許可した後も同じ拒否入力の結果を維持する", () => {
    const organization = createOrganization("organization-a", true);
    const deniedUser = createUser("user-denied", "organization-b", false);
    const unrelatedUser = createUser("user-allowed", "organization-a", true);
    const accessEligibility = AccessEligibility.create();

    const before = accessEligibility.assess(organization, deniedUser);
    const unrelated = accessEligibility.assess(organization, unrelatedUser);
    const after = accessEligibility.assess(organization, deniedUser);

    assert.deepStrictEqual(
      [before, unrelated, after],
      [
        { ok: false, error: "organization-mismatch" },
        { ok: true, value: true },
        { ok: false, error: "organization-mismatch" },
      ],
    );
  });
});

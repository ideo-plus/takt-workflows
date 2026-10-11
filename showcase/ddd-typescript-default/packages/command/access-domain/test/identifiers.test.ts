import assert from "node:assert/strict";
import { test } from "node:test";
import { UserId, OrgId, User, Organization } from "@acme/access-domain";

for (const [name, identifier] of [["UserId", UserId], ["OrgId", OrgId]] as const) {
  test(`${name}は空文字と文字列値を保ち、同じ値の別インスタンスを等しいと判断する`, () => {
    for (const value of ["", "same", "利用者😀", " user ", "  ", "User", "e\u0301"]) {
      const first = identifier.of(value);
      const second = identifier.parse(value);
      assert.equal(first.value(), value);
      if (!second.ok) assert.fail("文字列が拒否された");
      assert.equal(second.value.value(), value);
      if (first instanceof UserId && second.value instanceof UserId) {
        assert.equal(first.equals(second.value), true);
        assert.equal(first.equals(UserId.of("different")), false);
      } else if (first instanceof OrgId && second.value instanceof OrgId) {
        assert.equal(first.equals(second.value), true);
        assert.equal(first.equals(OrgId.of("different")), false);
      } else assert.fail("識別子の用途が変わった");
    }
  });

  test(`${name}は文字列以外を拒否し、ofも検証を迂回しない`, () => {
    for (const value of [undefined, null, 42, false, {}]) {
      // @ts-expect-error JavaScriptからの型不正な入力を確認する。
      assert.deepEqual(identifier.parse(value), { ok: false, error: "invalid-id" });
      // @ts-expect-error JavaScriptからの型不正な入力を確認する。
      assert.throws(() => identifier.of(value));
    }
  });
}

test("識別子の用途の取り違えを型検査と集約の実行時境界で拒否する", () => {
  // @ts-expect-error 同じ文字列値でも組織識別子を利用者識別子に渡せない。
  const wrongUserId = User.create(OrgId.of("same"), OrgId.of("same"), true);
  // @ts-expect-error 利用者識別子を所属組織識別子に渡せない。
  const wrongOrgId = User.create(UserId.of("same"), UserId.of("same"), true);
  // @ts-expect-error 利用組織も利用者識別子で生成できない。
  const wrongOrganization = Organization.create(UserId.of("same"), true);
  assert.deepEqual([wrongUserId, wrongOrgId, wrongOrganization], [
    { ok: false, error: "invalid-input" },
    { ok: false, error: "invalid-input" },
    { ok: false, error: "invalid-input" },
  ]);
});

test("生成イベントも文字列や異なる用途の識別子で復元できない", () => {
  const created = User.create(UserId.of("user"), OrgId.of("org"), true);
  if (!created.ok) assert.fail("利用者を構築できない");
  const event = created.value.createdEvent();
  assert.equal(event.userId.value(), "user");
  assert.equal(event.organizationId.value(), "org");
  assert.throws(() => User.replay([{
    ...event,
    // @ts-expect-error 組織識別子は利用者識別子として復元できない。
    userId: OrgId.of("user"),
  }]));
  assert.throws(() => User.replay([{
    ...event,
    // @ts-expect-error 生の文字列は組織識別子として復元できない。
    organizationId: "org",
  }]));
});

test("異なる表現の識別子を等価にせず、所属先も一致させない", () => {
  for (const [left, right] of [[" user ", "user"], ["User", "user"], ["e\u0301", "é"]]) {
    assert.equal(UserId.of(left).equals(UserId.of(right)), false);
    assert.equal(OrgId.of(left).equals(OrgId.of(right)), false);
  }
  const organization = Organization.create(OrgId.of(" org "), true);
  const user = User.create(UserId.of("user"), OrgId.of("org"), true);
  if (!organization.ok || !user.ok) assert.fail("許された入力を構築できない");
  assert.equal(user.value.belongsTo(organization.value), false);
  const sameOrganization = Organization.create(OrgId.of("org"), true);
  if (!sameOrganization.ok) assert.fail("利用組織を構築できない");
  assert.equal(user.value.belongsTo(sameOrganization.value), true);
});

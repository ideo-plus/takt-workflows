import type { Result } from "@acme/language-extensions";
import type { Organization } from "./organization.ts";
import type { User } from "./user.ts";

export type AssessAccessEligibilityError =
  | "organization-inactive"
  | "organization-mismatch"
  | "user-unavailable";

export class AccessEligibility {
  private constructor() {}

  static create(): AccessEligibility {
    return new AccessEligibility();
  }

  assess(organization: Organization, user: User): Result<boolean, AssessAccessEligibilityError> {
    if (!organization.isActive()) {
      return { ok: false, error: "organization-inactive" };
    }
    if (!user.belongsTo(organization)) {
      return { ok: false, error: "organization-mismatch" };
    }
    if (!user.isAvailable()) {
      return { ok: false, error: "user-unavailable" };
    }
    return { ok: true, value: true };
  }
}

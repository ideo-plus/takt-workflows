import { OrgId } from "./org-id.ts";
import type { Result } from "@acme/language-extensions";

export type CreateOrganizationError = "invalid-input";

export type OrganizationCreated = {
  readonly kind: "created";
  readonly organizationId: OrgId;
  readonly sequenceNumber: number;
  readonly active: boolean;
};

export class Organization {
  readonly #created: OrganizationCreated;

  private constructor(event: OrganizationCreated) {
    this.#created = Object.freeze({
      kind: event.kind,
      organizationId: event.organizationId,
      sequenceNumber: event.sequenceNumber,
      active: event.active,
    });
  }

  static create(id: OrgId, active: boolean): Result<Organization, CreateOrganizationError> {
    if (!(id instanceof OrgId) || typeof active !== "boolean") {
      return { ok: false, error: "invalid-input" };
    }
    const event: OrganizationCreated = {
      kind: "created",
      organizationId: id,
      sequenceNumber: 1,
      active,
    };
    return { ok: true, value: Organization.fromCreated(event) };
  }

  static replay(events: readonly OrganizationCreated[]): Organization {
    const candidate: OrganizationCreated | undefined = events[0];
    if (events.length !== 1 || candidate === undefined) {
      throw new Error("corrupt organization history");
    }
    const event: OrganizationCreated = {
      kind: candidate.kind,
      organizationId: candidate.organizationId,
      sequenceNumber: candidate.sequenceNumber,
      active: candidate.active,
    };
    if (event.kind !== "created" ||
        event.sequenceNumber !== 1 || !(event.organizationId instanceof OrgId) ||
        typeof event.active !== "boolean") {
      throw new Error("corrupt organization history");
    }
    return Organization.fromCreated(event);
  }

  private static fromCreated(event: OrganizationCreated): Organization {
    return new Organization(event);
  }

  createdEvent(): OrganizationCreated {
    return this.#created;
  }

  isActive(): boolean {
    return this.#created.active === true;
  }

  isIdentifiedBy(organizationId: OrgId): boolean {
    return organizationId.equals(this.#created.organizationId);
  }
}

import type { Result } from "@acme/language-extensions";
import type { Organization } from "./organization.ts";

export type CreateUserError = "invalid-input";

export type UserCreated = {
  readonly kind: "created";
  readonly userId: string;
  readonly sequenceNumber: number;
  readonly organizationId: string;
  readonly available: boolean;
};

export class User {
  readonly #created: UserCreated;

  private constructor(event: UserCreated) {
    this.#created = Object.freeze({
      kind: event.kind,
      userId: event.userId,
      sequenceNumber: event.sequenceNumber,
      organizationId: event.organizationId,
      available: event.available,
    });
  }

  static create(id: string, organizationId: string, available: boolean): Result<User, CreateUserError> {
    if (typeof id !== "string" || typeof organizationId !== "string" || typeof available !== "boolean") {
      return { ok: false, error: "invalid-input" };
    }
    const event: UserCreated = {
      kind: "created",
      userId: id,
      sequenceNumber: 1,
      organizationId,
      available,
    };
    return { ok: true, value: User.fromCreated(event) };
  }

  static replay(events: readonly UserCreated[]): User {
    const candidate: UserCreated | undefined = events[0];
    if (events.length !== 1 || candidate === undefined) {
      throw new Error("corrupt user history");
    }
    const event: UserCreated = {
      kind: candidate.kind,
      userId: candidate.userId,
      sequenceNumber: candidate.sequenceNumber,
      organizationId: candidate.organizationId,
      available: candidate.available,
    };
    if (event.kind !== "created" ||
        event.sequenceNumber !== 1 || typeof event.userId !== "string" ||
        typeof event.organizationId !== "string" || typeof event.available !== "boolean") {
      throw new Error("corrupt user history");
    }
    return User.fromCreated(event);
  }

  private static fromCreated(event: UserCreated): User {
    return new User(event);
  }

  createdEvent(): UserCreated {
    return this.#created;
  }

  isAvailable(): boolean {
    return this.#created.available === true;
  }

  belongsTo(organization: Organization): boolean {
    return organization.isIdentifiedBy(this.#created.organizationId);
  }
}

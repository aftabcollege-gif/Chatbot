import type { UserRole } from "@/db/schema";
import type { CurrentSession } from "@/lib/auth/session";

const ROLE_RANK: Record<UserRole, number> = { member: 0, manager: 1, admin: 2 };

export function hasMinimumRole(session: CurrentSession, minRole: UserRole): boolean {
  const role = session.user.role as UserRole;
  return (ROLE_RANK[role] ?? -1) >= ROLE_RANK[minRole];
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "دسترسی غیرمجاز است.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertRole(session: CurrentSession, minRole: UserRole): void {
  if (!hasMinimumRole(session, minRole)) {
    throw new ForbiddenError();
  }
}

/** Enforces tenant isolation: the resource's organizationId must match the caller's. */
export function assertSameOrganization(session: CurrentSession, resourceOrgId: string): void {
  if (session.user.organizationId !== resourceOrgId) {
    throw new ForbiddenError("این منبع متعلق به سازمان دیگری است.");
  }
}

/**
 * Department scoping: admins/managers see everything in their org; members
 * only see resources with no department (org-wide) or matching their own
 * department.
 */
export function canAccessDepartment(session: CurrentSession, resourceDepartmentId: string | null): boolean {
  if (hasMinimumRole(session, "manager")) return true;
  if (resourceDepartmentId === null) return true;
  return session.user.departmentId === resourceDepartmentId;
}

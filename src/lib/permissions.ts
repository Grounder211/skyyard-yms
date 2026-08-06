// Role-based access policy for staff-facing routes.
// Mirrors the `requireRole(...)` guards enforced server-side in server.ts —
// this is the UI-side mirror so nav items and routes stay in sync with what
// the API will actually allow. Roles: superadmin, ADMIN, GUARD, HOSTLER.
// (DRIVER and carrier accounts use the separate /driver and /carrier portals.)

export type StaffRole = "superadmin" | "ADMIN" | "GUARD" | "HOSTLER" | string;

export const ROUTE_ACCESS: Record<string, StaffRole[]> = {
  "/": ["superadmin", "ADMIN", "GUARD", "HOSTLER"],
  "/gate": ["superadmin", "ADMIN", "GUARD"],
  "/tracking": ["superadmin", "ADMIN", "GUARD", "HOSTLER"],
  "/dispatch": ["superadmin", "ADMIN", "HOSTLER"],
  "/network": ["superadmin", "ADMIN"],
  "/calendar": ["superadmin", "ADMIN", "GUARD"],
  "/finance": ["superadmin", "ADMIN"],
  "/analytics": ["superadmin", "ADMIN"],
  "/reports/builder": ["superadmin", "ADMIN"],
  "/superadmin": ["superadmin"],
  "/settings": ["superadmin", "ADMIN"],
  "/settings/notifications": ["superadmin", "ADMIN"],
  "/settings/dock-rules": ["superadmin", "ADMIN"],
  "/design": ["superadmin", "ADMIN", "GUARD", "HOSTLER"],
};

export function canAccess(role: StaffRole, path: string): boolean {
  const allowed = ROUTE_ACCESS[path];
  if (!allowed) return true; // unlisted routes are open to any signed-in staff member
  return allowed.includes(role);
}

export const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin — full network access",
  ADMIN: "Admin — full access to this facility",
  GUARD: "Guard — gate, check-in, and visitors",
  HOSTLER: "Hostler — yard moves and dispatch",
};

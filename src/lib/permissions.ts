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
  "/pipeline": ["superadmin", "ADMIN", "GUARD", "HOSTLER"],
  "/exceptions": ["superadmin", "ADMIN", "GUARD", "HOSTLER"],
  "/safety": ["superadmin", "ADMIN", "GUARD", "HOSTLER"],
  "/documents": ["superadmin", "ADMIN", "GUARD", "HOSTLER"],
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

// Modules switched off in the UI for now — not deleted. The pages and
// their APIs still exist and still work; they're simply not reachable
// (hidden from the nav, from the command palette, and from direct URLs)
// until they're wanted. Delete an entry here to bring one straight back.
export const HIDDEN_ROUTES = new Set([
  "/dispatch", "/pipeline", "/exceptions", "/documents", "/network", "/finance", "/design",
]);

export function isHidden(path: string): boolean {
  return HIDDEN_ROUTES.has(path);
}

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

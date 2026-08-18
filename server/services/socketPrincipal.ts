// Who a Socket.IO connection counts as. The facility room carries the whole
// internal feed — driver name/phone/licence/personnummer, every carrier's
// appointments, exceptions and incidents — so only staff belong in it.
// `session.user` is written exclusively by the staff login endpoints; the
// carrier and driver portals ride the same session cookie but write
// carrier_id / driver_id instead, and their HTTP endpoints are hard-scoped to
// that id. They get no principal here: no room, no presence, no broadcasts.
export function socketPrincipal(session: any): { id: string; name: string } | null {
  return session?.user ? { id: `staff-${session.user.id}`, name: session.user.name } : null;
}

// Sourced from real yard-manager/carrier research: "where's my trailer" is
// the #1 recurring question carriers/drivers ask by phone or radio. Answers
// it from data this app already has — trailer + spot rows — no GPS needed.
export type TrailerStatusLabel = "NOT_ARRIVED" | "AT_DOCK" | "IN_YARD" | "DEPARTED";

export function deriveTrailerStatus(
  trailer: { status: string; checked_out_at: string | null; spot_name: string | null; spot_type: string | null } | null
): { label: TrailerStatusLabel; detail: string } {
  if (!trailer) return { label: "NOT_ARRIVED", detail: "Not yet checked in" };
  if (trailer.checked_out_at || trailer.status === "DISPATCHED") return { label: "DEPARTED", detail: "Departed the yard" };
  if (trailer.spot_type === "DOCK" && trailer.spot_name) return { label: "AT_DOCK", detail: `At dock ${trailer.spot_name}` };
  if (trailer.spot_name) return { label: "IN_YARD", detail: `Parked at ${trailer.spot_name}` };
  return { label: "IN_YARD", detail: "In the yard" };
}

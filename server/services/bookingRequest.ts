export const CARGO_TYPES = ["Pallets", "Boxes", "Shipping container", "Other"] as const;

export interface BookingRequestInput {
  plate?: string;
  personal_id_number?: string;
  cargo_type?: string;
  cargo_quantity?: string;
  load_type?: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

// Same required-field shape as the gate check-in form (plate, personal ID,
// cargo type) — a carrier submitting a request on a driver's behalf needs
// to answer the same "who and what" questions a driver answers in person.
export function validateBookingRequest(input: BookingRequestInput): ValidationResult {
  if (!input.plate) return { ok: false, error: "Vehicle plate is required" };
  if (!input.personal_id_number) return { ok: false, error: "Personal identity number is required" };
  if (!input.cargo_type) return { ok: false, error: "Cargo type is required" };
  if (!(CARGO_TYPES as readonly string[]).includes(input.cargo_type)) return { ok: false, error: "Invalid cargo type" };
  return { ok: true };
}

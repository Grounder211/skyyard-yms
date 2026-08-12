import { describe, it, expect } from "vitest";
import { validateBookingRequest } from "./bookingRequest";

describe("validateBookingRequest", () => {
  it("accepts a complete request", () => {
    const result = validateBookingRequest({ plate: "ABC123", personal_id_number: "19900101-1234", cargo_type: "Pallets", cargo_quantity: "24", load_type: "standard" });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a missing plate", () => {
    const result = validateBookingRequest({ personal_id_number: "19900101-1234", cargo_type: "Pallets" });
    expect(result).toEqual({ ok: false, error: "Vehicle plate is required" });
  });

  it("rejects a missing personal ID number", () => {
    const result = validateBookingRequest({ plate: "ABC123", cargo_type: "Pallets" });
    expect(result).toEqual({ ok: false, error: "Personal identity number is required" });
  });

  it("rejects a missing cargo type", () => {
    const result = validateBookingRequest({ plate: "ABC123", personal_id_number: "19900101-1234" });
    expect(result).toEqual({ ok: false, error: "Cargo type is required" });
  });

  it("rejects a cargo type outside the fixed list", () => {
    const result = validateBookingRequest({ plate: "ABC123", personal_id_number: "19900101-1234", cargo_type: "Freeform text" });
    expect(result).toEqual({ ok: false, error: "Invalid cargo type" });
  });
});

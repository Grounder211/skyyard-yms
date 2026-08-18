import { describe, it, expect } from "vitest";
import { socketPrincipal } from "./socketPrincipal.js";

describe("socketPrincipal", () => {
  it("identifies a staff session", () => {
    expect(socketPrincipal({ user: { id: 7, name: "Anna" }, facility_id: 2 })).toEqual({ id: "staff-7", name: "Anna" });
  });

  it("gives carrier and driver portal sessions no principal", () => {
    expect(socketPrincipal({ carrier_id: 3, carrier_name: "Nordic Haul" })).toBeNull();
    expect(socketPrincipal({ driver_id: 12 })).toBeNull();
  });

  it("gives unauthenticated sockets no principal", () => {
    expect(socketPrincipal(undefined)).toBeNull();
    expect(socketPrincipal({})).toBeNull();
    expect(socketPrincipal({ pending_2fa_user_id: 7 })).toBeNull();
  });
});

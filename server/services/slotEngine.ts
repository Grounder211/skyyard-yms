import { db } from "../supabaseClient.js";

interface SlotScore { score: number; recommended: boolean; reason: string }

export async function scoreSlot(slot: any, params: {
  equipmentType: string; carrierId?: string; facilityId: number; date: string;
}): Promise<SlotScore> {
  let score = 0; const reasons: string[] = [];

  // FACTOR 1: Equipment match (40 pts)
  const { data: rules } = await db.from("dock_rules").select("allowed_equipment_types").eq("dock_door_id", slot.dock_id).maybeSingle();
  const allowed: string[] = rules?.allowed_equipment_types || ["standard"];

  if (allowed[0] === params.equipmentType) {
    score += 40; reasons.push("Perfect dock match");
  } else if (allowed.includes(params.equipmentType)) {
    score += 25; reasons.push("Compatible dock");
  } else {
    return { score: 0, recommended: false, reason: "Incompatible dock" };
  }

  // FACTOR 2: Queue depth (30 pts)
  const { count: queueDepth } = await db
    .from("appointments")
    .select("*", { count: "exact", head: true })
    .eq("dock_id", slot.dock_id)
    .eq("facility_id", params.facilityId)
    .gte("start_time", `${params.date}T00:00:00`)
    .lte("start_time", `${params.date}T23:59:59`)
    .in("status", ["SCHEDULED", "CHECKED_IN"]);

  const qBonus = Math.max(0, 30 - (queueDepth || 0) * 6);
  score += qBonus;
  if (!queueDepth) reasons.push("Empty queue");

  // FACTOR 3: Carrier speed history (20 pts)
  if (params.carrierId) {
    const { data: history } = await db
      .from("appointments")
      .select("actual_duration_minutes")
      .eq("carrier_id", params.carrierId)
      .eq("status", "COMPLETED")
      .not("actual_duration_minutes", "is", null)
      .limit(20);

    if (history && history.length > 0) {
      const carrierAvg = history.reduce((s, r: any) => s + r.actual_duration_minutes, 0) / history.length;
      const allAvg = 120; // facility-wide baseline; could be computed from a rolling aggregate later
      if (carrierAvg < allAvg) {
        score += 20; reasons.push("Fast carrier");
      } else {
        score += 10;
      }
    }
  }

  // FACTOR 4: Time preference (10 pts)
  const hour = parseInt(slot.start_time.split(":")[0]);
  if (hour >= 6 && hour <= 10) {
    score += 10; reasons.push("Morning slot");
  } else if (hour >= 11 && hour <= 14) {
    score += 5;
  }

  return { score, recommended: false, reason: reasons.join(" · ") };
}

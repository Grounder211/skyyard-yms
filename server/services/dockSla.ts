// Stage-level SLA — distinct from whole-visit detention (detention_records):
// this flags a trailer stuck at the dock (LOADING/UNLOADING) too long, which
// detention (measured from full check-in) can miss for hours.
const DOCK_STAGES = ["LOADING", "UNLOADING"];

export function isDockSlaBreached(stage: string, stageEnteredAtIso: string, slaMinutes: number, nowIso: string = new Date().toISOString()): boolean {
  if (!DOCK_STAGES.includes(stage)) return false;
  const minutesInStage = (new Date(nowIso).getTime() - new Date(stageEnteredAtIso).getTime()) / 60000;
  return minutesInStage >= slaMinutes;
}

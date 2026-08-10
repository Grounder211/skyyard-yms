export interface DetentionRiskTrailer {
  plate: string;
  checkedInAtIso: string;
}

export interface DetentionRiskRules {
  thresholdMinutes: number;
  ratePerHour: number;
}

export interface DetentionRiskResult {
  plate: string;
  dwellMinutes: number;
  minutesUntilThreshold: number;
  atRisk: boolean;
  projectedHourlyCost: number;
  reason: string;
}

// Priority 14: Operational Cost Connection — the detention cron only acts
// once a trailer has already crossed the free-time threshold. This looks
// the other direction: trailers still IN_YARD, not yet in detention,
// approaching that threshold within the warning window, with the real
// facility rate projected forward one hour. No invented multiplier, no
// "expected benefit" language beyond what the real rate actually is.
export function assessDetentionRisk(
  trailer: DetentionRiskTrailer,
  rules: DetentionRiskRules,
  nowIso: string,
  warningWindowMinutes = 60
): DetentionRiskResult {
  const now = new Date(nowIso).getTime();
  const checkedIn = new Date(trailer.checkedInAtIso).getTime();
  const dwellMinutes = Math.round((now - checkedIn) / 60000);
  const minutesUntilThreshold = rules.thresholdMinutes - dwellMinutes;
  const atRisk = minutesUntilThreshold > 0 && minutesUntilThreshold <= warningWindowMinutes;
  const projectedHourlyCost = Math.round(rules.ratePerHour * 100) / 100;

  return {
    plate: trailer.plate,
    dwellMinutes,
    minutesUntilThreshold,
    atRisk,
    projectedHourlyCost,
    reason: atRisk
      ? `Crosses the ${Math.round(rules.thresholdMinutes / 60)}h detention-free threshold in ${minutesUntilThreshold} minutes — every additional hour after that costs $${projectedHourlyCost.toFixed(2)}`
      : "Not approaching the detention-free threshold",
  };
}

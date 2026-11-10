export const feedbackFields = [
  'TotalDPS', 'CombinedDPS', 'FullDPS', 'TotalEHP',
  'PhysicalMaximumHitTaken', 'FireMaximumHitTaken', 'ColdMaximumHitTaken',
  'LightningMaximumHitTaken', 'ChaosMaximumHitTaken',
  'Life', 'EnergyShield', 'ManaUnreserved', 'ManaRegen', 'ManaPerSecondCost',
];

/** Differences describe two PoB results; they do not model any game mechanic. */
export function statChanges(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  return Object.fromEntries(feedbackFields.map(field => {
    const from = before?.[field];
    const to = after[field];
    const comparable = typeof from === 'number' && Number.isFinite(from) &&
      typeof to === 'number' && Number.isFinite(to);
    return [field, {
      before: from ?? null, after: to ?? null,
      delta: comparable ? to - from : null,
      percent: comparable && from !== 0 ? (to - from) / Math.abs(from) * 100 : null,
    }];
  }));
}

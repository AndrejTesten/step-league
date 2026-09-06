// Fun, approximate distance equivalences for the home screen — flavor text,
// not a fitness claim. Average stride length (0.762m) converts steps to a
// rough walking distance.
const METERS_PER_STEP = 0.762;

const UNITS: { meters: number; label: (n: number) => string }[] = [
  { meters: 105, label: (n) => `${n} football pitch${n === 1 ? '' : 'es'}` },
  { meters: 80, label: (n) => `${n} city block${n === 1 ? '' : 's'}` },
  { meters: 2737, label: (n) => `${n} Golden Gate Bridge${n === 1 ? '' : 's'}` },
  { meters: 42_195, label: (n) => `${n} marathon${n === 1 ? '' : 's'}` },
];

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

/** Rotates daily so it stays stable all day but changes tomorrow. */
export function getFunEquivalence(steps: number, now: Date = new Date()): string | null {
  if (steps <= 0) return null;
  const distanceMeters = steps * METERS_PER_STEP;

  // Pick the biggest unit that still rounds to at least 1, cycling daily
  // through whichever units currently qualify so it doesn't always land on
  // the same one.
  const qualifying = UNITS.filter((u) => distanceMeters / u.meters >= 1);
  if (qualifying.length === 0) return null;
  const unit = qualifying[dayOfYear(now) % qualifying.length];
  const count = Math.round(distanceMeters / unit.meters);
  return `That's about ${unit.label(count)}.`;
}

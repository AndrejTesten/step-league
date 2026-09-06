const ROAST_LINES = [
  'Even your phone’s pedometer feels bad for you.',
  'Last place. The couch sends its regards.',
  'At this pace, a snail owes you an apology for showing up.',
  'Your shoes are starting to wonder if they still have a job.',
  'Somewhere, a step counted today. It just wasn’t here.',
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic per (league, day) so the line doesn't flicker on re-render. */
export function getRoastLine(seed: string): string {
  return ROAST_LINES[hashSeed(seed) % ROAST_LINES.length];
}

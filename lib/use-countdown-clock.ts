import { useEffect, useState } from 'react';

import { formatCountdownClock } from './timezone';

/**
 * "3:41:08" ticking every second, counting down to `targetIso` — a league's
 * next_reset_at, or the soonest one across several leagues. Plain timestamp
 * arithmetic, no timezone math: each league's reset is the same absolute
 * instant for every member regardless of where they are, so there's nothing
 * to convert.
 */
export function useCountdownClock(targetIso: string | null | undefined): string {
  const target = targetIso ? new Date(targetIso).getTime() : null;
  const [ms, setMs] = useState(() => (target ? target - Date.now() : 0));

  useEffect(() => {
    if (!target) return;
    setMs(target - Date.now());
    const interval = setInterval(() => setMs(target - Date.now()), 1000);
    return () => clearInterval(interval);
  }, [target]);

  return formatCountdownClock(ms);
}

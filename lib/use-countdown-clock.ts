import { useEffect, useState } from 'react';

import { formatCountdownClock, msUntilNextRollup } from './timezone';

/** "3:41:08" ticking every second — the design's hero countdown-to-22:00 clock. */
export function useCountdownClock(timezone: string | undefined): string {
  const [ms, setMs] = useState(() => (timezone ? msUntilNextRollup(timezone) : 0));

  useEffect(() => {
    if (!timezone) return;
    setMs(msUntilNextRollup(timezone));
    const interval = setInterval(() => setMs(msUntilNextRollup(timezone)), 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  return formatCountdownClock(ms);
}

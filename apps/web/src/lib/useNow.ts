import { useEffect, useState } from 'react';

/**
 * A ticking wall-clock value, safe to read during render.
 *
 * Reading `Date.now()` directly in a component body is impure: the value only
 * refreshes when the parent happens to re-render, so an "SLA countdown" or
 * "elapsed time" display silently freezes. This hook makes the clock an
 * explicit subscription, so anything derived from it updates on a real cadence.
 *
 * @param intervalMs how often to re-read the clock. Default 30s — enough for
 *                   minute-resolution countdowns without needless renders.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

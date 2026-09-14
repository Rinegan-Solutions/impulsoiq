import { useEffect, useState } from 'react';
import { tenantApi, type Tenant } from '@/api/client';

// Every app page mounts its own AppShell, so without a cache each navigation
// would re-read the same row. Keyed by tenant id, so a different account signing
// in within the same tab never sees the previous workspace's record.
const cache = new Map<string, Promise<Tenant | null>>();
const listeners = new Set<() => void>();

export function invalidateTenantCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
  listeners.forEach((fn) => fn());
}

/** The signed-in workspace's tenant row, or null while loading / if unavailable. */
export function useTenant(tenantId: string | undefined): Tenant | null {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    listeners.add(bump);
    return () => { listeners.delete(bump); };
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    let pending = cache.get(tenantId);
    if (!pending) {
      // A failed read is not cached: the next mount retries.
      pending = tenantApi.get().catch(() => {
        cache.delete(tenantId);
        return null;
      });
      cache.set(tenantId, pending);
    }
    pending.then((t) => { if (!cancelled) setTenant(t); });

    return () => { cancelled = true; };
  }, [tenantId, tick]);

  return tenant;
}

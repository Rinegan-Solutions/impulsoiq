import type { Tenant } from '@/api/client';

const PAID = new Set(['starter', 'growth', 'enterprise']);

export function isPayingCsDesignPartner(tenant: Tenant | null | undefined): boolean {
  if (!tenant) return false;
  const paid = PAID.has(tenant.tier.toLowerCase());
  const expansion = tenant.config?.expansion;
  if (!expansion || typeof expansion !== 'object' || Array.isArray(expansion)) return false;
  return paid && (expansion as { csDesignPartner?: unknown }).csDesignPartner === true;
}

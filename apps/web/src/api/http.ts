/**
 * Transport for the ImpulsoIQ API.
 *
 * WHAT CHANGED AND WHY
 * The app previously had two clients: this one's predecessor posted to a
 * hardcoded `/api` with no Authorization header (only MSW ever answered it),
 * while a second, authenticated client in lib/api/ was imported by nothing.
 * In production `/api/...` hit CloudFront, missed S3, and the SPA 404->200
 * rewrite returned index.html — which then failed Zod parsing. One client now,
 * pointed at the real API Gateway stage, always carrying the Cognito token.
 *
 * THE OPERATION ENVELOPE
 * crm-read and crm-write-service dispatch on an `operation` field in the body,
 * not on path or method — CLAUDE.md makes the single CRM Write Service a hard
 * rule, and the agents invoke those same Lambdas directly with the same
 * {operation, payload} shape. So this speaks that protocol rather than
 * inventing REST resources that would be a second, divergent contract.
 *
 * CASE CONVERSION
 * DSQL returns snake_case columns; the UI types are camelCase. Converting in
 * one place here keeps every caller and schema in a single convention.
 */
import { z } from 'zod';
import { getCurrentToken } from '@/lib/auth/cognito';
import { currentTenantSlug } from '@/lib/tenant';

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Recursively snake_case -> camelCase on object keys. Arrays map elementwise. */
export function camelize<T>(input: unknown): T {
  if (Array.isArray(input)) return input.map((v) => camelize(v)) as T;
  if (input === null || typeof input !== 'object') return input as T;
  // Date instances and similar must not be rebuilt as plain objects.
  if (Object.getPrototypeOf(input) !== Object.prototype) return input as T;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[key] = camelize(v);
  }
  return out as T;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getCurrentToken();
  // The workspace this browser is addressing. The API compares it against the
  // token's custom:tenant_id and rejects a mismatch, so a user signed in to one
  // workspace cannot silently be shown their own data under another
  // workspace's URL. Omitted on the apex, where there is no workspace context.
  const tenant = currentTenantSlug();
  return {
    'Content-Type': 'application/json',
    // API Gateway's COGNITO_USER_POOLS authorizer reads the raw ID token from
    // Authorization. It does NOT accept a "Bearer " prefix.
    ...(token ? { Authorization: token } : {}),
    ...(tenant ? { 'x-impulsoiq-tenant': tenant } : {}),
  };
}

async function send(path: string, init: RequestInit): Promise<unknown> {
  if (!BASE) {
    throw new ApiError(
      0,
      'VITE_API_URL is not set. The build injects it from SSM ' +
        '(/impulsoiq/<env>/backend/api_url); locally, MSW answers instead.',
    );
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(await authHeaders()), ...init.headers },
  });

  const text = await res.text();
  if (!res.ok) {
    // Surface the API's own message when there is one — a bare status code
    // makes a tenant-scoping or validation failure impossible to diagnose.
    let detail = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      detail = parsed.error ?? parsed.message ?? detail;
    } catch {
      /* not JSON — use the raw body */
    }
    if (res.status === 504 || /timed out/i.test(detail)) {
      throw new ApiError(
        res.status,
        'That request hit the API time limit. Try again — planning a run should only take a few seconds.',
      );
    }
    throw new ApiError(res.status, detail);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Call a crm-read / crm-write-service operation and validate the result.
 *
 * Both Lambdas answer {ok?, result} or {ok:false, error}. `result` is unwrapped
 * here so callers only ever see their own data shape.
 */
export async function operation<T>(
  endpoint: '/crm-read' | '/crm-write',
  op: string,
  payload: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const raw = (await send(endpoint, {
    method: 'POST',
    body: JSON.stringify({ operation: op, payload }),
  })) as { ok?: boolean; error?: string; result?: unknown } | null;

  if (raw && raw.ok === false) throw new ApiError(500, raw.error ?? `${op} failed`);

  const result = raw && 'result' in raw ? raw.result : raw;
  return schema.parse(camelize(result));
}

/** Plain request for the endpoints that are not operation-dispatched. */
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  return schema.parse(camelize(await send(path, init)));
}

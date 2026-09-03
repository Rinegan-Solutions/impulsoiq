import { z } from 'zod';
import {
  ContactSchema, CampaignSchema, AgentRunSchema, DealSchema,
  DashboardStatsSchema, PaginatedSchema,
  type Contact,
} from './schemas';

const BASE = '/api';

// ─── Typed fetch — validates every response through Zod ─────────────────────

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function fetched<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }
  const json = await res.json();
  // Zod parse validates shape — throws ZodError if API returns unexpected structure
  return schema.parse(json);
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export const contactsApi = {
  list: (page = 1, pageSize = 20, search = '') =>
    fetched(
      PaginatedSchema(ContactSchema),
      `/contacts?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`,
    ),

  get: (id: string) => fetched(ContactSchema, `/contacts/${id}`),

  create: (body: Partial<Contact>) =>
    fetched(ContactSchema, '/contacts', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: Partial<Contact>) =>
    fetched(ContactSchema, `/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: (id: string) => fetched(z.object({ ok: z.boolean() }), `/contacts/${id}`, { method: 'DELETE' }),
};

// ─── Campaigns ───────────────────────────────────────────────────────────────

export const campaignsApi = {
  list: () => fetched(PaginatedSchema(CampaignSchema), '/campaigns'),
  get:  (id: string) => fetched(CampaignSchema, `/campaigns/${id}`),
  pause:  (id: string) => fetched(CampaignSchema, `/campaigns/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => fetched(CampaignSchema, `/campaigns/${id}/resume`, { method: 'POST' }),
};

// ─── Agent Runs ──────────────────────────────────────────────────────────────

export const agentRunsApi = {
  list: (page = 1, pageSize = 20) =>
    fetched(PaginatedSchema(AgentRunSchema), `/agent-runs?page=${page}&pageSize=${pageSize}`),
  pause:  (id: string) => fetched(AgentRunSchema, `/agent-runs/${id}/pause`,  { method: 'POST' }),
  resume: (id: string) => fetched(AgentRunSchema, `/agent-runs/${id}/resume`, { method: 'POST' }),
  kill:   (id: string) => fetched(AgentRunSchema, `/agent-runs/${id}/kill`,   { method: 'POST' }),
};

// ─── Deals ───────────────────────────────────────────────────────────────────

export const dealsApi = {
  list: () => fetched(PaginatedSchema(DealSchema), '/deals'),
  update: (id: string, body: Partial<z.infer<typeof DealSchema>>) =>
    fetched(DealSchema, `/deals/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

// ─── Registry (Phase 6B) ─────────────────────────────────────────────────────

export const registryApi = {
  list: (entryType?: string) =>
    fetched(z.array(z.object({
      entry_type:       z.string(),
      key:              z.string(),
      name:             z.string(),
      description:      z.string(),
      version:          z.string(),
      capabilities:     z.array(z.string()),
      phase_introduced: z.string(),
      status:           z.string(),
      metadata:         z.record(z.string(), z.unknown()),
    })), `/registry${entryType ? `?type=${entryType}` : ''}`),
};

// ─── Workspace Templates (Phase 5) ──────────────────────────────────────────

const TemplateActivationSchema = z.object({
  id:                 z.string(),
  templateKey:        z.string(),
  name:               z.string(),
  status:             z.enum(['active', 'inactive', 'pending_review']),
  config:             z.record(z.string(), z.unknown()),
  legalReviewedBy:    z.string().nullable().optional(),
  legalReviewedAt:    z.string().nullable().optional(),
  createdAt:          z.string(),
});

export const templatesApi = {
  list:     () => fetched(z.array(TemplateActivationSchema), '/workspace-templates'),
  activate: (templateKey: string) =>
    fetched(TemplateActivationSchema, `/workspace-templates/${templateKey}/activate`, { method: 'POST' }),
  deactivate: (templateKey: string) =>
    fetched(TemplateActivationSchema, `/workspace-templates/${templateKey}/deactivate`, { method: 'POST' }),
  launch: (templateKey: string, body: { targetIds: string[]; contextData?: Record<string, unknown> }) =>
    fetched(z.object({ started: z.number(), skipped: z.number(), template: z.string() }),
      `/workspace-templates/${templateKey}/launch`, { method: 'POST', body: JSON.stringify(body) }),
};

// ─── Reporting (Phase 3) ─────────────────────────────────────────────────────

const ForecastReportSchema = z.object({
  forecast:    z.object({
    totalPipeline:    z.number(),
    weightedForecast: z.number(),
    dealCount:        z.number(),
    period:           z.string(),
    byStage:          z.record(z.string(), z.object({ count: z.number(), totalAmount: z.number(), weightedAmount: z.number() })),
  }),
  riskFlags:   z.array(z.object({
    dealId:       z.string(),
    dealName:     z.string(),
    stage:        z.string(),
    amount:       z.number(),
    daysQuiet:    z.number(),
    teamMedian:   z.number(),
    xAboveMedian: z.number(),
  })),
  narratives:  z.array(z.string()),
  generatedAt: z.string(),
  period:      z.string(),
});

const MeteringUsageSchema = z.object({
  period: z.string(),
  usage: z.array(z.object({
    resource:   z.string(),
    used:       z.number(),
    quota:      z.number(),
    costUsd:    z.number(),
  })),
});

export const reportingApi = {
  getForecast:    () => fetched(ForecastReportSchema, '/reporting/forecast'),
  getMeteringUsage: () => fetched(MeteringUsageSchema, '/reporting/metering'),
};

// ─── Analytics ───────────────────────────────────────────────────────────────

const AnalyticsSchema = z.object({
  replyRateTrend:  z.array(z.number()),
  meetingsTrend:   z.array(z.number()),
  callOutcomes:    z.object({ answered: z.number(), voicemail: z.number(), noAnswer: z.number(), busy: z.number() }),
  topSequences:    z.array(z.object({ name: z.string(), replies: z.number(), meetings: z.number(), rate: z.number() })),
  contactsAdded:   z.array(z.number()),
  months:          z.array(z.string()),
});

export const analyticsApi = {
  get: () => fetched(AnalyticsSchema, '/analytics'),
};

// ─── Org check (unauthenticated) ─────────────────────────────────────────────

const OrgCheckSchema = z.object({
  tenants: z.array(z.object({
    id:        z.string(),
    name:      z.string(),
    subdomain: z.string(),
  })),
});

export const orgCheckApi = {
  byDomain: (domain: string) =>
    fetched(OrgCheckSchema, `/org-check?domain=${encodeURIComponent(domain)}`),
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

export const dashboardApi = {
  stats: () => fetched(DashboardStatsSchema, '/dashboard/stats'),
};

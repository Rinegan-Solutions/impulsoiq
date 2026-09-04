/**
 * The ImpulsoIQ API client.
 *
 * Every call goes to the real API Gateway stage (VITE_API_URL) with the
 * Cognito ID token attached. See ./http.ts for why the operation envelope
 * exists rather than REST resources.
 *
 * WHAT IS AND IS NOT BACKED
 * crm-read only implements the operations the agents needed, plus the three
 * list operations added for these screens. Anything without a backing
 * operation is absent from this file on purpose — a stub returning [] would
 * look identical to an empty tenant and hide the gap. Screens for unbacked
 * features render an explicit empty state instead.
 */
import { z } from 'zod';
import { operation, request } from './http';
import {
  ContactSchema,
  CampaignSchema,
  AgentRunSchema,
  DealSchema,
  PipelineDealSchema,
  DashboardStatsSchema,
  RegistryEntrySchema,
  KnowledgeArticleSchema,
  TemplateActivationSchema,
  OrgCheckSchema,
  PaginatedSchema,
  type Contact,
  type Deal,
  type Campaign,
  type AgentRun,
} from './schemas';

const OkSchema = z.object({ ok: z.boolean().optional(), id: z.string().optional() }).passthrough();

// ─── Contacts ─────────────────────────────────────────────────────────────────

export const contactsApi = {
  list: (page = 1, pageSize = 20, search = '') =>
    operation('/crm-read', 'list_contacts', { page, pageSize, search },
      PaginatedSchema(ContactSchema)),

  get: (id: string) =>
    operation('/crm-read', 'get_contact', { id }, ContactSchema.nullable()),

  // Writes go through crm-write-service only — never straight to DSQL.
  create: (body: Partial<Contact>) =>
    operation('/crm-write', 'upsert_contact', body as Record<string, unknown>, OkSchema),

  update: (id: string, body: Partial<Contact>) =>
    operation('/crm-write', 'upsert_contact', { id, ...body }, OkSchema),
};

// ─── Campaigns ────────────────────────────────────────────────────────────────

export const campaignsApi = {
  // list_campaigns returns every campaign with its aggregates.
  // get_active_campaigns (used by the agents) returns only active ones and no
  // metrics, so it is the wrong read for a management screen.
  list: () =>
    operation('/crm-read', 'list_campaigns', {}, z.array(CampaignSchema)),

  // Takes the WHOLE campaign, not just {id, status}. upsert_campaign is a real
  // upsert: its ON CONFLICT sets name = EXCLUDED.name, so a partial payload
  // would write NULL into a NOT NULL column. The agents always send full
  // objects, which is why this never surfaced before the UI could write.
  setStatus: (campaign: Campaign, status: 'active' | 'paused') =>
    operation('/crm-write', 'upsert_campaign',
      { ...campaign, status } as unknown as Record<string, unknown>, OkSchema),
};

// ─── Agent runs ───────────────────────────────────────────────────────────────

export const agentRunsApi = {
  list: (page = 1, pageSize = 20) =>
    operation('/crm-read', 'list_agent_runs', { page, pageSize },
      PaginatedSchema(AgentRunSchema)),

  // Pause/resume/kill are status transitions on the run record. The Step
  // Functions execution is driven separately by the backend.
  // Full row again: agent_run.contact_id and agent_type are NOT NULL, and the
  // proposed tuple is validated before ON CONFLICT is even considered, so a
  // partial {id, status} fails on the constraint rather than updating.
  setStatus: (run: AgentRun, status: 'running' | 'paused' | 'failed') =>
    operation('/crm-write', 'upsert_agent_run',
      { ...run, status } as unknown as Record<string, unknown>, OkSchema),
};

// ─── Deals ────────────────────────────────────────────────────────────────────

export const dealsApi = {
  list: (page = 1, pageSize = 50) =>
    operation('/crm-read', 'list_deals', { page, pageSize }, PaginatedSchema(DealSchema)),

  // The forecasting view: open deals only, with activity aggregates.
  pipeline: (lookbackDays = 90) =>
    operation('/crm-read', 'get_pipeline_data', { lookbackDays },
      z.array(PipelineDealSchema)),

  update: (id: string, body: Partial<Deal>) =>
    operation('/crm-write', 'upsert_deal', { id, ...body }, OkSchema),
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const dashboardApi = {
  stats: () => operation('/crm-read', 'get_dashboard_stats', {}, DashboardStatsSchema),
};

// ─── Registry (Phase 6B) ──────────────────────────────────────────────────────

export const registryApi = {
  list: (entryType?: string) =>
    operation('/crm-read', 'get_registry', entryType ? { entryType } : {},
      z.array(RegistryEntrySchema)),
};

// ─── Workspace templates (Phase 5) ────────────────────────────────────────────

export const templatesApi = {
  list: () =>
    operation('/crm-read', 'get_workspace_templates', {},
      z.array(TemplateActivationSchema)),

  // Conflict target is (tenant_id, template_key), so activating a template the
  // tenant has never activated before works without knowing a row id.
  setStatus: (templateKey: string, status: 'active' | 'inactive') =>
    operation('/crm-write', 'upsert_workspace_template', { templateKey, status }, OkSchema),

  // template-launcher is its own Lambda: it starts Step Functions executions
  // and enforces the accounts_receivable legal-review gate.
  launch: (templateKey: string, body: { targetIds: string[]; contextData?: Record<string, unknown> }) =>
    request('/templates',
      z.object({
        started: z.number(),
        skipped: z.number(),
        template: z.string(),
        executions: z.array(z.string()),
      }),
      { method: 'POST', body: JSON.stringify({ templateKey, ...body }) }),
};

// ─── Support (Phase 7/8) ──────────────────────────────────────────────────────

export const supportApi = {
  listQueues: () =>
    operation('/crm-read', 'list_queues', {}, z.array(z.record(z.string(), z.unknown()))),

  getConversation: (id: string) =>
    operation('/crm-read', 'get_conversation', { id },
      z.record(z.string(), z.unknown()).nullable()),

  getMessages: (conversationId: string, limit = 50) =>
    operation('/crm-read', 'get_messages', { conversationId, limit },
      z.array(z.record(z.string(), z.unknown()))),
};

// ─── Knowledge base (Phase 8A) ────────────────────────────────────────────────

export const knowledgeApi = {
  // The agent's default limit is 5 and status defaults to 'published'; a browse
  // screen wants more than that and needs drafts too, so both are explicit.
  search: (query = '', status?: string, limit = 100) =>
    operation('/crm-read', 'search_knowledge_articles',
      { query, ...(status ? { status } : {}), limit },
      z.array(KnowledgeArticleSchema)),

  get: (id: string) =>
    operation('/crm-read', 'get_knowledge_article', { id },
      z.record(z.string(), z.unknown()).nullable()),
};

// ─── Support insight (Phase 9A) ───────────────────────────────────────────────

export const supportInsightApi = {
  metrics: (periodDays = 30) =>
    operation('/crm-read', 'get_support_metrics', { periodDays },
      z.record(z.string(), z.unknown())),
};

// ─── Org check (public — called before the user has an account) ───────────────

export const orgCheckApi = {
  byDomain: (domain: string) =>
    request(`/org-check?domain=${encodeURIComponent(domain)}`, OrgCheckSchema),
};

export { ApiError } from './http';

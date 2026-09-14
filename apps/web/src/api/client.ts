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
  AccountSchema,
  CampaignSchema,
  AgentRunSchema,
  DealSchema,
  ActivitySchema,
  PipelineDealSchema,
  DashboardStatsSchema,
  RegistryEntrySchema,
  KnowledgeArticleSchema,
  TemplateActivationSchema,
  OrgCheckSchema,
  InvitationSchema,
  SequenceSchema,
  EnrichmentRecordSchema,
  PaginatedSchema,
  type Contact,
  type Deal,
  type Campaign,
  type InvitationRole,
} from './schemas';

const OkSchema = z.object({ ok: z.boolean().optional(), id: z.string().optional() }).passthrough();

// ─── Contacts ─────────────────────────────────────────────────────────────────

export const contactsApi = {
  list: (page = 1, pageSize = 20, search = '', stage = '') =>
    operation('/crm-read', 'list_contacts', { page, pageSize, search, ...(stage ? { stage } : {}) },
      PaginatedSchema(ContactSchema)),

  get: (id: string) =>
    operation('/crm-read', 'get_contact', { id }, ContactSchema.nullable()),

  // Writes go through crm-write-service only — never straight to DSQL.
  create: (body: Partial<Contact>) =>
    operation('/crm-write', 'upsert_contact', body as Record<string, unknown>, OkSchema),

  update: (id: string, body: Partial<Contact>) =>
    operation('/crm-write', 'upsert_contact', { id, ...body }, OkSchema),

  activity: (contactId: string, page = 1, pageSize = 50) =>
    operation('/crm-read', 'list_activities', { contactId, page, pageSize },
      PaginatedSchema(ActivitySchema)),

  enrichment: (contactId: string) =>
    operation('/crm-read', 'list_enrichment_records', { contactId }, z.array(EnrichmentRecordSchema)),
};

export const accountsApi = {
  list: (page = 1, pageSize = 20, search = '') =>
    operation('/crm-read', 'list_accounts', { page, pageSize, search },
      PaginatedSchema(AccountSchema)),

  get: (id: string) =>
    operation('/crm-read', 'get_account', { id }, AccountSchema.nullable()),

  create: (body: { name: string; domain?: string; industry?: string }) =>
    operation('/crm-write', 'upsert_account', body, OkSchema),

  activity: (accountId: string, page = 1, pageSize = 40) =>
    operation('/crm-read', 'list_activities', { accountId, page, pageSize },
      PaginatedSchema(ActivitySchema)),
};

export const activitiesApi = {
  list: (page = 1, pageSize = 40) =>
    operation('/crm-read', 'list_activities', { page, pageSize },
      PaginatedSchema(ActivitySchema)),

  pendingApprovals: () =>
    operation('/crm-read', 'list_pending_approvals', {}, z.array(ActivitySchema)),

  create: (body: { contactId?: string; accountId?: string; type: string; actorType: string; actorId: string; subject?: string; body?: string; occurredAt?: string }) =>
    operation('/crm-write', 'upsert_activity', body, OkSchema),
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

  attachSequence: (campaign: Campaign, sequenceId: string) =>
    operation('/crm-write', 'upsert_campaign',
      { ...campaign, config: { ...(campaign.config ?? {}), sequenceId } } as unknown as Record<string, unknown>, OkSchema),
};

// ─── Agent runs ───────────────────────────────────────────────────────────────

export const agentRunsApi = {
  list: (page = 1, pageSize = 20) =>
    operation('/crm-read', 'list_agent_runs', { page, pageSize },
      PaginatedSchema(AgentRunSchema)),

  get: (id: string) =>
    operation('/crm-read', 'get_agent_run', { id }, AgentRunSchema.nullable()),

  usage: () =>
    operation('/crm-read', 'get_metering_usage', {},
      z.object({
        period: z.string().nullable(),
        items: z.array(z.object({
          resource: z.unknown(),
          used: z.number(),
          quota: z.number(),
        })),
        error: z.string().optional(),
      }).passthrough()),

  quality: () =>
    operation('/crm-read', 'get_outbound_quality', {},
      z.object({
        consentBlocks: z.coerce.number(),
        bounces: z.coerce.number(),
        calls: z.coerce.number(),
        answered: z.coerce.number(),
        connectRate: z.number().nullable(),
        schemaValidationPassRate: z.number().nullable(),
        schemaFailures: z.coerce.number(),
      }).passthrough()),

  campaignUsage: () =>
    operation('/crm-read', 'get_campaign_usage', {}, z.array(z.object({
      id: z.string(),
      name: z.string(),
      runs: z.coerce.number(),
      emails: z.coerce.number(),
      consentBlocks: z.coerce.number().optional(),
      bounces: z.coerce.number().optional(),
      calls: z.coerce.number(),
      callSeconds: z.coerce.number().optional(),
    }).passthrough())),
};

const ControlResultSchema = z.object({
  ok: z.boolean().optional(),
  id: z.string().optional(),
  stopped: z.boolean().optional(),
  resumed: z.boolean().optional(),
  callMayComplete: z.boolean().optional(),
  callCancelled: z.boolean().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
  pausedOutbound: z.boolean().optional(),
  reason: z.string().optional(),
  paused: z.boolean().optional(),
}).passthrough();

/** Pause/resume/kill that StopExecution (or StartExecution on resume). */
export const controlApi = {
  pauseRun: (runId: string) =>
    request('/control', ControlResultSchema, {
      method: 'POST', body: JSON.stringify({ operation: 'pause_run', runId }),
    }),
  resumeRun: (runId: string) =>
    request('/control', ControlResultSchema, {
      method: 'POST', body: JSON.stringify({ operation: 'resume_run', runId }),
    }),
  killRun: (runId: string) =>
    request('/control', ControlResultSchema, {
      method: 'POST', body: JSON.stringify({ operation: 'kill_run', runId }),
    }),
  killTenant: () =>
    request('/control', ControlResultSchema, {
      method: 'POST', body: JSON.stringify({ operation: 'kill_tenant' }),
    }),
  clearTenantKill: () =>
    request('/control', ControlResultSchema, {
      method: 'POST', body: JSON.stringify({ operation: 'clear_tenant_kill' }),
    }),
  pauseStatus: () =>
    request('/control', ControlResultSchema, {
      method: 'POST', body: JSON.stringify({ operation: 'pause_status' }),
    }),
  actApproval: (body: {
    activityId: string;
    action: 'approve' | 'reject' | 'edit';
    subject?: string;
    body?: string;
    survivorId?: string;
    duplicateId?: string;
    allowUnverifiedEmail?: boolean;
  }) =>
    request('/control', ControlResultSchema, {
      method: 'POST', body: JSON.stringify({ operation: 'act_approval', ...body }),
    }),
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

  create: (body: { name: string; accountId: string; amount?: number; stage?: string; contactId?: string }) =>
    operation('/crm-write', 'upsert_deal', body, OkSchema),
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

// ─── Tenant ───────────────────────────────────────────────────────────────────

const TenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  subdomain: z.string(),
  tier: z.string(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type Tenant = z.infer<typeof TenantSchema>;

export const tenantApi = {
  get: () => operation('/crm-read', 'get_tenant', {}, TenantSchema.nullable()),
  saveBrandVoice: (brandVoiceProfile: Record<string, unknown>) =>
    operation('/crm-write', 'patch_tenant_config', { brandVoiceProfile }, OkSchema),
  saveSsoIntent: (body: { metadataUrl: string; provider: string }) =>
    operation('/crm-write', 'save_sso_intent', body, OkSchema),
  exportDsar: (contactId: string) =>
    operation('/crm-read', 'export_dsar', { contactId }, z.unknown()),
  exportAudit: (keys: { contactId?: string; campaignId?: string; agentRunId?: string }) =>
    operation('/crm-read', 'export_audit', keys, z.object({
      incomplete: z.boolean().optional(),
      reason: z.string().optional(),
      items: z.array(z.unknown()).optional(),
    }).passthrough()),
  eraseDsar: (contactId: string) =>
    operation('/crm-write', 'erase_dsar', { contactId }, OkSchema),
  setCsDesignPartner: (csDesignPartner: boolean) =>
    operation('/crm-write', 'patch_expansion_config', { csDesignPartner }, OkSchema),
};

export const insightsApi = {
  channelEfficacy: () =>
    operation('/crm-read', 'get_channel_efficacy', {}, z.object({
      channels: z.array(z.object({
        type: z.string(),
        total: z.coerce.number(),
        agent: z.coerce.number(),
        human: z.coerce.number(),
      })),
      callOutcomes: z.array(z.object({
        outcome: z.string().nullable().optional(),
        n: z.coerce.number(),
      })),
      omitted: z.array(z.string()),
      omittedReason: z.string(),
    })),
  pipelineAttribution: () =>
    operation('/crm-read', 'get_pipeline_attribution', {}, z.object({
      agentSourced: z.coerce.number(),
      humanOrUntouched: z.coerce.number(),
      agentSourcedDeals: z.coerce.number(),
      deals: z.coerce.number(),
    })),
  forecast: () =>
    operation('/crm-read', 'get_forecast_report', {}, z.object({
      available: z.boolean(),
      reason: z.string().optional(),
      report: z.record(z.string(), z.unknown()).optional(),
    })),
  personalQueue: () =>
    operation('/crm-read', 'get_personal_queue', {}, z.object({
      awaitingApproval: z.coerce.number(),
      myActivities30d: z.coerce.number(),
      runningAgents: z.coerce.number(),
    })),
};

export const billingApi = {
  status: () =>
    request('/billing', z.object({
      tier: z.string(),
      voiceAllowed: z.boolean().optional(),
      stripeCustomerId: z.string().nullable().optional(),
      stripeReady: z.boolean().optional(),
      contactCenter: z.string().optional(),
    }).passthrough(), {
      method: 'POST',
      body: JSON.stringify({ operation: 'status' }),
    }),
  checkout: (body: { action?: 'pack'; tier?: string; interval?: 'monthly' | 'annual'; pack?: string }) =>
    request('/billing', z.object({ url: z.string().optional(), error: z.string().optional() }).passthrough(), {
      method: 'POST',
      body: JSON.stringify({ operation: 'checkout', ...body }),
    }),
  portal: () =>
    request('/billing', z.object({ url: z.string().optional() }).passthrough(), {
      method: 'POST',
      body: JSON.stringify({ operation: 'portal' }),
    }),
};

export const sequencesApi = {
  list: () => operation('/crm-read', 'list_sequences', {}, z.array(SequenceSchema)),
  get: (id: string) => operation('/crm-read', 'get_sequence', { id }, SequenceSchema.nullable()),
  save: (body: { id?: string; name: string; status?: string; steps: unknown[] }) =>
    operation('/crm-write', 'upsert_sequence', body, OkSchema),
};

export const IntentQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
});

export const IntentPlanSchema = z.object({
  status: z.string(),
  href: z.string().optional(),
  goal: z.string().optional(),
  starter: z.string().optional(),
  questions: z.array(IntentQuestionSchema).optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  targets: z.object({
    contactIds: z.array(z.string()),
    label: z.string(),
  }).optional(),
  plan: z.object({
    goal: z.string(),
    goalType: z.string(),
    channels: z.array(z.string()),
    approvalMode: z.string(),
    maxTouches: z.number(),
    requiresApproval: z.boolean(),
    steps: z.array(z.object({ agent: z.string(), action: z.string() })),
    cost: z.object({
      enrichmentLookups: z.number(),
      emailSends: z.number(),
      estimatedCallMinutes: z.number(),
    }),
    topology: z.string(),
    voiceAllowed: z.boolean().optional(),
    voicePaywall: z.boolean().optional(),
    tier: z.string().optional(),
  }).optional(),
});

export type IntentQuestion = z.infer<typeof IntentQuestionSchema>;
export type IntentPlanResponse = Omit<z.infer<typeof IntentPlanSchema>, 'targets' | 'plan'> & {
  targets: { contactIds: string[]; label: string };
  plan: NonNullable<z.infer<typeof IntentPlanSchema>['plan']>;
};

const IntentConfirmSchema = z.object({
  ok: z.boolean().optional(),
  status: z.string().optional(),
  campaignId: z.string(),
  agentRunIds: z.array(z.string()).optional(),
  started: z.number().optional(),
  requiresApproval: z.boolean().optional(),
  inspectHref: z.string().optional(),
}).passthrough();

export const intentApi = {
  submitGoal: (body: { goal: string; starter?: string; answers?: Record<string, string> }) =>
    request('/intent', IntentPlanSchema, {
      method: 'POST',
      body: JSON.stringify({ operation: 'submit_goal', ...body }),
    }),
  resolve: (body: { goal: string; starter?: string; answers?: Record<string, string> }) =>
    request('/intent', IntentPlanSchema, {
      method: 'POST',
      body: JSON.stringify({ operation: 'resolve', ...body }),
    }),
  confirm: (body: { goal: string; starter?: string; answers?: Record<string, string>; contactIds?: string[] }) =>
    request('/intent', IntentConfirmSchema, {
      method: 'POST',
      body: JSON.stringify({ operation: 'confirm', ...body }),
    }),
  deepResearch: (body: { researchGoal: string; icp?: string; approved?: boolean }) =>
    request('/intent', z.object({
      status: z.string().optional(),
      estimatedTokens: z.number().optional(),
      message: z.string().optional(),
      ok: z.boolean().optional(),
      id: z.string().optional(),
      inspectHref: z.string().optional(),
      response: z.unknown().optional(),
      error: z.string().optional(),
    }).passthrough(), {
      method: 'POST',
      body: JSON.stringify({ operation: 'deep_research', ...body }),
    }),
  recordEvent: (eventType: string, data: Record<string, unknown> = {}) =>
    request('/intent', z.object({ ok: z.boolean().optional() }).passthrough(), {
      method: 'POST',
      body: JSON.stringify({ operation: 'record_event', eventType, data }),
    }),
};

// ─── Invitations ──────────────────────────────────────────────────────────────
//
// Membership is granted only by invitation — joining by matching email domain
// was removed because controlling a mailbox at a customer's domain is not the
// same as being authorised to see their CRM.
//
// Every rule below is enforced by the API, not here: a member gets a 403 from
// /invitations whatever the UI renders. `canInvite` exists to avoid showing a
// control that would only fail, never as the check itself.

export const invitationsApi = {
  /** Pending, accepted and revoked invitations for this workspace. Admin/manager only. */
  list: () => operation('/crm-read', 'list_invitations', {}, z.array(InvitationSchema)),

  /**
   * Mint an invitation and email it.
   *
   * 201 with emailed:true is fully sent. 202 with emailed:false means the row
   * exists but SES refused — the caller must say so rather than imply delivery.
   */
  create: (body: { email: string; role: InvitationRole; workspaceName?: string }) =>
    request('/invitations', z.object({
      ok: z.boolean().optional(),
      id: z.string().optional(),
      email: z.string().optional(),
      role: z.string().optional(),
      expiresAt: z.string().optional(),
      emailed: z.boolean().optional(),
      error: z.string().optional(),
    }).passthrough(), {
      method: 'POST',
      body: JSON.stringify({ operation: 'create', ...body }),
    }),

  revoke: (id: string) =>
    request('/invitations', z.object({ ok: z.boolean().optional() }).passthrough(), {
      method: 'POST',
      body: JSON.stringify({ operation: 'revoke', id }),
    }),

  /**
   * Public: what an invite link is for. Called on the sign-up screen before any
   * account exists. Every failure answers identically — an invalid token and an
   * expired one are indistinguishable, so this cannot be used to probe.
   */
  resolve: (token: string) =>
    request('/invite-lookup', z.object({
      valid: z.boolean(),
      email: z.string().optional(),
      role: z.string().optional(),
      tenantId: z.string().optional(),
      workspaceName: z.string().optional(),
      expiresAt: z.string().optional(),
      error: z.string().optional(),
    }), {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
};

/** Roles a given role may invite. Mirrors INVITABLE in invitation-service. */
export const INVITABLE_ROLES: Record<string, InvitationRole[]> = {
  admin: ['admin', 'manager', 'member'],
  manager: ['member'],
  member: [],
};

// ─── Org check (public — called before the user has an account) ───────────────

export const orgCheckApi = {
  byDomain: (domain: string) =>
    request(`/org-check?domain=${encodeURIComponent(domain)}`, OrgCheckSchema),
};

export { ApiError } from './http';

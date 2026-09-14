import { z } from 'zod';

/**
 * Response shapes for the ImpulsoIQ API.
 *
 * THESE NOW DESCRIBE THE DATABASE, NOT THE MOCK.
 * The previous versions were written against the MSW fixtures and drifted from
 * Aurora DSQL in three ways that would each have thrown at runtime:
 *   - snake_case columns vs camelCase fields (the client camelizes centrally now)
 *   - fields that are not columns: contact.company / contact.industry live on
 *     `account`; campaign.openRate / callsMade / meetingsBooked are aggregates
 *     over `activity` and `call_result`, not stored values
 *   - NOT NULL assumed where the schema allows NULL (contact.email, deal.close_date)
 *
 * Nullable columns are `.nullable()`, not `.optional()`. Postgres sends an
 * explicit null for an empty column; `.optional()` alone rejects that.
 *
 * Timestamps are plain strings. pg returns TIMESTAMPTZ as a Date, which
 * JSON.stringify renders as ISO-8601 — but DATE columns come back as
 * 'YYYY-MM-DD', which z.string().datetime() rejects. Validating the format
 * buys nothing here and turns a display concern into a hard failure.
 */

// ─── Enums (mirror the CHECK constraints in schema.sql) ───────────────────────

export const ActivityTypeSchema = z.enum(['email', 'sms', 'call', 'note', 'task', 'meeting']);
export const ActorTypeSchema = z.enum(['human', 'agent']);
export const CampaignStatusSchema = z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']);
export const AgentRunStatusSchema = z.enum(['pending', 'running', 'paused', 'completed', 'failed']);
export const PipelineStageSchema = z.enum([
  'Prospecting',
  'Qualified',
  'Demo Booked',
  'Proposal',
  'Negotiating',
  'Closed Won',
]);
export const AgentTypeSchema = z.enum([
  'coordinator',
  'clarification',
  'research_enrichment',
  'outreach',
  'voice',
  'nurture',
  'forecasting_insight',
  'data_hygiene',
  'ambient_interface',
  'deep_research',
  'signal_listening',
  'triage_escalation',
  'resolution',
  'support_insight',
]);

// ─── Core entities ────────────────────────────────────────────────────────────

export const ContactSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  accountId: z.string().nullable().optional(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  stage: PipelineStageSchema,
  score: z.number().int(),
  enrichmentJson: z.record(z.string(), z.unknown()).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Joined by list_contacts, not columns on `contact`:
  //   accountName      <- account.name        (the UI's "company")
  //   lastActivityAt   <- MAX(activity.occurred_at)
  // Absent on get_contact, hence optional.
  accountName: z.string().nullable().optional(),
  lastActivityAt: z.string().nullable().optional(),
});

export const CampaignSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  type: z.string(),
  status: CampaignStatusSchema,
  config: z.record(z.string(), z.unknown()).optional(),
  goalTemplate: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Aggregates computed by list_campaigns over agent_run/activity/call_result.
  // COUNT() comes back from pg as a string, hence coerce.
  // There is no openRate/replyRate: nothing in the schema records an email
  // being opened or replied to, so those cannot be derived honestly.
  contactsTotal: z.coerce.number().optional(),
  contactsTouched: z.coerce.number().optional(),
  callsMade: z.coerce.number().optional(),
  meetingsBooked: z.coerce.number().optional(),
  agentRuns: z.coerce.number().optional(),
});

export const AgentRunSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  campaignId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  agentType: AgentTypeSchema,
  status: AgentRunStatusSchema,
  stepFunctionsExecutionArn: z.string().nullable().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  costJson: z.record(z.string(), z.unknown()).nullable().optional(),
  startedAt: z.string(),
  endedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  // Joined from `contact` by list_agent_runs so the table can show a name
  // without an N+1 fetch per row.
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
});

export const DealSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  accountId: z.string(),
  contactId: z.string().nullable().optional(),
  name: z.string(),
  // NUMERIC arrives from pg as a string to preserve precision. Coerce so the
  // UI can do arithmetic without every caller remembering to parse it.
  amount: z.coerce.number(),
  stage: PipelineStageSchema,
  probability: z.number().int(),
  closeDate: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Joined by list_deals from `account`.
  accountName: z.string().nullable().optional(),
});

export const AccountSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  domain: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  employeeCount: z.coerce.number().nullable().optional(),
  annualRevenue: z.coerce.number().nullable().optional(),
  enrichmentJson: z.record(z.string(), z.unknown()).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  contactCount: z.coerce.number().optional(),
  dealCount: z.coerce.number().optional(),
  pipeline: z.coerce.number().optional(),
  lastActivityAt: z.string().nullable().optional(),
});

export const ActivitySchema = z.object({
  id: z.string(),
  tenantId: z.string().optional(),
  contactId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  agentRunId: z.string().nullable().optional(),
  type: ActivityTypeSchema,
  actorType: ActorTypeSchema,
  actorId: z.string(),
  subject: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.string(),
  createdAt: z.string().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  accountName: z.string().nullable().optional(),
});

export const SequenceStepSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['email', 'sms', 'wait', 'call', 'task']),
  waitSeconds: z.coerce.number().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  title: z.string().optional(),
});

export const SequenceSchema = z.object({
  id: z.string(),
  tenantId: z.string().optional(),
  name: z.string(),
  status: z.enum(['draft', 'active', 'archived']),
  steps: z.array(SequenceStepSchema),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).passthrough();

export const EnrichmentRecordSchema = z.object({
  id: z.string().optional(),
  source: z.string(),
  field: z.string(),
  value: z.string().nullable().optional(),
  confidence: z.coerce.number(),
  fetchedAt: z.string().optional(),
  decayPolicy: z.string().optional(),
}).passthrough();

// The FORECASTING projection from get_pipeline_data. Deliberately separate
// from DealSchema: that query omits tenant_id/account_id, excludes Closed Won,
// and adds aggregate columns. Relaxing DealSchema to cover both would make the
// deals table accept rows that are missing fields it needs.
export const PipelineDealSchema = z.object({
  id: z.string(),
  name: z.string(),
  stage: PipelineStageSchema,
  amount: z.coerce.number(),
  probability: z.number().int(),
  closeDate: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().nullable().optional(),
  activityCount: z.coerce.number().optional(),
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
// Matches the single aggregate statement in crm-read's get_dashboard_stats.
export const DashboardStatsSchema = z.object({
  totalContacts: z.number().int(),
  activeCampaigns: z.number().int(),
  runningAgents: z.number().int(),
  totalDeals: z.number().int(),
  pipelineValue: z.coerce.number(),
});

// ─── Knowledge base (Phase 8A) ───────────────────────────────────────────────
// Mirrors search_knowledge_articles' projection exactly.
export const KnowledgeArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  status: z.enum(['draft', 'published', 'deprecated']),
  version: z.coerce.number().optional(),
  lastReviewedAt: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
});

// ─── Registry (Phase 6B) ──────────────────────────────────────────────────────

// Matches get_registry's projection exactly: it selects `key` (not entry_key),
// and returns no id or tenant_id — the registry is a platform-wide catalog
// seeded by the registry-seeder Lambda, not per-tenant data.
export const RegistryEntrySchema = z.object({
  entryType: z.enum(['agent', 'tool', 'template']).or(z.string()),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  capabilities: z.array(z.string()).nullable().optional(),
  phaseIntroduced: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ─── Workspace templates (Phase 5) ────────────────────────────────────────────

export const TemplateActivationSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable().optional(),
  templateKey: z.string(),
  status: z.enum(['active', 'inactive', 'pending_review']),
  config: z.record(z.string(), z.unknown()).optional(),
  legalReviewedBy: z.string().nullable().optional(),
  legalReviewedAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

// ─── Org check (public, pre-signup) ───────────────────────────────────────────

export const OrgCheckSchema = z.object({
  tenants: z.array(
    z.object({
      name: z.string(),
      subdomain: z.string().nullable().optional(),
    }),
  ),
});

// ─── Request bodies ───────────────────────────────────────────────────────────

export const CreateContactBody = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Enter a valid email').optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
});

export const UpdateAgentRunBody = z.object({
  action: z.enum(['pause', 'resume', 'kill']),
});

// ─── Paginated list wrapper ───────────────────────────────────────────────────

export const PaginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

// ─── Inferred TypeScript types ────────────────────────────────────────────────

export type Contact = z.infer<typeof ContactSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type Deal = z.infer<typeof DealSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type Sequence = z.infer<typeof SequenceSchema>;
export type EnrichmentRecord = z.infer<typeof EnrichmentRecordSchema>;
export type PipelineDeal = z.infer<typeof PipelineDealSchema>;
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type KnowledgeArticle = z.infer<typeof KnowledgeArticleSchema>;
export type TemplateActivation = z.infer<typeof TemplateActivationSchema>;

// ─── Invitations ──────────────────────────────────────────────────────────────
// Deliberately no token or token hash: crm-read never selects it, and the raw
// token exists only in the email that was sent.

export const InvitationRoleSchema = z.enum(['admin', 'manager', 'member']);

export const InvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: InvitationRoleSchema,
  status: z.enum(['pending', 'accepted', 'revoked']),
  invitedBy: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  /** Computed by the API: pending, but past its expiry. */
  expired: z.boolean().nullable().optional(),
});

export type Invitation = z.infer<typeof InvitationSchema>;
export type InvitationRole = z.infer<typeof InvitationRoleSchema>;

// ─── Home assistant threads ───────────────────────────────────────────────────
// A saved Home conversation. `data` carries the payload for the turn kinds that
// are not plain prose (questions, plan), so a reloaded thread renders exactly
// as the live one did rather than collapsing to text.

export const ThreadTurnSchema = z.object({
  seq: z.coerce.number(),
  role: z.enum(['user', 'assistant']),
  kind: z.enum(['text', 'error', 'questions', 'plan']),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string().optional(),
});

export const ThreadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  starter: z.string().nullable().optional(),
  status: z.enum(['active', 'archived']),
  turnCount: z.coerce.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ThreadSchema = ThreadSummarySchema.extend({
  turns: z.array(ThreadTurnSchema),
});

export type Thread = z.infer<typeof ThreadSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;
export type ThreadTurn = z.infer<typeof ThreadTurnSchema>;

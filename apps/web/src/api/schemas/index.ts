import { z } from 'zod';

// ─── Primitive enums ─────────────────────────────────────────────────────────

export const ActivityTypeSchema = z.enum(['email', 'sms', 'call', 'note', 'task', 'meeting']);
export const ActorTypeSchema    = z.enum(['human', 'agent']);
export const CampaignStatusSchema = z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']);
export const AgentRunStatusSchema = z.enum(['pending', 'running', 'paused', 'completed', 'failed']);
export const PipelineStageSchema  = z.enum([
  'Prospecting', 'Qualified', 'Demo Booked', 'Proposal', 'Negotiating', 'Closed Won',
]);
export const AgentTypeSchema = z.enum(['research', 'outreach', 'voice', 'crm', 'coord']);

// ─── Core entities ────────────────────────────────────────────────────────────

export const ContactSchema = z.object({
  id:           z.string().uuid(),
  tenantId:     z.string(),
  firstName:    z.string().min(1),
  lastName:     z.string().min(1),
  email:        z.string().email().optional(),
  phone:        z.string().optional(),
  title:        z.string().optional(),
  company:      z.string().optional(),
  industry:     z.string().optional(),
  score:        z.number().int().min(0).max(100).optional(),
  stage:        PipelineStageSchema.optional(),
  lastActivity: z.string().datetime().optional(),
  createdAt:    z.string().datetime(),
});

export const CampaignSchema = z.object({
  id:              z.string().uuid(),
  tenantId:        z.string(),
  name:            z.string().min(1),
  type:            z.literal('sdr_qualification'),
  status:          CampaignStatusSchema,
  contactsTotal:   z.number().int().min(0),
  contactsTouched: z.number().int().min(0),
  openRate:        z.number().min(0).max(100),
  replyRate:       z.number().min(0).max(100),
  callsMade:       z.number().int().min(0),
  meetingsBooked:  z.number().int().min(0),
  createdAt:       z.string().datetime(),
});

export const AgentRunSchema = z.object({
  id:          z.string().uuid(),
  tenantId:    z.string(),
  campaignId:  z.string().uuid(),
  contactId:   z.string().uuid(),
  contactName: z.string(),
  company:     z.string().optional(),
  agentType:   AgentTypeSchema,
  status:      AgentRunStatusSchema,
  startedAt:   z.string().datetime(),
  endedAt:     z.string().datetime().optional(),
});

export const AgentActionSchema = z.object({
  id:         z.string().uuid(),
  agentRunId: z.string().uuid(),
  agentType:  AgentTypeSchema,
  action:     z.string(),
  status:     z.enum(['running', 'completed', 'failed', 'awaiting_approval']),
  occurredAt: z.string().datetime(),
});

export const DealSchema = z.object({
  id:        z.string().uuid(),
  tenantId:  z.string(),
  name:      z.string().min(1),
  contactId: z.string().uuid(),
  company:   z.string(),
  stage:     PipelineStageSchema,
  amount:    z.number().min(0),
  closeDate: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const DashboardStatsSchema = z.object({
  pipelineValue:   z.number(),
  dealsWonMonth:   z.number().int(),
  agentRunsToday:  z.number().int(),
  meetingsBooked:  z.number().int(),
  pipelineByStage: z.array(z.object({
    stage: PipelineStageSchema,
    count: z.number().int(),
    value: z.number(),
  })),
  campaignSummary: z.array(CampaignSchema.pick({
    id: true, name: true, status: true,
    contactsTotal: true, contactsTouched: true,
    openRate: true, replyRate: true, callsMade: true, meetingsBooked: true,
  })),
});

// ─── API request bodies ───────────────────────────────────────────────────────

export const CreateContactBody = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName:  z.string().min(1, 'Last name is required'),
  email:     z.string().email('Enter a valid email').optional(),
  phone:     z.string().optional(),
  title:     z.string().optional(),
  company:   z.string().optional(),
});

export const UpdateAgentRunBody = z.object({
  action: z.enum(['pause', 'resume', 'kill']),
});

// ─── Paginated list wrapper ───────────────────────────────────────────────────

export const PaginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page:  z.number().int(),
    pageSize: z.number().int(),
  });

// ─── Inferred TypeScript types ────────────────────────────────────────────────

export type Contact        = z.infer<typeof ContactSchema>;
export type Campaign       = z.infer<typeof CampaignSchema>;
export type AgentRun       = z.infer<typeof AgentRunSchema>;
export type AgentAction    = z.infer<typeof AgentActionSchema>;
export type Deal           = z.infer<typeof DealSchema>;
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;

export type ActivityType = 'email' | 'sms' | 'call' | 'note' | 'task' | 'meeting';
export type ActorType = 'human' | 'agent';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
export type AgentRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type ConsentChannel = 'email' | 'sms' | 'call';

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  tier: 'starter' | 'growth' | 'enterprise';
  createdAt: string;
}

export interface Account {
  id: string;
  tenantId: string;
  name: string;
  domain?: string;
  industry?: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  tenantId: string;
  accountId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  title?: string;
  createdAt: string;
}

export interface Deal {
  id: string;
  tenantId: string;
  accountId: string;
  contactId?: string;
  name: string;
  amount?: number;
  stage: string;
  closeDate?: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  tenantId: string;
  contactId?: string;
  accountId?: string;
  dealId?: string;
  agentRunId?: string;
  type: ActivityType;
  actorType: ActorType;
  actorId: string;
  subject?: string;
  body?: string;
  occurredAt: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  type: 'sdr_qualification';
  status: CampaignStatus;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  tenantId: string;
  campaignId: string;
  contactId: string;
  agentType: 'coordinator' | 'research_enrichment' | 'outreach' | 'voice' | 'nurture';
  status: AgentRunStatus;
  stepFunctionsExecutionArn?: string;
  startedAt: string;
  endedAt?: string;
}

export interface CallResult {
  id: string;
  tenantId: string;
  agentRunId: string;
  contactId: string;
  callId: string;
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'busy' | 'failed';
  durationSeconds?: number;
  transcriptS3Key?: string;
  summaryJson?: Record<string, unknown>;
  occurredAt: string;
}

export interface ConsentRecord {
  id: string;
  tenantId: string;
  contactId: string;
  channel: ConsentChannel;
  granted: boolean;
  source: string;
  recordedAt: string;
  expiresAt?: string;
}

export interface AgentAction {
  id: string;
  tenantId: string;
  agentRunId: string;
  agentType: string;
  action: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed' | 'awaiting_approval';
  occurredAt: string;
}

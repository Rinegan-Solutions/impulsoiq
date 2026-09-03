/**
 * Registry Seeder — Phase 6B.
 *
 * Populates the agent_registry table with the complete catalog of agents,
 * tools, and templates. Run once on deploy via a CloudFormation custom resource
 * or a one-time Lambda invoke. Re-run on any version bump.
 *
 * Enterprise admins use this catalog in the Registry page to discover what is
 * available to configure without needing to read source code.
 *
 * A2A agent cards are stored here and served via /api/registry/agent-card/:key
 * for cross-system agent discovery (Phase 6C).
 */
import type { Handler } from 'aws-lambda';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';

const REGION   = process.env.AWS_REGION ?? 'eu-west-2';
const ENDPOINT = process.env.DSQL_ENDPOINT!;

async function getDb(): Promise<Client> {
  const signer = new DsqlSigner({ hostname: ENDPOINT, region: REGION });
  const token  = await signer.getDbConnectAdminAuthToken();
  const client = new Client({ host: ENDPOINT, database: 'postgres', user: 'admin',
    password: token, port: 5432, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

// ── Complete registry catalogue ───────────────────────────────────────────────

interface RegistryEntry {
  entry_type:       'agent' | 'tool' | 'template';
  key:              string;
  name:             string;
  description:      string;
  version:          string;
  capabilities:     string[];
  input_schema:     Record<string, unknown>;
  output_schema:    Record<string, unknown>;
  phase_introduced: string;
  status:           'active' | 'deprecated' | 'experimental';
  metadata:         Record<string, unknown>;
}

const REGISTRY: RegistryEntry[] = [

  // ── Agents ────────────────────────────────────────────────────────────────

  {
    entry_type: 'agent', key: 'coordinator', version: '1.0.0', status: 'active',
    phase_introduced: '1',
    name: 'Coordinator Agent',
    description: 'Plans, decomposes, and orchestrates all specialist agents using Graph topology. The primary entry point for all campaign executions.',
    capabilities: ['graph_orchestration','consent_enforcement','metering_check','template_compliance'],
    input_schema:  { tenantId: 'string', contactId: 'string', goal: 'string', templateContext: 'object?' },
    output_schema: { executionArns: 'string[]', status: 'string' },
    metadata: { model: 'claude-sonnet', topology: 'graph', swarm: false },
  },
  {
    entry_type: 'agent', key: 'clarification', version: '1.0.0', status: 'active',
    phase_introduced: '1',
    name: 'Clarification Agent',
    description: 'Turns an ambiguous goal into a fully-specified one. Checks AgentCore Memory first; asks only what is genuinely unresolved.',
    capabilities: ['memory_lookup','structured_questioning','goal_specification'],
    input_schema:  { tenantId: 'string', goal: 'string', contactId: 'string?' },
    output_schema: { resolvedGoal: 'string', parameters: 'object' },
    metadata: { model: 'claude-haiku', minQuestionsEnforced: true },
  },
  {
    entry_type: 'agent', key: 'research-enrichment', version: '1.0.0', status: 'active',
    phase_introduced: '2',
    name: 'Research & Enrichment Agent',
    description: 'Enriches contacts with firmographic data, intent signals, and ICP fit scores. Waterfall: internal history → API → browser. Deterministic scoring.',
    capabilities: ['lead_enrichment','icp_scoring','memory_write','browser_tool','code_interpreter'],
    input_schema:  { tenantId: 'string', contactId: 'string', campaignId: 'string?' },
    output_schema: { score: 'number', enrichmentData: 'object', verdict: 'string' },
    metadata: { scoringIsDeterministic: true, browseForMissingData: true },
  },
  {
    entry_type: 'agent', key: 'outreach', version: '1.0.0', status: 'active',
    phase_introduced: '2',
    name: 'Outreach & Drafting Agent',
    description: 'Drafts and sends compliant, personalised email and SMS sequences. Validates CAN-SPAM/CASL elements. Respects template tone rules (fixed for 5B).',
    capabilities: ['email_draft','sms_draft','compliance_validation','approval_queue','ses_send','sns_send'],
    input_schema:  { tenantId: 'string', contactId: 'string', channel: 'string', templateContext: 'object?' },
    output_schema: { activityId: 'string', sent: 'boolean', approvalRequired: 'boolean' },
    metadata: { canSpamValidation: true, caslValidation: true, fdcpaToneCheck: true },
  },
  {
    entry_type: 'agent', key: 'voice', version: '1.0.0', status: 'active',
    phase_introduced: '2',
    name: 'Voice Agent (CALL-E)',
    description: 'Initiates async outbound calls via CALL-E. Validates calling window and DNC registry. Step Functions graph pauses until CallCompleted webhook resumes execution.',
    capabilities: ['voice_call','calling_window_validation','dnc_check','async_sfn_wait','call_result_write'],
    input_schema:  { tenantId: 'string', contactId: 'string', toPhone: 'string', callGoal: 'string', taskToken: 'string' },
    output_schema: { callInitiated: 'boolean', callId: 'string' },
    metadata: { asyncPattern: 'waitForTaskToken', callProvider: 'CALL-E', gdprConsentRequired: true },
  },
  {
    entry_type: 'agent', key: 'nurture', version: '1.0.0', status: 'active',
    phase_introduced: '2',
    name: 'Nurture & Follow-up Agent',
    description: 'Post-first-touch cadence management. Evaluates engagement signals to decide next action (email, call, stop). Persists cadence state in DynamoDB.',
    capabilities: ['engagement_monitoring','cadence_management','next_action_decision','per_contact_memory'],
    input_schema:  { tenantId: 'string', contactId: 'string', triggerEvent: 'string' },
    output_schema: { action: 'string', reason: 'string', scheduledFor: 'string?' },
    metadata: { decisionIsDeterministic: true, minCooldownHours: 24 },
  },
  {
    entry_type: 'agent', key: 'forecasting-insight', version: '1.0.0', status: 'active',
    phase_introduced: '3',
    name: 'Forecasting & Insight Agent',
    description: 'Daily pipeline forecast using deterministic stage-weighted calculation. Detects stalled deals vs team median. LLM writes narratives — does not compute numbers.',
    capabilities: ['pipeline_forecast','anomaly_detection','narrative_generation','reporting_write'],
    input_schema:  { tenantId: 'string', reportPeriod: 'string?' },
    output_schema: { forecast: 'object', riskFlags: 'array', narratives: 'array' },
    metadata: { scheduledDaily: '07:00 UTC', forecastingIsDeterministic: true },
  },
  {
    entry_type: 'agent', key: 'data-hygiene', version: '1.0.0', status: 'active',
    phase_introduced: '3',
    name: 'Data Hygiene Agent',
    description: 'Weekly sweep for duplicates and decayed records. NEVER auto-applies — all proposals go to the Control Panel approval queue for human review.',
    capabilities: ['duplicate_detection','decay_scan','hygiene_proposal','approval_queue'],
    input_schema:  { tenantId: 'string' },
    output_schema: { proposalsCreated: 'number', duplicatesFound: 'number' },
    metadata: { scheduledWeekly: 'Sunday 06:00 UTC', autoApplyForbidden: true },
  },
  {
    entry_type: 'agent', key: 'ambient-interface', version: '1.0.0', status: 'active',
    phase_introduced: '4',
    name: 'Ambient Interface Agent (Nova Sonic)',
    description: 'Lets the professional talk to ImpulsoIQ by voice. Distinct from the Voice Agent which calls other people. Routes spoken goals into the same Coordinator pipeline.',
    capabilities: ['voice_input','spoken_status_query','morning_briefing','voice_approval'],
    input_schema:  { tenantId: 'string', message: 'string', sessionId: 'string?' },
    output_schema: { response: 'string', sessionId: 'string' },
    metadata: { model: 'nova-sonic-v1', inputModality: 'voice', fallbackModel: 'claude-sonnet' },
  },
  {
    entry_type: 'agent', key: 'deep-research', version: '1.0.0', status: 'active',
    phase_introduced: '4',
    name: 'Deep Research Agent (Swarm)',
    description: 'The ONLY Swarm agent in the system. Runs 4 parallel sub-agents (firmographic, technographic, news signals, lookalike) and synthesises a ranked output. Requires explicit cost approval.',
    capabilities: ['swarm_orchestration','firmographic_research','technographic_research','news_signal_research','lookalike_research','synthesis'],
    input_schema:  { tenantId: 'string', goal: 'string', approved: 'boolean', sessionId: 'string?' },
    output_schema: { rankedCompanies: 'array', methodology: 'string', sessionId: 'string' },
    metadata: { topology: 'swarm', requiresApproval: true, estimatedTokens: 37000 },
  },
  {
    entry_type: 'agent', key: 'signal-listening', version: '1.0.0', status: 'active',
    phase_introduced: '4',
    name: 'Signal Listening Agent (v3)',
    description: 'Continuous, unprompted public-signal monitoring to originate brand-new candidate leads. Two-stage: Nova Micro cheap classifier → Nova 2 Lite synthesis. Every candidate enters Control Panel approval queue. Disabled by default — requires legal review per tenant per source. Never deanonymizes individuals.',
    capabilities: ['rss_monitoring', 'reddit_public_api', 'press_release_wires', 'signal_classification', 'candidate_origination', 'approval_queue'],
    input_schema:  { tenantId: 'string', sources: 'array?', dryRun: 'boolean?' },
    output_schema: { fetched: 'number', promoted: 'number', skipped: 'number' },
    metadata: {
      stage1Model:         'nova-micro',
      stage2Model:         'nova-lite',
      disabledByDefault:   true,
      requiresLegalReview: true,
      neverDeanonymizes:   true,
      dailyStage1Tokens:   500000,
      dailyStage2Tokens:   100000,
    },
  },

  // ── Key tools ─────────────────────────────────────────────────────────────

  {
    entry_type: 'tool', key: 'crm.write_record', version: '1.0.0', status: 'active',
    phase_introduced: '1',
    name: 'CRM Write Record',
    description: 'THE single write path to Aurora DSQL. All agents use this; none write to DSQL directly. Supports all entity types.',
    capabilities: ['dsql_write','dynamodb_event_publish','occ_retry'],
    input_schema:  { operation: 'string', payload: 'object', tenantId: 'string' },
    output_schema: { ok: 'boolean', id: 'string' },
    metadata: { singleWriterEnforced: true, auditEventPublished: true },
  },
  {
    entry_type: 'tool', key: 'crm.check_consent', version: '1.0.0', status: 'active',
    phase_introduced: '1',
    name: 'Consent Gate Check',
    description: 'Hard gate before any outbound action. Reads ConsentRecord from DSQL. Returns hasConsent=false to stop the agent branch if consent is missing, expired, or revoked.',
    capabilities: ['consent_enforcement','channel_check','expiry_validation'],
    input_schema:  { tenantId: 'string', contactId: 'string', channel: 'string' },
    output_schema: { hasConsent: 'boolean', reason: 'string?' },
    metadata: { hardGate: true, blockOnFalse: true },
  },
  {
    entry_type: 'tool', key: 'crm.check_send_pause', version: '1.0.0', status: 'active',
    phase_introduced: '2',
    name: 'Send Pause Gate',
    description: 'Checks whether outbound messaging is paused due to SES reputation event. Coordinator reads this before every email/SMS delegation.',
    capabilities: ['reputation_gate','dynamodb_read'],
    input_schema:  { tenantId: 'string' },
    output_schema: { paused: 'boolean', reason: 'string?', pausedAt: 'string?' },
    metadata: { triggeredBy: 'SES Reputation alarms', ttlHours: 24 },
  },
  {
    entry_type: 'tool', key: 'crm.check_metering_quota', version: '2.0.0', status: 'active',
    phase_introduced: '3',
    name: 'Metering Quota Check (Phase 3)',
    description: 'Real-time synchronous quota enforcement. Reads per-tenant usage counters from DynamoDB metering table. Fails open if metering table is unavailable.',
    capabilities: ['quota_enforcement','dynamodb_read','fail_open'],
    input_schema:  { tenantId: 'string', resource: 'string', amount: 'number' },
    output_schema: { allowed: 'boolean', used: 'number', quota: 'number', remaining: 'number' },
    metadata: { failOpenOnError: true, resources: ['llm_tokens','call_minutes','enrichment_lookups','agent_runs'] },
  },
  {
    entry_type: 'tool', key: 'crm.validate_template_compliance', version: '1.0.0', status: 'active',
    phase_introduced: '5',
    name: 'Template Compliance Validator',
    description: 'Validates actions against workspace template compliance rules. Enforces 5B fixed tone, FDCPA escalation threshold, and channel restrictions.',
    capabilities: ['tone_validation','escalation_check','channel_validation'],
    input_schema:  { templateKey: 'string', actionType: 'string', content: 'string?', daysOverdue: 'number?', amountUsd: 'number?' },
    output_schema: { allowed: 'boolean', reason: 'string?', escalateToHuman: 'boolean?' },
    metadata: { fdcpaEscalationDeterministic: true, toneFixedFor5B: true },
  },

  // ── Templates ─────────────────────────────────────────────────────────────

  {
    entry_type: 'template', key: 'recruiting_coordination', version: '1.0.0', status: 'active',
    phase_introduced: '5A',
    name: 'Recruiting Coordination',
    description: 'Interview confirmation, candidate outreach, and offer follow-up. Employment-communications compliance. Every schedule change requires human approval.',
    capabilities: ['candidate_outreach','interview_scheduling','offer_followup'],
    input_schema:  { candidateName: 'string', role: 'string', daysToInterview: 'number?' },
    output_schema: { touchesCompleted: 'number', latestStatus: 'string' },
    metadata: { compliance: 'employment_communications', requiresLegalReview: false },
  },
  {
    entry_type: 'template', key: 'accounts_receivable', version: '1.0.0', status: 'active',
    phase_introduced: '5B',
    name: 'Accounts Receivable Follow-up',
    description: 'Payment reminders — STRICTEST GUARDRAILS. Tone fixed; escalation ladder deterministic at day 30/$5K. FDCPA-adjacent. Legal review required.',
    capabilities: ['payment_reminder','escalation_ladder','fdcpa_compliance'],
    input_schema:  { invoiceNumber: 'string', amount: 'number', dueDate: 'string', daysOverdue: 'number' },
    output_schema: { touchesCompleted: 'number', escalatedToHuman: 'boolean' },
    metadata: { compliance: 'FDCPA_adjacent', requiresLegalReview: true, toneFixed: true },
  },
  {
    entry_type: 'template', key: 'vendor_ops_coordination', version: '1.0.0', status: 'active',
    phase_introduced: '5C',
    name: 'Vendor & Ops Coordination',
    description: 'Supplier status checks with structured result extraction (on_schedule/delayed/cancelled).',
    capabilities: ['status_extraction','structured_output'],
    input_schema:  { orderNumber: 'string', vendorName: 'string', expectedDate: 'string' },
    output_schema: { status: 'string', newEta: 'string?' },
    metadata: { compliance: 'B2B_standard', requiresLegalReview: false },
  },
  {
    entry_type: 'template', key: 'appointment_scheduling', version: '1.0.0', status: 'active',
    phase_introduced: '5D',
    name: 'Appointment Scheduling & Reminders',
    description: 'Highest-volume, least approval-gated. Binary confirm/reschedule/cancel outcomes for service businesses.',
    capabilities: ['appointment_confirmation','reminder_call'],
    input_schema:  { clientName: 'string', appointmentDate: 'string', service: 'string' },
    output_schema: { status: 'string', newTimePreference: 'string?' },
    metadata: { compliance: 'commercial_services', approvalGateMode: 'never', requiresLegalReview: false },
  },
  {
    entry_type: 'template', key: 'customer_success_renewal', version: '1.0.0', status: 'active',
    phase_introduced: '5E',
    name: 'Customer Success & Renewal',
    description: 'Churn prevention triggered by usage-decline (≥30%) or renewal within 60 days. Uses Forecasting agent for renewal-risk scoring.',
    capabilities: ['churn_prevention','renewal_discussion','save_call','risk_scoring'],
    input_schema:  { contactId: 'string', daysToRenewal: 'number', usageSignal: 'string' },
    output_schema: { touchesCompleted: 'number', renewalStatus: 'string' },
    metadata: { compliance: 'commercial_communications', requiresLegalReview: false, usesForecasting: true },
  },
];

// ── Upsert all entries ────────────────────────────────────────────────────────

export const handler: Handler = async () => {
  const db = await getDb();

  let upserted = 0;
  let failed   = 0;

  for (const entry of REGISTRY) {
    try {
      await db.query(
        `INSERT INTO agent_registry
           (entry_type, key, name, description, version, capabilities, input_schema,
            output_schema, phase_introduced, status, metadata)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb)
         ON CONFLICT (entry_type, key) DO UPDATE SET
           name             = EXCLUDED.name,
           description      = EXCLUDED.description,
           version          = EXCLUDED.version,
           capabilities     = EXCLUDED.capabilities,
           input_schema     = EXCLUDED.input_schema,
           output_schema    = EXCLUDED.output_schema,
           phase_introduced = EXCLUDED.phase_introduced,
           status           = EXCLUDED.status,
           metadata         = EXCLUDED.metadata,
           updated_at       = NOW()`,
        [
          entry.entry_type, entry.key, entry.name, entry.description, entry.version,
          JSON.stringify(entry.capabilities), JSON.stringify(entry.input_schema),
          JSON.stringify(entry.output_schema), entry.phase_introduced,
          entry.status, JSON.stringify(entry.metadata),
        ],
      );
      upserted++;
    } catch (err) {
      console.error('registry-seeder: upsert failed', { key: entry.key, error: (err as Error).message });
      failed++;
    }
  }

  await db.end();
  console.log(`Registry seeded: ${upserted} upserted, ${failed} failed`);
  return { upserted, failed, total: REGISTRY.length };
};

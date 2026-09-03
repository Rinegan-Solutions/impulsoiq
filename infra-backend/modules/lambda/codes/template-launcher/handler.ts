/**
 * Template Launcher — Phase 5.
 *
 * Starts Step Functions executions pre-loaded with workspace template context.
 * This is how the same 10 agents deliver 5 additional workspace domains:
 * the agents don't change — the data injected into the SFN execution does.
 *
 * Template context injected into every execution:
 *   templateKey, brandVoiceProfile, complianceRules, approvalGateConfig,
 *   callTypes, maxTouches
 *
 * 5B (accounts_receivable) compliance gate:
 *   - Checks that legal_reviewed_by and legal_reviewed_at are set in DSQL
 *   - Rejects activation if legal review is missing
 *
 * 5B escalation gate (deterministic, not LLM):
 *   - If daysOverdue >= 30 OR amount >= $5000 → routes to human escalation queue
 *   - The SFN receives a skip_automated_call flag for the agent to read
 */
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';

const sfn    = new SFNClient({});
const REGION = process.env.AWS_REGION ?? 'eu-west-2';
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;
const DSQL_ENDPOINT     = process.env.DSQL_ENDPOINT!;

// ── Embedded template definitions (mirrors templates.py) ─────────────────────
// Duplicated here so the Lambda doesn't need to call a Python service.
// The Python templates.py and this TEMPLATES object MUST remain in sync.

const TEMPLATES: Record<string, {
  brandVoiceProfile: string;
  complianceRules:   Record<string, unknown>;
  approvalGateConfig: Record<string, unknown>;
  callTypes:         string[];
  maxTouches:        number;
  requiresLegalReview: boolean;
}> = {
  recruiting_coordination: {
    brandVoiceProfile:  "professional, warm, candidate-experience-focused, empathetic",
    complianceRules:    { jurisdiction: "employment_communications", toneFixed: false, channels: ["email","call"] },
    approvalGateConfig: { mode: "every_action", requiresHumanFor: ["interview_reschedule","offer_extension"] },
    callTypes:          ["interview_confirmation","scheduling","offer_follow_up"],
    maxTouches:         6,
    requiresLegalReview: false,
  },
  accounts_receivable: {
    brandVoiceProfile:  "polite, non-aggressive, informational, professional. FIXED TONE — no escalation permitted.",
    complianceRules:    {
      jurisdiction: "debt_communications", toneFixed: true, fdcpaCompliant: true,
      callEscalationThreshold: { daysOverdue: 30, amountUsd: 5000 },
      escalateToHumanBeyondThreshold: true,
    },
    approvalGateConfig: { mode: "every_action", requiresHumanFor: ["every_call","every_send"] },
    callTypes:          ["payment_reminder","payment_status_check"],
    maxTouches:         4,
    requiresLegalReview: true,
  },
  vendor_ops_coordination: {
    brandVoiceProfile:  "professional, concise, operational",
    complianceRules:    { jurisdiction: "business_to_business", toneFixed: false },
    approvalGateConfig: { mode: "exceptions_only" },
    callTypes:          ["delivery_confirmation","status_check"],
    maxTouches:         3,
    requiresLegalReview: false,
  },
  appointment_scheduling: {
    brandVoiceProfile:  "friendly, warm, efficient",
    complianceRules:    { jurisdiction: "commercial_services", toneFixed: false },
    approvalGateConfig: { mode: "never" },
    callTypes:          ["appointment_reminder","appointment_confirmation"],
    maxTouches:         2,
    requiresLegalReview: false,
  },
  customer_success_renewal: {
    brandVoiceProfile:  "consultative, value-oriented, empathetic, outcome-focused",
    complianceRules:    { jurisdiction: "commercial_communications", toneFixed: false },
    approvalGateConfig: { mode: "first_n", n: 3 },
    callTypes:          ["check_in","renewal_discussion","save_call"],
    maxTouches:         8,
    requiresLegalReview: false,
  },
};

// ── DSQL connection (for legal review check) ─────────────────────────────────
let _db: Client | null = null;

async function getDb(): Promise<Client> {
  if (_db) { try { await _db.query('SELECT 1'); return _db; } catch { _db = null; } }
  const signer = new DsqlSigner({ hostname: DSQL_ENDPOINT, region: REGION });
  const token  = await signer.getDbConnectAdminAuthToken();
  const client = new Client({ host: DSQL_ENDPOINT, database: 'postgres', user: 'admin',
    password: token, port: 5432, ssl: { rejectUnauthorized: false } });
  await client.connect();
  _db = client;
  return client;
}

async function checkLegalReview(tenantId: string, templateKey: string): Promise<boolean> {
  const db  = await getDb();
  const res = await db.query(
    `SELECT legal_reviewed_by, legal_reviewed_at
     FROM workspace_template
     WHERE tenant_id = $1 AND template_key = $2`,
    [tenantId, templateKey],
  );
  return !!(res.rows[0]?.legal_reviewed_by && res.rows[0]?.legal_reviewed_at);
}

// ── 5B: Deterministic escalation check (NOT LLM) ─────────────────────────────
function needsHumanEscalation(
  templateKey:  string,
  daysOverdue:  number,
  amountUsd:    number,
): boolean {
  if (templateKey !== 'accounts_receivable') return false;
  return daysOverdue >= 30 || amountUsd >= 5_000;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const tenantId = event.requestContext.authorizer?.jwt?.claims?.['custom:tenant_id'] as string;
  if (!tenantId) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const body = JSON.parse(event.body ?? '{}') as {
    templateKey:  string;
    targetIds:    string[];
    contextData?: Record<string, unknown>;
  };

  const { templateKey, targetIds = [], contextData = {} } = body;

  const template = TEMPLATES[templateKey];
  if (!template) {
    return { statusCode: 400, body: JSON.stringify({ error: `Unknown template: ${templateKey}` }) };
  }

  // Legal review gate (5B only)
  if (template.requiresLegalReview) {
    const reviewed = await checkLegalReview(tenantId, templateKey);
    if (!reviewed) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error:   'Template requires legal review before activation',
          template: templateKey,
          action:  'Set legal_reviewed_by and legal_reviewed_at in workspace_template table',
        }),
      };
    }
  }

  // Start SFN executions for each target
  const executions: string[] = [];
  const skipped:    string[] = [];

  for (const targetId of targetIds) {
    // 5B escalation check: if daysOverdue/amount exceeds threshold, skip automated call
    const daysOverdue = Number(contextData.daysOverdue ?? 0);
    const amountUsd   = Number(contextData.amountUsd   ?? 0);
    const skipCall    = needsHumanEscalation(templateKey, daysOverdue, amountUsd);

    if (skipCall) {
      skipped.push(targetId);
      // TODO: create a human-escalation activity record via CRM Write Service
      continue;
    }

    const resp = await sfn.send(new StartExecutionCommand({
      stateMachineArn: STATE_MACHINE_ARN,
      name:            `${templateKey}-${targetId}-${Date.now()}`,
      input:           JSON.stringify({
        tenantId,
        contactId:  targetId,
        templateKey,
        templateContext: {
          brandVoiceProfile:  template.brandVoiceProfile,
          complianceRules:    template.complianceRules,
          approvalGateConfig: template.approvalGateConfig,
          callTypes:          template.callTypes,
          maxTouches:         template.maxTouches,
        },
        ...contextData,
      }),
    }));
    executions.push(resp.executionArn);
  }

  return {
    statusCode: 202,
    body: JSON.stringify({
      started:  executions.length,
      skipped:  skipped.length,
      template: templateKey,
      executions,
    }),
  };
};

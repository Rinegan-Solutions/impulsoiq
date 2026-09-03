/**
 * A2A Handoff Lambda — Phase 6C.
 *
 * Implements cross-department agent handoff using the Agent-to-Agent (A2A) protocol.
 * The primary use case: when a Sales deal reaches 'Closed Won', the system
 * automatically hands off to the Customer Success Renewal template (5E) with
 * full context — no manual re-entry into a "new" system.
 *
 * A2A agent card format (Google A2A spec v0.2):
 *   Each agent publishes metadata about its capabilities so receiving agents
 *   can understand what context they're inheriting.
 *
 * Trigger: DynamoDB Streams — filters for deal 'Closed Won' updates.
 *
 * Handoff flow:
 *   1. Detect deal Closed Won from DynamoDB Streams event
 *   2. Check if tenant has customer_success_renewal template active
 *   3. Build A2A context message (deal + contact + sales history)
 *   4. Invoke template-launcher with CS Renewal template + full context
 *   5. Write a2a_handoff record to DSQL via CRM Write Service
 *   6. Log a cross-system activity note
 */
import type { DynamoDBStreamHandler } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';

const lambda = new LambdaClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CRM_WRITE_ARN   = process.env.CRM_WRITE_SERVICE_ARN!;
const CRM_READ_ARN    = process.env.CRM_READ_SERVICE_ARN!;
const LAUNCHER_ARN    = process.env.TEMPLATE_LAUNCHER_ARN ?? '';
const DYNAMODB_TABLE  = process.env.DYNAMODB_TABLE!;

// ── A2A Agent Card (Google A2A spec v0.2) ─────────────────────────────────────
// Published so receiving agents understand the context they're inheriting.

const SALES_AGENT_CARD = {
  name:        'ImpulsoIQ Sales Coordinator',
  description: 'SDR qualification, outreach, and deal management agent',
  url:         'https://impulsoiq.rinegansolutions.com/.well-known/agents/coordinator',
  version:     '1.0.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
  defaultInputModes:  ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [{
    id:          'run_sales_campaign',
    name:        'Run Sales Campaign',
    description: 'Execute full SDR lead-qualification and deal-closing workflow',
    tags:        ['sales', 'crm', 'outreach', 'voice'],
  }],
};

const CS_AGENT_CARD = {
  name:        'ImpulsoIQ Customer Success Agent',
  description: 'Renewal management, churn prevention, and usage-signal monitoring',
  url:         'https://impulsoiq.rinegansolutions.com/.well-known/agents/customer-success',
  version:     '1.0.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
  defaultInputModes:  ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [{
    id:          'run_cs_renewal',
    name:        'Customer Success & Renewal',
    description: 'Proactive check-in and renewal discussion triggered by usage signals or deal closure',
    tags:        ['customer_success', 'renewal', 'churn_prevention'],
  }],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function invokeLambda(arn: string, payload: Record<string, unknown>) {
  if (!arn) return null;
  const resp = await lambda.send(new InvokeCommand({
    FunctionName:   arn,
    InvocationType: 'RequestResponse',
    Payload:        Buffer.from(JSON.stringify(payload)),
  }));
  return resp.Payload ? JSON.parse(Buffer.from(resp.Payload).toString()) : null;
}

async function checkTemplateActive(tenantId: string, templateKey: string): Promise<boolean> {
  const item = await dynamo.send(new GetCommand({
    TableName: DYNAMODB_TABLE,
    Key: {
      pk: `${tenantId}#template#${templateKey}`,
      sk: 'activation',
    },
  }));
  return item.Item?.status === 'active';
}

async function writeCrmRecord(op: string, payload: Record<string, unknown>, tenantId: string) {
  return invokeLambda(CRM_WRITE_ARN, {
    operation: op, payload, tenantId,
    actorType: 'agent', actorId: 'a2a-handoff',
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') continue;
    if (!record.dynamodb?.NewImage) continue;

    const image     = unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>);
    const tenantId  = image['tenantId']   as string | undefined;
    const entityType = image['entityType'] as string | undefined;
    const eventType  = image['eventType']  as string | undefined;
    const data       = image['data']       as Record<string, unknown> | undefined;

    // Only act on deal 'Closed Won' events
    if (entityType !== 'deal' || eventType !== 'updated') continue;
    if ((data?.stage ?? data?.deal_stage) !== 'Closed Won') continue;
    if (!tenantId) continue;

    const dealId    = image['entityId'] as string | undefined;
    const contactId = (data?.contact_id ?? data?.contactId) as string | undefined;

    if (!dealId || !contactId) continue;

    try {
      // 1. Check if tenant has CS Renewal template active
      const csActive = await checkTemplateActive(tenantId, 'customer_success_renewal');
      if (!csActive) {
        console.log('a2a-handoff: CS Renewal template not active', { tenantId, dealId });
        continue;
      }

      // 2. Read deal + contact context for the handoff message
      const [dealData, contactData] = await Promise.all([
        invokeLambda(CRM_READ_ARN, { operation: 'get_contact', payload: { id: contactId }, tenantId }),
        invokeLambda(CRM_READ_ARN, { operation: 'get_activity_history', payload: { contactId, limit: 5 }, tenantId }),
      ]);

      // 3. Build A2A context message
      const a2aContext = {
        // A2A-compliant handoff envelope
        protocol:    'a2a/0.2',
        fromAgent:   SALES_AGENT_CARD,
        toAgent:     CS_AGENT_CARD,
        taskId:      `handoff-${dealId}-${Date.now()}`,
        handoffType: 'closed_won_to_cs',

        // Context transferred to the CS agent
        deal: {
          id:     dealId,
          stage:  'Closed Won',
          amount: data?.amount,
          name:   data?.name,
        },
        contact:       contactData?.result,
        recentHistory: dealData?.result,
        salesNotes:    data?.customFields,
      };

      // 4. Trigger CS Renewal campaign via template-launcher
      if (LAUNCHER_ARN) {
        await invokeLambda(LAUNCHER_ARN, {
          tenantId,
          templateKey: 'customer_success_renewal',
          targetIds:   [contactId],
          contextData: {
            dealId,
            dealAmount:    data?.amount,
            handoffSource: 'sales_closed_won',
            a2aContext,
            daysToRenewal: 365,  // Default: 1-year renewal cycle
            usageSignal:   'new_customer_closed',
          },
        });
      }

      // 5. Write A2A handoff record via CRM Write Service
      await writeCrmRecord('upsert_activity', {
        contactId,
        type:      'note',
        actorType: 'agent',
        actorId:   'a2a-handoff',
        subject:   'A2A Handoff: Sales → Customer Success',
        body:      `Deal "${data?.name}" closed at ${data?.amount ? `$${data.amount}` : 'undisclosed'}. Automatically handed off to Customer Success Renewal workflow.`,
        metadata:  {
          handoffType:  'closed_won_to_cs',
          fromTemplate: 'sales',
          toTemplate:   'customer_success_renewal',
          a2aProtocol:  '0.2',
          dealId,
        },
      }, tenantId);

      console.log('a2a-handoff: handoff completed', { tenantId, dealId, contactId });

    } catch (err) {
      console.error('a2a-handoff: failed', {
        tenantId, dealId, error: (err as Error).message,
      });
    }
  }
};

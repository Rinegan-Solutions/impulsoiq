/**
 * CSAT Capture Lambda — Phase 8D.
 *
 * Receives CSAT survey responses submitted by customers after their
 * conversation is resolved. Updates conversation.csat_score in DSQL
 * and triggers Triage re-evaluation if the score is low (< 3.0).
 *
 * Per v4 §8D: if the customer replies with dissatisfaction, the Nurture
 * Agent re-triggers Triage rather than treating "resolved" as final.
 *
 * Invocation modes:
 *   1. Webhook POST from email survey click (common pattern: link in CSAT email)
 *   2. Chat widget inline rating
 *   3. SMS reply parsing ("Reply 1-5 to rate your support experience")
 */
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});

const CRM_WRITE_ARN      = process.env.CRM_WRITE_SERVICE_ARN!;
const CONNECT_INTAKE_ARN = process.env.CONNECT_INTAKE_ARN ?? '';

// CSAT threshold below which we re-trigger Triage (dissatisfied customer)
const DISSATISFIED_THRESHOLD = 3.0;

async function invokeLambda(arn: string, payload: Record<string, unknown>) {
  if (!arn) return null;
  const resp = await lambda.send(new InvokeCommand({
    FunctionName:   arn,
    InvocationType: 'RequestResponse',
    Payload:        Buffer.from(JSON.stringify(payload)),
  }));
  return resp.Payload ? JSON.parse(Buffer.from(resp.Payload).toString()) : null;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const body = JSON.parse(event.body ?? '{}') as {
    tenantId:       string;
    conversationId: string;
    score:          number;  // 1.0 to 5.0
    comment?:       string;
    channel?:       string;  // how the CSAT was submitted
  };

  const { tenantId, conversationId, score, comment, channel = 'survey' } = body;

  if (!tenantId || !conversationId || score === undefined) {
    return { statusCode: 400, body: JSON.stringify({ error: 'tenantId, conversationId, score required' }) };
  }

  if (score < 1 || score > 5) {
    return { statusCode: 400, body: JSON.stringify({ error: 'score must be 1.0–5.0' }) };
  }

  // 1. Persist the CSAT score on the conversation
  await invokeLambda(CRM_WRITE_ARN, {
    operation: 'update_csat_score',
    payload: {
      conversationId,
      csatScore:          score,
      csatCapturedAt:     new Date().toISOString(),
      csatComment:        comment ?? null,
      csatChannel:        channel,
    },
    tenantId,
    actorId:   'csat-capture',
    actorType: 'agent',
  });

  // 2. If the customer is dissatisfied, re-trigger Triage — don't leave it as "resolved"
  if (score < DISSATISFIED_THRESHOLD) {
    console.log('csat-capture: low score detected — re-opening conversation for Triage', {
      conversationId, score, tenantId,
    });

    await invokeLambda(CRM_WRITE_ARN, {
      operation: 'resolve_conversation',
      payload: {
        id:         conversationId,
        status:     'open',           // re-open
        resolvedAt: null,             // clear resolved_at
      },
      tenantId,
      actorId:   'csat-capture',
      actorType: 'agent',
    });

    // Re-invoke connect-intake (which will call Triage) with the dissatisfaction context
    if (CONNECT_INTAKE_ARN) {
      await invokeLambda(CONNECT_INTAKE_ARN, {
        tenantId,
        contactId:    undefined,
        channel:      channel,
        body:         `[CSAT re-open] Customer rated their support ${score}/5. Comment: "${comment ?? 'no comment'}". Please follow up.`,
        sentimentScore: (score - 3) / 2,  // map 1-5 to -1 to 1
      });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true, conversationId, score }),
  };
};

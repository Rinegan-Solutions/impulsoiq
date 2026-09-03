/**
 * Connect Intake Lambda — Phase 7.
 *
 * Bridge between Amazon Connect Contact Flows and ImpulsoIQ's data model.
 * Invoked by Connect for every new inbound contact (voice, chat, email).
 *
 * Two invocation modes:
 *   1. From Amazon Connect Contact Flow: event has ConnectContactId, Channel
 *   2. From direct API Gateway: event has message body for email/SMS/social intake
 *
 * Responsibilities:
 *   1. Create or look up the Conversation record via CRM Write Service
 *   2. Append the new Message record
 *   3. Invoke the Triage & Escalation Agent to classify and route
 *   4. Return routing instructions to Amazon Connect (for mode 1)
 *
 * Architecture note (v4 §7A): Connect provides telephony/chat transport.
 * ImpulsoIQ's Triage agent is the reasoning layer — NOT Q in Connect.
 * Every classification goes through the Control Panel and Cedar policy.
 */
import type { Handler } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});

const CRM_WRITE_ARN   = process.env.CRM_WRITE_SERVICE_ARN!;
const TRIAGE_AGENT_ARN = process.env.TRIAGE_AGENT_ARN ?? '';

interface ConnectContactFlowEvent {
  ContactId?:  string;
  Channel?:    'VOICE' | 'CHAT';
  Attributes?: Record<string, string>;
  Name?:       string;
}

interface DirectIntakeEvent {
  tenantId:     string;
  contactId?:   string;
  channel:      'email' | 'sms' | 'social';
  body:         string;
  senderInfo?:  { email?: string; phone?: string };
  sentimentScore?: number;
}

async function invokeLambda(arn: string, payload: Record<string, unknown>) {
  if (!arn) return null;
  const resp = await lambda.send(new InvokeCommand({
    FunctionName:   arn,
    InvocationType: 'RequestResponse',
    Payload:        Buffer.from(JSON.stringify(payload)),
  }));
  return resp.Payload ? JSON.parse(Buffer.from(resp.Payload).toString()) : null;
}

async function upsertConversation(tenantId: string, contactId: string | undefined, channel: string, connectContactId?: string) {
  return invokeLambda(CRM_WRITE_ARN, {
    operation: 'upsert_conversation',
    payload: {
      contactId:         contactId ?? null,
      channelHistory:    [{ channel, timestamp: new Date().toISOString() }],
      status:            'open',
      connectContactId:  connectContactId ?? null,
    },
    tenantId,
    actorId: 'connect-intake',
    actorType: 'agent',
  });
}

async function appendMessage(tenantId: string, conversationId: string, channel: string, body: string, sentimentScore?: number) {
  return invokeLambda(CRM_WRITE_ARN, {
    operation: 'upsert_message',
    payload: {
      conversationId,
      channel,
      senderType:    'customer',
      body:          body?.slice(0, 10000), // cap at 10K chars
      sentimentScore: sentimentScore ?? null,
    },
    tenantId,
    actorId: 'connect-intake',
    actorType: 'agent',
  });
}

export const handler: Handler = async (event) => {
  const isConnectEvent = !!(event as ConnectContactFlowEvent).ContactId;

  if (isConnectEvent) {
    // Mode 1: Amazon Connect Contact Flow invocation
    const ce      = event as ConnectContactFlowEvent;
    const tenantId = ce.Attributes?.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const channel  = (ce.Channel ?? 'VOICE').toLowerCase() as 'voice' | 'chat';

    if (!tenantId) {
      console.error('connect-intake: no tenantId in Connect contact attributes');
      return { Lambda_Invocation_Type: 'InProgress', Lambda_Result: 'ERROR_NO_TENANT' };
    }

    // Create conversation + first message
    const convResult  = await upsertConversation(tenantId, undefined, channel, ce.ContactId);
    const convId      = convResult?.id;

    if (convId) {
      await appendMessage(tenantId, convId, channel, `[${channel} contact started]`);

      // Invoke Triage & Escalation Agent
      if (TRIAGE_AGENT_ARN) {
        const triage = await invokeLambda(TRIAGE_AGENT_ARN, { tenantId, conversationId: convId });
        const tier   = triage?.result ? (JSON.parse(triage.result || '{}') as { tier?: number }).tier ?? 1 : 1;

        // Return routing instruction to Connect Contact Flow
        return {
          Lambda_Invocation_Type: 'InProgress',
          tier:                   String(tier),
          conversationId:         convId,
          queueId:                triage?.queueId ?? 'default',
        };
      }
    }

    return { Lambda_Invocation_Type: 'InProgress', tier: '1', conversationId: convId ?? null };

  } else {
    // Mode 2: Direct API intake (email/SMS/social)
    const de = event as DirectIntakeEvent;

    if (!de.tenantId) return { statusCode: 400, body: 'tenantId required' };

    const convResult  = await upsertConversation(de.tenantId, de.contactId, de.channel);
    const convId      = convResult?.id;

    if (convId) {
      await appendMessage(de.tenantId, convId, de.channel, de.body, de.sentimentScore);

      if (TRIAGE_AGENT_ARN) {
        await invokeLambda(TRIAGE_AGENT_ARN, {
          tenantId:          de.tenantId,
          conversationId:    convId,
          latestMessageBody: de.body,
          sentimentScore:    de.sentimentScore,
        });
      }
    }

    return { statusCode: 202, body: JSON.stringify({ conversationId: convId }) };
  }
};

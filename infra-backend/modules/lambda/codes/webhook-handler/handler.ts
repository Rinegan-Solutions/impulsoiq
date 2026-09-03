/**
 * Webhook Handler — receives CALL-E CallCompleted webhooks.
 *
 * Phase 2 update: also resumes Step Functions executions that are
 * waiting on a task token (PlaceVoiceCall waitForTaskToken state).
 *
 * Flow:
 * 1. Parse the CALL-E payload (callId, outcome, durationSeconds, idempotencyKey)
 * 2. Look up the taskToken stored in DynamoDB when the voice agent placed the call
 * 3. Call sfn.SendTaskSuccess to resume the paused SFN execution
 * 4. Publish to EventBridge (belt-and-suspenders for other consumers)
 *
 * DynamoDB key for task tokens:
 *   PK: {tenantId}#call_tasks#{idempotencyKey}
 *   SK: task_token
 */
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const eb    = new EventBridgeClient({});
const sfn   = new SFNClient({});
const ddb   = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const EVENT_BUS     = process.env.EVENT_BUS_ARN!;
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE!;

interface CalleWebhookPayload {
  tenantId?:         string;
  callId:            string;
  outcome:           string; // answered | voicemail | no_answer | busy | failed
  durationSeconds:   number;
  transcriptUrl?:    string;
  transcriptS3Key?:  string;
  summaryJson?:      Record<string, unknown>;
  idempotencyKey:    string;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const body = JSON.parse(event.body ?? '{}') as CalleWebhookPayload;

  // 1. Publish to EventBridge first (belt-and-suspenders — other consumers may listen)
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS,
      Source:       'calle.webhook',
      DetailType:   'CallCompleted',
      Detail:       JSON.stringify(body),
    }],
  }));

  // 2. Look up the Step Functions task token stored by the voice agent
  if (body.idempotencyKey) {
    const tenantId = body.tenantId ?? 'unknown';
    const pk       = `${tenantId}#call_tasks#${body.idempotencyKey}`;

    try {
      const res = await ddb.send(new GetCommand({
        TableName: DYNAMODB_TABLE,
        Key:       { pk, sk: 'task_token' },
      }));

      if (res.Item?.taskToken) {
        const taskToken = res.Item.taskToken as string;

        if (body.outcome === 'failed') {
          // Resume Step Functions with a failure so HandleError catch fires
          await sfn.send(new SendTaskFailureCommand({
            taskToken,
            error:  'CALL_FAILED',
            cause:  JSON.stringify({ callId: body.callId, outcome: body.outcome }),
          }));
        } else {
          // Resume Step Functions with the call result
          await sfn.send(new SendTaskSuccessCommand({
            taskToken,
            output: JSON.stringify({
              callId:           body.callId,
              outcome:          body.outcome,
              durationSeconds:  body.durationSeconds,
              transcriptS3Key:  body.transcriptS3Key ?? body.transcriptUrl ?? null,
              summaryJson:      body.summaryJson ?? {},
              idempotencyKey:   body.idempotencyKey,
            }),
          }));
        }

        console.log('Step Functions resumed', { taskToken: taskToken.substring(0, 20) + '...', outcome: body.outcome });
      } else {
        console.warn('No task token found for idempotency key', body.idempotencyKey);
      }
    } catch (err) {
      // Log but don't fail — EventBridge already published; SFN heartbeat will timeout naturally
      console.error('Failed to resume Step Functions', { error: (err as Error).message });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

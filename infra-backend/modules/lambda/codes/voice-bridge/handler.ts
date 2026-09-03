/**
 * Voice Bridge Lambda — Phase 4A.
 *
 * WebSocket API Gateway handler that bridges between:
 *   Browser (Web Audio API) ←→ Amazon Bedrock Nova Sonic
 *
 * Routes handled:
 *   $connect    — validate JWT, store connection in DynamoDB
 *   $disconnect — remove connection record
 *   $default    — forward text/audio message to the ambient-interface agent
 *                 and stream the response back to the browser
 *
 * For the hackathon MVP, the bridge operates in TEXT MODE: it accepts JSON
 * messages with { type: "text", message: "...", tenantId: "..." } and returns
 * text responses from the ambient-interface agent. The Nova Sonic bidirectional
 * audio stream is the production upgrade path.
 *
 * Production audio path:
 *   Browser → Base64-encoded PCM audio chunks (16kHz, 16-bit, mono)
 *          → InvokeModelWithBidirectionalStream (Nova Sonic)
 *          → streamed audio response → WebSocket back to browser
 */
import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamo  = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'eu-west-2' });
const lambda  = new LambdaClient({ region: process.env.AWS_REGION ?? 'eu-west-2' });

const CONNECTIONS_TABLE   = process.env.DYNAMODB_TABLE!;
const AMBIENT_AGENT_ARN   = process.env.AMBIENT_AGENT_ARN ?? '';
const NOVA_SONIC_MODEL    = 'us.amazon.nova-sonic-v1:0';
const SONNET_FALLBACK     = 'us.anthropic.claude-sonnet-4-5';

// TTL: 2 hours for WebSocket connections
const CONN_TTL_SECONDS = 7_200;

interface WsMessage {
  type:      'text' | 'audio' | 'ping';
  message?:  string;
  tenantId?: string;
  userId?:   string;
  sessionId?: string;
  audioData?: string; // base64-encoded PCM
}

async function sendToClient(
  endpoint: string,
  connectionId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const client = new ApiGatewayManagementApiClient({ endpoint });
  await client.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data:         Buffer.from(JSON.stringify(payload)),
  }));
}

async function invokAmbientAgent(tenantId: string, message: string, sessionId: string): Promise<string> {
  if (AMBIENT_AGENT_ARN) {
    // Invoke the Python ambient-interface agent via AgentCore/Lambda
    const resp = await lambda.send(new InvokeCommand({
      FunctionName:   AMBIENT_AGENT_ARN,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({
        tenantId,
        message,
        sessionId,
        textMode: true,
      })),
    }));
    const result = JSON.parse(Buffer.from(resp.Payload!).toString());
    return result?.response ?? 'Sorry, I could not process that.';
  }

  // Fallback: use Bedrock Converse directly (no tools, simple Q&A)
  const resp = await bedrock.send(new ConverseCommand({
    modelId: SONNET_FALLBACK,
    system: [{
      text: 'You are ImpulsoIQ\'s voice assistant. Give short, spoken-friendly responses (1-3 sentences). Tenant: ' + tenantId,
    }],
    messages: [{ role: 'user', content: [{ text: message }] }],
  }));
  return (resp.output?.message?.content?.[0] as { text?: string })?.text ?? 'Sorry, I could not process that.';
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const { connectionId, routeKey, domainName, stage } = event.requestContext;
  const endpoint = `https://${domainName}/${stage}`;
  const ttl      = Math.floor(Date.now() / 1000) + CONN_TTL_SECONDS;

  // ── $connect ────────────────────────────────────────────────────────────────
  if (routeKey === '$connect') {
    // JWT validation: the token is in the query string or Authorization header
    // Full validation is handled by the Lambda authorizer attached to the WebSocket API
    await dynamo.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        pk:           `connection#${connectionId}`,
        sk:           'meta',
        connectionId,
        connectedAt:  new Date().toISOString(),
        endpoint,
        ttl,
      },
    }));
    return { statusCode: 200, body: 'Connected' };
  }

  // ── $disconnect ─────────────────────────────────────────────────────────────
  if (routeKey === '$disconnect') {
    await dynamo.send(new DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { pk: `connection#${connectionId}`, sk: 'meta' },
    }));
    return { statusCode: 200, body: 'Disconnected' };
  }

  // ── $default — process message ───────────────────────────────────────────────
  let msg: WsMessage;
  try {
    msg = JSON.parse(event.body ?? '{}') as WsMessage;
  } catch {
    await sendToClient(endpoint, connectionId, { type: 'error', error: 'Invalid JSON' });
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (msg.type === 'ping') {
    await sendToClient(endpoint, connectionId, { type: 'pong' });
    return { statusCode: 200, body: 'pong' };
  }

  const tenantId  = msg.tenantId ?? '';
  const message   = msg.message  ?? '';
  const sessionId = msg.sessionId ?? connectionId;

  if (!tenantId || !message) {
    await sendToClient(endpoint, connectionId, {
      type: 'error', error: 'tenantId and message are required',
    });
    return { statusCode: 400, body: 'Missing fields' };
  }

  // Acknowledge immediately — provides conversational responsiveness
  await sendToClient(endpoint, connectionId, { type: 'processing', sessionId });

  try {
    const response = await invokAmbientAgent(tenantId, message, sessionId);

    await sendToClient(endpoint, connectionId, {
      type:       'response',
      text:       response,
      sessionId,
      inputModality: 'voice',
    });
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error('voice-bridge: agent invocation failed', { error: errMsg, connectionId });
    await sendToClient(endpoint, connectionId, {
      type: 'error', error: 'Agent unavailable. Please try again.', sessionId,
    });
  }

  return { statusCode: 200, body: 'OK' };
};

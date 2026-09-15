/**
 * Voice Bridge Lambda — Phase 4A.
 *
 * WebSocket API Gateway handler between the browser and the ambient-interface
 * agent. Speech-to-speech: the browser sends {type:"start"} and receives a
 * SigV4-presigned AgentCore /ws URL (BidiAgent + Nova Sonic). Typed fallback
 * still uses {type:"text"} → InvokeAgentRuntime HTTP.
 *
 * SECURITY MODEL
 * This handler used to store connections without authenticating them and take
 * the workspace from `msg.tenantId` in each message — so anyone who could reach
 * the WebSocket URL could put questions to any workspace's assistant, whose
 * tools read that workspace's pipeline, calls and approvals.
 *
 *   $connect   Browsers cannot set headers on a WebSocket, and API Gateway
 *              allows authorisation only on $connect, so the Cognito ID token
 *              arrives as ?token=. It is verified here — RS256 signature against
 *              this pool's JWKS, issuer (our pool), audience (the web client),
 *              token_use=id, expiry — and the account must hold a workspace
 *              group, the same membership rule crm-read/crm-write enforce. An
 *              optional ?workspace= that disagrees with the claim is refused,
 *              mirroring the x-impulsoiq-tenant check. A non-2xx response from
 *              $connect makes API Gateway reject the upgrade.
 *   $default   The workspace and user come ONLY from the identity stored on the
 *              connection record at $connect. Nothing tenant-shaped in a message
 *              is read. A connection whose token has expired is told to
 *              reconnect (code "session_expired") and closed. The presigned
 *              AgentCore URL also carries that same tenant/user as custom query
 *              params; the container binds tools to that workspace.
 */
import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { formatUrl } from '@aws-sdk/util-format-url';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const REGION = process.env.AWS_REGION ?? 'eu-west-2';

const dynamo    = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});
const bedrock   = new BedrockRuntimeClient({ region: REGION });
const agentcore = new BedrockAgentCoreClient({ region: REGION });
const ssm       = new SSMClient({ region: REGION });
const lambda    = new LambdaClient({ region: REGION });

const CONNECTIONS_TABLE = process.env.DYNAMODB_TABLE!;

// Used only when the ambient agent's ARN cannot be resolved. Nova 2 Lite is the
// roster model; in eu-west-2 it is reachable only through the global profile.
// (This was a us.* Claude profile, which does not resolve in eu-west-2.)
const TEXT_FALLBACK_MODEL = 'global.amazon.nova-2-lite-v1:0';

const CONN_TTL_SECONDS  = 7_200;
const MAX_MESSAGE_CHARS = 4_000;
const FALLBACK_REPLY    = 'Sorry, I could not process that.';

const WORKSPACE_ROLES = new Set(['admin', 'manager', 'member']);
// Same grammar as tenant.id's CHECK constraint.
const SLUG       = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const SESSION_ID = /^[A-Za-z0-9-]{16,56}$/;

interface WsMessage {
  type:       'text' | 'audio' | 'ping' | 'start';
  message?:   string;
  sessionId?: string;
}

/** Bound to a connection at $connect from a verified token. The only source of identity for $default. */
interface ConnectionIdentity {
  tenantId: string;
  userId:   string;
  /** ID-token expiry, epoch seconds. */
  tokenExp: number;
}

// ── SSM parameters (warm-cached) ─────────────────────────────────────────────
// Read at runtime rather than injected by Terraform: the pool lives in the auth
// module, which already depends on this module.

const paramCache = new Map<string, string>();

async function ssmParam(envVar: string): Promise<string> {
  const name = process.env[envVar];
  if (!name) throw new Error(`${envVar} is not set`);
  const cached = paramCache.get(name);
  if (cached) return cached;
  const resp = await ssm.send(new GetParameterCommand({ Name: name }));
  const value = resp.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} is empty`);
  paramCache.set(name, value);
  return value;
}

// ── Token verification ───────────────────────────────────────────────────────

const jwksClients = new Map<string, ReturnType<typeof jwksClient>>();

function jwksFor(issuer: string) {
  let client = jwksClients.get(issuer);
  if (!client) {
    client = jwksClient({
      jwksUri: `${issuer}/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 600_000,
      cacheMaxEntries: 5,
      // An unknown kid triggers a fetch; rate-limit so forged tokens cannot turn
      // this function into a JWKS request amplifier.
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    jwksClients.set(issuer, client);
  }
  return client;
}

class Refused extends Error {
  constructor(public readonly statusCode: 401 | 403, reason: string) {
    super(reason);
  }
}

async function verifyConnect(token: string, workspace: string): Promise<ConnectionIdentity> {
  if (!token) throw new Refused(401, 'missing token');

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
    throw new Refused(401, 'malformed token');
  }

  const [poolId, clientId] = await Promise.all([
    ssmParam('USER_POOL_ID_SSM_PATH'),
    ssmParam('USER_POOL_CLIENT_ID_SSM_PATH'),
  ]);
  const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${poolId}`;

  let payload: jwt.JwtPayload;
  try {
    const key = await jwksFor(issuer).getSigningKey(decoded.header.kid);
    // issuer pins OUR pool, audience pins the web client (an ID token's aud is
    // the client id), and verify() rejects expired tokens.
    payload = jwt.verify(token, key.getPublicKey(), {
      algorithms: ['RS256'],
      issuer,
      audience: clientId,
    }) as jwt.JwtPayload;
  } catch (err) {
    throw new Refused(401, `invalid token: ${(err as Error).message}`);
  }

  // Access tokens carry no custom attributes; only ID tokens identify a workspace.
  if (payload.token_use !== 'id') throw new Refused(401, 'not an ID token');

  const tenantId = typeof payload['custom:tenant_id'] === 'string' ? payload['custom:tenant_id'] : '';
  if (!SLUG.test(tenantId)) throw new Refused(403, 'no workspace claim');

  const rawGroups = payload['cognito:groups'];
  const groups = Array.isArray(rawGroups) ? rawGroups.map(String) : [];
  if (!groups.some((g) => WORKSPACE_ROLES.has(g))) throw new Refused(403, 'no workspace membership');

  if (workspace && workspace !== tenantId) throw new Refused(403, 'workspace mismatch');

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    throw new Refused(401, 'token missing sub or exp');
  }
  return { tenantId, userId: payload.sub, tokenExp: payload.exp };
}

// ── Client I/O ───────────────────────────────────────────────────────────────

async function sendToClient(endpoint: string, connectionId: string, payload: Record<string, unknown>): Promise<void> {
  const client = new ApiGatewayManagementApiClient({ endpoint });
  await client.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data:         Buffer.from(JSON.stringify(payload)),
  }));
}

async function closeConnection(endpoint: string, connectionId: string): Promise<void> {
  try {
    await new ApiGatewayManagementApiClient({ endpoint }).send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
  } catch (err) {
    // Already gone — nothing to close.
    console.warn('voice-bridge: close failed', { connectionId, error: (err as Error).message });
  }
}

// ── Agent invocation ─────────────────────────────────────────────────────────

/** Collect InvokeAgentRuntime's streamed body into a string. */
async function readBody(body: unknown): Promise<string> {
  if (body == null) return '';
  const maybe = body as { transformToString?: () => Promise<string> };
  if (typeof maybe.transformToString === 'function') return maybe.transformToString();
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (typeof body === 'string') return body;
  const iterable = body as AsyncIterable<Uint8Array>;
  if (typeof iterable[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of iterable) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }
  return String(body);
}

function spokenText(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t || null;
  }
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (obj.ok === false) {
    throw new Error(typeof obj.error === 'string' ? obj.error : 'agent returned an error');
  }
  for (const key of ['response', 'text', 'message', 'output', 'result']) {
    const inner = obj[key];
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
    if (inner && typeof inner === 'object' && inner !== value) {
      const nested = spokenText(inner);
      if (nested) return nested;
    }
  }
  if (Array.isArray(obj.content)) {
    const bits = obj.content
      .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string'
        ? (c as { text: string }).text
        : ''))
      .filter(Boolean);
    if (bits.length) return bits.join(' ').trim();
  }
  return null;
}

function extractReply(raw: string): string {
  let parsed: unknown = raw;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { /* plain-text reply */ }
  // AgentCore sometimes wraps the agent JSON as a string field.
  if (typeof parsed === 'string') {
    const inner = parsed.trim();
    try {
      parsed = JSON.parse(inner);
    } catch {
      return inner || FALLBACK_REPLY;
    }
  }
  return spokenText(parsed) ?? FALLBACK_REPLY;
}

function runtimeSessionId(tenantId: string, userId: string, sessionId: string): string {
  // AgentCore always forwards Session-Id to the container. Custom TenantId/UserId
  // headers are stripped unless the runtime allowlist is applied, so identity
  // also rides in this id: {tenant}__{user}__{session}.
  const raw = `${tenantId}__${userId}__${sessionId}`.replace(/[^A-Za-z0-9_-]/g, '');
  if (raw.length >= 33) return raw.slice(0, 256);
  return (raw + 'x'.repeat(33)).slice(0, 256);
}

/** Browser cannot SigV4 the AgentCore handshake, so this Lambda mints a 5-minute URL. */
async function presignBidiUrl(identity: ConnectionIdentity, sessionId: string): Promise<string> {
  const agentRuntimeArn = await ssmParam('AMBIENT_AGENT_ARN_SSM_PATH');
  const hostname = `bedrock-agentcore.${REGION}.amazonaws.com`;
  // Match AgentCoreRuntimeClient.generate_presigned_url: quote the ARN as one
  // path segment (":" and "/" → %3A / %2F) and let SigV4 double-escape that
  // segment in the canonical URI (% → %25). uriEscapePath: false signed the
  // single-encoded path and AgentCore returned 403 on the browser handshake.
  // https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-websocket.html
  const path = `/runtimes/${encodeURIComponent(agentRuntimeArn)}/ws`;
  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: REGION,
    service: 'bedrock-agentcore',
    sha256: Sha256,
    uriEscapePath: true,
  });
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'https:',
    hostname,
    path,
    query: {
      qualifier: 'DEFAULT',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': runtimeSessionId(identity.tenantId, identity.userId, sessionId),
      'X-Amzn-Bedrock-AgentCore-Runtime-Custom-TenantId': identity.tenantId,
      'X-Amzn-Bedrock-AgentCore-Runtime-Custom-UserId': identity.userId,
    },
    headers: { host: hostname },
  });
  const signed = await signer.presign(request, { expiresIn: 300 });
  return formatUrl(signed).replace(/^https:/, 'wss:');
}

async function invokeAmbientAgent(identity: ConnectionIdentity, message: string, sessionId: string): Promise<string> {
  // The runtime ARN is published to SSM by the root module. The previous code
  // read process.env.AMBIENT_AGENT_ARN, which Terraform never set, and would
  // have called lambda:InvokeFunction on it — an AgentCore runtime is not a
  // Lambda, so the assistant always fell through to a toolless model call.
  let agentRuntimeArn = '';
  try {
    agentRuntimeArn = await ssmParam('AMBIENT_AGENT_ARN_SSM_PATH');
  } catch (err) {
    console.warn('voice-bridge: ambient agent ARN unavailable, using direct model', { error: (err as Error).message });
  }

  if (agentRuntimeArn) {
    const resp = await agentcore.send(new InvokeAgentRuntimeCommand({
      agentRuntimeArn,
      qualifier: 'DEFAULT',
      // AgentCore scopes session memory by this id (min 33 chars). Prefixing the
      // user keeps one person's conversation out of another's.
      runtimeSessionId: runtimeSessionId(identity.tenantId, identity.userId, sessionId),
      payload: Buffer.from(JSON.stringify({
        tenantId: identity.tenantId,
        userId:   identity.userId,
        message,
        sessionId,
        textMode: true,
      }), 'utf8'),
    }));
    return extractReply(await readBody(resp.response));
  }

  const resp = await bedrock.send(new ConverseCommand({
    modelId: TEXT_FALLBACK_MODEL,
    system: [{ text: "You are ImpulsoIQ's voice assistant. Give short, spoken-friendly responses (1-3 sentences)." }],
    messages: [{ role: 'user', content: [{ text: message }] }],
  }));
  const block = resp.output?.message?.content?.find((c) => 'text' in c && typeof c.text === 'string');
  return (block as { text?: string } | undefined)?.text ?? FALLBACK_REPLY;
}

// ── Handler ──────────────────────────────────────────────────────────────────

interface AsyncWork {
  asyncWork: true;
  connectionId: string;
  endpoint: string;
  identity: ConnectionIdentity;
  message: string;
  sessionId: string;
}

function isAsyncWork(event: unknown): event is AsyncWork {
  return Boolean(event && typeof event === 'object' && (event as AsyncWork).asyncWork === true);
}

async function handleAsyncWork(work: AsyncWork): Promise<{ statusCode: number; body: string }> {
  try {
    const text = await invokeAmbientAgent(work.identity, work.message, work.sessionId);
    await sendToClient(work.endpoint, work.connectionId, {
      type: 'response', text, sessionId: work.sessionId, inputModality: 'voice',
    });
  } catch (err) {
    console.error('voice-bridge: agent invocation failed', {
      error: (err as Error).message, connectionId: work.connectionId, tenantId: work.identity.tenantId,
    });
    await sendToClient(work.endpoint, work.connectionId, {
      type: 'error', error: 'The assistant is unavailable. Please try again.', sessionId: work.sessionId,
    }).catch(() => undefined);
  }
  return { statusCode: 200, body: 'OK' };
}

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  if (isAsyncWork(event as unknown)) return handleAsyncWork(event as unknown as AsyncWork);

  const { connectionId, routeKey, domainName, stage } = event.requestContext;
  const endpoint = `https://${domainName}/${stage}`;
  const key      = { pk: `connection#${connectionId}`, sk: 'meta' };

  // ── $connect ────────────────────────────────────────────────────────────────
  if (routeKey === '$connect') {
    const qs = (event as unknown as { queryStringParameters?: Record<string, string | undefined> })
      .queryStringParameters ?? {};

    let identity: ConnectionIdentity;
    try {
      identity = await verifyConnect(qs.token ?? '', (qs.workspace ?? '').trim().toLowerCase());
    } catch (err) {
      if (err instanceof Refused) {
        console.warn('voice-bridge: connection refused', { connectionId, reason: err.message });
        return { statusCode: err.statusCode, body: err.statusCode === 401 ? 'Unauthorized' : 'Forbidden' };
      }
      console.error('voice-bridge: connect verification failed', { connectionId, error: (err as Error).message });
      return { statusCode: 500, body: 'Error' };
    }

    await dynamo.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        ...key,
        connectionId,
        connectedAt: new Date().toISOString(),
        endpoint,
        ttl: Math.floor(Date.now() / 1000) + CONN_TTL_SECONDS,
        ...identity,
      },
    }));
    return { statusCode: 200, body: 'Connected' };
  }

  // ── $disconnect ─────────────────────────────────────────────────────────────
  if (routeKey === '$disconnect') {
    await dynamo.send(new DeleteCommand({ TableName: CONNECTIONS_TABLE, Key: key }));
    return { statusCode: 200, body: 'Disconnected' };
  }

  // ── $default ────────────────────────────────────────────────────────────────
  const record   = await dynamo.send(new GetCommand({ TableName: CONNECTIONS_TABLE, Key: key }));
  const identity = record.Item as Partial<ConnectionIdentity> | undefined;

  // No identity: a connection opened before $connect verification existed, or
  // a record already expired. Expired token: the connection outlived the hour.
  // Either way the client must reconnect with a fresh token.
  const expired = !identity?.tenantId || !identity.userId || !identity.tokenExp
    || identity.tokenExp * 1000 <= Date.now();
  if (expired) {
    await sendToClient(endpoint, connectionId, {
      type: 'error', code: 'session_expired', error: 'Your session expired. Reconnecting…',
    }).catch(() => undefined);
    await closeConnection(endpoint, connectionId);
    return { statusCode: 401, body: 'Unauthorized' };
  }
  const who = identity as ConnectionIdentity;

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

  const sessionId = msg.sessionId && SESSION_ID.test(msg.sessionId)
    ? msg.sessionId
    : connectionId.replace(/[^A-Za-z0-9-]/g, '');

  if (msg.type === 'start') {
    try {
      const url = await presignBidiUrl(who, sessionId);
      await sendToClient(endpoint, connectionId, {
        type: 'bidi_session',
        url,
        sessionId,
        inputSampleRate: 16000,
        outputSampleRate: 24000,
      });
    } catch (err) {
      console.warn('voice-bridge: bidi presign failed', { error: (err as Error).message, tenantId: who.tenantId });
      await sendToClient(endpoint, connectionId, {
        type: 'bidi_unavailable',
        error: 'Live voice is unavailable. You can still type.',
        sessionId,
      });
    }
    return { statusCode: 200, body: 'bidi' };
  }

  const message = typeof msg.message === 'string' ? msg.message.trim() : '';
  if (msg.type !== 'text' || !message) {
    await sendToClient(endpoint, connectionId, { type: 'error', error: 'A text message is required.' });
    return { statusCode: 400, body: 'Missing message' };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    await sendToClient(endpoint, connectionId, { type: 'error', error: `Messages are limited to ${MAX_MESSAGE_CHARS} characters.` });
    return { statusCode: 400, body: 'Message too long' };
  }

  // Acknowledge immediately, then finish the agent call on a second invocation.
  // WebSocket integrations time out at 29s; a tool-using agent routinely takes longer.
  await sendToClient(endpoint, connectionId, { type: 'processing', sessionId });

  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    await sendToClient(endpoint, connectionId, {
      type: 'error', error: 'The assistant is not configured.', sessionId,
    });
    return { statusCode: 500, body: 'Not configured' };
  }

  await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      asyncWork: true,
      connectionId,
      endpoint,
      identity: who,
      message,
      sessionId,
    } satisfies AsyncWork)),
  }));

  return { statusCode: 200, body: 'Accepted' };
};

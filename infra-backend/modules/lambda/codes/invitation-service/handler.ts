/**
 * Invitation service — the only way into an existing workspace.
 *
 * WHY THIS EXISTS
 * Joining used to happen automatically when a signing-up email's domain matched
 * a workspace's. Anyone who could receive mail at a customer's domain could walk
 * into that customer's CRM. Membership is now granted only by someone who
 * already holds the authority to grant it.
 *
 * ROUTES
 *   POST /invitations   (Cognito-authorised) create | revoke
 *   POST /invite-lookup (public)             resolve — the token IS the credential
 *
 * TOKEN HANDLING
 * 32 random bytes, base64url. Only its SHA-256 hash is stored, so a database
 * copy yields no usable invitation. Single-use and 7-day expiry are enforced by
 * the claim in crm-write, not here.
 *
 * ROLE CEILING (server-side — the UI hiding a control is not a permission)
 *   admin   → admin | manager | member
 *   manager → member
 *   member  → nothing
 * A manager cannot mint a manager or an admin, so no one can invite their way
 * upward. Every refusal is logged with the caller, because an attempt from a
 * low-privilege account is a signal worth keeping.
 */
import type { APIGatewayProxyHandler, APIGatewayProxyEvent } from 'aws-lambda';
import { createHash, randomBytes } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const lambda = new LambdaClient({});
const ses = new SESv2Client({});
const ssm = new SSMClient({});
const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const CRM_WRITE_ARN = process.env.CRM_WRITE_SERVICE_ARN!;
const CRM_READ_ARN = process.env.CRM_READ_SERVICE_ARN!;
const TABLE = process.env.DYNAMODB_TABLE!;
// Workspaces live at <slug>.<host>, matching infra-web's tenant wildcard.
const WEB_HOST = process.env.WEB_HOST ?? 'impulsoiq.rinegansolutions.com';
const FROM_ADDRESS = process.env.SES_FROM_ADDRESS ?? 'noreply@impulsoiq.rinegansolutions.com';
// Bounces and complaints from invitation mail count toward the same reputation
// alarms as campaign mail, which is what pauses sending if either spikes.
const CONFIG_SET = process.env.SES_CONFIGURATION_SET || undefined;

const INVITE_TTL_DAYS = 7;
/** A workspace cannot mint more than this many invitations in a day. */
const DAILY_INVITE_CAP = 50;

type Role = 'admin' | 'manager' | 'member';

const ROLE_PRECEDENCE: Role[] = ['admin', 'manager', 'member'];

const INVITABLE: Record<Role, Role[]> = {
  admin: ['admin', 'manager', 'member'],
  manager: ['member'],
  member: [],
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-impulsoiq-tenant',
  'Content-Type': 'application/json',
};

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function claimsOf(event: APIGatewayProxyEvent): Record<string, unknown> {
  return (event.requestContext?.authorizer?.claims as Record<string, unknown>) ?? {};
}

function tenantOf(event: APIGatewayProxyEvent): string | null {
  const v = claimsOf(event)['custom:tenant_id'];
  return typeof v === 'string' && v ? v : null;
}

function roleOf(event: APIGatewayProxyEvent): Role | null {
  const raw = claimsOf(event)['cognito:groups'];
  const values = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[\s,[\]"]+/);
  return ROLE_PRECEDENCE.find((r) => values.includes(r)) ?? null;
}

function actorOf(event: APIGatewayProxyEvent): string {
  const c = claimsOf(event);
  return String(c.email ?? c.sub ?? 'unknown');
}

/** RFC-5322-lite: good enough to reject typos without rejecting valid addresses. */
function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function invokeJson(arn: string, payload: unknown): Promise<Record<string, unknown>> {
  const out = await lambda.send(new InvokeCommand({
    FunctionName: arn,
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
  const text = Buffer.from(out.Payload ?? new Uint8Array()).toString('utf8');
  if (out.FunctionError) throw new Error(`invoke failed: ${text}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function ssmValue(envVar: string): Promise<string> {
  const name = process.env[envVar];
  if (!name) throw new Error(`${envVar} is not set`);
  const resp = await ssm.send(new GetParameterCommand({ Name: name }));
  return resp.Parameter?.Value ?? '';
}

/**
 * One Cognito pool serves every workspace, so an email can hold exactly one
 * ImpulsoIQ account. Inviting an address that already has one would send a link
 * that can only fail at sign-up, so say so now instead.
 */
async function emailAlreadyRegistered(email: string): Promise<boolean> {
  let poolId = '';
  try {
    poolId = await ssmValue('USER_POOL_ID_SSM_PATH');
  } catch {
    return false; // cannot check — the sign-up path still refuses duplicates
  }
  if (!poolId) return false;
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'UserNotFoundException') return false;
    return false;
  }
}

/** Per-workspace daily cap, so a compromised admin session cannot become a mail cannon. */
async function withinSendCap(tenantId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `${tenantId}#invite_rate#${day}`, sk: 'count' },
      UpdateExpression: 'SET #c = if_not_exists(#c, :zero) + :one, #t = :ttl',
      ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':ttl': Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
      },
      ReturnValues: 'UPDATED_NEW',
    }));
    return Number(res.Attributes?.count ?? 0) <= DAILY_INVITE_CAP;
  } catch (err) {
    // Fail OPEN on the counter only: it is anti-abuse, not authorisation, and
    // authorisation has already passed by this point.
    console.warn('invite rate check failed', (err as Error).message);
    return true;
  }
}

function inviteEmail(workspace: string, inviter: string, role: Role, link: string) {
  const text = [
    `${inviter} invited you to the ${workspace} workspace on ImpulsoIQ as ${role}.`,
    '',
    `Accept: ${link}`,
    '',
    `This link works once and expires in ${INVITE_TTL_DAYS} days.`,
    'If you were not expecting this, ignore this email — nothing happens until you accept.',
  ].join('\n');

  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a">
    <p><strong>${inviter}</strong> invited you to the <strong>${workspace}</strong> workspace on ImpulsoIQ as <strong>${role}</strong>.</p>
    <p><a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#4f46e5;color:#fff;text-decoration:none">Accept the invitation</a></p>
    <p style="color:#64748b;font-size:13px">This link works once and expires in ${INVITE_TTL_DAYS} days.<br>
    If you were not expecting this, ignore this email — nothing happens until you accept.</p>
  </body></html>`;

  return { text, html, subject: `You have been invited to ${workspace} on ImpulsoIQ` };
}

// ── Operations ────────────────────────────────────────────────────────────────

async function createInvitation(event: APIGatewayProxyEvent, tenantId: string, body: Record<string, unknown>) {
  const callerRole = roleOf(event);
  const actor = actorOf(event);
  if (!callerRole) return json(403, { error: 'This account has no workspace role.' });

  const email = String(body.email ?? '').trim().toLowerCase();
  const role = String(body.role ?? 'member') as Role;

  if (!isEmail(email)) return json(400, { error: 'Enter a valid email address.' });
  if (!ROLE_PRECEDENCE.includes(role)) return json(400, { error: 'Unknown role.' });

  const allowed = INVITABLE[callerRole] ?? [];
  if (!allowed.includes(role)) {
    // The UI never offers this; reaching it means the API was called directly.
    console.warn('invitation refused: role ceiling', { tenantId, actor, callerRole, requested: role });
    return json(403, {
      error: callerRole === 'member'
        ? 'Only admins and managers can invite people.'
        : `A ${callerRole} can invite ${allowed.join(' or ') || 'nobody'}.`,
    });
  }

  if (await emailAlreadyRegistered(email)) {
    return json(409, {
      error: 'That email already has an ImpulsoIQ account. An account belongs to one workspace, so it cannot be invited to another.',
    });
  }

  if (!(await withinSendCap(tenantId))) {
    return json(429, { error: `This workspace has sent ${DAILY_INVITE_CAP} invitations today. Try again tomorrow.` });
  }

  // The raw token exists here and in the email. Only its hash is persisted.
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString();

  const written = await invokeJson(CRM_WRITE_ARN, {
    operation: 'create_invitation',
    payload: { email, role, tokenHash: sha256(token), invitedBy: actor, expiresAt },
    tenantId,
    actorType: 'human',
    actorId: 'invitation-service',
  });
  if (written.ok !== true) {
    return json(500, { error: String(written.error ?? 'Could not create the invitation.') });
  }

  const workspace = String(body.workspaceName ?? tenantId);
  const link = `https://${tenantId}.${WEB_HOST}/sign-up?invite=${encodeURIComponent(token)}`;
  const mail = inviteEmail(workspace, actor, role, link);

  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: FROM_ADDRESS,
      Destination: { ToAddresses: [email] },
      Content: {
        Simple: {
          Subject: { Data: mail.subject },
          Body: { Text: { Data: mail.text }, Html: { Data: mail.html } },
        },
      },
      ConfigurationSetName: CONFIG_SET,
    }));
  } catch (err) {
    // The invitation exists; only delivery failed. Say so plainly so an admin
    // can resend rather than assuming the person was emailed.
    //
    // The first release of this said only "the email could not be sent", which
    // took a CloudWatch dig to explain: SES was refusing the send because the
    // Lambda role lacked permission on the CONFIGURATION SET (SendEmail is
    // authorised against the configuration set as well as the identity). A
    // misconfiguration and a transient bounce need different responses from the
    // admin reading this, so they are told apart here. The SES message itself
    // stays in the log -- it names role ARNs, which do not belong in the UI.
    const name = (err as { name?: string }).name ?? '';
    const detail = (err as Error).message ?? '';
    const misconfigured =
      name === 'AccessDeniedException' ||
      name === 'NotFoundException' ||
      /not authorized|AccessDenied|ConfigurationSetDoesNotExist|MessageRejected/i.test(detail);

    console.error('invitation email failed', { tenantId, name, error: detail });

    return json(202, {
      ok: true,
      id: written.id,
      email,
      role,
      expiresAt,
      emailed: false,
      error: misconfigured
        ? 'Invitation created, but email delivery is not configured correctly for this workspace. Resending will not help until an administrator fixes it.'
        : 'Invitation created, but the email could not be sent. Use Resend.',
    });
  }

  console.log('invitation created', { tenantId, actor, role, id: written.id });
  return json(201, { ok: true, id: written.id, email, role, expiresAt, emailed: true });
}

async function revokeInvitation(event: APIGatewayProxyEvent, tenantId: string, body: Record<string, unknown>) {
  const callerRole = roleOf(event);
  const actor = actorOf(event);
  if (callerRole !== 'admin' && callerRole !== 'manager') {
    console.warn('revoke refused', { tenantId, actor, callerRole });
    return json(403, { error: 'Only admins and managers can revoke invitations.' });
  }
  const id = String(body.id ?? '');
  if (!id) return json(400, { error: 'id is required' });

  const out = await invokeJson(CRM_WRITE_ARN, {
    operation: 'revoke_invitation',
    payload: { id },
    tenantId,
    actorType: 'human',
    actorId: 'invitation-service',
  });
  if (out.ok !== true) return json(409, { error: String(out.error ?? 'Could not revoke that invitation.') });
  console.log('invitation revoked', { tenantId, actor, id });
  return json(200, { ok: true, id });
}

/**
 * Public: turn a raw token into what the sign-up screen needs to show.
 *
 * Deliberately narrow — workspace name, the invited email and the role. Every
 * failure answers the same way, so this cannot be used to probe for valid
 * tokens or to learn whether an address has been invited.
 */
async function resolveInvitation(body: Record<string, unknown>) {
  const token = String(body.token ?? '');
  const generic = { valid: false as const, error: 'This invitation link is not valid, has already been used, or has expired.' };
  if (!token || token.length < 20) return json(200, generic);

  let found: Record<string, unknown> | null = null;
  try {
    const out = await invokeJson(CRM_READ_ARN, {
      operation: 'find_invitation',
      payload: { tokenHash: sha256(token) },
      // The token identifies exactly one row; the envelope still requires a
      // tenant, which this lookup does not filter on.
      tenantId: 'invite-lookup',
    });
    found = (out.result ?? null) as Record<string, unknown> | null;
  } catch (err) {
    console.error('invite resolve failed', (err as Error).message);
    return json(200, generic);
  }

  if (!found || found.usable !== true) return json(200, generic);

  return json(200, {
    valid: true,
    email: String(found.email),
    role: String(found.role),
    tenantId: String(found.tenant_id),
    workspaceName: String(found.workspace_name ?? found.tenant_id),
    expiresAt: found.expires_at,
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandler = async (event) => {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const path = event.path ?? event.resource ?? '';
  // Public route: no session exists yet when someone opens an invite link.
  if (path.includes('invite-lookup')) {
    return resolveInvitation(body);
  }

  const tenantId = tenantOf(event);
  if (!tenantId) return json(401, { error: 'Missing tenant_id' });

  const operation = String(body.operation ?? '');
  try {
    if (operation === 'create') return await createInvitation(event, tenantId, body);
    if (operation === 'revoke') return await revokeInvitation(event, tenantId, body);
    return json(400, { error: `Unknown operation: ${operation}` });
  } catch (err) {
    console.error('invitation-service', (err as Error).message);
    return json(500, { error: 'Could not complete that invitation action.' });
  }
};

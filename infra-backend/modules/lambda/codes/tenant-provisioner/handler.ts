/**
 * Tenant Provisioner — Cognito PreSignUp AND PostConfirmation trigger.
 *
 * WHY IT GUARDS BOTH ENDS
 * An account's workspace is custom:tenant_id, and the BROWSER sets it at
 * sign-up. This function used to accept it unchecked and make whoever confirmed
 * a member of that workspace — while crm-read/crm-write scope every query by
 * that claim. Signing up with custom:tenant_id="acme" was enough to read Acme's
 * CRM. It also upserted the tenant on every join, resetting the workspace's
 * name, tier and config each time someone joined.
 *
 *   PreSignUp_SignUp            Refuse an invalid or reserved workspace address,
 *                               and refuse naming an EXISTING workspace unless the
 *                               email's domain is that workspace's email_domain.
 *   PostConfirmation_ConfirmSignUp
 *                               Create the workspace if absent (creator → admin).
 *                               Otherwise re-check the domain against the stored
 *                               row — the workspace may have been created by
 *                               someone else between sign-up and confirmation —
 *                               and add the member (→ member) or disable the
 *                               account.
 *
 * Joining by domain is only possible for a workspace created from a company
 * domain: public mailbox domains are never stored as a workspace's
 * email_domain, so a workspace created from gmail.com admits no one by domain.
 *
 * The API additionally requires a workspace group (hasWorkspaceRole in crm-read
 * and crm-write), so an account left without one — provisioning failed or was
 * refused — reaches no data. scripts/reconcile-tenant-membership.sh (run by the backend migrate stage) repairs a failed one.
 *
 * ERROR POLICY
 * PreSignUp throws to refuse; Cognito returns the message to the sign-up form.
 * It fails CLOSED when the workspace lookup errors. PostConfirmation never
 * throws — the account is already confirmed — and logs instead.
 */
import type { PreSignUpTriggerEvent, PostConfirmationTriggerEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const lambda  = new LambdaClient({ region: process.env.AWS_REGION });

const CRM_WRITE_ARN = process.env.CRM_WRITE_SERVICE_ARN!;
const CRM_READ_ARN  = process.env.CRM_READ_SERVICE_ARN!;

// Same grammar as tenant.id's CHECK constraint, the CloudFront tenant router
// and apps/web/src/lib/tenant.ts. A slug that fails it could confirm an account
// whose workspace row can never be written.
const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

// Must match RESERVED in infra-web/functions/tenant-router.js and apps/web/src/lib/tenant.ts.
const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'smtp', 'imap', 'ftp', 'cdn',
  'static', 'assets', 'status', 'docs', 'support', 'help', 'blog',
  'dev', 'test', 'stage', 'staging', 'prod', 'internal', 'root',
  'security', 'autodiscover', 'autoconfig', '_domainkey',
]);

// Must match COMMON_PROVIDERS in org-check.
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me',
  'fastmail.com', 'hey.com', 'gmx.com', 'gmx.net', 'zoho.com', 'mail.com',
  'yandex.com',
]);

const WORKSPACE_NAME_MAX = 80;

const JOIN_REFUSED =
  'A workspace with this address already exists. Ask its admin to invite you, or choose a different address.';

function emailDomainOf(email: string | undefined): string | null {
  const value = (email ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return at > 0 && at < value.length - 1 ? value.slice(at + 1) : null;
}

/** The domain a workspace admits members by, or null when it admits nobody that way. */
function joinableDomain(domain: string | null): string | null {
  return domain && !PUBLIC_EMAIL_DOMAINS.has(domain) ? domain : null;
}

function mayJoin(userDomain: string | null, workspaceDomain: string | null): boolean {
  const domain = joinableDomain(userDomain);
  return domain !== null && domain === workspaceDomain;
}

async function invoke(functionArn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resp = await lambda.send(new InvokeCommand({
    FunctionName:   functionArn,
    InvocationType: 'RequestResponse',
    Payload:        Buffer.from(JSON.stringify(body)),
  }));
  const text = resp.Payload ? Buffer.from(resp.Payload).toString() : '';
  if (resp.FunctionError) throw new Error(`invoke failed: ${text}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function readTenant(tenantId: string): Promise<{ emailDomain: string | null } | null> {
  const out = await invoke(CRM_READ_ARN, { operation: 'get_tenant', payload: {}, tenantId });
  if (out.ok === false) throw new Error(`get_tenant failed: ${String(out.error ?? 'unknown')}`);
  const row = out.result as { email_domain?: string | null } | null | undefined;
  return row ? { emailDomain: row.email_domain ?? null } : null;
}

// ── PreSignUp ────────────────────────────────────────────────────────────────

async function preSignUp(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  // Administrator-created accounts are provisioned deliberately; only
  // self-service sign-up is policed here.
  if (event.triggerSource !== 'PreSignUp_SignUp') return event;

  const attrs    = event.request.userAttributes;
  const tenantId = attrs['custom:tenant_id'] ?? '';

  if (!SLUG.test(tenantId) || RESERVED.has(tenantId)) {
    throw new Error('That workspace address is not available. Choose a different one.');
  }

  const workspaceName = attrs['custom:workspace_name'];
  if (workspaceName !== undefined && (!workspaceName.trim() || workspaceName.length > WORKSPACE_NAME_MAX)) {
    throw new Error(`Workspace name must be between 1 and ${WORKSPACE_NAME_MAX} characters.`);
  }

  let existing: { emailDomain: string | null } | null;
  try {
    existing = await readTenant(tenantId);
  } catch (err) {
    console.error('PreSignUp: workspace lookup failed; refusing sign-up', { tenantId, error: (err as Error).message });
    throw new Error('Sign-up is temporarily unavailable. Please try again in a moment.');
  }

  const userDomain = emailDomainOf(attrs.email);
  if (existing && !mayJoin(userDomain, existing.emailDomain)) {
    console.warn('PreSignUp: refused sign-up into existing workspace', { tenantId, emailDomain: userDomain });
    throw new Error(JOIN_REFUSED);
  }

  return event;
}

// ── PostConfirmation ─────────────────────────────────────────────────────────

async function postConfirmation(event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> {
  // Only a sign-up confirmation provisions — not a forgotten-password confirmation.
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;

  const attrs      = event.request.userAttributes;
  const tenantId   = attrs['custom:tenant_id'];
  const userDomain = emailDomainOf(attrs.email);

  if (!tenantId) {
    console.warn('PostConfirmation: missing custom:tenant_id', { userName: event.userName });
    return event;
  }

  try {
    const result = await invoke(CRM_WRITE_ARN, {
      operation: 'upsert_tenant',
      payload: {
        id:          tenantId,
        name:        (attrs['custom:workspace_name'] ?? '').trim() || tenantId,
        subdomain:   tenantId,
        // Never a public mailbox domain: that would admit every user of it.
        emailDomain: joinableDomain(userDomain),
        tier:        'free',
        config:      {},
      },
      tenantId,
      actorType: 'human',
      actorId:   'tenant-provisioner',
    });

    if (result.ok !== true) {
      throw new Error(`upsert_tenant failed: ${String(result.error ?? 'unknown')}`);
    }

    const created = result.wasInserted === true;
    const workspaceDomain = (result.emailDomain as string | null | undefined) ?? null;

    if (!created && !mayJoin(userDomain, workspaceDomain)) {
      // PreSignUp admitted this sign-up, so the workspace was created by someone
      // else in the meantime. The account holds that workspace's claim and must
      // not keep it: disable it. (Without a group the API already refuses it;
      // disabling also stops it signing in at all.)
      await cognito.send(new AdminDisableUserCommand({
        UserPoolId: event.userPoolId,
        Username:   event.userName,
      }));
      console.error('PostConfirmation: join refused, account disabled', {
        tenantId, userName: event.userName, emailDomain: userDomain,
      });
      return event;
    }

    const groupName = created ? 'admin' : 'member';
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: event.userPoolId,
      Username:   event.userName,
      GroupName:  groupName,
    }));

    console.log('Tenant provisioned', { tenantId, userName: event.userName, role: groupName, created });
  } catch (err) {
    // The account stays without a group, so the API refuses it until repaired
    // by scripts/reconcile-tenant-membership.sh on the next backend deploy.
    console.error('Tenant provisioning failed (non-fatal)', {
      tenantId, userName: event.userName, error: (err as Error).message,
    });
  }

  return event;
}

export const handler = async (
  event: PreSignUpTriggerEvent | PostConfirmationTriggerEvent,
): Promise<PreSignUpTriggerEvent | PostConfirmationTriggerEvent> => {
  if (event.triggerSource.startsWith('PreSignUp_')) return preSignUp(event as PreSignUpTriggerEvent);
  if (event.triggerSource.startsWith('PostConfirmation_')) return postConfirmation(event as PostConfirmationTriggerEvent);
  return event;
};

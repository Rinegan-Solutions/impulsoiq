/**
 * Tenant Provisioner - Cognito PreSignUp AND PostConfirmation trigger.
 *
 * WHY IT GUARDS BOTH ENDS
 * An account's workspace is custom:tenant_id, and the BROWSER sets it at
 * sign-up. This function used to accept it unchecked and make whoever confirmed
 * a member of that workspace - while crm-read/crm-write scope every query by
 * that claim. Signing up with custom:tenant_id="acme" was enough to read Acme's
 * CRM. It also upserted the tenant on every join, resetting the workspace's
 * name, tier and config each time someone joined.
 *
 *   PreSignUp_SignUp            Refuse an invalid or reserved workspace address.
 *                               Creating a NEW workspace is open. Joining an
 *                               EXISTING one requires an invitation token that
 *                               resolves to THAT workspace and THIS email.
 *   PostConfirmation_ConfirmSignUp
 *                               Create the workspace if absent (creator -> admin).
 *                               Otherwise claim the pending invitation for this
 *                               email and grant the role it carries, or disable
 *                               the account.
 *
 * WHY JOINING BY EMAIL DOMAIN IS GONE
 * Membership used to be granted to anyone whose email domain matched the
 * workspace's. Control of a mailbox at a customer's domain - a contractor, a
 * former employee whose address was recycled, anyone who could register a
 * lookalike - was enough to walk into that customer's CRM. Someone who already
 * holds the authority to grant membership must now grant it explicitly.
 * email_domain is still recorded on the tenant, but it no longer admits anyone.
 *
 * WHY POSTCONFIRMATION RE-LOOKS-UP RATHER THAN TRUSTING THE TOKEN
 * Cognito passes ClientMetadata from the API call that triggered it, so a token
 * supplied to SignUp does not reach PostConfirmation (a different call). The
 * invitation is therefore claimed by (tenant_id, email), which the confirmed
 * account has proved it owns. The claim is a single conditional UPDATE in
 * crm-write, so two concurrent confirmations cannot both consume one invitation.
 *
 * The API additionally requires a workspace group (hasWorkspaceRole in crm-read
 * and crm-write), so an account left without one - provisioning failed or was
 * refused - reaches no data. scripts/reconcile-tenant-membership.sh (run by the backend migrate stage) repairs a failed one.
 *
 * ERROR POLICY
 * PreSignUp throws to refuse; Cognito returns the message to the sign-up form.
 * It fails CLOSED when the workspace or invitation lookup errors.
 * PostConfirmation never throws - the account is already confirmed - and logs.
 */
import type { PreSignUpTriggerEvent, PostConfirmationTriggerEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminDisableUserCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { createHash } from 'node:crypto';

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

// Deliberately the same message whether the workspace exists, the token is
// absent, expired, already used, or was issued to a different address. Any
// distinction between those would let someone map workspaces and invitations
// from the sign-up form. The UI shows the "ask your admin" modal on this.
const JOIN_REFUSED =
  'A workspace with this address already exists. Ask its admin to invite you, or choose a different address.';

function emailDomainOf(email: string | undefined): string | null {
  const value = (email ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return at > 0 && at < value.length - 1 ? value.slice(at + 1) : null;
}

/**
 * The domain recorded on a workspace, or null for a public mailbox provider.
 * Recorded for display and support only - it grants no membership. See the
 * header note on why domain joining was removed.
 */
function companyDomain(domain: string | null): string | null {
  return domain && !PUBLIC_EMAIL_DOMAINS.has(domain) ? domain : null;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Does this raw token authorise THIS email to join THIS workspace right now?
 * Everything is checked here: the token exists, is pending, has not expired,
 * belongs to the named workspace, and was issued to the address signing up -
 * without the last check, one person's invitation would let anyone holding the
 * link join in their place.
 */
async function invitationAdmits(token: string, tenantId: string, email: string): Promise<boolean> {
  if (!token || token.length < 20) return false;
  const out = await invoke(CRM_READ_ARN, {
    operation: 'find_invitation',
    payload: { tokenHash: sha256(token) },
    tenantId,
  });
  const row = out.result as { tenant_id?: string; email?: string; usable?: boolean } | null | undefined;
  if (!row || row.usable !== true) return false;
  if (row.tenant_id !== tenantId) return false;
  return String(row.email ?? '').toLowerCase() === email.toLowerCase();
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

/**
 * Is this a real Cognito confirmation, or a replay?
 *
 * scripts/reconcile-tenant-membership.sh repairs accounts that were left
 * without a group by re-invoking this function with a synthesised
 * PostConfirmation event, and stamps its own name in callerContext. It must
 * never DISABLE anything: it runs over every account in the pool on each
 * backend deploy, and the accounts it examines are by definition ones whose
 * provisioning it is trying to fix.
 */
function isReplay(event: PostConfirmationTriggerEvent): boolean {
  return event.callerContext?.awsSdkVersion === 'reconcile-tenant-membership.sh';
}

/** Does this account already hold a workspace role? */
async function hasWorkspaceGroup(userPoolId: string, userName: string): Promise<boolean> {
  const out = await cognito.send(new AdminListGroupsForUserCommand({
    UserPoolId: userPoolId, Username: userName, Limit: 60,
  }));
  return (out.Groups ?? []).some((g) => g.GroupName === 'admin' || g.GroupName === 'manager' || g.GroupName === 'member');
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

  if (!existing) return event; // Creating a new workspace needs no invitation.

  const email = (attrs.email ?? '').trim().toLowerCase();
  const token = event.request.clientMetadata?.inviteToken ?? '';

  let admitted = false;
  try {
    admitted = await invitationAdmits(token, tenantId, email);
  } catch (err) {
    // Fail closed: an invitation that cannot be read is not a valid one.
    console.error('PreSignUp: invitation lookup failed; refusing sign-up', { tenantId, error: (err as Error).message });
    throw new Error('Sign-up is temporarily unavailable. Please try again in a moment.');
  }

  if (!admitted) {
    console.warn('PreSignUp: refused sign-up into existing workspace', {
      tenantId, emailDomain: emailDomainOf(email), hadToken: token !== '',
    });
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
        // Recorded for display and support only; it admits nobody.
        emailDomain: companyDomain(userDomain),
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

    // Whoever creates the workspace is its first admin. Everyone else holds an
    // invitation, and the role comes from THAT invitation - not from anything
    // the browser sent - so a signing-up user cannot choose their own role.
    let groupName = 'admin';
    if (!created) {
      // An account that already holds a role was provisioned properly at some
      // point; there is nothing to claim and nothing to punish. This is the
      // common case when the reconcile script sweeps the pool.
      if (await hasWorkspaceGroup(event.userPoolId, event.userName)) {
        console.log('PostConfirmation: already a member, nothing to do', { tenantId, userName: event.userName });
        return event;
      }

      const claim = await invoke(CRM_WRITE_ARN, {
        operation: 'consume_invitation',
        payload: { email: (attrs.email ?? '').trim().toLowerCase() },
        tenantId,
        actorType: 'human',
        actorId:   'tenant-provisioner',
      });

      if (claim.ok !== true || typeof claim.role !== 'string') {
        // PreSignUp admitted this account, so between sign-up and confirmation
        // the invitation was revoked, expired, already used, or the workspace
        // was created by someone else. The account holds that workspace's claim
        // and must not keep it: disable it. (Without a group the API already
        // refuses it; disabling also stops it signing in at all.)
        //
        // Not on a replay: the reconcile script inspects accounts precisely
        // because their provisioning may have failed, and disabling them would
        // turn a repair pass into an outage. Leaving the account without a group
        // already denies it every API, which is the property that matters.
        if (isReplay(event)) {
          console.warn('PostConfirmation (replay): no claimable invitation; leaving account without a role', {
            tenantId, userName: event.userName,
          });
          // Tells the reconcile script this is a refusal, not a bug it should
          // fail the deploy over. Only ever set on the replay path, so the real
          // Cognito trigger contract is untouched.
          (event.response as Record<string, unknown>).reconcileOutcome = 'no-invitation';
          return event;
        }
        await cognito.send(new AdminDisableUserCommand({
          UserPoolId: event.userPoolId,
          Username:   event.userName,
        }));
        console.error('PostConfirmation: no claimable invitation, account disabled', {
          tenantId, userName: event.userName, emailDomain: userDomain,
        });
        return event;
      }

      groupName = claim.role;
    }

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

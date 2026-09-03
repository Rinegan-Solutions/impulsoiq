/**
 * Tenant Provisioner — Cognito Post-Confirmation Lambda trigger.
 *
 * Fires once per user, only on sign-up confirmation (not password resets).
 *
 * Group assignment logic:
 *   - If the workspace (tenantId) was just created → assign 'admin'
 *   - If the workspace already existed (a colleague's workspace) → assign 'member'
 *
 * This makes the "join your team" flow seamless: the user signs up with their
 * colleague's workspace ID and becomes a member without any admin intervention.
 *
 * Error policy: errors are logged but NEVER re-thrown. A provisioning failure
 * must not block the user from completing sign-up.
 */
import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const lambda  = new LambdaClient({ region: process.env.AWS_REGION });

const CRM_WRITE_ARN = process.env.CRM_WRITE_SERVICE_ARN!;

async function invokeCrmWrite(
  operation: string,
  payload:   Record<string, unknown>,
  tenantId:  string,
): Promise<{ ok: boolean; id?: string; wasInserted?: boolean; error?: string }> {
  const resp = await lambda.send(new InvokeCommand({
    FunctionName:   CRM_WRITE_ARN,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify({
      operation,
      payload,
      tenantId,
      actorType: 'human',
      actorId:   'tenant-provisioner',
    })),
  }));

  if (resp.FunctionError) {
    const body = resp.Payload ? JSON.parse(Buffer.from(resp.Payload).toString()) : {};
    throw new Error(`CRM invoke error: ${JSON.stringify(body)}`);
  }

  return resp.Payload
    ? JSON.parse(Buffer.from(resp.Payload).toString())
    : { ok: false, error: 'empty response' };
}

export const handler: PostConfirmationTriggerHandler = async (event) => {
  // Only act on email confirmation of a new sign-up, not password resets
  if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') {
    return event;
  }

  const attrs      = event.request.userAttributes;
  const tenantId   = attrs['custom:tenant_id'];
  const email      = attrs['email'] ?? '';
  const emailDomain = email.includes('@') ? email.split('@')[1].toLowerCase() : null;

  if (!tenantId) {
    console.warn('PostConfirmation: missing custom:tenant_id', { userName: event.userName });
    return event;
  }

  try {
    // 1. Upsert the tenant record.
    //    wasInserted = true  → this user created the workspace → admin
    //    wasInserted = false → workspace already existed    → member
    const result = await invokeCrmWrite(
      'upsert_tenant',
      {
        id:          tenantId,
        name:        tenantId,
        subdomain:   tenantId,
        emailDomain, // stored for org-detection on future sign-ups
        tier:        'starter',
        config:      {},
      },
      tenantId,
    );

    if (!result.ok) {
      throw new Error(`upsert_tenant failed: ${result.error ?? 'unknown'}`);
    }

    // 2. Assign the user to the correct RBAC group
    const groupName = result.wasInserted ? 'admin' : 'member';

    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: event.userPoolId,
      Username:   event.userName,
      GroupName:  groupName,
    }));

    console.log('Tenant provisioned', {
      tenantId,
      userName:   event.userName,
      email,
      role:       groupName,
      wasCreated: result.wasInserted,
    });

  } catch (err) {
    // Never block sign-up on provisioning failures
    console.error('Tenant provisioning failed (non-fatal)', {
      tenantId,
      userName: event.userName,
      error:    (err as Error).message,
    });
  }

  return event;
};

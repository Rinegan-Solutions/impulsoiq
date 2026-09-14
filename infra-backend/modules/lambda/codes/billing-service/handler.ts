/**
 * Stripe Checkout + Customer Portal + webhooks.
 *
 * Not Connect: this is first-party SaaS billing. Empty Stripe keys fail closed
 * (no fake paid tier). Tier writes go through CRM Write as actor billing-service.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import Stripe from 'stripe';
import { appSecret } from './secrets';

const lambda = new LambdaClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // DynamoDB rejects an undefined attribute value outright. Optional fields
  // (starter, campaignId, agentRunId, ...) are routinely undefined, so without
  // this every Put/Update carrying one fails at runtime with
  // "Pass options.removeUndefinedValues=true".
  marshallOptions: { removeUndefinedValues: true },
});

const CRM_WRITE = process.env.CRM_WRITE_SERVICE_ARN!;
const CRM_READ = process.env.CRM_READ_SERVICE_ARN!;
const TABLE = process.env.DYNAMODB_TABLE!;
const METERING = process.env.METERING_TABLE ?? '';
const ENV = process.env.ENV ?? 'dev';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-impulsoiq-tenant,Stripe-Signature',
  'Content-Type': 'application/json',
};

const PAID_TIERS = new Set(['starter', 'growth']);
const PACKS = new Set(['call_minutes', 'enrichment_lookups', 'concurrent_runs']);

const PACK_UNITS: Record<string, number> = {
  call_minutes: Number(process.env.STRIPE_PACK_CALL_MINUTES_UNITS ?? 50),
  enrichment_lookups: Number(process.env.STRIPE_PACK_ENRICHMENT_UNITS ?? 250),
  concurrent_runs: Number(process.env.STRIPE_PACK_CONCURRENT_UNITS ?? 2),
};

let stripeCache: Stripe | undefined;
let stripeSecretCache: string | undefined;

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function claimsOf(event: APIGatewayProxyEvent): Record<string, string> {
  return (event.requestContext.authorizer?.claims ?? {}) as Record<string, string>;
}

function tenantFromEvent(event: APIGatewayProxyEvent): string | null {
  return claimsOf(event)['custom:tenant_id'] ?? null;
}

function hasWorkspaceRole(event: APIGatewayProxyEvent): boolean {
  const raw = claimsOf(event)['cognito:groups'];
  const values = String(raw ?? '').split(/[\s,[\]"]+/);
  return values.some((g) => g === 'admin' || g === 'manager' || g === 'member');
}

function isManagerOrAdmin(event: APIGatewayProxyEvent): boolean {
  const raw = claimsOf(event)['cognito:groups'];
  const values = String(raw ?? '').split(/[\s,[\]"]+/);
  return values.some((g) => g === 'admin' || g === 'manager');
}

async function stripeClient(): Promise<Stripe> {
  if (stripeCache) return stripeCache;
  const secret = await appSecret('stripe_secret_key');
  if (!secret || secret.startsWith('PLACEHOLDER') || secret === 'unset') {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }
  stripeSecretCache = secret;
  stripeCache = new Stripe(secret, { apiVersion: '2024-06-20' });
  return stripeCache;
}

async function webhookSecret(): Promise<string> {
  const secret = await appSecret('stripe_webhook_secret');
  if (!secret || secret.startsWith('PLACEHOLDER')) throw new Error('STRIPE_WEBHOOK_NOT_CONFIGURED');
  return secret;
}

async function invokeCrm(arn: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: arn,
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
  return (res.Payload ? JSON.parse(Buffer.from(res.Payload).toString()) : {}) as Record<string, unknown>;
}

async function getTenant(tenantId: string): Promise<Record<string, unknown> | null> {
  const raw = await invokeCrm(CRM_READ, { operation: 'get_tenant', payload: {}, tenantId });
  return (raw.result ?? null) as Record<string, unknown> | null;
}

async function setBilling(tenantId: string, payload: Record<string, unknown>): Promise<void> {
  const result = await invokeCrm(CRM_WRITE, {
    operation: 'set_tenant_billing',
    payload,
    tenantId,
    actorType: 'agent',
    actorId: 'billing-service',
  });
  if (result.ok === false) throw new Error(String(result.error ?? 'set_tenant_billing failed'));
}

function priceIdFor(tier: string, interval: 'monthly' | 'annual'): string {
  const key = `STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;
  return (process.env[key] ?? '').trim();
}

function packPriceId(pack: string): string {
  const key = `STRIPE_PRICE_PACK_${pack.toUpperCase()}`;
  return (process.env[key] ?? '').trim();
}

function originOf(event: APIGatewayProxyEvent): string {
  const headers = event.headers ?? {};
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'origin' && headers[k]) return headers[k]!.replace(/\/$/, '');
  }
  return (process.env.WEB_BASE_URL ?? 'https://impulsoiq.rinegansolutions.com').replace(/\/$/, '');
}

function periodUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function addPackQuota(tenantId: string, resource: string, units: number): Promise<void> {
  if (!METERING) throw new Error('METERING_TABLE is not configured');
  const period = periodUtc();
  await ddb.send(new UpdateCommand({
    TableName: METERING,
    Key: { pk: `${tenantId}#meter#${period}`, sk: resource },
    UpdateExpression: 'ADD quota :u SET #p = if_not_exists(#p, :period)',
    ExpressionAttributeNames: { '#p': 'period' },
    ExpressionAttributeValues: { ':u': units, ':period': period },
  }));
}

async function recordConversion(tenantId: string, toTier: string): Promise<void> {
  const marker = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { pk: `${tenantId}#activation#first_outbound_sent`, sk: 'current' },
  }));
  if (!marker.Item) return;
  const now = new Date().toISOString();
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: `${tenantId}#activation#converted_from_free_after_outbound`,
        sk: 'current',
        tenantId,
        entityType: 'activation',
        entityId: 'converted_from_free_after_outbound',
        eventType: 'converted_from_free_after_outbound',
        occurredAt: now,
        data: { toTier, firstOutboundAt: marker.Item.occurredAt },
        ttl: Math.floor(Date.now() / 1000) + 7 * 365 * 24 * 3600,
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
  } catch {
    /* already recorded */
  }
}

async function handleCheckout(event: APIGatewayProxyEvent, tenantId: string) {
  if (!isManagerOrAdmin(event)) {
    return json(403, { error: 'Only admins and managers can start checkout' });
  }
  let body: { action?: string; tier?: string; interval?: string; pack?: string };
  try {
    body = JSON.parse(event.body ?? '{}') as typeof body;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  let stripe: Stripe;
  try {
    stripe = await stripeClient();
  } catch {
    return json(503, { error: 'Billing is not configured for this environment. No paid upgrade can be completed.' });
  }

  const tenant = await getTenant(tenantId);
  if (!tenant) return json(404, { error: 'Workspace not found' });
  const config = (tenant.config ?? {}) as Record<string, unknown>;
  let customerId = typeof config.stripeCustomerId === 'string' ? config.stripeCustomerId : '';
  const email = claimsOf(event).email;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: email || undefined,
      metadata: { tenantId },
    });
    customerId = customer.id;
    await setBilling(tenantId, { stripeCustomerId: customerId, tier: tenant.tier });
  }

  const origin = originOf(event);
  const success = `${origin}/settings?billing=success`;
  const cancel = `${origin}/pricing?billing=cancelled`;

  if (body.action === 'pack') {
    const pack = String(body.pack ?? '');
    if (!PACKS.has(pack)) return json(400, { error: 'Unknown usage pack' });
    const price = packPriceId(pack);
    if (!price) {
      return json(503, { error: `Usage pack ${pack} is not priced in this environment` });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      client_reference_id: tenantId,
      metadata: { tenantId, kind: 'pack', pack },
      line_items: [{ price, quantity: 1 }],
      success_url: success,
      cancel_url: cancel,
    });
    return json(200, { url: session.url });
  }

  const tier = String(body.tier ?? '');
  if (tier === 'enterprise') {
    return json(400, { error: 'Enterprise is a custom contract. Contact sales — there is no self-serve checkout.' });
  }
  if (tier === 'free') {
    return json(400, { error: 'Free does not require checkout. Use the billing portal to cancel a paid plan.' });
  }
  if (!PAID_TIERS.has(tier)) return json(400, { error: 'Unknown plan' });
  const interval = body.interval === 'annual' ? 'annual' : 'monthly';
  const price = priceIdFor(tier, interval);
  if (!price) {
    return json(503, { error: `Stripe price for ${tier} ${interval} is not configured` });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: tenantId,
    metadata: { tenantId, kind: 'subscription', tier, previousTier: String(tenant.tier ?? 'free') },
    subscription_data: { metadata: { tenantId, tier } },
    line_items: [{ price, quantity: 1 }],
    success_url: success,
    cancel_url: cancel,
    allow_promotion_codes: true,
  });
  return json(200, { url: session.url });
}

async function handlePortal(event: APIGatewayProxyEvent, tenantId: string) {
  if (!isManagerOrAdmin(event)) {
    return json(403, { error: 'Only admins and managers can open the billing portal' });
  }
  let stripe: Stripe;
  try {
    stripe = await stripeClient();
  } catch {
    return json(503, { error: 'Billing is not configured for this environment' });
  }
  const tenant = await getTenant(tenantId);
  const config = (tenant?.config ?? {}) as Record<string, unknown>;
  const customerId = typeof config.stripeCustomerId === 'string' ? config.stripeCustomerId : '';
  if (!customerId) return json(400, { error: 'No Stripe customer on this workspace yet' });
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${originOf(event)}/settings`,
  });
  return json(200, { url: session.url });
}

async function handleStatus(tenantId: string) {
  const tenant = await getTenant(tenantId);
  if (!tenant) return json(404, { error: 'Workspace not found' });
  const config = (tenant.config ?? {}) as Record<string, unknown>;
  const configured = Boolean(stripeSecretCache) || Boolean(process.env.STRIPE_SECRET_SSM_PATH);
  let stripeReady = false;
  try {
    await stripeClient();
    stripeReady = true;
  } catch {
    stripeReady = false;
  }
  return json(200, {
    tier: tenant.tier ?? 'free',
    voiceAllowed: tenant.tier !== 'free',
    stripeCustomerId: typeof config.stripeCustomerId === 'string' ? config.stripeCustomerId : null,
    stripeReady,
    configured,
    contactCenter: 'not_live',
  });
}

async function applySubscription(tenantId: string, tier: string, subscriptionId: string, previousTier?: string) {
  if (!BILLING_SAFE(tier)) return;
  await setBilling(tenantId, { tier, stripeSubscriptionId: subscriptionId });
  if ((previousTier === 'free' || !previousTier) && tier !== 'free') {
    await recordConversion(tenantId, tier);
  }
}

function BILLING_SAFE(tier: string): boolean {
  return tier === 'free' || PAID_TIERS.has(tier) || tier === 'enterprise';
}

async function handleWebhook(event: APIGatewayProxyEvent) {
  let stripe: Stripe;
  let secret: string;
  try {
    stripe = await stripeClient();
    secret = await webhookSecret();
  } catch {
    return json(503, { error: 'Stripe webhook is not configured' });
  }
  const sig = event.headers?.['Stripe-Signature']
    ?? event.headers?.['stripe-signature']
    ?? '';
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
  let parsed: Stripe.Event;
  try {
    parsed = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return json(400, { error: `Invalid Stripe signature: ${(err as Error).message}` });
  }

  if (parsed.type === 'checkout.session.completed') {
    const session = parsed.data.object as Stripe.Checkout.Session;
    const tenantId = session.metadata?.tenantId || session.client_reference_id || '';
    if (!tenantId) return json(200, { ignored: true });
    if (session.metadata?.kind === 'pack') {
      const pack = session.metadata.pack ?? '';
      if (PACKS.has(pack)) {
        await addPackQuota(tenantId, pack, PACK_UNITS[pack] ?? 0);
      }
      return json(200, { ok: true });
    }
    const tier = session.metadata?.tier ?? '';
    const previous = session.metadata?.previousTier;
    const subId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? '';
    if (tier) await applySubscription(tenantId, tier, subId, previous);
    return json(200, { ok: true });
  }

  if (parsed.type === 'customer.subscription.updated') {
    const sub = parsed.data.object as Stripe.Subscription;
    const tenantId = sub.metadata?.tenantId ?? '';
    const tier = sub.metadata?.tier ?? '';
    if (tenantId && tier && sub.status !== 'canceled' && sub.status !== 'unpaid') {
      await applySubscription(tenantId, tier, sub.id);
    }
    if (tenantId && (sub.status === 'unpaid' || sub.status === 'canceled')) {
      await applySubscription(tenantId, 'free', sub.id);
    }
    return json(200, { ok: true });
  }

  if (parsed.type === 'customer.subscription.deleted') {
    const sub = parsed.data.object as Stripe.Subscription;
    const tenantId = sub.metadata?.tenantId ?? '';
    if (tenantId) await applySubscription(tenantId, 'free', sub.id);
    return json(200, { ok: true });
  }

  return json(200, { received: parsed.type });
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const path = event.path ?? event.resource ?? '';
  if (path.includes('webhooks-stripe')) {
    return handleWebhook(event);
  }

  const tenantId = tenantFromEvent(event);
  if (!tenantId) return json(401, { error: 'Missing tenant_id' });
  if (!hasWorkspaceRole(event)) {
    return json(403, { error: 'This account has not been granted access to its workspace' });
  }

  let body: { operation?: string };
  try {
    body = JSON.parse(event.body ?? '{}') as typeof body;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }
  const op = body.operation ?? 'status';
  try {
    if (op === 'checkout') return await handleCheckout(event, tenantId);
    if (op === 'portal') return await handlePortal(event, tenantId);
    if (op === 'status') return await handleStatus(tenantId);
    return json(400, { error: `Unknown operation: ${op}` });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'STRIPE_NOT_CONFIGURED') {
      return json(503, { error: 'Billing is not configured for this environment. No paid upgrade can be completed.' });
    }
    console.error('billing-service', msg);
    return json(500, { error: msg });
  }
};

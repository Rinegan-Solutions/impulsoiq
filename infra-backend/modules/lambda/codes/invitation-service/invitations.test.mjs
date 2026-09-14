/**
 * Behavioural tests for the invitation workflow.
 *
 * WHAT THESE TEST
 * The REAL handlers, bundled by esbuild with the AWS SDK clients and the DSQL
 * pool replaced by in-memory stubs. Nothing here re-implements the rules it is
 * checking — a test that restates the allowlist would pass even if the handler
 * dropped it.
 *
 * Covered:
 *   - the role ceiling, called directly as the API would be (the UI is not the
 *     control; see the Budibase advisory, where an invite hidden in the UI was
 *     still reachable over the API)
 *   - a raw token is never persisted, and never leaves the mint
 *   - single use, expiry, revocation, and email match on claim
 *   - cross-tenant claim refusal
 *   - the unauthenticated resolve endpoint answers identically for every failure
 *
 * Run: node invitations.test.mjs   (from this directory)
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = resolve('.');
const CRM_WRITE = resolve(HERE, '../crm-write-service');
const stubDir = mkdtempSync(join(tmpdir(), 'invite-stubs-'));

// ── Shared mutable state the stubs record into ───────────────────────────────
const calls = { lambda: [], ses: [], cognitoUsers: new Set() };
let crmWriteHandler = null; // wired below, so invitation-service reaches the real writer

// ── Stub modules ─────────────────────────────────────────────────────────────

writeFileSync(join(stubDir, 'lambda.mjs'), `
export class LambdaClient {
  async send(cmd) {
    const payload = JSON.parse(Buffer.from(cmd.input.Payload).toString());
    const out = await globalThis.__dispatch(cmd.input.FunctionName, payload);
    return { Payload: Buffer.from(JSON.stringify(out)) };
  }
}
export class InvokeCommand { constructor(input) { this.input = input; } }
`);

writeFileSync(join(stubDir, 'sesv2.mjs'), `
export class SESv2Client {
  async send(cmd) {
    if (globalThis.__sesFails) throw new Error('ses refused');
    globalThis.__ses.push(cmd.input);
    return {};
  }
}
export class SendEmailCommand { constructor(input) { this.input = input; } }
`);

writeFileSync(join(stubDir, 'ssm.mjs'), `
export class SSMClient { async send() { return { Parameter: { Value: 'pool-1' } }; } }
export class GetParameterCommand { constructor(input) { this.input = input; } }
`);

writeFileSync(join(stubDir, 'cognito.mjs'), `
export class CognitoIdentityProviderClient {
  async send(cmd) {
    if (globalThis.__cognitoUsers.has(cmd.input.Username)) return {};
    const err = new Error('not found'); err.name = 'UserNotFoundException'; throw err;
  }
}
export class AdminGetUserCommand { constructor(input) { this.input = input; } }
`);

writeFileSync(join(stubDir, 'ddb.mjs'), `
export class DynamoDBClient {}
`);

writeFileSync(join(stubDir, 'libddb.mjs'), `
export const DynamoDBDocumentClient = {
  from: () => ({ send: async () => ({ Attributes: { count: ++globalThis.__inviteCount } }) }),
};
export class UpdateCommand { constructor(input) { this.input = input; } }
`);

// ── A DSQL stand-in for crm-write ────────────────────────────────────────────
// Rows live in an array; each query is matched by its leading verb and table,
// then applied with the same predicates the SQL states. Timestamps are real, so
// the expiry test exercises the same comparison the database would.
writeFileSync(join(stubDir, 'db.mjs'), `
// esbuild inlines this module into the crm-write bundle, so the rows must live
// somewhere both that copy and the test can see.
globalThis.__rows = globalThis.__rows || [];
export const rows = globalThis.__rows;
let seq = 0;

function query(sql, params) {
  const s = sql.replace(/\\s+/g, ' ').trim();

  if (s.startsWith("UPDATE invitation SET status = 'revoked'") && s.includes('AND email =')) {
    const [tenantId, email] = params;
    let n = 0;
    for (const r of rows) {
      if (r.tenant_id === tenantId && r.email === email && r.status === 'pending') { r.status = 'revoked'; n++; }
    }
    return { rows: [], rowCount: n };
  }

  if (s.startsWith("UPDATE invitation SET status = 'revoked'") && s.includes('WHERE id =')) {
    const [id, tenantId] = params;
    const r = rows.find((x) => x.id === id && x.tenant_id === tenantId && x.status === 'pending');
    if (!r) return { rows: [], rowCount: 0 };
    r.status = 'revoked';
    return { rows: [{ id }], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO invitation')) {
    const [tenant_id, email, role, token_hash, invited_by, expires_at] = params;
    const row = {
      id: 'inv-' + (++seq), tenant_id, email, role, token_hash, invited_by,
      expires_at, status: 'pending', accepted_sub: null, accepted_at: null,
      created_at: new Date().toISOString(),
    };
    rows.push(row);
    return { rows: [{ id: row.id }], rowCount: 1 };
  }

  if (s.startsWith("UPDATE invitation SET status = 'accepted'")) {
    const [tenantId, email, sub] = params;
    const r = rows.find((x) =>
      x.tenant_id === tenantId && x.email === email && x.status === 'pending' &&
      new Date(x.expires_at).getTime() > Date.now());
    if (!r) return { rows: [], rowCount: 0 };
    r.status = 'accepted'; r.accepted_sub = sub; r.accepted_at = new Date().toISOString();
    return { rows: [{ id: r.id, role: r.role }], rowCount: 1 };
  }

  throw new Error('unexpected SQL in stub: ' + s.slice(0, 90));
}

export async function getDb() { return { query: async (sql, params) => query(sql, params) }; }
export async function closeDb() {}
`);

writeFileSync(join(stubDir, 'events.mjs'), `
export async function publishEvent() {}
export async function recordFirstActivation() {}
export async function recordActivation() {}
`);

// Handlers read their configuration at module scope, so this must be set
// before either of them is imported.
process.env.CRM_WRITE_SERVICE_ARN = 'crm-write-arn';
process.env.CRM_READ_SERVICE_ARN = 'crm-read-arn';
process.env.DYNAMODB_TABLE = 'events';
process.env.WEB_HOST = 'impulsoiq.example.com';
process.env.SES_FROM_ADDRESS = 'noreply@impulsoiq.example.com';
process.env.USER_POOL_ID_SSM_PATH = '/impulsoiq/test/backend/cognito_user_pool_id';

// ── Bundle both handlers against the stubs ───────────────────────────────────
async function bundle(entry, outfile, { alias = {}, relative = {} } = {}) {
  // esbuild's `alias` only accepts bare package names, so relative imports
  // (./db, ./events) are redirected with a resolver plugin instead.
  const redirectRelative = {
    name: 'redirect-relative',
    setup(b) {
      for (const [from, to] of Object.entries(relative)) {
        const pattern = new RegExp(`^${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
        b.onResolve({ filter: pattern }, () => ({ path: to }));
      }
    },
  };
  await build({
    entryPoints: [entry],
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    outfile, alias, plugins: [redirectRelative], logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const invitationMod = await bundle(join(HERE, 'handler.ts'), join(stubDir, 'invitation.mjs'), { alias: {
  '@aws-sdk/client-lambda': join(stubDir, 'lambda.mjs'),
  '@aws-sdk/client-sesv2': join(stubDir, 'sesv2.mjs'),
  '@aws-sdk/client-ssm': join(stubDir, 'ssm.mjs'),
  '@aws-sdk/client-cognito-identity-provider': join(stubDir, 'cognito.mjs'),
  '@aws-sdk/client-dynamodb': join(stubDir, 'ddb.mjs'),
  '@aws-sdk/lib-dynamodb': join(stubDir, 'libddb.mjs'),
} });

const writeMod = await bundle(join(CRM_WRITE, 'handler.ts'), join(stubDir, 'crmwrite.mjs'), {
  relative: {
    './db': join(stubDir, 'db.mjs'),
    './events': join(stubDir, 'events.mjs'),
  },
});
crmWriteHandler = writeMod.handler;

const dbMod = { get rows() { return globalThis.__rows; } };

// ── Wiring the stubbed Lambda client ─────────────────────────────────────────
globalThis.__ses = calls.ses;
globalThis.__cognitoUsers = calls.cognitoUsers;
globalThis.__inviteCount = 0;
globalThis.__sesFails = false;

globalThis.__dispatch = async (arn, payload) => {
  calls.lambda.push({ arn, payload });
  if (arn === 'crm-write-arn') return crmWriteHandler(payload, {});
  if (arn === 'crm-read-arn') {
    // Stands in for crm-read's find_invitation: the same lookup by token hash,
    // against the same rows crm-write wrote.
    const row = dbMod.rows.find((r) => r.token_hash === payload.payload.tokenHash);
    if (!row) return { result: null };
    return {
      result: {
        ...row,
        workspace_name: 'Acme',
        usable: row.status === 'pending' && new Date(row.expires_at).getTime() > Date.now(),
      },
    };
  }
  throw new Error('unknown arn ' + arn);
};


// ── Test helpers ─────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; })
    .catch((err) => { failures.push(`${name}: ${err.message}`); });
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function apiEvent({ tenant = 'acme', groups = 'admin', email = 'boss@acme.com', body = {}, path = '/invitations' } = {}) {
  return {
    path,
    body: JSON.stringify(body),
    requestContext: { authorizer: { claims: { 'custom:tenant_id': tenant, 'cognito:groups': groups, email } } },
  };
}

const invite = (event) => invitationMod.handler(event, {}, () => {});
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body) });

// ── The role ceiling ─────────────────────────────────────────────────────────

const CEILING = [
  ['admin', 'admin', true], ['admin', 'manager', true], ['admin', 'member', true],
  ['manager', 'admin', false], ['manager', 'manager', false], ['manager', 'member', true],
  ['member', 'admin', false], ['member', 'manager', false], ['member', 'member', false],
];

for (const [callerRole, wanted, allowed] of CEILING) {
  await check(`${callerRole} invites ${wanted} -> ${allowed ? 'allowed' : 'refused'}`, async () => {
    const res = parse(await invite(apiEvent({
      groups: callerRole,
      body: { operation: 'create', email: `p-${callerRole}-${wanted}@other.com`, role: wanted },
    })));
    if (allowed) assert(res.status === 201, `expected 201, got ${res.status} ${JSON.stringify(res.body)}`);
    else assert(res.status === 403, `expected 403, got ${res.status}`);
  });
}

await check('an account with no workspace group cannot invite', async () => {
  const res = parse(await invite(apiEvent({ groups: '', body: { operation: 'create', email: 'x@other.com', role: 'member' } })));
  assert(res.status === 403, `expected 403, got ${res.status}`);
});

await check('a request with no tenant claim is rejected', async () => {
  const res = parse(await invite({
    path: '/invitations',
    body: JSON.stringify({ operation: 'create', email: 'x@other.com', role: 'member' }),
    requestContext: { authorizer: { claims: {} } },
  }));
  assert(res.status === 401, `expected 401, got ${res.status}`);
});

// ── Token handling ───────────────────────────────────────────────────────────

let liveToken = '';

await check('the mint stores only a hash, and the raw token appears only in the email link', async () => {
  calls.ses.length = 0;
  const res = parse(await invite(apiEvent({
    body: { operation: 'create', email: 'new@other.com', role: 'member', workspaceName: 'Acme' },
  })));
  assert(res.status === 201, `expected 201, got ${res.status}`);
  assert(res.body.emailed === true, 'should report the email as sent');

  const sent = calls.ses.at(-1);
  const link = sent.Content.Simple.Body.Text.Data.match(/https:\/\/\S+/)[0];
  liveToken = decodeURIComponent(new URL(link).searchParams.get('invite'));

  assert(link.startsWith('https://acme.impulsoiq.example.com/sign-up?invite='),
    `link points at the tenant host: ${link}`);
  assert(liveToken.length >= 40, `token should be long and random, got ${liveToken.length} chars`);

  const row = dbMod.rows.find((r) => r.email === 'new@other.com' && r.status === 'pending');
  assert(row.token_hash === createHash('sha256').update(liveToken).digest('hex'),
    'stored hash must be the sha256 of the emailed token');
  assert(!JSON.stringify(row).includes(liveToken), 'the raw token must never be stored');
});

await check('two invitations never share a token', async () => {
  calls.ses.length = 0;
  await invite(apiEvent({ body: { operation: 'create', email: 'a1@other.com', role: 'member' } }));
  await invite(apiEvent({ body: { operation: 'create', email: 'a2@other.com', role: 'member' } }));
  const [one, two] = calls.ses.map((s) => s.Content.Simple.Body.Text.Data.match(/invite=(\S+)/)[1]);
  assert(one !== two, 'tokens must be unique');
});

await check('an email that already has an account is refused, not invited', async () => {
  calls.cognitoUsers.add('taken@other.com');
  const res = parse(await invite(apiEvent({ body: { operation: 'create', email: 'taken@other.com', role: 'member' } })));
  assert(res.status === 409, `expected 409, got ${res.status}`);
  assert(!dbMod.rows.some((r) => r.email === 'taken@other.com'), 'no row should be written');
});

await check('a send failure is reported as not emailed, never as sent', async () => {
  globalThis.__sesFails = true;
  const res = parse(await invite(apiEvent({ body: { operation: 'create', email: 'bounce@other.com', role: 'member' } })));
  globalThis.__sesFails = false;
  assert(res.status === 202, `expected 202, got ${res.status}`);
  assert(res.body.emailed === false, 'must not claim the email was sent');
});

// ── Resolve (public) ─────────────────────────────────────────────────────────

const GENERIC = 'This invitation link is not valid, has already been used, or has expired.';

await check('resolve returns only the workspace, address and role', async () => {
  const res = parse(await invite({ path: '/invite-lookup', body: JSON.stringify({ token: liveToken }) }));
  assert(res.body.valid === true, 'should resolve');
  assert(res.body.email === 'new@other.com' && res.body.role === 'member', 'returns the invited identity');
  assert(res.body.workspaceName === 'Acme', 'returns the workspace name');
  assert(!('tokenHash' in res.body) && !('token' in res.body), 'must not echo any token material');
});

await check('resolve answers identically for an unknown token', async () => {
  const res = parse(await invite({ path: '/invite-lookup', body: JSON.stringify({ token: 'z'.repeat(43) }) }));
  assert(res.body.valid === false && res.body.error === GENERIC, 'generic refusal only');
});

await check('resolve needs no Cognito claims at all', async () => {
  const res = parse(await invite({ path: '/invite-lookup', body: JSON.stringify({ token: liveToken }) }));
  assert(res.status === 200 && res.body.valid === true, 'public route must work unauthenticated');
});

// ── Claiming ─────────────────────────────────────────────────────────────────

const consume = (tenantId, email, actorId = 'tenant-provisioner') =>
  crmWriteHandler({ operation: 'consume_invitation', payload: { email, sub: 'sub-1' }, tenantId, actorType: 'human', actorId }, {});

await check('the claimed role comes from the invitation, not the request', async () => {
  const out = await consume('acme', 'new@other.com');
  assert(out.ok === true && out.role === 'member', `expected member, got ${JSON.stringify(out)}`);
});

await check('an invitation cannot be claimed twice', async () => {
  const out = await consume('acme', 'new@other.com');
  assert(out.role === null, 'a second claim must grant nothing');
});

await check('a different address cannot claim someone else\'s invitation', async () => {
  const res = parse(await invite(apiEvent({ body: { operation: 'create', email: 'target@other.com', role: 'manager' } })));
  assert(res.status === 201);
  const out = await consume('acme', 'impostor@other.com');
  assert(out.role === null, 'claiming as another address must grant nothing');
});

await check('an invitation cannot be claimed from another workspace', async () => {
  const out = await consume('evilcorp', 'target@other.com');
  assert(out.role === null, 'cross-tenant claim must grant nothing');
});

await check('an expired invitation grants nothing', async () => {
  const row = dbMod.rows.find((r) => r.email === 'target@other.com' && r.status === 'pending');
  row.expires_at = new Date(Date.now() - 1000).toISOString();
  const out = await consume('acme', 'target@other.com');
  assert(out.role === null, 'expired invitations must grant nothing');
});

await check('a revoked invitation grants nothing', async () => {
  await invite(apiEvent({ body: { operation: 'create', email: 'gone@other.com', role: 'member' } }));
  const row = dbMod.rows.find((r) => r.email === 'gone@other.com' && r.status === 'pending');
  const res = parse(await invite(apiEvent({ body: { operation: 'revoke', id: row.id } })));
  assert(res.status === 200, `revoke should succeed, got ${res.status}`);
  const out = await consume('acme', 'gone@other.com');
  assert(out.role === null, 'revoked invitations must grant nothing');
});

await check('re-inviting invalidates the previous link', async () => {
  calls.ses.length = 0;
  await invite(apiEvent({ body: { operation: 'create', email: 'again@other.com', role: 'member' } }));
  const first = decodeURIComponent(calls.ses.at(-1).Content.Simple.Body.Text.Data.match(/invite=(\S+)/)[1]);
  await invite(apiEvent({ body: { operation: 'create', email: 'again@other.com', role: 'member' } }));

  const stale = parse(await invite({ path: '/invite-lookup', body: JSON.stringify({ token: first }) }));
  assert(stale.body.valid === false, 'the superseded link must stop working');
  const live = dbMod.rows.filter((r) => r.email === 'again@other.com' && r.status === 'pending');
  assert(live.length === 1, `exactly one live invitation per address, found ${live.length}`);
});

// ── crm-write is not reachable around the service ────────────────────────────

await check('crm-write refuses invitation writes arriving over the API', async () => {
  // Shaped exactly as API Gateway delivers it: the envelope is in the body, and
  // an admin's own claims are attached. Being an admin is not the point — the
  // mint has to go through invitation-service, which is what applies the ceiling.
  const out = await crmWriteHandler({
    body: JSON.stringify({
      operation: 'create_invitation',
      payload: { email: 'x@other.com', role: 'admin', tokenHash: 'a'.repeat(64), invitedBy: 'x', expiresAt: new Date().toISOString() },
      actorId: 'invitation-service',
    }),
    requestContext: { authorizer: { claims: { 'custom:tenant_id': 'acme', 'cognito:groups': 'admin' } } },
  }, {});
  const status = out.statusCode ?? JSON.parse(out.body ?? '{}').statusCode;
  assert(status === 403, `expected 403, got ${JSON.stringify(out)}`);
});

await check('crm-write refuses a claim from anything but the provisioner', async () => {
  const out = await consume('acme', 'again@other.com', 'someone-else');
  assert(out.ok === false, `expected refusal, got ${JSON.stringify(out)}`);
});

await check('crm-write refuses an invitation with a role outside the roster', async () => {
  const out = await crmWriteHandler({
    operation: 'create_invitation',
    payload: { email: 'x@other.com', role: 'owner', tokenHash: 'a'.repeat(64), invitedBy: 'x', expiresAt: new Date().toISOString() },
    tenantId: 'acme', actorId: 'invitation-service',
  }, {});
  assert(out.ok === false, `expected refusal, got ${JSON.stringify(out)}`);
});

await check('crm-write refuses a token hash that is not a sha256 digest', async () => {
  const out = await crmWriteHandler({
    operation: 'create_invitation',
    payload: { email: 'x@other.com', role: 'member', tokenHash: 'short', invitedBy: 'x', expiresAt: new Date().toISOString() },
    tenantId: 'acme', actorId: 'invitation-service',
  }, {});
  assert(out.ok === false, 'a short hash must be refused');
});

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);

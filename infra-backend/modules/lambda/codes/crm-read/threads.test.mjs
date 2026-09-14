/**
 * Behavioural tests for Home assistant thread storage.
 *
 * WHAT MATTERS HERE
 * A thread is one person's private scratchpad inside a shared workspace, so the
 * interesting failures are not "does it save" but:
 *   - can a colleague in the SAME tenant read or write my thread?
 *   - can someone in another tenant?
 *   - does re-sending a transcript duplicate turns?
 *   - can a save rewrite history rather than append to it?
 *
 * Both real handlers are bundled with esbuild against an in-memory stand-in for
 * DSQL, so the SQL predicates under test are the ones that ship.
 *
 * Run: node threads.test.mjs   (from this directory)
 */
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// The handlers bundle the AWS SDK, which is CommonJS and calls require() at load
// time. Emitting ESM turns those into esbuild's "Dynamic require is not
// supported" shim, so the bundles are CJS and loaded through createRequire.
const require = createRequire(import.meta.url);

const HERE = resolve('.');
const CRM_WRITE = resolve(HERE, '../crm-write-service');
const stubDir = mkdtempSync(join(tmpdir(), 'thread-stubs-'));

// ── DSQL stand-in ────────────────────────────────────────────────────────────
// Each branch applies the same predicates the handler's SQL states. Rows live on
// globalThis because esbuild inlines this module into BOTH bundles.
writeFileSync(join(stubDir, 'db.mjs'), `
globalThis.__threads = globalThis.__threads || [];
globalThis.__turns = globalThis.__turns || [];
let seq = 0;

function query(sql, params) {
  const s = sql.replace(/\\s+/g, ' ').trim();
  const threads = globalThis.__threads;
  const turns = globalThis.__turns;

  if (s.startsWith('UPDATE assistant_thread SET title')) {
    const [id, tenantId, title, goal, starter, ownerSub] = params;
    const t = threads.find((x) => x.id === id && x.tenant_id === tenantId && x.user_sub === ownerSub);
    if (!t) return { rows: [], rowCount: 0 };
    Object.assign(t, { title, goal, starter, updated_at: new Date().toISOString() });
    return { rows: [{ id }], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO assistant_thread')) {
    const [tenant_id, user_sub, title, goal, starter] = params;
    const row = {
      id: 'th-' + (++seq), tenant_id, user_sub, title, goal, starter,
      status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    threads.push(row);
    return { rows: [{ id: row.id }], rowCount: 1 };
  }

  if (s.includes('MAX(seq)')) {
    const [threadId] = params;
    const mine = turns.filter((t) => t.thread_id === threadId);
    const max = mine.length ? Math.max(...mine.map((t) => t.seq)) : -1;
    return { rows: [{ max_seq: max }], rowCount: 1 };
  }

  if (s.startsWith('INSERT INTO assistant_turn')) {
    const [tenant_id, thread_id, seqNo, role, kind, body, data] = params;
    turns.push({ tenant_id, thread_id, seq: seqNo, role, kind, body, data: JSON.parse(data),
                 created_at: new Date().toISOString() });
    return { rows: [], rowCount: 1 };
  }

  if (s.startsWith("UPDATE assistant_thread SET status = 'archived'")) {
    const [id, tenantId, ownerSub] = params;
    const t = threads.find((x) => x.id === id && x.tenant_id === tenantId && x.user_sub === ownerSub);
    if (!t) return { rows: [], rowCount: 0 };
    t.status = 'archived';
    return { rows: [{ id }], rowCount: 1 };
  }

  if (s.startsWith('SELECT t.id, t.title')) {
    const [tenantId, sub, limit] = params;
    const rows = threads
      .filter((t) => t.tenant_id === tenantId && t.user_sub === sub && t.status === 'active')
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, limit)
      .map((t) => ({ ...t, turn_count: turns.filter((x) => x.thread_id === t.id).length }));
    return { rows, rowCount: rows.length };
  }

  if (s.startsWith('SELECT id, title, goal, starter, status')) {
    const [id, tenantId, sub] = params;
    const t = threads.find((x) => x.id === id && x.tenant_id === tenantId && x.user_sub === sub);
    return { rows: t ? [t] : [], rowCount: t ? 1 : 0 };
  }

  if (s.startsWith('SELECT seq, role, kind, body, data')) {
    const [threadId, tenantId] = params;
    const rows = turns
      .filter((t) => t.thread_id === threadId && t.tenant_id === tenantId)
      .sort((a, b) => a.seq - b.seq);
    return { rows, rowCount: rows.length };
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
writeFileSync(join(stubDir, 'empty.mjs'), 'export default {};\n');

function bundle(entry, outfile) {
  const redirect = {
    name: 'redirect',
    setup(b) {
      b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: join(stubDir, 'db.mjs') }));
      b.onResolve({ filter: /^\.\/events$/ }, () => ({ path: join(stubDir, 'events.mjs') }));
    },
  };
  return build({
    entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs',
    target: 'node20', outfile, plugins: [redirect], logLevel: 'silent',
  }).then(() => require(outfile));
}

process.env.DYNAMODB_TABLE = 'events';

const write = (await bundle(join(CRM_WRITE, 'handler.ts'), join(stubDir, 'w.cjs'))).handler;
const read = (await bundle(join(HERE, 'handler.ts'), join(stubDir, 'r.cjs'))).handler;

// ── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];

const check = (name, fn) => Promise.resolve().then(fn)
  .then(() => { passed++; })
  .catch((err) => { failures.push(`${name}: ${err.message}`); });

function assert(cond, message) { if (!cond) throw new Error(message); }

/** An API Gateway event as the Cognito authorizer delivers it. */
function evt(op, payload, { tenant = 'acme', sub = 'user-1', host = null } = {}) {
  return {
    body: JSON.stringify({ operation: op, payload }),
    headers: host ? { 'x-impulsoiq-tenant': host } : {},
    requestContext: {
      authorizer: { claims: { 'custom:tenant_id': tenant, 'cognito:groups': 'member', sub } },
    },
  };
}

const unwrap = (res) => {
  if (res && typeof res.body === 'string' && res.statusCode) {
    return { statusCode: res.statusCode, ...JSON.parse(res.body) };
  }
  return res;
};

const turn = (role, body) => ({ role, kind: 'text', body });

// ── Saving ───────────────────────────────────────────────────────────────────

let threadId = '';

await check('a thread is created and its turns stored', async () => {
  const res = unwrap(await write(evt('save_thread', {
    goal: 'Qualify inbound leads',
    turns: [turn('user', 'Qualify inbound leads'), turn('assistant', 'Which channel?')],
  }), {}));
  assert(res.ok === true && res.id, `expected an id, got ${JSON.stringify(res)}`);
  threadId = res.id;
  assert(res.appended === 2, `expected 2 turns appended, got ${res.appended}`);
});

await check('re-sending the same transcript appends nothing', async () => {
  const res = unwrap(await write(evt('save_thread', {
    id: threadId,
    goal: 'Qualify inbound leads',
    turns: [turn('user', 'Qualify inbound leads'), turn('assistant', 'Which channel?')],
  }), {}));
  assert(res.appended === 0, `a repeat save must append nothing, appended ${res.appended}`);
  assert(globalThis.__turns.filter(t => t.thread_id === threadId).length === 2, 'turn count must stay 2');
});

await check('only genuinely new turns are appended', async () => {
  const res = unwrap(await write(evt('save_thread', {
    id: threadId,
    goal: 'Qualify inbound leads',
    turns: [turn('user', 'Qualify inbound leads'), turn('assistant', 'Which channel?'), turn('user', 'Email only')],
  }), {}));
  assert(res.appended === 1, `expected 1 appended, got ${res.appended}`);
});

await check('a save cannot rewrite an earlier turn', async () => {
  await write(evt('save_thread', {
    id: threadId,
    goal: 'Qualify inbound leads',
    turns: [turn('user', 'REWRITTEN'), turn('assistant', 'REWRITTEN'), turn('user', 'REWRITTEN')],
  }), {});
  const first = globalThis.__turns.find(t => t.thread_id === threadId && t.seq === 0);
  assert(first.body === 'Qualify inbound leads', `history was rewritten to "${first.body}"`);
});

await check('structured turns keep their payload', async () => {
  const res = unwrap(await write(evt('save_thread', {
    goal: 'Plan test',
    turns: [{ role: 'assistant', kind: 'plan', body: '', data: { plan: { steps: ['a', 'b'] } } }],
  }), {}));
  const stored = globalThis.__turns.find(t => t.thread_id === res.id && t.seq === 0);
  assert(stored.kind === 'plan', `kind lost: ${stored.kind}`);
  assert(stored.data.plan.steps.length === 2, 'plan payload must survive the round trip');
});

await check('an unknown turn kind is stored as text, not rejected or trusted', async () => {
  const res = unwrap(await write(evt('save_thread', {
    goal: 'Odd', turns: [{ role: 'assistant', kind: 'javascript', body: 'x' }],
  }), {}));
  const stored = globalThis.__turns.find(t => t.thread_id === res.id && t.seq === 0);
  assert(stored.kind === 'text', `expected text, got ${stored.kind}`);
});

// ── Reading, and the ownership boundary ──────────────────────────────────────

await check('the owner can read their own thread back', async () => {
  const res = unwrap(await read(evt('get_thread', { id: threadId }), {}));
  assert(res.result, 'owner must be able to read it');
  assert(res.result.turns.length === 3, `expected 3 turns, got ${res.result.turns.length}`);
  assert(res.result.turns[0].seq === 0, 'turns must come back in order');
});

await check('a colleague in the SAME workspace cannot read it', async () => {
  const res = unwrap(await read(evt('get_thread', { id: threadId }, { sub: 'user-2' }), {}));
  assert(res.result === null, 'another user in the same tenant must get null');
});

await check('a colleague does not see it in their list', async () => {
  const res = unwrap(await read(evt('list_threads', {}, { sub: 'user-2' }), {}));
  assert(Array.isArray(res.result) && res.result.length === 0,
    `another user's list must be empty, got ${JSON.stringify(res.result)}`);
});

await check('another workspace cannot read it', async () => {
  const res = unwrap(await read(evt('get_thread', { id: threadId }, { tenant: 'evilcorp', sub: 'user-1' }), {}));
  assert(res.result === null, 'cross-tenant read must return null');
});

await check('the owner list shows their threads newest first', async () => {
  const res = unwrap(await read(evt('list_threads', {}), {}));
  assert(res.result.length >= 3, `expected the owner's threads, got ${res.result.length}`);
  assert(res.result[0].turn_count >= 1, 'turn_count should be reported');
});

await check('threads are not reachable by direct (agent) invocation', async () => {
  const res = unwrap(await read({ operation: 'list_threads', payload: {}, tenantId: 'acme' }, {}));
  assert(res.statusCode === 403, `expected 403 for a direct invoke, got ${JSON.stringify(res)}`);
});

await check('an agent cannot write a thread either', async () => {
  const res = unwrap(await write({
    operation: 'save_thread', payload: { goal: 'x', turns: [] },
    tenantId: 'acme', actorType: 'agent', actorId: 'some-agent',
  }, {}));
  assert(res.ok === false, `expected refusal, got ${JSON.stringify(res)}`);
});

// ── Writing to someone else's thread ─────────────────────────────────────────

await check("a colleague cannot append to someone else's thread", async () => {
  const before = globalThis.__turns.filter(t => t.thread_id === threadId).length;
  const res = unwrap(await write(evt('save_thread', {
    id: threadId, goal: 'hijack', turns: [turn('user', 'hijack')],
  }, { sub: 'user-2' }), {}));
  assert(res.ok === false, `expected refusal, got ${JSON.stringify(res)}`);
  const after = globalThis.__turns.filter(t => t.thread_id === threadId).length;
  assert(before === after, 'no turn may be written to a thread the caller does not own');
});

await check("another workspace cannot append to it", async () => {
  const res = unwrap(await write(evt('save_thread', {
    id: threadId, goal: 'hijack', turns: [turn('user', 'hijack')],
  }, { tenant: 'evilcorp' }), {}));
  assert(res.ok === false, `expected refusal, got ${JSON.stringify(res)}`);
});

await check('the thread goal was not altered by the refused writes', async () => {
  const t = globalThis.__threads.find(x => x.id === threadId);
  assert(t.goal === 'Qualify inbound leads', `goal was changed to "${t.goal}"`);
});

// ── Archiving ────────────────────────────────────────────────────────────────

await check("a colleague cannot archive someone else's thread", async () => {
  const res = unwrap(await write(evt('archive_thread', { id: threadId }, { sub: 'user-2' }), {}));
  assert(res.ok === false, `expected refusal, got ${JSON.stringify(res)}`);
  assert(globalThis.__threads.find(x => x.id === threadId).status === 'active', 'must stay active');
});

await check('the owner can archive, and it leaves their list', async () => {
  const res = unwrap(await write(evt('archive_thread', { id: threadId }), {}));
  assert(res.ok !== false, `owner archive should succeed, got ${JSON.stringify(res)}`);
  const list = unwrap(await read(evt('list_threads', {}), {}));
  assert(!list.result.some(t => t.id === threadId), 'an archived thread must not be listed');
});

// ── Limits ───────────────────────────────────────────────────────────────────

await check('an absurdly long thread is refused rather than stored', async () => {
  const many = Array.from({ length: 401 }, (_, i) => turn('user', `t${i}`));
  const res = unwrap(await write(evt('save_thread', { goal: 'too long', turns: many }), {}));
  assert(res.ok === false, `expected refusal, got ${JSON.stringify(res)}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.error(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);

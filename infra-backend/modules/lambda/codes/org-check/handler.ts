/**
 * Org-Check Lambda — unauthenticated endpoint.
 *
 * Called by the sign-up flow before the user creates an account. Given an
 * email domain, returns any existing workspaces that share that domain so
 * the frontend can offer a "join your team" option instead of silently
 * creating a duplicate workspace.
 *
 * Security notes:
 * - Intentionally public (no auth) — the user hasn't signed up yet.
 * - Returns only non-sensitive fields: tenant name + subdomain. No user data.
 * - API Gateway rate limiting protects against enumeration attacks.
 * - Domains shorter than 4 chars or missing a TLD are rejected.
 */
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';

const REGION   = process.env.AWS_REGION ?? 'eu-west-2';
const ENDPOINT = process.env.DSQL_ENDPOINT!;

let _client: Client | null = null;

async function getDb(): Promise<Client> {
  if (_client) {
    try { await _client.query('SELECT 1'); return _client; }
    catch { _client = null; }
  }
  const signer = new DsqlSigner({ hostname: ENDPOINT, region: REGION });
  const token  = await signer.getDbConnectAdminAuthToken();
  const client = new Client({
    host: ENDPOINT, database: 'postgres', user: 'admin', password: token,
    port: 5432, ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5_000, query_timeout: 10_000,
  });
  await client.connect();
  _client = client;
  return client;
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function isValidDomain(domain: string): boolean {
  // Minimum: a.bc  (1 char label + dot + 2 char TLD)
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$/i.test(domain);
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const domain = (event.queryStringParameters?.domain ?? '').toLowerCase().trim();

  if (!domain || !isValidDomain(domain)) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid or missing domain parameter' }),
    };
  }

  // Reject public mailbox providers: a workspace created from a gmail.com
  // address would otherwise match every gmail.com user who types their address
  // here, telling each of them a stranger's workspace exists. Must match
  // PUBLIC_EMAIL_DOMAINS in tenant-provisioner, which never records these as a
  // workspace's email_domain.
  //
  // NOTE ON WHAT THIS ENDPOINT IS FOR NOW. It used to drive a join flow; a
  // domain match granted membership. It no longer grants anything — membership
  // comes from an invitation — so this only decides whether sign-up and sign-in
  // show the "ask your workspace admin" modal. It is unauthenticated and
  // returns nothing but a workspace's display name and address.
  const COMMON_PROVIDERS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
    'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'aol.com',
    'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me',
    'fastmail.com', 'hey.com', 'gmx.com', 'gmx.net', 'zoho.com', 'mail.com',
    'yandex.com',
  ]);
  if (COMMON_PROVIDERS.has(domain)) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenants: [] }),
    };
  }

  try {
    const db  = await getDb();
    const res = await db.query(
      `SELECT id, name, subdomain
       FROM   tenant
       WHERE  email_domain = $1
       LIMIT  5`,
      [domain],
    );

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenants: res.rows.map(r => ({
          id:        r.id,
          name:      r.name,
          subdomain: r.subdomain,
        })),
      }),
    };

  } catch (err) {
    console.error('org-check error', { domain, error: (err as Error).message });
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal error' }),
    };
  }
};

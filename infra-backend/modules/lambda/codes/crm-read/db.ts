/**
 * Aurora DSQL connection helper (copied from crm-write-service/db.ts).
 *
 * DSQL uses IAM authentication: we generate a short-lived token via DsqlSigner
 * and pass it as the PostgreSQL password. The token is refreshed on each cold
 * start; for warm invocations we reuse the pooled client.
 *
 * DSQL endpoint format: <cluster-id>.dsql.<region>.on.aws
 */
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';

const REGION   = process.env.AWS_REGION ?? 'eu-west-2';
const ENDPOINT = process.env.DSQL_ENDPOINT!;

let _client: Client | null = null;

export async function getDb(): Promise<Client> {
  // Reuse warm connection — DSQL keeps connections alive across invocations
  if (_client) {
    try {
      await _client.query('SELECT 1');
      return _client;
    } catch {
      _client = null; // stale connection; fall through to reconnect
    }
  }

  const signer  = new DsqlSigner({ hostname: ENDPOINT, region: REGION });
  const token   = await signer.getDbConnectAdminAuthToken();

  const client = new Client({
    host:                    ENDPOINT,
    database:                'postgres',
    user:                    'admin',
    password:                token,
    port:                    5432,
    ssl:                     { rejectUnauthorized: false }, // DSQL uses self-signed cert
    connectionTimeoutMillis: 5_000,
    query_timeout:           15_000,
  });

  await client.connect();
  _client = client;
  return client;
}

/** Disconnect — call on Lambda shutdown or after a fatal DB error. */
export async function closeDb(): Promise<void> {
  if (_client) { await _client.end().catch(() => void 0); _client = null; }
}

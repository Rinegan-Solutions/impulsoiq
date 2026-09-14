/**
 * Read a key from the environment's packed Secrets Manager JSON.
 * Missing ARN, missing key, or empty value is a closed fail — callers decide.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});
let cache: Record<string, string> | null = null;

export async function appSecret(key: string): Promise<string> {
  const arn = process.env.APP_SECRET_ARN ?? '';
  if (!arn) return '';
  if (!cache) {
    const resp = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
    const raw = resp.SecretString ?? '';
    if (!raw) {
      cache = {};
    } else {
      try {
        cache = JSON.parse(raw) as Record<string, string>;
      } catch {
        throw new Error('APP_SECRET_ARN did not contain JSON');
      }
    }
  }
  const value = cache[key];
  return typeof value === 'string' ? value.trim() : '';
}

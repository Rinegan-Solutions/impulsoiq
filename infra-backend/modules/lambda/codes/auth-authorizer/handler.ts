/**
 * Lambda authorizer for API Gateway.
 *
 * Validates Cognito JWTs and returns an IAM policy.
 * The User Pool ID is read from SSM on cold start (not hardcoded) so this
 * Lambda has no Terraform dependency on the auth module — it discovers the
 * pool at runtime from the well-known SSM path.
 *
 * Context passed downstream:
 *   tenantId  — from custom:tenant_id claim (always present; rejects if missing)
 *   userId    — JWT sub claim
 *   groups    — JSON-encoded cognito:groups array e.g. '["admin"]'
 *   isAdmin   — "true" | "false" string (APIGW context values must be primitive)
 *
 * IAM policy Resource: the entire API stage (not just the invoked method) so
 * cached authorizer decisions don't block subsequent method calls.
 */
import type { APIGatewayRequestAuthorizerHandler, APIGatewayAuthorizerResult } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import jwksClient from 'jwks-rsa';
import jwt from 'jsonwebtoken';

const ssm = new SSMClient({ region: process.env.AWS_REGION });

// Module-level cache: lives for the lifetime of the warm Lambda container
let cachedPoolId: string | null = null;

async function getPoolId(): Promise<string> {
  if (cachedPoolId) return cachedPoolId;

  const resp = await ssm.send(new GetParameterCommand({
    Name: process.env.USER_POOL_ID_SSM_PATH!,
  }));

  if (!resp.Parameter?.Value) {
    throw new Error('USER_POOL_ID_SSM_PATH resolved to empty value');
  }

  cachedPoolId = resp.Parameter.Value;
  return cachedPoolId;
}

// jwks-rsa client is also module-level; its key cache is shared across warm invocations
const jwksCache: Record<string, ReturnType<typeof jwksClient>> = {};

function getJwksClient(jwksUri: string) {
  if (!jwksCache[jwksUri]) {
    jwksCache[jwksUri] = jwksClient({
      jwksUri,
      cache:        true,
      cacheMaxAge:  600_000, // 10 min — Cognito rotates keys infrequently
      cacheMaxEntries: 5,
    });
  }
  return jwksCache[jwksUri];
}

export const handler: APIGatewayRequestAuthorizerHandler = async (event) => {
  // API Gateway lowercases headers; guard against clients that send Authorization
  const rawHeader = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const token     = rawHeader.replace(/^[Bb]earer\s+/, '');

  if (!token) throw new Error('Unauthorized');

  // Decode without verification first — we need the kid to fetch the right public key
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') throw new Error('Unauthorized');

  // Resolve our pool ID and region at runtime (SSM, warm-cached)
  const poolId = await getPoolId();
  const region = process.env.AWS_REGION!;

  // Build the expected issuer URL from OUR pool — this is the anti-spoofing check
  const expectedIssuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
  const jwksUri        = `${expectedIssuer}/.well-known/jwks.json`;

  const client     = getJwksClient(jwksUri);
  const signingKey = await client.getSigningKey(decoded.header.kid);

  const payload = jwt.verify(token, signingKey.getPublicKey(), {
    algorithms: ['RS256'],
    issuer:     expectedIssuer, // rejects JWTs not issued by our pool
    audience:   undefined,       // Cognito doesn't set aud on access tokens by default
  }) as jwt.JwtPayload;

  const tenantId = payload['custom:tenant_id'] as string | undefined;
  if (!tenantId) throw new Error('Unauthorized'); // no tenant_id = not a workspace user

  const groups  = (payload['cognito:groups'] as string[] | undefined) ?? [];
  const userSub = payload.sub!;

  // Build an allow policy scoped to the entire stage (not just this method).
  // Returning a method-scoped policy causes cache misses to block subsequent calls.
  const [, , , awsRegion, accountId, apiGwArn] = event.methodArn.split(':');
  const [apiId, stageName]                     = apiGwArn.split('/');
  const stageResource = `arn:aws:execute-api:${awsRegion}:${accountId}:${apiId}/${stageName}/*/*`;

  return {
    principalId: userSub,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Effect:   'Allow',
        Action:   'execute-api:Invoke',
        Resource: stageResource,
      }],
    },
    // Context values must be string | number | boolean — no arrays or objects
    context: {
      tenantId,
      userId:  userSub,
      groups:  JSON.stringify(groups),
      isAdmin: String(groups.includes('admin')),
    },
  } satisfies APIGatewayAuthorizerResult;
};

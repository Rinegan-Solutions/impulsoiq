/**
 * AppSync Publisher — DynamoDB Streams → AppSync real-time push.
 *
 * Auth: AWS IAM signing. APPSYNC_URL is resolved from SSM at cold start
 * (Terraform cannot inject the URL without a lambda→api cycle).
 */
import type { DynamoDBStreamHandler } from 'aws-lambda';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import https from 'https';
import { URL } from 'url';

const REGION = process.env.AWS_REGION ?? 'eu-west-2';
const ssm = new SSMClient({ region: REGION });

const PUBLISH_MUTATION = /* GraphQL */ `
  mutation PublishAgentAction($input: AgentActionInput!) {
    publishAgentAction(input: $input) {
      id
      agentType
      action
      status
      occurredAt
    }
  }
`;

let appsyncUrlCache: string | undefined;

async function appsyncUrl(): Promise<string> {
  if (process.env.APPSYNC_URL) return process.env.APPSYNC_URL;
  if (appsyncUrlCache) return appsyncUrlCache;
  const path = process.env.APPSYNC_URL_SSM_PATH;
  if (!path) throw new Error('APPSYNC_URL is not configured');
  const resp = await ssm.send(new GetParameterCommand({ Name: path }));
  const value = resp.Parameter?.Value ?? '';
  if (!value) throw new Error('APPSYNC_URL_SSM_PATH resolved empty');
  appsyncUrlCache = value;
  return value;
}

function attrS(image: Record<string, { S?: string; M?: Record<string, unknown> }>, key: string): string {
  return image[key]?.S ?? '';
}

function nestedS(image: Record<string, { M?: Record<string, { S?: string }> }>, key: string): string {
  return image.data?.M?.[key]?.S ?? '';
}

async function signedPost(endpoint: string, body: string): Promise<void> {
  const url    = new URL(endpoint);
  const signer = new SignatureV4({
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      sessionToken:    process.env.AWS_SESSION_TOKEN,
    },
    region:  REGION,
    service: 'appsync',
    sha256:  Sha256,
  });

  const request = {
    method:   'POST',
    protocol: url.protocol,
    hostname: url.hostname,
    path:     url.pathname,
    headers:  {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body).toString(),
      host: url.hostname,
    },
    body,
  };

  const signed = await signer.sign(request);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname,
        method:   'POST',
        headers:  signed.headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`AppSync responded ${res.statusCode}: ${data}`));
          } else {
            resolve();
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export const handler: DynamoDBStreamHandler = async (event) => {
  const endpoint = await appsyncUrl();

  for (const record of event.Records) {
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') continue;

    const image = record.dynamodb?.NewImage as Record<string, { S?: string; M?: Record<string, { S?: string }> }> | undefined;
    if (!image) continue;

    const entityType = attrS(image, 'entityType');
    const eventType  = attrS(image, 'eventType');
    const tenantId   = attrS(image, 'tenantId');

    if (entityType !== 'agent_run' && !eventType.startsWith('agent_')) continue;

    const agentAction = {
      id:          attrS(image, 'entityId') || attrS(image, 'pk'),
      tenantId,
      agentRunId:  attrS(image, 'entityId'),
      agentType:   attrS(image, 'agentType') || nestedS(image, 'agentType') || 'coordinator',
      action:      eventType || nestedS(image, 'operation') || 'updated',
      status:      attrS(image, 'status') || nestedS(image, 'status') || 'running',
      input:       null,
      output:      null,
      occurredAt:  attrS(image, 'occurredAt') || new Date().toISOString(),
    };

    const body = JSON.stringify({
      query:     PUBLISH_MUTATION,
      variables: { input: agentAction },
    });

    try {
      await signedPost(endpoint, body);
    } catch (err) {
      console.error('AppSync publish failed', { tenantId, eventType, error: (err as Error).message });
    }
  }
};

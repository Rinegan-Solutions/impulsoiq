/**
 * AppSync Publisher — DynamoDB Streams → AppSync real-time push.
 *
 * Triggered by DynamoDB Streams from the events table.
 * For each NEW_IMAGE record relating to agent actions, publishes
 * a publishAgentAction mutation to AppSync so the Agent Control Panel
 * receives real-time updates.
 *
 * Auth: AWS IAM signing (not API key) — the Lambda's execution role
 *       must have appsync:GraphQL on the AppSync API ARN.
 */
import type { DynamoDBStreamHandler } from 'aws-lambda';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import https from 'https';
import { URL } from 'url';

const REGION       = process.env.AWS_REGION ?? 'eu-west-2';
const APPSYNC_URL  = process.env.APPSYNC_URL!;

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

// ── SigV4 signed GraphQL request ─────────────────────────────────────────────

async function signedPost(body: string): Promise<void> {
  const url    = new URL(APPSYNC_URL);
  const signer = new SignatureV4({
    credentials: {
      // Lambda execution role credentials from environment
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

// ── Stream handler ────────────────────────────────────────────────────────────

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') continue;

    const image = record.dynamodb?.NewImage;
    if (!image) continue;

    // Parse DynamoDB image — attributes are DynamoDB typed maps
    const pk         = image.pk?.S ?? '';
    const eventType  = image.eventType?.S ?? '';
    const entityType = image.entityType?.S ?? '';
    const tenantId   = image.tenantId?.S ?? '';

    // Only forward agent-run and action events to AppSync
    if (entityType !== 'agent_run' && !eventType.startsWith('agent_')) continue;

    const agentAction = {
      id:          image.id?.S ?? pk,
      tenantId,
      agentRunId:  image.entityId?.S ?? '',
      agentType:   image.agentType?.S ?? 'coordinator',
      action:      eventType,
      status:      image.status?.S ?? 'running',
      input:       image.inputJson?.S  ? JSON.parse(image.inputJson.S)  : null,
      output:      image.outputJson?.S ? JSON.parse(image.outputJson.S) : null,
      occurredAt:  image.timestamp?.S ?? new Date().toISOString(),
    };

    const body = JSON.stringify({
      query:     PUBLISH_MUTATION,
      variables: { input: agentAction },
    });

    try {
      await signedPost(body);
    } catch (err) {
      console.error('AppSync publish failed', { pk, eventType, error: (err as Error).message });
      // Non-fatal — best-effort real-time push; audit log is source of truth
    }
  }
};

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

export const handler: APIGatewayProxyHandler = async (event) => {
  // COGNITO_USER_POOLS authorizer: verified ID-token claims live at
  // requestContext.authorizer.claims as a flat string map. Not .tenantId
  // (custom authorizer) and not .jwt.claims (HTTP API v2).
  const claims = event.requestContext.authorizer?.claims as Record<string, string> | undefined;
  const tenantId = claims?.['custom:tenant_id'];
  const body = JSON.parse(event.body ?? '{}') as { campaignId: string; contactIds: string[] };

  const executions = await Promise.all(
    body.contactIds.map((contactId) =>
      sfn.send(new StartExecutionCommand({
        stateMachineArn: STATE_MACHINE_ARN,
        name: `${body.campaignId}-${contactId}-${Date.now()}`,
        input: JSON.stringify({ tenantId, campaignId: body.campaignId, contactId }),
      })),
    ),
  );

  return {
    statusCode: 202,
    body: JSON.stringify({ started: executions.length }),
  };
};

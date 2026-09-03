import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const sfn = new SFNClient({});
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const tenantId = event.requestContext.authorizer?.jwt?.claims?.['custom:tenant_id'];
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

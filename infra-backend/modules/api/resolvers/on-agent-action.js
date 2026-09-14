/**
 * AppSync JS resolver — onAgentAction subscription.
 *
 * Subscribers may only listen to their own JWT custom:tenant_id.
 * Runtime: APPSYNC_JS (not VTL).
 */

export function request(ctx) {
  const identity = ctx.identity || {};
  const claims = identity.claims || {};
  const jwtTenant = claims['custom:tenant_id'];
  if (!jwtTenant || jwtTenant !== ctx.args.tenantId) {
    util.error('tenant mismatch', 'Unauthorized');
  }
  return { payload: { tenantId: ctx.args.tenantId } };
}

export function response(ctx) {
  return ctx.result;
}

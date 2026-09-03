/**
 * AppSync JS resolver — publishAgentAction mutation.
 *
 * Uses a NONE data source (local resolver pattern) for subscription fanout.
 * The mutation payload is forwarded directly to subscribers — no external
 * data source lookup required.
 *
 * Runtime: APPSYNC_JS (not VTL).
 */

export function request(ctx) {
  return { payload: ctx.args.input };
}

export function response(ctx) {
  return ctx.result;
}

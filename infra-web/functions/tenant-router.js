// CloudFront Function — tenant subdomain resolution (viewer-request).
//
// LAYER 1 of the three-layer tenant isolation described in CLAUDE.md:
//   1. this function: host label -> tenant slug          <-- here
//   2. Lambda/API: custom:tenant_id claim must match the slug
//   3. DSQL: every query is parameterised on tenant_id
//
// WHAT THIS DOES AND DOES NOT PROVE
// A viewer-request function sees an UNAUTHENTICATED request. It cannot know
// who the caller is, so it can only decide whether a host is a well-formed
// tenant address. It is not the security boundary — a caller can send any Host
// header they like, and the origin here is a public SPA bundle with no tenant
// data in it. The boundary is layer 2, where the slug is compared against a
// signed Cognito claim.
//
// What it is genuinely worth:
//   * rejects malformed and reserved hosts at the edge, before S3
//   * normalises the slug into x-impulsoiq-tenant so every origin behind this
//     distribution reads the tenant the same way, rather than each re-parsing
//     Host
//   * keeps the reserved-label list in ONE place shared with sign-up
//
// CloudFront Functions are JavaScript runtime 2.0: ES5-era syntax only, no
// async, no network calls, 1 ms budget. Everything below is deliberately
// allocation-light and loop-free on the hot path.

// Labels that can never be a tenant. `www` and the environment hosts would
// otherwise resolve to a "tenant" of that name and shadow the real site;
// the rest are reserved so a workspace cannot impersonate infrastructure.
var RESERVED = {
  www: 1, app: 1, api: 1, admin: 1, mail: 1, smtp: 1, imap: 1,
  ftp: 1, cdn: 1, static: 1, assets: 1, status: 1, docs: 1,
  support: 1, help: 1, blog: 1, dev: 1, test: 1, stage: 1,
  staging: 1, prod: 1, internal: 1, root: 1, security: 1,
  autodiscover: 1, autoconfig: 1, _domainkey: 1,
};

// Same grammar as the tenant.id CHECK constraint in schema.sql, and the same
// as toSlug() in the sign-up form. All three must agree or a workspace can be
// created that is unreachable at its own address.
var SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

function handler(event) {
  var request = event.request;
  var headers = request.headers;

  var hostHeader = headers.host && headers.host.value ? headers.host.value : '';
  // Strip any port and lowercase — Host is case-insensitive, slugs are not.
  var host = hostHeader.split(':')[0].toLowerCase();

  // ZONE is substituted by Terraform (templatefile) so this function never
  // has to guess which environment it is deployed into.
  var zone = '${zone}';

  var tenant = '';

  if (host !== zone && host.length > zone.length + 1) {
    var suffix = host.substring(host.length - zone.length - 1);
    if (suffix === '.' + zone) {
      var label = host.substring(0, host.length - zone.length - 1);
      // Only a SINGLE label is a tenant. a.b.zone is not a nested tenant, it
      // is a malformed address, and treating it as tenant "a.b" would let one
      // host masquerade as another.
      if (label.indexOf('.') === -1) {
        if (SLUG.test(label) && !RESERVED[label]) {
          tenant = label;
        } else {
          // A syntactically impossible or reserved tenant address. Answer at
          // the edge rather than serving the app shell, which would otherwise
          // load, call the API and fail confusingly on the tenant check.
          return {
            statusCode: 404,
            statusDescription: 'Not Found',
            headers: {
              'content-type': { value: 'text/plain' },
              'cache-control': { value: 'max-age=60' },
            },
            body: 'Unknown workspace.',
          };
        }
      }
    }
  }

  // Always set the header, empty for the apex/www. An origin can then rely on
  // it existing rather than distinguishing "absent" from "no tenant".
  //
  // Overwriting is deliberate: a client-supplied x-impulsoiq-tenant must never
  // survive to the origin, or the header would be attacker-controlled.
  request.headers['x-impulsoiq-tenant'] = { value: tenant };

  return request;
}

Shared typing helpers for the REST-facing Lambdas.

The REST API (`aws_api_gateway_rest_api`) uses a custom Lambda authorizer
(`auth-authorizer`), which returns a FLAT `context` map:

    { tenantId, userId, groups, isAdmin }

API Gateway surfaces that at `event.requestContext.authorizer`. It is NOT the
HTTP-API (v2) JWT shape — there is no `.jwt.claims` here.

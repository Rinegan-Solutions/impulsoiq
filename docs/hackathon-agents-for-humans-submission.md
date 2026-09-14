# ImpulsoIQ, Agents for Humans submission

Paste into the AWS Agents for Humans Devpost form (Professional Agents track).

Fill the TODO rows (demo video, Builder.AWS post, CALL-E PR) before you submit.

| Field | Value |
|---|---|
| Project name | ImpulsoIQ |
| Tagline | Sales outreach run by agents you can watch, approve, and stop |
| Elevator pitch | ImpulsoIQ is a CRM where a sales team can type a goal and let agents research contacts and draft email. The first sends wait for a person. On a paid plan the same run can place a live qualification call with CALL-E. You follow the work on an Agent Control Panel and you can stop it. Inbound support on Amazon Connect is designed. It is not this demo. |

Glossary we stick to below: workspace (one customer account), Home (goal screen), campaign (the run you confirmed), Agent Control Panel (Control, then Runs), Approvals (drafts waiting on a person).

---

# Project Details

## Inspiration

Sales teams already buy "AI SDRs." A lot of those tools dump email into the world, hide what the model did, and still cannot make a phone call that does not sound like a robocall. We wanted something we would actually point at our own contacts.

Agents for Humans asks for a professional agent on Strands and Bedrock AgentCore, not a chat box with a Bedrock sticker. CALL-E asks for a real business use of live calling. That matches how outbound work actually goes: research, a draft, a person on the first send you cannot undo, then a call only if the person consented and you still have quota.

Law made the rest non-optional. EU AI Act Article 50 started applying in August 2026: if a system talks to someone, you tell them they are talking to AI, in the first moment, out loud on a call. US TCPA and FCC rules treat AI voices like prerecorded calls. Consent, calling hours, do-not-call lists, and that first sentence are product work. If we could not stop a campaign, or prove a call was gated, we would not show this to a customer.

Sales is first because the payoff is easy to explain. The same agents should later help recruiting, renewals, collections, and support, still on the same customer record. That inbound support desk is the next product. It is not what we are asking you to click through today.

## What it does

You sign up at the landing page and get a workspace on `{subdomain}.impulsoiq.rinegansolutions.com`. After login you land on Home, not a wall of invented KPIs.

You pick "Qualify inbound leads" or type a goal. The app asks a few concrete questions: email only, or email then a call; approve every send, or approve the first few. It shows a plan and a cost estimate. Confirm starts a real campaign. If there are no people in the segment, you add a contact (use an email you own if you will send). The product will not invent rows.

First drafts sit in Control, Approvals. Approve continues the campaign. Reject does not send. Control, Runs is that campaign. Pause or kill stops the running campaign in Step Functions. Open the contact. Activity is one list: your notes and the agents' actions.

Free workspaces can research, draft, and send with approval. They cannot place calls. The upgrade copy is the product, not a disabled button.

Around that path you also get a CRM (contacts, companies, deals), enrichment attributed to a source (if no vendor key is configured, research reports a gap instead of "Technology, 50 employees"), editable sequences, brand-voice settings, usage caps that stop work when hit, Stripe billing (Free, Starter, Growth, Enterprise), export and erase of a person plus agent history (GDPR/CCPA style), and an audit export. SSO is "paste your metadata; an operator still attaches the IdP." We do not call that live SSO. Workspace templates for recruiting, collections, vendors, appointments, and customer success reuse the same agents with different goals and rules. Collections still needs legal review in the database before launch. Home stays sales for this submission.

Support: we intend inbound email, chat, and phone on the same customer as outbound. That queue is not live. If the nav says Support is coming, believe it.

## How we built it

The path is one line. Browser to API Gateway (Cognito ID token, header `x-impulsoiq-tenant`). Lambdas start work. Specialist agents run on AgentCore. Tools come back through the same Lambdas the UI uses. Durable steps live in Step Functions. Records land in Aurora DSQL through one writer. The event log, metering, and forecast snapshots live in DynamoDB. The Agent Control Panel reads that trail.

Each specialist is Python Strands in its own ARM64 AgentCore Runtime. There are fourteen: coordinator, clarification, research/enrichment, outreach, voice, nurture, forecasting, data hygiene, a spoken UI (Nova Sonic), deep research, signal listening, plus triage, resolution, and support insight, which stay unused until there is a queue. Work is a graph you can replay. Deep research is the only swarm, and only after you approve the token cost. AgentCore Gateway exposes tools (MCP) onto those Lambdas. Clarification can store settled preferences in AgentCore Memory so a second session is not a blank slate.

Campaigns are Step Functions so a four-minute call is not a Lambda that sits there. Approvals are `waitForTaskToken`. Pause and kill call `StopExecution`. Voice is CALL-E behind a `VoiceProvider` (`plan`, `run`, `cancel`, result schema). `run_call` returns while the phone is still ringing. A webhook hits EventBridge. The graph resumes. Consent, do-not-call, calling window, and AI disclosure are checks on that path. Missing keys in Secrets Manager (`impulsoiq/<env>/app`, one JSON object per environment) stop the call. A stub provider cannot be on in production.

Aurora DSQL (Postgres flavored) holds tenant, contact, account, deal, activity, consent, call result, campaign, agent run, enrichment, sequence. It has no triggers and no extensions, and concurrent writers collide, so every CRM write goes through one CRM Write Lambda. Agents read through crm-read. DynamoDB is append-only events, idempotency, metering, and the nightly pipeline forecast (`pk={tenant}#report#pipeline_forecast`, `sk=latest`).

The UI is a React TypeScript app on S3 and CloudFront: Home, CRM, Campaigns, Control, More. Stripe Checkout and Customer Portal for paid plans. AppSync can push Control Panel events; if the UI is polling, it says so. Infra is Terraform (`hashicorp/aws` 6.x) and CodePipeline. Region is eu-west-2.

## Challenges we ran into

DSQL is not "Postgres with a new logo." Chunked writes, no triggers, optimistic concurrency when two writers hit the same row. Putting events in DynamoDB and forcing one writer slowed the screens. It also stopped specialist agents from retry-storming the database.

AgentCore runtime names, ECR repos, and a 48-character cap fought each other. Inference profiles that exist in us-east-1 were missing in eu-west-2. We set the model per agent in environment variables instead of assuming a default profile.

The Cognito authorizer on REST API Gateway wants the raw ID token. A normal `Bearer` header looks fine in DevTools and returns 401 from every Lambda. A tenant header that does not match the token claim is a quiet 403. We spent more time on that than we expected.

We could have faked a nicer video: placeholder enrichment, a pause control that only updated DSQL, reply-rate charts the schema cannot compute (`activity` has no open or reply event). We cut those. Missing keys stop the action.

CALL-E is the right outbound product. Amazon Connect is the right inbound queue. The trap is letting Connect's own AI become a second brain the Control Panel cannot see. We wrote the split down early: Connect would move the call; Strands would still decide.

Async voice is awkward. `run_call` returns before anyone hangs up. Step Functions waits on a webhook that might never arrive. Kill has to admit a call already ringing may finish.

## Accomplishments that we're proud of

The Home to Approvals to Agent Control Panel path starts real Step Functions executions. Chat UIs that narrate work that never hit the CRM are how we got picky about that.

Pause and kill reach `StopExecution`.

Call gates write timestamps onto the call record (`call_result`), including when AI disclosure was delivered.

Free workspaces hit a billing check for voice, not a CSS trick.

Fourteen AgentCore runtimes are in Terraform. The three support ones stay dark on purpose.

## What we learned

The model is the cheap part of a professional agent. Tenancy, consent, not sending twice, metering, and making Stop mean stop are the rest.

Sales buyers in 2026 have already seen unbounded auto-send. Default human approval on the first emails is what they will pay for. More autonomy is a setting you earn.

eu-west-2, ARM64 AgentCore, Bedrock profiles, and DSQL limits belong in the architecture notes before anyone designs Home. We learned that by hitting them.

If agent tools call the same Lambdas as the UI, the Agent Control Panel is not a second story. It is watching the same operations.

A support bot that cannot see CRM history will close a ticket for an account that is mid-renewal. That is why we would not glue on a separate helpdesk later. It is also why we are not showing a Support queue until tickets actually list.

## What's next for ImpulsoIQ

A paying design partner using a non-sales template, customer success first. Manager views that count real email, SMS, and call rows, plus the forecast the nightly agent already writes. We will not invent open or reply rates.

Then the contact center (our phases 7 to 9). Turn Support on when a workspace has a Connect number or inbound email. Ticket list, who is available, SLAs, a knowledge base you publish, auto-resolve that cannot refund money, a chat widget, CSAT, and feeding support pain into renewal risk. Connect still carries the inbound call. Our agents still decide. Cedar-style gates and the Agent Control Panel stay the same as outbound.

After that: a public API, customer MCP, a real vector index, tighter AgentCore Identity per tool, a second voice vendor, more languages.

---

## Try it out

| | |
|---|---|
| Live app (landing and sign-up) | [https://impulsoiq.rinegansolutions.com](https://impulsoiq.rinegansolutions.com) |
| Workspace URLs | `{subdomain}.impulsoiq.rinegansolutions.com` (created at sign-up) |
| Source | [https://github.com/Rinegan-Solutions/impulsoiq](https://github.com/Rinegan-Solutions/impulsoiq) |
| Architecture | [docs/impulsoiq-technical-architecture-v1.md](impulsoiq-technical-architecture-v1.md) |
| Product requirements | [docs/impulsoiq-prd-v4.md](impulsoiq-prd-v4.md) |
| Demo video | TODO: AWS (about 5 min) and CALL-E (about 3 min) links |
| CALL-E packaging | TODO: Agent Skill or Workflow Plugin PR (`awesome-phone-call-agents`) |

If GitHub is still private, attach the zip Devpost asks for.

---

## Built with

Up to 25 tags for Devpost:

1. Amazon Bedrock
2. Amazon Bedrock AgentCore
3. Strands Agents SDK
4. AWS Lambda
5. Amazon API Gateway
6. AWS Step Functions
7. Amazon EventBridge
8. Amazon Cognito
9. Amazon Aurora DSQL
10. Amazon DynamoDB
11. Amazon S3
12. Amazon CloudFront
13. AWS AppSync
14. AWS Secrets Manager
15. Amazon CloudWatch
16. Amazon ECR
17. Amazon Connect
18. Amazon SES
19. Terraform
20. React
21. TypeScript
22. Python
23. CALL-E
24. Stripe
25. PostgreSQL

---

## Testing instructions

You need a desktop browser and a work email you can verify. A paid workspace is only required if you want a live CALL-E call. Free workspaces cannot place voice.

Sales walkthrough (about 10 to 15 minutes):

1. Open [https://impulsoiq.rinegansolutions.com](https://impulsoiq.rinegansolutions.com). Create an account. You should land on `{your-subdomain}.impulsoiq.rinegansolutions.com`.
2. After sign-in you should see Home.
3. Pick "Qualify inbound leads" or type a goal. Answer the channel and approval questions. Confirm the plan.
4. If there are no contacts, create one (use an email you own if you will send). Run again from Home.
5. Open Control, then Approvals. Approve or reject a draft. Approve should continue the campaign. Reject should not send.
6. Open Control, then Runs. That should be the campaign you started. Pause or kill a running campaign. It should stop advancing. If you have AWS console access, check the Step Functions execution.
7. Open the contact's Activity. Human and agent rows should share one list.

Also check:

- On Free, include a call in the plan. You should see an upgrade explanation.
- Settings: export for a contact should include consent and call metadata when those rows exist. Erase is for admin and manager.
- Stripe checkout is for signed-in workspaces. Signed-out checkout should not work.
- With no enrichment keys, research should report a gap, not a fake industry.
- Workspace, Accounts receivable: launch without legal review in the database should be refused. Collections is not a Home starter.
- If you see Support (coming), that is correct.

Voice (Starter or above, CALL-E keys in Secrets Manager):

1. Contact has a phone number and call consent.
2. Plan includes a call, or the campaign allows voice.
3. Agent Control Panel should show waiting on the call. Take or decline the live call.
4. The contact should get a call result (outcome, disclosure time). The campaign should continue.

Local UI (optional):

```bash
npm install
# Point the app at a deployed API. There is no useful mock; users are scoped to a workspace.
export VITE_API_URL=https://<api-id>.execute-api.eu-west-2.amazonaws.com/<stage>
npm run dev:web   # http://localhost:5173
```

Backend apply and schema: README and CLAUDE.md (DSQL `schema.sql`, registry seeder, Secrets Manager JSON at `impulsoiq/<env>/app`).

If you have AWS access: region `eu-west-2`, AgentCore runtimes are ARM64, `Authorization` is the raw ID token (no `Bearer ` prefix), plus `x-impulsoiq-tenant`.

---

## Optional bonus blog post (Builder.AWS)

Publish on [Builder.AWS](https://builder.aws.com/). The title must include "Agents for Humans".

Suggested title:

Agents for Humans: ImpulsoIQ, Strands agents sales teams can watch and stop

Outline:

1. AI SDR tools that cannot be killed, consented, or called.
2. Why we used Strands plus AgentCore Runtime, Memory, and Gateway (MCP tools) instead of one Bedrock invoke.
3. A graph plus Step Functions so CALL-E can be async.
4. One CRM writer on Aurora DSQL, events in DynamoDB.
5. The Agent Control Panel as the place you trust the system.
6. What we left off: Amazon Connect as inbound plumbing, same agents later.

Published URL: TODO (paste the Builder.AWS permalink after it is live)

---

## Judge cheat sheet (not a Devpost field)

| Question | Answer |
|---|---|
| Who is it for? | SDR, AE, RevOps who will approve the first emails. Later, customer success and support. Cognito roles: admin, manager, member. |
| Why it matters | Unsupervised outbound AI is a legal and brand problem. Phone is still how many teams qualify. Article 50 disclosure and TCPA-shaped gates land on `call_result`. |
| AgentCore | One ARM64 runtime per job. Memory for clarification preferences. Gateway tools to the same Lambdas the UI calls. |
| CALL-E | Live outbound qualification and confirmation calls. `VoiceProvider`, webhook, EventBridge, graph resume. |
| Do not grade as shipped | Support queue, OpenSearch, vector memory pipeline, LinkedIn, email open or reply rates. Support agents exist in Terraform and stay unused. |

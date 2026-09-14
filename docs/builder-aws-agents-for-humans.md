# Agents for Humans: ImpulsoIQ, Strands agents sales teams can watch and stop

Paste this into [Builder.AWS](https://builder.aws.com/). The contest wants "Agents for Humans" in the title. Live app: [https://impulsoiq.rinegansolutions.com](https://impulsoiq.rinegansolutions.com). Source: [https://github.com/Rinegan-Solutions/impulsoiq](https://github.com/Rinegan-Solutions/impulsoiq). Region we actually run in: `eu-west-2`.

---

Most "AI SDR" demos we sat through did the same trick. You type a goal. The model dumps email. If you want it to stop, you close the tab and hope. Phone is missing, or it is a robocall with a nicer script. The Control Panel, if there is one, narrates work that never hit the CRM.

We built ImpulsoIQ because we would not point that at our own contacts. Agents for Humans asked for a professional agent on the [Strands Agents SDK](https://strandsagents.com/) and [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/), not a chat box with a Bedrock sticker. CALL-E asked for a real business use of live calling. That is how outbound work actually goes: research, a draft, a person on the first send you cannot undo, then a call only if they consented and you still have quota.

Law made the rest non-optional. EU AI Act Article 50 started applying in August 2026: if a system talks to someone, you tell them they are talking to AI, in the first moment, out loud on a call. US TCPA and FCC rules treat AI voices like prerecorded calls. Consent, calling hours, do-not-call lists, and that first sentence are product work. If we could not stop a campaign, or prove a call was gated, we would not show this to a customer.

## Why not one Bedrock invoke

`InvokeModel` gives you a completion. A sales run needs a loop that can call tools, wait on a human, survive a four-minute phone call, and still be the same tenant when it comes back.

Each specialist is Python Strands in its own ARM64 AgentCore Runtime. The ones this demo actually uses are coordinator, clarification, research, outreach, and voice. The rest of the roster is in Terraform too (nurture, forecasting, hygiene, Nova Sonic, deep research, signal listening, plus three support agents). The support ones stay unused until there is a ticket queue. We set the model per agent in environment variables. Inference profiles that exist in `us-east-1` were missing in `eu-west-2`. Runtime names, ECR repos, and a 48-character cap fought each other. That is boring until the create fails.

Tools go through AgentCore Gateway (MCP) onto the same Lambdas the React app uses. If the agent upserts a contact, the UI reads that contact. Clarification can store settled preferences in AgentCore Memory so a second session is not a blank quiz.

Work is a graph you can replay. Deep research is the only swarm, and only after you approve the token cost. Swarm is expensive and easy to lose. We treat it like that.

## A graph plus Step Functions so CALL-E can be async

Campaigns are AWS Step Functions because a live call is not a Lambda that sits there. Approvals are `waitForTaskToken`. Pause and kill call `StopExecution`.

Voice is CALL-E behind a `VoiceProvider` (`plan`, `run`, `cancel`, a result schema). `run_call` returns while the phone is still ringing. A webhook hits Amazon EventBridge. The graph resumes. Consent, do-not-call, calling window, and AI disclosure are checks on that path. The timestamps land on `call_result`, including when the disclosure was delivered. Missing keys in Secrets Manager (`impulsoiq/<env>/app`, one JSON object per environment) stop the call. A stub provider cannot be on in production.

Kill has to admit a call already ringing may finish. Async voice is awkward. We would rather say that than pretend `StopExecution` un-rings a handset.

Amazon Connect is the right inbound queue later. CALL-E is the right outbound product now. The trap is letting Connect's own AI become a second brain the Control Panel cannot see. Connect would move the call. Strands would still decide.

## One CRM writer, events somewhere else

Amazon Aurora DSQL is Postgres flavored. It is not "Postgres with a new logo." No triggers, no extensions, no `SERIALIZABLE`. Concurrent writers collide. Bulk writes have to be chunked.

Every CRM write goes through one CRM Write Lambda. Specialist agents never talk to DSQL themselves. Agents read through `crm-read`. That slowed the screens. It also stopped OCC retry storms when four specialists decided to "just update the contact."

The relational record is in DSQL: tenant, contact, account, deal, activity, consent, call result, campaign, agent run, enrichment, sequence. Amazon DynamoDB holds the append-only event log, idempotency, metering, and the nightly pipeline forecast (`pk={tenant}#report#pipeline_forecast`, `sk=latest`). Metering is checked before a billable action, not only reported after.

The browser talks to Amazon API Gateway with a Cognito ID token and header `x-impulsoiq-tenant`. The REST Cognito authorizer wants the raw ID token. A normal `Bearer` header looks fine in DevTools and returns 401 from every Lambda. A tenant header that does not match the token claim is a quiet 403. We spent more time on that than we expected.

Infra is Terraform (`hashicorp/aws` 6.x) and CodePipeline. The UI is React TypeScript on S3 and CloudFront.

## Home, Approvals, Runs

After login you land on Home, not a wall of invented KPIs. You pick "Qualify inbound leads" or type a goal. The app asks a few concrete questions: email only, or email then a call; approve every send, or approve the first few. It shows a plan and a cost estimate. Confirm starts a real campaign, which means a real Step Functions execution.

If there are no people in the segment, you add a contact. Use an email you own if you will send. The product will not invent rows. Missing enrichment keys report a gap. They do not invent "Technology, 50 employees."

First drafts sit in Control, Approvals. Approve continues the campaign. Reject does not send. Control, Runs is that campaign. Pause or kill stops it advancing. Open the contact. Activity is one list: your notes and the agents' actions.

Free workspaces can research, draft, and send with approval. They cannot place calls. The upgrade copy is the product, not a disabled button. We could have faked a nicer video: placeholder enrichment, a pause control that only updated DSQL, reply-rate charts the schema cannot compute (`activity` has no open or reply event). We cut those.

If agent tools call the same Lambdas as the UI, the Control Panel is not a second story. It is watching the same operations.

## What we left off

Support on Amazon Connect (inbound email, chat, phone on the same customer record) is designed. The queue is not live. If the nav says Support is coming, believe it. A support bot that cannot see CRM history will close a ticket for an account that is mid-renewal. That is why we would not glue on a separate helpdesk, and why we are not showing a queue until tickets actually list.

We also did not ship OpenSearch, a vector memory pipeline, LinkedIn scraping, or email open rates. Sales is first because the payoff is easy to explain. The same agents should later help recruiting, renewals, collections, and support, still on the same customer record. Collections still needs legal review in the database before anyone launches that template.

The model is the cheap part of a professional agent. Tenancy, consent, not sending twice, metering, and making Stop mean stop are the rest. Sales buyers in 2026 have already seen unbounded auto-send. Default human approval on the first emails is what they will pay for. More autonomy is a setting you earn.

Try it: [https://impulsoiq.rinegansolutions.com](https://impulsoiq.rinegansolutions.com). After sign-up the workspace is `{subdomain}.impulsoiq.rinegansolutions.com`.

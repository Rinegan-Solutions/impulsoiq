import { http, HttpResponse } from 'msw';
import { MOCK_CONTACTS, MOCK_CAMPAIGNS, MOCK_AGENT_RUNS, MOCK_DEALS } from './db';
import type { Contact, Deal } from '@/api/schemas';

// In-memory mutable copies so mutations (pause/kill) persist in the session
let contacts   = [...MOCK_CONTACTS];
let campaigns  = [...MOCK_CAMPAIGNS];
let agentRuns  = [...MOCK_AGENT_RUNS];
let deals      = [...MOCK_DEALS];

const BASE = '/api';

function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

export const handlers = [

  // ── Contacts ──────────────────────────────────────────────────────────────

  http.get(`${BASE}/contacts`, ({ request }) => {
    const url    = new URL(request.url);
    const page   = parseInt(url.searchParams.get('page')    ?? '1');
    const size   = parseInt(url.searchParams.get('pageSize')?? '20');
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';

    const filtered = search
      ? contacts.filter(c =>
          `${c.firstName} ${c.lastName} ${c.email ?? ''} ${c.company ?? ''}`.toLowerCase().includes(search))
      : contacts;

    return HttpResponse.json(paginate(filtered, page, size));
  }),

  http.get(`${BASE}/contacts/:id`, ({ params }) => {
    const c = contacts.find(c => c.id === params.id);
    return c ? HttpResponse.json(c) : new HttpResponse(null, { status: 404 });
  }),

  http.post(`${BASE}/contacts`, async ({ request }) => {
    const body = await request.json() as Partial<Contact>;
    const c: Contact = {
      id: crypto.randomUUID(), tenantId: 'demo',
      firstName: body.firstName ?? '', lastName: body.lastName ?? '',
      ...body, createdAt: new Date().toISOString(),
    };
    contacts = [c, ...contacts];
    return HttpResponse.json(c, { status: 201 });
  }),

  http.patch(`${BASE}/contacts/:id`, async ({ params, request }) => {
    const body = await request.json() as Partial<Contact>;
    contacts = contacts.map(c => c.id === params.id ? { ...c, ...body } : c);
    const updated = contacts.find(c => c.id === params.id);
    return updated ? HttpResponse.json(updated) : new HttpResponse(null, { status: 404 });
  }),

  http.delete(`${BASE}/contacts/:id`, ({ params }) => {
    contacts = contacts.filter(c => c.id !== params.id);
    return HttpResponse.json({ ok: true });
  }),

  // ── Campaigns ─────────────────────────────────────────────────────────────

  http.get(`${BASE}/campaigns`, () =>
    HttpResponse.json(paginate(campaigns, 1, 50)),
  ),

  http.get(`${BASE}/campaigns/:id`, ({ params }) => {
    const c = campaigns.find(c => c.id === params.id);
    return c ? HttpResponse.json(c) : new HttpResponse(null, { status: 404 });
  }),

  http.post(`${BASE}/campaigns/:id/pause`, ({ params }) => {
    campaigns = campaigns.map(c => c.id === params.id ? { ...c, status: 'paused' as const } : c);
    return HttpResponse.json(campaigns.find(c => c.id === params.id));
  }),

  http.post(`${BASE}/campaigns/:id/resume`, ({ params }) => {
    campaigns = campaigns.map(c => c.id === params.id ? { ...c, status: 'active' as const } : c);
    return HttpResponse.json(campaigns.find(c => c.id === params.id));
  }),

  // ── Agent Runs ────────────────────────────────────────────────────────────

  http.get(`${BASE}/agent-runs`, ({ request }) => {
    const url  = new URL(request.url);
    const page = parseInt(url.searchParams.get('page')    ?? '1');
    const size = parseInt(url.searchParams.get('pageSize')?? '20');
    return HttpResponse.json(paginate(agentRuns, page, size));
  }),

  http.post(`${BASE}/agent-runs/:id/pause`, ({ params }) => {
    agentRuns = agentRuns.map(r => r.id === params.id ? { ...r, status: 'paused' as const } : r);
    return HttpResponse.json(agentRuns.find(r => r.id === params.id));
  }),

  http.post(`${BASE}/agent-runs/:id/resume`, ({ params }) => {
    agentRuns = agentRuns.map(r => r.id === params.id ? { ...r, status: 'running' as const } : r);
    return HttpResponse.json(agentRuns.find(r => r.id === params.id));
  }),

  http.post(`${BASE}/agent-runs/:id/kill`, ({ params }) => {
    agentRuns = agentRuns.map(r => r.id === params.id ? { ...r, status: 'failed' as const, endedAt: new Date().toISOString() } : r);
    return HttpResponse.json(agentRuns.find(r => r.id === params.id));
  }),

  // ── Deals ─────────────────────────────────────────────────────────────────

  http.get(`${BASE}/deals`, () => HttpResponse.json(paginate(deals, 1, 50))),

  http.patch(`${BASE}/deals/:id`, async ({ params, request }) => {
    const body = await request.json() as Partial<Deal>;
    deals = deals.map(d => d.id === params.id ? { ...d, ...body } : d);
    return HttpResponse.json(deals.find(d => d.id === params.id));
  }),

  // ── Support (Phase 7 + 8) ────────────────────────────────────────────────

  http.get(`${BASE}/support/tickets`, () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 })),
  http.get(`${BASE}/support/conversations/:id`, ({ params }) =>
    HttpResponse.json({ result: { id: params.id, status: 'open', channelHistory: [] } }),
  ),
  http.get(`${BASE}/support/knowledge-articles`, () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 })),
  http.post(`${BASE}/support/intake`, async ({ request }) => {
    await request.json();
    return HttpResponse.json({ conversationId: crypto.randomUUID(), status: 'triaged' });
  }),

  // Phase 9
  http.get(`${BASE}/support/insight`, () => HttpResponse.json({ result: null })),
  http.get(`${BASE}/support/kb-gaps`, () => HttpResponse.json({ gaps: [], gapCount: 0 })),

  // Phase 8
  http.post(`${BASE}/support/csat`, async ({ request }) => {
    const body = await request.json() as { conversationId?: string; score?: number };
    return HttpResponse.json({ received: true, conversationId: body.conversationId, score: body.score });
  }),
  // Search returns empty until the KB embedding pipeline is wired (Phase 8).
  http.get(`${BASE}/support/knowledge-articles/search`, () =>
    HttpResponse.json({ result: [] })
  ),

  // ── Registry (Phase 6B) ──────────────────────────────────────────────────

  http.get(`${BASE}/registry`, ({ request }) => {
    const url  = new URL(request.url);
    const type = url.searchParams.get('type') ?? null;
    // Return empty array — RegistryPage uses its static STATIC_REGISTRY directly
    // Real implementation reads from DSQL agent_registry table via crm-read
    return HttpResponse.json(type ? [] : []);
  }),

  // ── Workspace Templates (Phase 5) ────────────────────────────────────────

  http.get(`${BASE}/workspace-templates`, () => HttpResponse.json([])),

  http.post(`${BASE}/workspace-templates/:key/activate`, ({ params }) =>
    HttpResponse.json({ id: crypto.randomUUID(), templateKey: params.key, name: String(params.key), status: 'active', config: {}, createdAt: new Date().toISOString() })
  ),

  http.post(`${BASE}/workspace-templates/:key/deactivate`, ({ params }) =>
    HttpResponse.json({ id: crypto.randomUUID(), templateKey: params.key, name: String(params.key), status: 'inactive', config: {}, createdAt: new Date().toISOString() })
  ),

  http.post(`${BASE}/workspace-templates/:key/launch`, async ({ request }) => {
    const body = await request.json() as { targetIds?: string[] };
    return HttpResponse.json({ started: (body.targetIds ?? []).length, skipped: 0, template: 'launched' });
  }),

  // ── Voice Interface (Phase 4A) ────────────────────────────────────────────

  http.post(`${BASE}/voice/message`, async ({ request }) => {
    const body = await request.json() as { message?: string; tenantId?: string };
    const msg  = (body.message ?? '').toLowerCase();

    let response = 'I heard you. Let me check on that.';
    if (msg.includes('briefing') || msg.includes('morning') || msg.includes('brief')) {
      response = 'Good morning! Your agents completed 24 runs overnight and booked 3 meetings. You have 2 items awaiting approval. Your weighted September forecast is $847K against $2.8M in pipeline.';
    } else if (msg.includes('pipeline') || msg.includes('deal')) {
      response = 'You have 16 open deals worth $2.8M. Weighted forecast for September: $847K. Three deals are flagged as stalled — Meridian Health is the top risk.';
    } else if (msg.includes('approval') || msg.includes('queue')) {
      response = 'You have 2 items in your approval queue: an outreach email for Sarah Chen at Acme, and a hygiene proposal to merge 3 duplicate contacts.';
    } else if (msg.includes('call')) {
      response = 'Last call was with Jennifer Park at NexaCo — answered, interest level high, meeting booked for September 5th.';
    }

    return HttpResponse.json({ ok: true, response, sessionId: 'demo-session', inputModality: 'voice' });
  }),

  // ── Reporting (Phase 3) ──────────────────────────────────────────────────

  http.get(`${BASE}/reporting/forecast`, () => HttpResponse.json({
    forecast: {
      totalPipeline:    2_847_500,
      weightedForecast:   847_300,
      dealCount:             16,
      period:            '2026-09',
      byStage: {
        'Prospecting': { count: 3, totalAmount: 71_000, weightedAmount: 3_550 },
        'Qualified':   { count: 4, totalAmount: 182_000, weightedAmount: 36_400 },
        'Demo Booked': { count: 4, totalAmount: 258_000, weightedAmount: 103_200 },
        'Proposal':    { count: 2, totalAmount: 150_000, weightedAmount: 90_000 },
        'Negotiating': { count: 1, totalAmount: 128_000, weightedAmount: 102_400 },
        'Closed Won':  { count: 2, totalAmount: 130_000, weightedAmount: 130_000 },
      },
    },
    riskFlags: [
      { dealId: 'deal-1', dealName: 'Meridian Health — AI Suite', stage: 'Negotiating', amount: 128000, daysQuiet: 14.2, teamMedian: 5.1, xAboveMedian: 2.8 },
      { dealId: 'deal-2', dealName: 'Acme Corp — Enterprise',     stage: 'Demo Booked', amount: 84000,  daysQuiet: 11.7, teamMedian: 5.1, xAboveMedian: 2.3 },
      { dealId: 'deal-3', dealName: 'Strata Labs — Enterprise',   stage: 'Proposal',    amount: 54000,  daysQuiet: 9.3,  teamMedian: 5.1, xAboveMedian: 1.8 },
    ],
    narratives: [
      'Weighted September forecast: $847K against $2.8M unweighted pipeline (30% conversion rate).',
      'Negotiating stage has the highest risk: 1 deal worth $128K has been quiet for 14 days (team median: 5 days).',
      'Demo Booked stage looks healthy: 4 deals totalling $258K with recent activity.',
      '3 deals flagged as stalled — review and re-engage to protect the quarter.',
    ],
    generatedAt: new Date().toISOString(),
    period: '2026-09',
  })),

  http.get(`${BASE}/reporting/metering`, () => HttpResponse.json({
    period: '2026-09',
    usage: [
      { resource: 'agent_runs',          used: 1247,     quota: 1000,    costUsd: 1.25  },
      { resource: 'llm_tokens',          used: 2_847_000, quota: 1_000_000, costUsd: 8.54 },
      { resource: 'call_minutes',        used: 89,        quota: 100,     costUsd: 4.45  },
      { resource: 'enrichment_lookups',  used: 412,       quota: 1000,    costUsd: 4.12  },
      { resource: 'email_sends',         used: 2847,      quota: 10_000,  costUsd: 0.28  },
      { resource: 'sms_sends',           used: 156,       quota: 1000,    costUsd: 0.78  },
    ],
  })),

  // ── Analytics ─────────────────────────────────────────────────────────────

  http.get(`${BASE}/analytics`, () => HttpResponse.json({
    replyRateTrend: [4.2, 5.1, 4.8, 6.3, 7.1, 6.9, 8.3, 9.7, 8.9, 10.2, 11.1, 12.1],
    meetingsTrend:  [8, 11, 9, 14, 13, 16, 18, 22, 21, 26, 29, 31],
    callOutcomes:   { answered: 189, voicemail: 143, noAnswer: 67, busy: 28 },
    topSequences: [
      { name: 'CEO Cold Outreach v3',    replies: 47, meetings: 18, rate: 38.3 },
      { name: 'VP Sales Re-engagement',  replies: 38, meetings: 14, rate: 36.8 },
      { name: 'FinTech Decision Makers', replies: 29, meetings: 11, rate: 37.9 },
      { name: 'SaaS Growth Play',        replies: 24, meetings: 9,  rate: 37.5 },
    ],
    contactsAdded:  [34, 41, 38, 52, 47, 61, 58, 73, 69, 84, 91, 105],
    months: ['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'],
  })),

  // ── Org check (unauthenticated) ───────────────────────────────────────────

  http.get(`${BASE}/org-check`, ({ request }) => {
    const url    = new URL(request.url);
    const domain = url.searchParams.get('domain') ?? '';
    // In dev, simulate a match for 'acmecorp.com' so the join flow can be tested
    if (domain === 'acmecorp.com') {
      return HttpResponse.json({
        tenants: [{ id: 'demo', name: 'Acme Corp', subdomain: 'acme' }],
      });
    }
    return HttpResponse.json({ tenants: [] });
  }),

  // ── Dashboard stats ───────────────────────────────────────────────────────

  http.get(`${BASE}/dashboard/stats`, () => {
    const pipelineStages = [
      { stage: 'Prospecting' as const,  count: 234, value: 0       },
      { stage: 'Qualified' as const,    count:  89, value: 890000  },
      { stage: 'Demo Booked' as const,  count:  34, value: 680000  },
      { stage: 'Proposal' as const,     count:  18, value: 540000  },
      { stage: 'Negotiating' as const,  count:   8, value: 320000  },
      { stage: 'Closed Won' as const,   count:  31, value: 417500  },
    ];
    return HttpResponse.json({
      pipelineValue:  2847500,
      dealsWonMonth:  31,
      agentRunsToday: 1247,
      meetingsBooked: 54,
      pipelineByStage: pipelineStages,
      campaignSummary: campaigns.map(c => ({
        id: c.id, name: c.name, status: c.status,
        contactsTotal: c.contactsTotal, contactsTouched: c.contactsTouched,
        openRate: c.openRate, replyRate: c.replyRate,
        callsMade: c.callsMade, meetingsBooked: c.meetingsBooked,
      })),
    });
  }),
];

import type { Contact, Campaign, AgentRun, Deal } from '@/api/schemas';

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function iso(offsetMs = 0) {
  return new Date(Date.now() - offsetMs).toISOString();
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export const MOCK_CONTACTS: Contact[] = [
  { id: uuid(), tenantId: 'demo', firstName: 'Sarah',    lastName: 'Chen',    email: 'sarah.chen@acmecorp.com',       title: 'CTO',             company: 'Acme Corp',          industry: 'SaaS',       score: 94, stage: 'Demo Booked',  lastActivity: iso(120_000),   createdAt: iso(30 * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Marcus',   lastName: 'Webb',    email: 'm.webb@stratalabs.io',          title: 'VP Sales',        company: 'Strata Labs',        industry: 'FinTech',    score: 87, stage: 'Qualified',    lastActivity: iso(480_000),   createdAt: iso(28 * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Priya',    lastName: 'Nair',    email: 'priya@vantageai.com',           title: 'VP Engineering',  company: 'Vantage AI',         industry: 'AI/ML',      score: 82, stage: 'Qualified',    lastActivity: iso(900_000),   createdAt: iso(25 * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Jennifer', lastName: 'Park',    email: 'jpark@nexaco.com',              title: 'COO',             company: 'NexaCo',             industry: 'HealthTech', score: 79, stage: 'Demo Booked',  lastActivity: iso(1_860_000), createdAt: iso(22 * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Daniel',   lastName: 'Osei',    email: 'd.osei@circlepoint.co',         title: 'CRO',             company: 'Circlepoint',        industry: 'SaaS',       score: 76, stage: 'Prospecting',  lastActivity: iso(3_600_000), createdAt: iso(20 * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Aiko',     lastName: 'Tanaka',  email: 'aiko.t@northern.io',            title: 'Head of Growth',  company: 'Northern.io',        industry: 'SaaS',       score: 71, stage: 'Qualified',    lastActivity: iso(7_200_000), createdAt: iso(18 * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Carlos',   lastName: 'Rivera',  email: 'crivera@embercapital.com',      title: 'Partner',         company: 'Ember Capital',      industry: 'VC/PE',      score: 68, stage: 'Prospecting',  lastActivity: iso(14_400_000),createdAt: iso(15 * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Lisa',     lastName: 'Chen',    email: 'l.chen@meridianhealth.org',     title: 'VP Operations',   company: 'Meridian Health',    industry: 'HealthTech', score: 91, stage: 'Proposal',     lastActivity: iso(60_000),    createdAt: iso(12 * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Tom',      lastName: 'Walsh',   email: 'twalsh@embercapital.com',       title: 'MD Technology',   company: 'Ember Capital',      industry: 'VC/PE',      score: 65, stage: 'Prospecting',  lastActivity: iso(21_600_000),createdAt: iso(10 * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Jordan',   lastName: 'Lee',     email: 'j.lee@nexaco.com',              title: 'Director of IT',  company: 'NexaCo',             industry: 'HealthTech', score: 58, stage: 'Prospecting',  lastActivity: iso(86_400_000),createdAt: iso(9  * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Rania',    lastName: 'Khalid',  email: 'rk@meridianhealth.org',         title: 'VP Sales',        company: 'Meridian Health',    industry: 'HealthTech', score: 88, stage: 'Negotiating',  lastActivity: iso(300_000),   createdAt: iso(8  * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'James',    lastName: 'Park',    email: 'jpark@stratalabs.io',           title: 'RevOps Lead',     company: 'Strata Labs',        industry: 'FinTech',    score: 72, stage: 'Qualified',    lastActivity: iso(5_400_000), createdAt: iso(7  * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Amara',    lastName: 'Mensah',  email: 'a.mensah@northvault.co',        title: 'CEO',             company: 'Northvault',         industry: 'SaaS',       score: 95, stage: 'Closed Won',   lastActivity: iso(180_000),   createdAt: iso(6  * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Wei',      lastName: 'Zhang',   email: 'wei@acmecorp.com',              title: 'Head of Sales',   company: 'Acme Corp',          industry: 'SaaS',       score: 83, stage: 'Demo Booked',  lastActivity: iso(1_200_000), createdAt: iso(5  * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Sophie',   lastName: 'Müller',  email: 'sophie.m@vantageai.com',        title: 'CPO',             company: 'Vantage AI',         industry: 'AI/ML',      score: 77, stage: 'Qualified',    lastActivity: iso(3_000_000), createdAt: iso(4  * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Kwame',    lastName: 'Asante',  email: 'k.asante@circlepoint.co',       title: 'VP Product',      company: 'Circlepoint',        industry: 'SaaS',       score: 61, stage: 'Prospecting',  lastActivity: iso(43_200_000),createdAt: iso(3  * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Elena',    lastName: 'Popescu', email: 'elena@northern.io',             title: 'CMO',             company: 'Northern.io',        industry: 'SaaS',       score: 74, stage: 'Qualified',    lastActivity: iso(7_800_000), createdAt: iso(2  * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Hiroshi',  lastName: 'Tanaka',  email: 'h.tanaka@embercapital.com',     title: 'Managing Partner',company: 'Ember Capital',      industry: 'VC/PE',      score: 69, stage: 'Prospecting',  lastActivity: iso(18_000_000),createdAt: iso(1  * 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Nadia',    lastName: 'Al-Faris',email: 'nadia@meridianhealth.org',      title: 'CISO',            company: 'Meridian Health',    industry: 'HealthTech', score: 56, stage: 'Prospecting',  lastActivity: iso(64_800_000),createdAt: iso(0.5* 86400_000) },
  { id: uuid(), tenantId: 'demo', firstName: 'Blake',    lastName: 'Torres',  email: 'b.torres@northvault.co',        title: 'Head of RevOps',  company: 'Northvault',         industry: 'SaaS',       score: 85, stage: 'Demo Booked',  lastActivity: iso(600_000),   createdAt: iso(0.2* 86400_000) },
];

// ─── Campaigns ────────────────────────────────────────────────────────────────

export const MOCK_CAMPAIGNS: Campaign[] = [
  { id: uuid(), tenantId: 'demo', name: 'Q4 SaaS Outreach',        type: 'sdr_qualification', status: 'active',    contactsTotal: 2000, contactsTouched: 1247, openRate: 24.0, replyRate:  8.3, callsMade:  89, meetingsBooked: 17, createdAt: iso(30 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'FinTech Decision Makers', type: 'sdr_qualification', status: 'active',    contactsTotal:  800, contactsTouched:  380, openRate: 31.2, replyRate: 12.1, callsMade:  45, meetingsBooked: 11, createdAt: iso(25 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Enterprise Re-engagement',type: 'sdr_qualification', status: 'active',    contactsTotal: 1500, contactsTouched:  891, openRate: 27.4, replyRate:  9.7, callsMade: 112, meetingsBooked: 23, createdAt: iso(20 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Healthcare Champions',    type: 'sdr_qualification', status: 'paused',    contactsTotal:  500, contactsTouched:  215, openRate: 19.1, replyRate:  5.2, callsMade:  23, meetingsBooked:  4, createdAt: iso(15 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Startup Growth Series',   type: 'sdr_qualification', status: 'completed', contactsTotal:  600, contactsTouched:  600, openRate: 22.3, replyRate:  7.8, callsMade:  67, meetingsBooked: 14, createdAt: iso(10 * 86400_000) },
];

// ─── Agent Runs ───────────────────────────────────────────────────────────────

const AGENT_TYPES: AgentRun['agentType'][] = ['research', 'outreach', 'voice', 'crm', 'coord'];
const AGENT_STATUSES: AgentRun['status'][] = ['running', 'running', 'running', 'paused', 'completed'];

export const MOCK_AGENT_RUNS: AgentRun[] = MOCK_CONTACTS.slice(0, 12).map((c, i) => ({
  id:          uuid(),
  tenantId:    'demo',
  campaignId:  MOCK_CAMPAIGNS[i % MOCK_CAMPAIGNS.length].id,
  contactId:   c.id,
  contactName: `${c.firstName} ${c.lastName}`,
  company:     c.company,
  agentType:   AGENT_TYPES[i % AGENT_TYPES.length],
  status:      AGENT_STATUSES[i % AGENT_STATUSES.length],
  startedAt:   iso((i * 3 + 1) * 60_000),
  endedAt:     AGENT_STATUSES[i % AGENT_STATUSES.length] === 'completed' ? iso((i * 3) * 60_000) : undefined,
}));

// ─── Deals ────────────────────────────────────────────────────────────────────

export const MOCK_DEALS: Deal[] = [
  { id: uuid(), tenantId: 'demo', name: 'Acme Corp — Enterprise',     contactId: MOCK_CONTACTS[0].id,  company: 'Acme Corp',       stage: 'Demo Booked',  amount: 84000,  closeDate: '2026-10-15', createdAt: iso(20 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Strata Labs — Growth',       contactId: MOCK_CONTACTS[1].id,  company: 'Strata Labs',     stage: 'Qualified',    amount: 36000,  closeDate: '2026-10-30', createdAt: iso(18 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Vantage AI — Platform',      contactId: MOCK_CONTACTS[2].id,  company: 'Vantage AI',      stage: 'Qualified',    amount: 52000,  closeDate: '2026-11-01', createdAt: iso(15 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'NexaCo — Starter',           contactId: MOCK_CONTACTS[3].id,  company: 'NexaCo',          stage: 'Demo Booked',  amount: 24000,  closeDate: '2026-10-20', createdAt: iso(14 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Circlepoint — Scale',        contactId: MOCK_CONTACTS[4].id,  company: 'Circlepoint',     stage: 'Prospecting',  amount: 18000,  closeDate: '2026-12-01', createdAt: iso(12 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Northern.io — Teams',        contactId: MOCK_CONTACTS[5].id,  company: 'Northern.io',     stage: 'Qualified',    amount: 29000,  closeDate: '2026-11-15', createdAt: iso(11 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Meridian Health — Ops',      contactId: MOCK_CONTACTS[7].id,  company: 'Meridian Health', stage: 'Proposal',     amount: 96000,  closeDate: '2026-10-10', createdAt: iso(10 * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Northvault — Platform',      contactId: MOCK_CONTACTS[12].id, company: 'Northvault',      stage: 'Closed Won',   amount: 72000,  createdAt: iso(9  * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Acme Corp — Growth',         contactId: MOCK_CONTACTS[13].id, company: 'Acme Corp',       stage: 'Demo Booked',  amount: 48000,  closeDate: '2026-10-25', createdAt: iso(8  * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Vantage AI — Enterprise',    contactId: MOCK_CONTACTS[14].id, company: 'Vantage AI',      stage: 'Qualified',    amount: 65000,  closeDate: '2026-11-10', createdAt: iso(7  * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Meridian Health — AI Suite', contactId: MOCK_CONTACTS[10].id, company: 'Meridian Health', stage: 'Negotiating',  amount: 128000, closeDate: '2026-10-05', createdAt: iso(6  * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Strata Labs — Enterprise',   contactId: MOCK_CONTACTS[11].id, company: 'Strata Labs',     stage: 'Proposal',     amount: 54000,  closeDate: '2026-10-18', createdAt: iso(5  * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Northvault — Growth',        contactId: MOCK_CONTACTS[19].id, company: 'Northvault',      stage: 'Demo Booked',  amount: 42000,  closeDate: '2026-11-05', createdAt: iso(4  * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Circlepoint — Teams',        contactId: MOCK_CONTACTS[15].id, company: 'Circlepoint',     stage: 'Prospecting',  amount: 22000,  closeDate: '2026-12-15', createdAt: iso(3  * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Ember Capital — SaaS',       contactId: MOCK_CONTACTS[6].id,  company: 'Ember Capital',   stage: 'Prospecting',  amount: 31000,  closeDate: '2026-12-01', createdAt: iso(2  * 86400_000) },
  { id: uuid(), tenantId: 'demo', name: 'Northern.io — Enterprise',   contactId: MOCK_CONTACTS[16].id, company: 'Northern.io',     stage: 'Closed Won',   amount: 58000,  createdAt: iso(1  * 86400_000) },
];

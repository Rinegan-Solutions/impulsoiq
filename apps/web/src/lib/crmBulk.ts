import { accountsApi, activitiesApi, contactsApi, dealsApi } from '@/api/client';
import { parseStage } from '@/lib/csv';

const TYPES = new Set(['email', 'sms', 'call', 'note', 'task', 'meeting']);
const ACTORS = new Set(['human', 'agent']);
const LIMIT = 500;

function cap(rows: Record<string, string>[]): Record<string, string>[] {
  return rows.slice(0, LIMIT);
}

export async function importCompanies(rows: Record<string, string>[]) {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const row of cap(rows)) {
    const name = row.name || row.company || '';
    if (!name) { skipped += 1; errors.push('Company row missing name'); continue; }
    try {
      await accountsApi.create({
        name,
        domain: row.domain || undefined,
        industry: row.industry || undefined,
      });
      imported += 1;
    } catch (err) {
      skipped += 1;
      errors.push(err instanceof Error ? err.message : `Could not create ${name}`);
    }
  }
  return { imported, skipped, errors };
}

export async function importContacts(rows: Record<string, string>[]) {
  const accounts = await accountsApi.list(1, 100);
  const byName = new Map(accounts.items.map((a) => [a.name.trim().toLowerCase(), a.id]));
  const byDomain = new Map(
    accounts.items.filter((a) => a.domain).map((a) => [String(a.domain).trim().toLowerCase(), a.id]),
  );
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const row of cap(rows)) {
    const firstName = row.first_name || row.firstname || '';
    const lastName = row.last_name || row.lastname || '';
    if (!firstName || !lastName) { skipped += 1; errors.push('Contact needs first_name and last_name'); continue; }
    let accountId = row.account_id || '';
    const company = (row.company || row.account || row.account_name || '').trim();
    const domain = (row.domain || '').trim().toLowerCase();
    if (!accountId && company) accountId = byName.get(company.toLowerCase()) ?? '';
    if (!accountId && domain) accountId = byDomain.get(domain) ?? '';
    if (!accountId && company) {
      try {
        const created = await accountsApi.create({ name: company, domain: row.domain || undefined });
        accountId = String(created.id ?? '');
        if (accountId) byName.set(company.toLowerCase(), accountId);
      } catch { /* leave unlinked */ }
    }
    try {
      await contactsApi.create({
        firstName,
        lastName,
        email: row.email || undefined,
        phone: row.phone || undefined,
        title: row.title || undefined,
        accountId: accountId || undefined,
        stage: parseStage(row.stage || ''),
        score: 0,
      });
      imported += 1;
    } catch (err) {
      skipped += 1;
      errors.push(err instanceof Error ? err.message : `Could not create ${firstName} ${lastName}`);
    }
  }
  return { imported, skipped, errors };
}

export async function importDeals(rows: Record<string, string>[]) {
  const accounts = await accountsApi.list(1, 100);
  const byName = new Map(accounts.items.map((a) => [a.name.trim().toLowerCase(), a.id]));
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const row of cap(rows)) {
    const name = row.name || row.deal || '';
    const company = (row.company || row.account || row.account_name || '').trim();
    const accountId = row.account_id || (company ? byName.get(company.toLowerCase()) ?? '' : '');
    if (!name || !accountId) {
      skipped += 1;
      errors.push(`Deal "${name || '?'}" needs a company that already exists (or account_id)`);
      continue;
    }
    try {
      await dealsApi.create({
        name,
        accountId,
        amount: Number(row.amount || 0),
        stage: parseStage(row.stage || ''),
      });
      imported += 1;
    } catch (err) {
      skipped += 1;
      errors.push(err instanceof Error ? err.message : `Could not create ${name}`);
    }
  }
  return { imported, skipped, errors };
}

export async function importActivities(
  rows: Record<string, string>[],
  actorId: string,
) {
  const contacts = await contactsApi.list(1, 100);
  const byEmail = new Map(
    contacts.items.filter((c) => c.email).map((c) => [String(c.email).trim().toLowerCase(), c.id]),
  );
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const row of cap(rows)) {
    const type = (row.type || 'note').toLowerCase();
    if (!TYPES.has(type)) { skipped += 1; errors.push(`Unknown activity type "${row.type}"`); continue; }
    const actorType = ACTORS.has((row.actor_type || '').toLowerCase()) ? row.actor_type.toLowerCase() : 'human';
    const email = (row.contact_email || row.email || '').trim().toLowerCase();
    const contactId = row.contact_id || (email ? byEmail.get(email) ?? '' : '');
    if (!contactId) {
      skipped += 1;
      errors.push('Activity needs contact_email for an existing contact');
      continue;
    }
    try {
      await activitiesApi.create({
        contactId,
        type,
        actorType,
        actorId: row.actor_id || actorId,
        subject: row.subject || undefined,
        body: row.body || undefined,
        occurredAt: row.occurred_at || row.occurredat || undefined,
      });
      imported += 1;
    } catch (err) {
      skipped += 1;
      errors.push(err instanceof Error ? err.message : 'Activity row failed');
    }
  }
  return { imported, skipped, errors };
}

export const CONTACT_SAMPLE = `first_name,last_name,email,phone,title,company,stage
Amina,Okoye,amina@example.com,+15550101,VP Sales,Example Co,Prospecting
`;

export const COMPANY_SAMPLE = `name,domain,industry
Example Co,example.com,Software / SaaS
`;

export const DEAL_SAMPLE = `name,company,amount,stage
Q3 expansion,Example Co,25000,Qualified
`;

export const ACTIVITY_SAMPLE = `type,actor_type,subject,body,contact_email
note,human,Intro call,Spoke with Amina about timeline,amina@example.com
`;

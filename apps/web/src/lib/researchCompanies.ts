import { accountsApi } from '@/api/client';
import type { Account } from '@/api/schemas';
import { prepareMarkdown } from '@/lib/prepareMarkdown';

const SKIP_NAME = /^(status|findings|next steps|recommendation|methodology|full ranked|would you like)/i;

/** Pull company names from Deep Research markdown (numbered / bulleted lines). */
export function parseResearchCompanyNames(markdown: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const raw of prepareMarkdown(markdown).split('\n')) {
    const line = raw.trim();
    if (!/^(?:\d+\.|[-*])\s+/.test(line)) continue;
    const rest = line.replace(/^(?:\d+\.|[-*])\s+/, '');
    const bold = rest.match(/^\*\*([^*]{2,80})\*\*/);
    let name = (bold?.[1] ?? rest.split(/[–—]| - /)[0] ?? '').replace(/\*+/g, '').trim();
    name = name.replace(/\s*\(company\)\s*$/i, '').trim();
    if (name.length < 2 || name.length > 80) continue;
    if (SKIP_NAME.test(name)) continue;
    if (/^(verify|ensure|check|retry|consider|expand|populate|resolve|re-run|address|review)/i.test(name)) continue;
    if (!bold && !/^[A-Z]/.test(name)) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    found.push(name);
  }
  return found;
}

function sameCompany(a: string, b: string) {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return n(a) === n(b);
}

export async function saveResearchCompaniesToCrm(
  names: string[],
  meta: { goal?: string; sessionId?: string } = {},
): Promise<{ id: string; name: string }[]> {
  const saved: { id: string; name: string }[] = [];
  for (const name of names) {
    const page = await accountsApi.list(1, 20, name);
    const hit = page.items.find((acc: Account) => sameCompany(acc.name, name));
    if (hit) {
      saved.push({ id: hit.id, name: hit.name });
      continue;
    }
    const created = await accountsApi.create({
      name,
      customFields: { origin: 'deep_research' },
      enrichmentJson: {
        deepResearch: {
          goal: meta.goal ?? '',
          sessionId: meta.sessionId ?? '',
          reasons: [],
          strategies: [],
        },
      },
    });
    if (created.id) saved.push({ id: created.id, name });
  }
  return saved;
}

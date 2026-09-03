import type { ConsentRecord, ConsentChannel } from '@impulsoiq/api-types';

export function hasConsent(
  records: ConsentRecord[],
  contactId: string,
  channel: ConsentChannel,
): boolean {
  const now = new Date().toISOString();
  return records.some(
    (r) =>
      r.contactId === contactId &&
      r.channel === channel &&
      r.granted &&
      (!r.expiresAt || r.expiresAt > now),
  );
}

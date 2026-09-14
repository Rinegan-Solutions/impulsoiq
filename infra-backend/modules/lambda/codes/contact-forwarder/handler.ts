/**
 * Contact forwarder — SES receipt-rule Lambda action.
 *
 * Mail to the public contact addresses (sales@, support@, privacy@, legal@
 * impulsoiq.rinegansolutions.com) is received by SES. The receipt rule first
 * stores the raw message in S3 (the audit copy, kept whatever happens here) and
 * then invokes this function asynchronously, which forwards it to the team inbox.
 *
 * WHY THE MESSAGE IS REWRITTEN
 * SES may only send From an address on a verified identity, and the original
 * sender's domain is not ours. Re-sending the message unchanged would also fail
 * DMARC at the destination, because the sender's DKIM signature no longer
 * matches once SES re-signs it. So:
 *   From:      "<original name> via ImpulsoIQ" <noreply@impulsoiq.rinegansolutions.com>
 *   Reply-To:  the original sender (unless the message already set one)
 *   removed:   DKIM-Signature, Return-Path, Sender, Message-ID
 *   added:     X-ImpulsoIQ-Original-From, X-ImpulsoIQ-Delivered-To
 * Replying in the destination inbox therefore goes straight to the sender.
 *
 * WHAT IS NOT FORWARDED (still stored in S3)
 *   - virus or spam verdict FAIL
 *   - DMARC FAIL where the sender's domain publishes p=reject
 *   - mail from our own mail domain (a forwarding loop)
 *
 * Bytes are handled as latin1 end to end: it maps every byte to one code unit
 * and back, so 8-bit MIME bodies survive the round trip untouched.
 */
import type { SESEvent, SESReceipt } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const s3  = new S3Client({});
const ses = new SESv2Client({});

const BUCKET      = process.env.MAIL_BUCKET ?? '';
const PREFIX      = process.env.MAIL_PREFIX ?? 'inbound/';
const FROM        = process.env.FORWARD_FROM ?? '';
const MAIL_DOMAIN = (process.env.MAIL_DOMAIN ?? '').toLowerCase();
const FORWARD_TO  = (process.env.FORWARD_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Headers that must not survive the rewrite: the original DKIM signature cannot
// verify against a changed From, and SES sets its own envelope and Message-ID.
const DROPPED_HEADERS = new Set(['from', 'dkim-signature', 'return-path', 'sender', 'message-id']);

// ── Header handling (exported for tests) ─────────────────────────────────────

export function splitMessage(raw: string): { headers: string[]; body: string } {
  const boundary = /\r?\n\r?\n/.exec(raw);
  const headerText = boundary ? raw.slice(0, boundary.index) : raw;
  const body = boundary ? raw.slice(boundary.index + boundary[0].length) : '';
  const headers: string[] = [];
  for (const line of headerText.split(/\r?\n/)) {
    // A line starting with whitespace continues the previous (folded) header.
    if (/^[ \t]/.test(line) && headers.length > 0) headers[headers.length - 1] += `\r\n${line}`;
    else if (line) headers.push(line);
  }
  return { headers, body };
}

function headerName(field: string): string {
  return field.slice(0, field.indexOf(':')).trim().toLowerCase();
}

function headerValue(field: string): string {
  return field.slice(field.indexOf(':') + 1).replace(/\r?\n[ \t]+/g, ' ').trim();
}

/** The bare address from a From value such as `"Jo Bloggs" <jo@example.com>`. */
export function addressOf(value: string): string {
  const angle = /<([^>]+)>/.exec(value);
  return (angle ? angle[1] : value).trim().toLowerCase();
}

function displayNameOf(value: string): string {
  const match = /^(.*?)<[^>]+>\s*$/.exec(value);
  const name = match ? match[1].trim().replace(/^"(.*)"$/, '$1') : '';
  return name || addressOf(value);
}

function phrase(text: string): string {
  const clean = text.replace(/[\r\n]+/g, ' ');
  // RFC 2047 encoded-words are not decoded inside quoted strings, so a name
  // that is already encoded is left as an unquoted phrase.
  if (clean.includes('=?')) return clean;
  return `"${clean.replace(/[\\"]/g, '\\$&')}"`;
}

export function rewriteMessage(raw: string, opts: { from: string; recipients: string[] }): string {
  const { headers, body } = splitMessage(raw);
  const originalFromField = headers.find((h) => headerName(h) === 'from');
  const originalFrom = originalFromField ? headerValue(originalFromField) : '';
  const hasReplyTo = headers.some((h) => headerName(h) === 'reply-to');

  const added = [
    `From: ${phrase(`${displayNameOf(originalFrom || 'unknown sender')} via ImpulsoIQ`)} <${opts.from}>`,
  ];
  if (!hasReplyTo && originalFrom) added.push(`Reply-To: ${originalFrom}`);
  added.push(`X-ImpulsoIQ-Original-From: ${originalFrom || 'unknown'}`);
  added.push(`X-ImpulsoIQ-Delivered-To: ${opts.recipients.join(', ')}`);

  const kept = headers.filter((h) => !DROPPED_HEADERS.has(headerName(h)));
  return `${[...added, ...kept].join('\r\n')}\r\n\r\n${body}`;
}

/** Why a message must not be forwarded, or null to forward it. */
export function dropReason(receipt: SESReceipt, senderAddress: string, mailDomain: string): string | null {
  if (receipt.virusVerdict?.status === 'FAIL') return 'virus';
  if (receipt.spamVerdict?.status === 'FAIL') return 'spam';
  // Compared case-insensitively: @types/aws-lambda declares lowercase values,
  // while SES's notification reference documents them in capitals.
  const dmarcPolicy = String(receipt.dmarcPolicy ?? '').toLowerCase();
  if (receipt.dmarcVerdict?.status === 'FAIL' && dmarcPolicy === 'reject') return 'dmarc-reject';
  const domain = senderAddress.slice(senderAddress.lastIndexOf('@') + 1);
  if (mailDomain && (domain === mailDomain || domain.endsWith(`.${mailDomain}`))) return 'loop';
  return null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: SESEvent): Promise<void> => {
  for (const record of event.Records) {
    const { mail, receipt } = record.ses;
    const sender = addressOf(mail.commonHeaders.from?.[0] ?? mail.source);
    const context = { messageId: mail.messageId, recipients: receipt.recipients };

    const reason = dropReason(receipt, sender, MAIL_DOMAIN);
    if (reason) {
      console.warn('contact-forwarder: not forwarded', { ...context, reason });
      continue;
    }
    if (FORWARD_TO.length === 0 || !FROM || !BUCKET) {
      console.warn('contact-forwarder: forwarding not configured; message kept in S3 only', context);
      continue;
    }

    const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}${mail.messageId}` }));
    if (!object.Body) throw new Error(`empty S3 object for ${mail.messageId}`);
    const raw = Buffer.from(await object.Body.transformToByteArray()).toString('latin1');

    const rewritten = rewriteMessage(raw, { from: FROM, recipients: receipt.recipients });

    // Deliberately no configuration set: an outbound-reputation pause on the
    // product's own sending must not also stop enquiries reaching the team.
    // A thrown error makes the async invocation retry.
    await ses.send(new SendEmailCommand({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: FORWARD_TO },
      Content: { Raw: { Data: Buffer.from(rewritten, 'latin1') } },
    }));
    console.log('contact-forwarder: forwarded', { ...context, destinations: FORWARD_TO.length });
  }
};

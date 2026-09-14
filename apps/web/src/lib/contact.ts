/**
 * Public contact addresses, in one place.
 *
 * The site linked @impulsoiq.com, a domain this product does not own, so every
 * sales, privacy and legal enquiry went nowhere. The product's own domain is
 * impulsoiq.rinegansolutions.com — a delegated Route 53 hosted zone of its own,
 * and the host SES sends from. Each address can be overridden at build time
 * without touching the pages.
 *
 * Mail to them is received by SES (MX published by infra-web prod), stored in
 * S3 and forwarded to the team inbox by infra-backend's mail module. Changing
 * the local parts here means changing contact_local_parts there too, or SES
 * will reject the new address.
 */
const MAIL_DOMAIN = 'impulsoiq.rinegansolutions.com';

export const CONTACT = {
  sales:   import.meta.env.VITE_CONTACT_SALES_EMAIL   || `sales@${MAIL_DOMAIN}`,
  support: import.meta.env.VITE_CONTACT_SUPPORT_EMAIL || `support@${MAIL_DOMAIN}`,
  privacy: import.meta.env.VITE_CONTACT_PRIVACY_EMAIL || `privacy@${MAIL_DOMAIN}`,
  legal:   import.meta.env.VITE_CONTACT_LEGAL_EMAIL   || `legal@${MAIL_DOMAIN}`,
} as const;

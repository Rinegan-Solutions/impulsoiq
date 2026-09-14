import { CONTACT } from '@/lib/contact';
import { NavBar } from '@/components/layout/NavBar';
import { Footer } from '@/components/layout/Footer';
import { SEO } from '@/components/SEO';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-[1.35rem] font-extrabold text-slate-900 dark:text-white mb-4 tracking-tight">{title}</h2>
      <div className="text-[0.95rem] text-slate-600 dark:text-slate-400 leading-[1.8] space-y-3">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen font-sans antialiased bg-white dark:bg-[#020617] text-slate-900 dark:text-white overflow-x-hidden">
      <SEO
        title="Privacy Policy — ImpulsoIQ"
        description="Learn how ImpulsoIQ, operated by Rinegan Solutions Limited, collects, uses, and protects your personal data."
        canonical="https://impulsoiq.rinegansolutions.com/privacy"
        noIndex={false}
      />
      <NavBar />

      <main className="pt-[80px] pb-24 px-4 sm:px-6">
        <div className="max-w-[760px] mx-auto">

          {/* Header */}
          <div className="py-12 border-b border-slate-200 dark:border-white/[0.07] mb-12">
            <div className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-3">Legal</div>
            <h1 className="text-[2.5rem] sm:text-[3rem] font-extrabold tracking-[-0.04em] text-slate-900 dark:text-white mb-3">Privacy Policy</h1>
            <p className="text-slate-500 dark:text-slate-400 text-[0.9rem]">
              Last updated: 1 September 2026 · Effective: 1 September 2026
            </p>
          </div>

          <Section title="1. Introduction">
            <p>
              ImpulsoIQ (&quot;ImpulsoIQ&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is operated by <strong className="text-slate-800 dark:text-slate-200">Rinegan Solutions Limited</strong>, a company registered in England and Wales. We are committed to protecting your personal data and respecting your privacy rights.
            </p>
            <p>
              This Privacy Policy explains what personal data we collect, why we collect it, how we use and share it, and what rights you have. It applies to our website at impulsoiq.rinegansolutions.com and all related services (the &quot;Services&quot;).
            </p>
            <p>
              By using our Services, you agree to the collection and use of information in accordance with this policy. If you do not agree, please do not use our Services.
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <p><strong className="text-slate-800 dark:text-slate-200">Contact and account data:</strong> When you register or contact us, we collect your name, email address, company name, job title, and phone number.</p>
            <p><strong className="text-slate-800 dark:text-slate-200">Usage data:</strong> We automatically collect information about how you interact with our Services, including IP address, browser type, pages visited, time spent, and referring URLs.</p>
            <p><strong className="text-slate-800 dark:text-slate-200">CRM and sales data:</strong> If you use ImpulsoIQ to manage contacts and campaigns, we process contact records, email content, call transcripts, and activity logs on your behalf as a data processor.</p>
            <p><strong className="text-slate-800 dark:text-slate-200">Cookie data:</strong> We use cookies and similar tracking technologies as described in Section 8 below.</p>
            <p><strong className="text-slate-800 dark:text-slate-200">Payment data:</strong> Payment card details are processed directly by our payment processor (Stripe) and are never stored on our servers.</p>
          </Section>

          <Section title="3. How We Use Your Information">
            <p>We use your data to:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Provide, maintain, and improve our Services</li>
              <li>Process transactions and send related information</li>
              <li>Send transactional and operational emails (e.g. account verification, billing)</li>
              <li>Respond to your comments and questions</li>
              <li>Monitor and analyse usage patterns to improve user experience</li>
              <li>Detect and prevent fraudulent or unauthorised activity</li>
              <li>Comply with legal obligations</li>
              <li>Send you marketing communications where you have given consent or where we have a legitimate interest</li>
            </ul>
            <p>
              Our legal basis for processing is: (a) contract performance for account and billing data; (b) legitimate interests for usage analytics and security; (c) consent for marketing emails and cookies; and (d) legal obligation for compliance-related processing.
            </p>
          </Section>

          <Section title="4. Data Sharing and Disclosure">
            <p>We do not sell your personal data. We may share your data with:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong className="text-slate-800 dark:text-slate-200">Service providers:</strong> Trusted third parties who help us deliver our Services (cloud infrastructure, payment processing, email delivery, analytics). These providers are contractually bound to protect your data.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Business transfers:</strong> In the event of a merger, acquisition, or asset sale, your data may be transferred. We will notify you before your data becomes subject to a different privacy policy.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Legal requirements:</strong> We may disclose your data when required by law, court order, or governmental authority.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Protection of rights:</strong> We may disclose data to protect the rights, property, or safety of ImpulsoIQ, our users, or the public.</li>
            </ul>
          </Section>

          <Section title="5. Data Retention">
            <p>
              We retain personal data for as long as necessary to provide our Services and comply with legal obligations. Account data is retained for the duration of your subscription plus 7 years to meet audit and legal requirements. You may request earlier deletion subject to Section 6.
            </p>
            <p>
              Usage logs and anonymised analytics data may be retained indefinitely in aggregated, non-identifiable form.
            </p>
          </Section>

          <Section title="6. Your Rights (GDPR)">
            <p>If you are located in the European Economic Area or the United Kingdom, you have the following rights under applicable data protection law:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong className="text-slate-800 dark:text-slate-200">Right of access:</strong> Request a copy of the personal data we hold about you.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Right to rectification:</strong> Request correction of inaccurate or incomplete data.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Right to erasure:</strong> Request deletion of your personal data in certain circumstances.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Right to data portability:</strong> Receive your data in a structured, machine-readable format.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Right to object:</strong> Object to processing based on legitimate interests or direct marketing.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Right to restrict processing:</strong> Request that we limit how we use your data.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Right to withdraw consent:</strong> Where processing is based on consent, you may withdraw it at any time.</li>
            </ul>
            <p>
            To exercise these rights for contacts in your workspace, an admin can export or erase a contact from Settings → Privacy (includes consent records and call metadata). You may also email <a href={`mailto:${CONTACT.privacy}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{CONTACT.privacy}</a>. We will respond within 30 days.
            </p>
          </Section>

          <Section title="7. International Transfers">
            <p>
              Our Services are hosted on Amazon Web Services (AWS) infrastructure in the EU and US regions. Where data is transferred outside the EEA, we use standard contractual clauses approved by the European Commission to ensure adequate protection.
            </p>
          </Section>

          <Section title="8. Cookies Policy">
            <p>We use the following categories of cookies:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><strong className="text-slate-800 dark:text-slate-200">Strictly necessary:</strong> Required for the Services to function (authentication, session management). These cannot be disabled.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Analytics:</strong> Help us understand how users interact with our Services (e.g. page views, session duration). We use privacy-respecting analytics tools.</li>
              <li><strong className="text-slate-800 dark:text-slate-200">Preferences:</strong> Remember your settings such as language and theme.</li>
            </ul>
            <p>
              You can manage cookie preferences through your browser settings. Disabling certain cookies may affect the functionality of our Services.
            </p>
          </Section>

          <Section title="9. Security">
            <p>
              We implement industry-standard technical and organisational measures to protect your personal data, including encryption in transit (TLS 1.2+), encryption at rest, access controls, and regular security assessments. We are working towards SOC 2 Type II certification.
            </p>
            <p>
              No method of transmission over the internet is 100% secure. We cannot guarantee absolute security but are committed to promptly notifying affected users of any breach as required by applicable law.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. When we do, we will revise the &quot;Last updated&quot; date at the top of this page and, for material changes, notify you via email or a prominent notice within the Services at least 30 days before the change takes effect.
            </p>
            <p>
              Your continued use of the Services after changes become effective constitutes your acceptance of the updated policy.
            </p>
          </Section>

          <Section title="11. Contact Us">
            <p>
              If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
            </p>
            <div className="bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.07] rounded-xl p-5 mt-4 not-prose">
              <p className="font-semibold text-slate-900 dark:text-white mb-1">Rinegan Solutions Limited</p>
              <p>Email: <a href={`mailto:${CONTACT.privacy}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{CONTACT.privacy}</a></p>
              <p className="mt-1 text-slate-500 dark:text-slate-500 text-[0.85rem]">Registered in England and Wales</p>
            </div>
          </Section>

        </div>
      </main>

      <Footer />
    </div>
  );
}

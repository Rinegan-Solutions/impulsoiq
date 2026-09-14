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

export default function TermsPage() {
  return (
    <div className="min-h-screen font-sans antialiased bg-white dark:bg-[#020617] text-slate-900 dark:text-white overflow-x-hidden">
      <SEO
        title="Terms of Service — ImpulsoIQ"
        description="Read the Terms of Service governing your use of ImpulsoIQ, operated by Rinegan Solutions Limited."
        canonical="https://impulsoiq.rinegansolutions.com/terms"
        noIndex={false}
      />
      <NavBar />

      <main className="pt-[80px] pb-24 px-4 sm:px-6">
        <div className="max-w-[760px] mx-auto">

          {/* Header */}
          <div className="py-12 border-b border-slate-200 dark:border-white/[0.07] mb-12">
            <div className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-3">Legal</div>
            <h1 className="text-[2.5rem] sm:text-[3rem] font-extrabold tracking-[-0.04em] text-slate-900 dark:text-white mb-3">Terms of Service</h1>
            <p className="text-slate-500 dark:text-slate-400 text-[0.9rem]">
              Last updated: 1 September 2026 · Effective: 1 September 2026
            </p>
          </div>

          <Section title="1. Acceptance of Terms">
            <p>
              By accessing or using ImpulsoIQ (&quot;Service&quot;), you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you are entering into these Terms on behalf of a company or other legal entity, you represent that you have the authority to bind that entity.
            </p>
            <p>
              These Terms constitute a legally binding agreement between you (&quot;Customer&quot;) and <strong className="text-slate-800 dark:text-slate-200">Rinegan Solutions Limited</strong>, a company registered in England and Wales (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;). If you do not agree to these Terms, you must not use the Service.
            </p>
          </Section>

          <Section title="2. Description of Services">
            <p>
              ImpulsoIQ provides an AI-powered sales engagement platform that enables autonomous agents to perform outreach, contact enrichment, sequencing, and voice calls on behalf of revenue teams.
            </p>
            <p>
              The Service includes: AI research and contact enrichment, personalised email and SMS sequencing, AI voice call capabilities via the CALL-E integration, a built-in CRM, an Agent Control Panel, and related analytics and reporting features.
            </p>
            <p>
              We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time, with reasonable notice where practicable.
            </p>
          </Section>

          <Section title="3. Account Registration">
            <p>
              To use the Service, you must register for an account. You agree to provide accurate, complete, and current information and to keep it updated. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.
            </p>
            <p>
              You must notify us immediately at <a href={`mailto:${CONTACT.legal}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{CONTACT.legal}</a> of any unauthorised use of your account. You may not share your account with others or create accounts for the purpose of circumventing usage limits.
            </p>
          </Section>

          <Section title="4. Acceptable Use Policy">
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Violate any applicable law, regulation, or third-party rights</li>
              <li>Send unsolicited commercial messages without proper consent</li>
              <li>Transmit malware, viruses, or any malicious code</li>
              <li>Attempt to gain unauthorised access to the Service or its systems</li>
              <li>Scrape, reverse engineer, or reproduce the Service without permission</li>
              <li>Misrepresent your identity or impersonate any person or entity</li>
              <li>Use the Service in a way that could harm, disable, or impair it</li>
              <li>Process data of individuals without a valid legal basis (e.g. without consent where required)</li>
            </ul>
            <p>
              Violation of this policy may result in immediate suspension or termination of your account without refund.
            </p>
          </Section>

          <Section title="5. AI Agent Usage">
            <p>
              The Service uses autonomous AI agents to perform actions on your behalf. You acknowledge and agree that:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>You are responsible for configuring agents appropriately and reviewing their outputs</li>
              <li>AI-generated content may contain errors and should be reviewed before reliance</li>
              <li>You are solely responsible for ensuring all outreach complies with applicable laws (including CAN-SPAM, GDPR, CASL, and TCPA)</li>
              <li>You must obtain proper consent before using the Service to contact any individual</li>
              <li>We are not liable for damages arising from autonomous agent actions taken in accordance with your configuration</li>
            </ul>
            <p>
              The Agent Control Panel provides you with tools to pause, resume, and terminate agent runs. You are encouraged to use approval gates for high-value or sensitive outreach.
            </p>
          </Section>

          <Section title="6. Data Processing Agreement">
            <p>
              To the extent you upload or process personal data of third parties (e.g. your contacts) through the Service, we act as a data processor on your behalf and you act as the data controller. Our processing activities are governed by our Data Processing Addendum (&quot;DPA&quot;), which is incorporated by reference into these Terms.
            </p>
            <p>
              You are responsible for ensuring you have a valid legal basis for processing each contact&apos;s data and for maintaining consent records. Our platform provides consent-gating tools to help you comply, but ultimate responsibility remains with you.
            </p>
          </Section>

          <Section title="7. Payment and Billing">
            <p>
              Access to paid features requires a valid subscription. All fees are quoted in USD and are exclusive of applicable taxes unless stated otherwise.
            </p>
            <p>
              Access to paid features uses Stripe Checkout and the Stripe Customer Portal. Free includes CRM, research, drafts, and human-approved send — not voice. We do not store card numbers.
            </p>
            <p>
              If payment fails, we may suspend your account after providing notice. Overdue amounts accrue interest at 1.5% per month or the maximum permitted by law, whichever is less.
            </p>
            <p>
              Annual subscriptions may be cancelled within 14 days of purchase for a full refund. Monthly subscriptions may be cancelled at any time; no pro-rated refund is issued for the current billing period.
            </p>
          </Section>

          <Section title="8. Intellectual Property">
            <p>
              All rights, title, and interest in and to the Service, including its software, design, and documentation, are owned by Rinegan Solutions Limited. Nothing in these Terms grants you any right to use our trademarks, trade names, or branding.
            </p>
            <p>
              You retain all rights to your data and content. By using the Service, you grant us a limited, non-exclusive licence to process your data solely to provide the Service.
            </p>
          </Section>

          <Section title="9. Termination">
            <p>
              Either party may terminate these Terms at any time. You may cancel your account through the account settings or by contacting us. We may terminate or suspend your access immediately for breach of these Terms or non-payment, or upon 30 days&apos; notice for any other reason.
            </p>
            <p>
              Upon termination, your right to use the Service ceases immediately. We will retain your data for 30 days post-termination to allow export, after which it will be deleted in accordance with our Privacy Policy.
            </p>
          </Section>

          <Section title="10. Disclaimer of Warranties">
            <p>
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR COMPLETELY SECURE.
            </p>
          </Section>

          <Section title="11. Limitation of Liability">
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, RINEGAN SOLUTIONS LIMITED SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING OUT OF OR IN CONNECTION WITH THESE TERMS OR THE USE OF THE SERVICE.
            </p>
            <p>
              OUR AGGREGATE LIABILITY TO YOU FOR ALL CLAIMS ARISING UNDER THESE TERMS SHALL NOT EXCEED THE GREATER OF (A) THE TOTAL FEES PAID BY YOU IN THE 12 MONTHS PRECEDING THE CLAIM, OR (B) £100.
            </p>
          </Section>

          <Section title="12. Governing Law and Disputes">
            <p>
              These Terms are governed by and construed in accordance with the laws of England and Wales. Any dispute arising out of or in connection with these Terms shall be subject to the exclusive jurisdiction of the courts of England and Wales.
            </p>
            <p>
              Before initiating formal proceedings, both parties agree to attempt to resolve disputes informally by contacting <a href={`mailto:${CONTACT.legal}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{CONTACT.legal}</a>.
            </p>
          </Section>

          <Section title="13. Changes to These Terms">
            <p>
              We may modify these Terms at any time. For material changes, we will provide at least 30 days&apos; advance notice via email or a prominent notice within the Service. Your continued use of the Service after the effective date constitutes acceptance of the updated Terms.
            </p>
          </Section>

          <Section title="14. Contact">
            <div className="bg-slate-50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.07] rounded-xl p-5 mt-4">
              <p className="font-semibold text-slate-900 dark:text-white mb-1">Rinegan Solutions Limited</p>
              <p>Legal enquiries: <a href={`mailto:${CONTACT.legal}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{CONTACT.legal}</a></p>
              <p className="mt-1 text-slate-500 dark:text-slate-500 text-[0.85rem]">Registered in England and Wales</p>
            </div>
          </Section>

        </div>
      </main>

      <Footer />
    </div>
  );
}

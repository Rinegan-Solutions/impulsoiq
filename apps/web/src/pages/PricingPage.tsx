import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ArrowRight, Zap, Building2, Rocket } from 'lucide-react';
import { NavBar } from '@/components/layout/NavBar';
import { Footer } from '@/components/layout/Footer';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';

// ─── Data ────────────────────────────────────────────────────────────────────

const TIERS = [
  {
    id: 'starter',
    name: 'Starter',
    icon: <Zap size={20} />,
    color: 'bg-indigo-500/15 text-indigo-500 dark:text-indigo-400',
    monthly: 149,
    annual: 119,
    description: 'Perfect for solo SDRs and small teams getting started with AI outreach.',
    cta: 'Start free trial',
    ctaHref: '/sign-up',
    popular: false,
    features: [
      '1 seat',
      '500 contacts / month',
      'Email sequences',
      'Basic AI research',
      '10 voice calls / month',
      'Basic CRM',
      'Email support',
      '99.9% uptime SLA',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    icon: <Rocket size={20} />,
    color: 'bg-violet-500/15 text-violet-500 dark:text-violet-400',
    monthly: 399,
    annual: 319,
    description: 'For growing teams that need full AI SDR capabilities and real-time control.',
    cta: 'Start free trial',
    ctaHref: '/sign-up',
    popular: true,
    features: [
      '5 seats',
      '5,000 contacts / month',
      'Full sequences + SMS',
      'All enrichment sources',
      '100 voice calls / month',
      'Full CRM + pipeline',
      'Agent Control Panel',
      'Priority support',
      '99.9% uptime SLA',
      'Advanced analytics',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    icon: <Building2 size={20} />,
    color: 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400',
    monthly: null,
    annual: null,
    description: 'Custom contracts for large teams, agencies, and complex compliance needs.',
    cta: 'Talk to sales',
    ctaHref: 'mailto:sales@impulsoiq.com',
    popular: false,
    features: [
      'Unlimited seats',
      'Unlimited contacts',
      'Everything in Growth',
      'White-label option',
      'SSO / SAML',
      'Dedicated success manager',
      'Custom SLA',
      'Custom data retention',
      'On-boarding & training',
      'SLA-backed support',
    ],
  },
];

const COMPARISON_FEATURES = [
  { label: 'Seats', starter: '1', growth: '5', enterprise: 'Unlimited' },
  { label: 'Contacts / month', starter: '500', growth: '5,000', enterprise: 'Unlimited' },
  { label: 'Email sequences', starter: true, growth: true, enterprise: true },
  { label: 'SMS sequences', starter: false, growth: true, enterprise: true },
  { label: 'AI research', starter: 'Basic', growth: 'All sources', enterprise: 'All sources' },
  { label: 'Voice calls / month', starter: '10', growth: '100', enterprise: 'Unlimited' },
  { label: 'CRM', starter: 'Basic', growth: 'Full + pipeline', enterprise: 'Full + pipeline' },
  { label: 'Agent Control Panel', starter: false, growth: true, enterprise: true },
  { label: 'Analytics & reporting', starter: 'Basic', growth: 'Advanced', enterprise: 'Custom' },
  { label: 'SSO / SAML', starter: false, growth: false, enterprise: true },
  { label: 'White-label', starter: false, growth: false, enterprise: true },
  { label: 'Dedicated success manager', starter: false, growth: false, enterprise: true },
  { label: 'Custom SLA', starter: false, growth: false, enterprise: true },
  { label: 'Support', starter: 'Email', growth: 'Priority', enterprise: 'SLA-backed' },
];

const FAQS = [
  {
    q: 'Is there a free trial?',
    a: 'Yes — every paid plan starts with a 14-day free trial. No credit card required to start. You only provide payment details when you choose to continue.',
  },
  {
    q: 'Can I change plans at any time?',
    a: 'Absolutely. You can upgrade at any time and the difference is prorated immediately. Downgrades take effect at the start of the next billing cycle.',
  },
  {
    q: 'What counts as a "contact"?',
    a: 'A contact is any person your agents enrich, email, SMS, or call within a calendar month. Contacts who are only stored in the CRM without agent activity do not count toward your monthly limit.',
  },
  {
    q: 'How does annual billing work?',
    a: 'Annual plans are billed upfront for 12 months and save you 20% compared to monthly billing. Annual subscribers also get priority support and early access to new features.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: 'You can export all your data at any time from the settings panel. After cancellation, your data is retained for 30 days for re-activation or export, then permanently deleted.',
  },
  {
    q: 'Is ImpulsoIQ GDPR-compliant?',
    a: 'Yes. The platform includes built-in consent gating — every email, SMS, and call checks a consent record before firing. We also offer a Data Processing Addendum for GDPR-regulated customers.',
  },
];

// ─── Components ───────────────────────────────────────────────────────────────

const ease = [0.22, 1, 0.36, 1] as const;

function CellValue({ value }: { value: boolean | string }) {
  if (value === true) return <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>;
  if (value === false) return <span className="text-slate-300 dark:text-slate-700">—</span>;
  return <span className="text-slate-700 dark:text-slate-300 text-[0.85rem]">{value}</span>;
}

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);

  return (
    <div className="min-h-screen font-sans antialiased bg-white dark:bg-[#020617] text-slate-900 dark:text-white overflow-x-hidden">
      <SEO
        title="Pricing — ImpulsoIQ"
        description="Simple, transparent pricing for AI-powered sales teams. Start free, no credit card required. Starter from $149/mo, Growth from $399/mo."
        canonical="https://impulsoiq.rinegansolutions.com/pricing"
      />
      <NavBar />

      <main className="pt-[80px]">

        {/* Hero */}
        <section className="py-20 px-4 sm:px-6 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-50/60 via-white to-white dark:from-indigo-950/20 dark:via-[#020617] dark:to-[#020617]" />
          <div className="relative z-10 max-w-[680px] mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
            >
              <div className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-4">Pricing</div>
              <h1 className="text-[2.5rem] sm:text-[3.5rem] font-extrabold tracking-[-0.04em] text-slate-900 dark:text-white mb-4">
                Simple, transparent pricing.
              </h1>
              <p className="text-[1.1rem] text-slate-500 dark:text-slate-400 leading-relaxed mb-8">
                Start free. No credit card required. Scale as your pipeline grows.
              </p>

              {/* Toggle */}
              <div className="inline-flex items-center gap-3 bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] rounded-full px-2 py-2">
                <button
                  onClick={() => setAnnual(false)}
                  className={cn(
                    'px-4 py-1.5 rounded-full text-sm font-semibold transition-all',
                    !annual ? 'bg-white dark:bg-[#1e293b] shadow text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400',
                  )}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setAnnual(true)}
                  className={cn(
                    'px-4 py-1.5 rounded-full text-sm font-semibold transition-all flex items-center gap-2',
                    annual ? 'bg-white dark:bg-[#1e293b] shadow text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400',
                  )}
                >
                  Annual
                  <span className="text-[0.65rem] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">-20%</span>
                </button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Pricing cards */}
        <section className="pb-20 px-4 sm:px-6">
          <div className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
            {TIERS.map((tier, i) => (
              <motion.div
                key={tier.id}
                initial={{ opacity: 0, y: 32, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.55, delay: i * 0.08, ease }}
                className={cn(
                  'relative flex flex-col rounded-2xl p-7 border transition-all duration-300',
                  tier.popular
                    ? 'bg-gradient-to-b from-indigo-600 to-violet-700 border-transparent shadow-2xl shadow-indigo-500/25 scale-[1.02]'
                    : 'bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/[0.08] hover:shadow-lg dark:hover:bg-white/[0.05]',
                )}
              >
                {tier.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-white text-indigo-700 text-[0.68rem] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full shadow-md">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-4', tier.popular ? 'bg-white/20 text-white' : tier.color)}>
                  {tier.icon}
                </div>

                <div className={cn('text-[1.1rem] font-extrabold mb-1', tier.popular ? 'text-white' : 'text-slate-900 dark:text-white')}>
                  {tier.name}
                </div>

                <div className="mb-4">
                  {tier.monthly !== null ? (
                    <div className="flex items-end gap-1">
                      <span className={cn('text-[2.8rem] font-extrabold tracking-tight leading-none', tier.popular ? 'text-white' : 'text-slate-900 dark:text-white')}>
                        ${annual ? tier.annual : tier.monthly}
                      </span>
                      <span className={cn('text-[0.9rem] mb-2', tier.popular ? 'text-white/70' : 'text-slate-400')}>/ mo</span>
                    </div>
                  ) : (
                    <div className={cn('text-[2.2rem] font-extrabold tracking-tight leading-none', tier.popular ? 'text-white' : 'text-slate-900 dark:text-white')}>
                      Custom
                    </div>
                  )}
                  {tier.monthly !== null && annual && (
                    <p className={cn('text-[0.75rem] mt-1', tier.popular ? 'text-white/60' : 'text-slate-400')}>
                      Billed annually · Save ${(tier.monthly! - tier.annual!) * 12}/yr
                    </p>
                  )}
                </div>

                <p className={cn('text-[0.85rem] leading-relaxed mb-6', tier.popular ? 'text-white/80' : 'text-slate-500 dark:text-slate-400')}>
                  {tier.description}
                </p>

                <ul className="flex flex-col gap-2.5 mb-8 flex-1">
                  {tier.features.map((f, fi) => (
                    <li key={fi} className="flex items-start gap-2.5 text-[0.855rem]">
                      <Check size={15} className={cn('flex-shrink-0 mt-0.5', tier.popular ? 'text-white' : 'text-emerald-500 dark:text-emerald-400')} />
                      <span className={tier.popular ? 'text-white/90' : 'text-slate-600 dark:text-slate-300'}>{f}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href={tier.ctaHref}
                  className={cn(
                    'flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-sm transition-all',
                    tier.popular
                      ? 'bg-white text-indigo-700 hover:bg-indigo-50 shadow-lg hover:shadow-xl hover:-translate-y-0.5'
                      : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-0.5',
                  )}
                >
                  {tier.cta}
                  <ArrowRight size={15} />
                </a>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Feature comparison table */}
        <section className="py-20 px-4 sm:px-6 bg-slate-50 dark:bg-[#080e1d]">
          <div className="max-w-[1100px] mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.6, ease }}
              className="mb-10"
            >
              <div className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-3">Compare plans</div>
              <h2 className="text-[2rem] font-extrabold tracking-[-0.035em] text-slate-900 dark:text-white">Full feature breakdown</h2>
            </motion.div>

            <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02]">
              {/* Table header */}
              <div className="grid grid-cols-4 gap-0 border-b border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-white/[0.03]">
                <div className="px-5 py-4 text-[0.75rem] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-600">Feature</div>
                {TIERS.map(t => (
                  <div key={t.id} className="px-5 py-4 text-center">
                    <div className="font-extrabold text-slate-900 dark:text-white text-[0.95rem]">{t.name}</div>
                  </div>
                ))}
              </div>
              {/* Rows */}
              {COMPARISON_FEATURES.map((row, i) => (
                <div
                  key={i}
                  className={cn(
                    'grid grid-cols-4 gap-0 border-b border-slate-100 dark:border-white/[0.04] last:border-0',
                    i % 2 === 0 ? '' : 'bg-slate-50/60 dark:bg-white/[0.015]',
                  )}
                >
                  <div className="px-5 py-3.5 text-[0.855rem] text-slate-600 dark:text-slate-400 font-medium">{row.label}</div>
                  <div className="px-5 py-3.5 text-center"><CellValue value={row.starter} /></div>
                  <div className="px-5 py-3.5 text-center"><CellValue value={row.growth} /></div>
                  <div className="px-5 py-3.5 text-center"><CellValue value={row.enterprise} /></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 px-4 sm:px-6 bg-white dark:bg-[#020617]">
          <div className="max-w-[760px] mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.6, ease }}
              className="mb-12"
            >
              <div className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-3">FAQ</div>
              <h2 className="text-[2rem] font-extrabold tracking-[-0.035em] text-slate-900 dark:text-white">Common questions</h2>
            </motion.div>

            <div className="space-y-6">
              {FAQS.map((faq, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.2 }}
                  transition={{ duration: 0.5, delay: i * 0.05, ease }}
                  className="border-b border-slate-200 dark:border-white/[0.07] pb-6 last:border-0"
                >
                  <h3 className="font-extrabold text-slate-900 dark:text-white mb-2">{faq.q}</h3>
                  <p className="text-[0.9rem] text-slate-500 dark:text-slate-400 leading-relaxed">{faq.a}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="py-20 px-4 sm:px-6 bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700">
          <div className="max-w-[640px] mx-auto text-center">
            <h2 className="text-[2rem] sm:text-[2.5rem] font-extrabold tracking-[-0.04em] text-white mb-4">
              Ready to build your AI SDR team?
            </h2>
            <p className="text-indigo-200 leading-relaxed mb-8 text-[1rem]">
              14-day free trial on all plans. No credit card required. Cancel any time.
            </p>
            <div className="flex justify-center flex-wrap gap-3">
              <a
                href="/sign-up"
                className="inline-flex items-center gap-2 px-6 py-3.5 font-semibold text-indigo-700 bg-white rounded-xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
              >
                Start free — no credit card
                <ArrowRight size={16} />
              </a>
              <a
                href="mailto:sales@impulsoiq.com"
                className="inline-flex items-center gap-2 px-5 py-3.5 font-semibold text-white rounded-xl border border-white/30 hover:border-white/60 hover:bg-white/10 transition-all"
              >
                Talk to sales
              </a>
            </div>
            <p className="mt-5 text-[0.78rem] text-indigo-300">GDPR-ready · 99.9% uptime SLA · Built by Rinegan Solutions Limited</p>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}

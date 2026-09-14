import { CONTACT } from '@/lib/contact';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, ArrowRight, Zap, Building2, Rocket, Gift } from 'lucide-react';
import { NavBar } from '@/components/layout/NavBar';
import { Footer } from '@/components/layout/Footer';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';
import { useAuth, roleOf } from '@/lib/auth/useAuth';
import { billingApi } from '@/api/client';
import { ApiError } from '@/api/http';
import { useMarketingCta } from '@/lib/marketingCta';

type TierId = 'free' | 'starter' | 'growth' | 'enterprise';

const TIERS: {
  id: TierId;
  name: string;
  icon: React.ReactNode;
  color: string;
  monthly: number | null;
  annual: number | null;
  description: string;
  cta: string;
  popular: boolean;
  features: string[];
}[] = [
  {
    id: 'free',
    name: 'Free',
    icon: <Gift size={20} />,
    color: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    monthly: 0,
    annual: 0,
    description: 'One seat. CRM, research, and drafts. Humans approve every send. No voice.',
    cta: 'Start free',
    popular: false,
    features: [
      '1 seat',
      'CRM',
      'Research + draft outreach',
      'Human-approved send only',
      'No voice calls',
      'Agent Control Panel',
      'Consent gates',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    icon: <Zap size={20} />,
    color: 'bg-indigo-500/15 text-indigo-500 dark:text-indigo-400',
    monthly: 149,
    annual: 119,
    description: 'Paid voice minutes and more concurrent runs, still with Control Panel kill/pause.',
    cta: 'Upgrade to Starter',
    popular: false,
    features: [
      '1 seat',
      'Email sequences',
      '10 voice minutes / month',
      'Human-approved send by default',
      'Agent Control Panel',
      'Usage packs available',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    icon: <Rocket size={20} />,
    color: 'bg-violet-500/15 text-violet-500 dark:text-violet-400',
    monthly: 399,
    annual: 319,
    description: 'Teams that need more minutes, enrichment, and concurrent graphs.',
    cta: 'Upgrade to Growth',
    popular: true,
    features: [
      '5 seats',
      'Full sequences + SMS',
      '100 voice minutes / month',
      'Agent Control Panel',
      'Contact center: add-on (not live)',
      'Usage packs',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    icon: <Building2 size={20} />,
    color: 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400',
    monthly: null,
    annual: null,
    description: 'Custom contract. SSO is environment-level until dedicated pools. Contact center included later — not live.',
    cta: 'Talk to sales',
    popular: false,
    features: [
      'Custom seats',
      'SSO / SAML (onboarding)',
      'Custom SLA',
      'Contact center included (roadmap)',
      'Dedicated success',
    ],
  },
];

const COMPARISON_FEATURES: { label: string; free: boolean | string; starter: boolean | string; growth: boolean | string; enterprise: boolean | string }[] = [
  { label: 'Seats', free: '1', starter: '1', growth: '5', enterprise: 'Custom' },
  { label: 'CRM', free: true, starter: true, growth: true, enterprise: true },
  { label: 'Research + draft', free: true, starter: true, growth: true, enterprise: true },
  { label: 'Send without approval', free: false, starter: 'After HITL relax', growth: 'After HITL relax', enterprise: 'Configurable' },
  { label: 'Voice minutes', free: '0', starter: '10', growth: '100', enterprise: 'Custom' },
  { label: 'Agent Control Panel', free: true, starter: true, growth: true, enterprise: true },
  { label: 'Contact center module', free: false, starter: false, growth: 'Add-on, not live', enterprise: 'Included, not live' },
  { label: 'SSO / SAML', free: false, starter: false, growth: false, enterprise: 'Onboarding' },
];

const FAQS = [
  {
    q: 'Is Free actually free?',
    a: 'Yes. One seat, CRM, research and drafts, human-approved send. Voice is a paywall until you upgrade to Starter. No credit card for Free.',
  },
  {
    q: 'How do I pay?',
    a: 'Starter and Growth use Stripe Checkout (hosted). We never store card numbers. Enterprise is a custom contract.',
  },
  {
    q: 'Can I buy extra minutes or enrichment?',
    a: 'Usage packs add quota on the same fail-closed meter: call minutes, enrichment records, concurrent runs. Packs require Stripe prices in this environment.',
  },
  {
    q: 'Is the contact center in Growth?',
    a: 'It is priced as a Growth add-on and included in Enterprise on the roadmap. The module is not live (Phase 7). Pricing must not imply a support queue exists today.',
  },
  {
    q: 'What happens to my data if I cancel?',
    a: `Admins can export a contact (consent + call metadata) from Settings or the contact record. After cancellation, data is retained for 30 days, then deleted. You can also email ${CONTACT.privacy}.`,
  },
  {
    q: 'How does ImpulsoIQ support GDPR / CCPA?',
    a: 'Consent is checked before every email, SMS and call. Workspace admins can export or erase a contact and associated agent history in-product. That is a data-subject tool, not a promise of a SOC 2 Type II report.',
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

function CellValue({ value }: { value: boolean | string }) {
  if (value === true) return <span className="text-emerald-600 dark:text-emerald-400 font-bold">✓</span>;
  if (value === false) return <span className="text-slate-300 dark:text-slate-700">—</span>;
  return <span className="text-slate-700 dark:text-slate-300 text-[0.85rem]">{value}</span>;
}

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const { to: marketingTo, startLabel } = useMarketingCta();
  const canPay = user && (roleOf(user) === 'admin' || roleOf(user) === 'manager');

  async function startCheckout(tier: TierId) {
    setError(null);
    if (tier === 'enterprise') {
      window.location.assign(`mailto:${CONTACT.sales}`);
      return;
    }
    if (tier === 'free') {
      if (status === 'signedIn') navigate('/home');
      else navigate('/sign-up');
      return;
    }
    if (status !== 'signedIn') {
      navigate(`/sign-in?next=${encodeURIComponent('/pricing')}`);
      return;
    }
    if (!canPay) {
      setError('Only workspace admins and managers can start checkout.');
      return;
    }
    setBusy(tier);
    try {
      const res = await billingApi.checkout({
        tier,
        interval: annual ? 'annual' : 'monthly',
      });
      if (res.url) {
        window.location.assign(res.url);
        return;
      }
      setError('Checkout did not return a Stripe URL.');
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen font-sans antialiased bg-white dark:bg-[#020617] text-slate-900 dark:text-white overflow-x-hidden">
      <SEO
        title="Pricing — ImpulsoIQ"
        description="Free workspace with human-approved send. Starter adds voice. Growth and Enterprise for teams. Contact center is not live."
        canonical="https://impulsoiq.rinegansolutions.com/pricing"
      />
      <NavBar />

      <main className="pt-[80px]">
        <section className="py-20 px-4 sm:px-6 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-50/60 via-white to-white dark:from-indigo-950/20 dark:via-[#020617] dark:to-[#020617]" />
          <div className="relative z-10 max-w-[720px] mx-auto">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
              <div className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-4">Pricing</div>
              <h1 className="text-[2.5rem] sm:text-[3.5rem] font-extrabold tracking-[-0.04em] text-slate-900 dark:text-white mb-4">
                An agentic workspace you can pay for.
              </h1>
              <p className="text-[1.1rem] text-slate-500 dark:text-slate-400 leading-relaxed mb-8">
                Sales wedge first: Control Panel, consent, and human-approved send. Not “replace your SDR.”
              </p>
              <div className="inline-flex items-center gap-3 bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] rounded-full px-2 py-2">
                <button
                  type="button"
                  onClick={() => setAnnual(false)}
                  className={cn(
                    'px-4 py-1.5 rounded-full text-sm font-semibold transition-all',
                    !annual ? 'bg-white dark:bg-[#1e293b] shadow text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400',
                  )}
                >
                  Monthly
                </button>
                <button
                  type="button"
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
              {error && <p className="mt-4 text-[0.85rem] text-amber-700 dark:text-amber-300">{error}</p>}
            </motion.div>
          </div>
        </section>

        <section className="pb-20 px-4 sm:px-6">
          <div className="max-w-[1200px] mx-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch">
            {TIERS.map((tier, i) => (
              <motion.div
                key={tier.id}
                initial={{ opacity: 0, y: 32, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.55, delay: i * 0.08, ease }}
                className={cn(
                  'relative flex flex-col rounded-2xl p-7 border transition-all duration-300',
                  tier.popular
                    ? 'bg-gradient-to-b from-indigo-600 to-violet-700 border-transparent shadow-2xl shadow-indigo-500/25'
                    : 'bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/[0.08]',
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
                </div>
                <p className={cn('text-[0.85rem] leading-relaxed mb-6', tier.popular ? 'text-white/80' : 'text-slate-500 dark:text-slate-400')}>
                  {tier.description}
                </p>
                <ul className="flex flex-col gap-2.5 mb-8 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[0.855rem]">
                      <Check size={15} className={cn('flex-shrink-0 mt-0.5', tier.popular ? 'text-white' : 'text-emerald-500')} />
                      <span className={tier.popular ? 'text-white/90' : 'text-slate-600 dark:text-slate-300'}>{f}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy === tier.id}
                  onClick={() => void startCheckout(tier.id)}
                  className={cn(
                    'flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50',
                    tier.popular
                      ? 'bg-white text-indigo-700 hover:bg-indigo-50'
                      : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white',
                  )}
                >
                  {busy === tier.id ? 'Redirecting…' : tier.cta}
                  <ArrowRight size={15} />
                </button>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="py-20 px-4 sm:px-6 bg-slate-50 dark:bg-[#080e1d]">
          <div className="max-w-[1100px] mx-auto">
            <div className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-400 mb-3">Compare plans</div>
            <h2 className="text-[2rem] font-extrabold tracking-[-0.035em] text-slate-900 dark:text-white mb-10">What ships today</h2>
            <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/[0.07] bg-white dark:bg-white/[0.02] overflow-x-auto">
              <div className="grid grid-cols-5 min-w-[720px] border-b border-slate-200 dark:border-white/[0.07] bg-slate-50 dark:bg-white/[0.03]">
                <div className="px-5 py-4 text-[0.75rem] font-bold uppercase tracking-wider text-slate-400">Feature</div>
                {TIERS.map((t) => (
                  <div key={t.id} className="px-5 py-4 text-center font-extrabold text-slate-900 dark:text-white text-[0.95rem]">{t.name}</div>
                ))}
              </div>
              {COMPARISON_FEATURES.map((row, i) => (
                <div key={row.label} className={cn('grid grid-cols-5 min-w-[720px] border-b border-slate-100 dark:border-white/[0.04]', i % 2 === 0 ? '' : 'bg-slate-50/60 dark:bg-white/[0.015]')}>
                  <div className="px-5 py-3.5 text-[0.855rem] text-slate-600 dark:text-slate-400 font-medium">{row.label}</div>
                  <div className="px-5 py-3.5 text-center"><CellValue value={row.free} /></div>
                  <div className="px-5 py-3.5 text-center"><CellValue value={row.starter} /></div>
                  <div className="px-5 py-3.5 text-center"><CellValue value={row.growth} /></div>
                  <div className="px-5 py-3.5 text-center"><CellValue value={row.enterprise} /></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 px-4 sm:px-6">
          <div className="max-w-[760px] mx-auto">
            <h2 className="text-[2rem] font-extrabold tracking-[-0.035em] text-slate-900 dark:text-white mb-12">Common questions</h2>
            <div className="space-y-6">
              {FAQS.map((faq) => (
                <div key={faq.q} className="border-b border-slate-200 dark:border-white/[0.07] pb-6">
                  <h3 className="font-extrabold text-slate-900 dark:text-white mb-2">{faq.q}</h3>
                  <p className="text-[0.9rem] text-slate-500 dark:text-slate-400 leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 px-4 sm:px-6 bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700">
          <div className="max-w-[640px] mx-auto text-center">
            <h2 className="text-[2rem] sm:text-[2.5rem] font-extrabold tracking-[-0.04em] text-white mb-4">
              Run agents under a Control Panel.
            </h2>
            <p className="text-indigo-200 leading-relaxed mb-8">
              Free to start. Voice when you pay. Consent before every outbound action.
            </p>
            <div className="flex justify-center flex-wrap gap-3">
              <Link
                to={marketingTo}
                className="inline-flex items-center gap-2 px-6 py-3.5 font-semibold text-indigo-700 bg-white rounded-xl"
              >
                {startLabel}
                <ArrowRight size={16} />
              </Link>
              <a
                href={`mailto:${CONTACT.sales}`}
                className="inline-flex items-center gap-2 px-5 py-3.5 font-semibold text-white rounded-xl border border-white/30"
              >
                Talk to sales
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

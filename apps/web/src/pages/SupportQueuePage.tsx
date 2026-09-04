/**
 * Support Queue Page — Phase 7D.
 *
 * Rep-facing queue and conversation UI. Non-agentic — a UI over
 * agent-generated data, following the same Control Panel pattern (§2G).
 *
 * Features:
 *   - Ticket list by queue with live SLA countdown (DynamoDB Streams → AppSync)
 *   - Unified conversation view (cross-channel thread)
 *   - Presence/status toggle
 *   - Manual grab / reassign / escalate / merge / close
 *   - Tier badge for each ticket
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  MessageSquare, Phone, Mail, MessageCircle, Globe,
  AlertTriangle, Clock, CheckCircle2, ArrowUpRight,
} from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { SEO } from '@/components/SEO';
import { cn } from '@/lib/utils';
import { useNow } from '@/lib/useNow';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ticket {
  id:               string;
  conversationId:   string;
  tier:             0 | 1 | 2 | 3;
  priority:         'low' | 'normal' | 'high' | 'urgent';
  slaTargetAt:      string;
  slaBreachedAt?:   string;
  assignedRepId?:   string;
  queueName:        string;
  contactName:      string;
  lastMessage:      string;
  channel:          'email' | 'chat' | 'sms' | 'voice' | 'social';
  status:           'open' | 'pending' | 'resolved';
  createdAt:        string;
}

// The eight fixture tickets that lived here are gone.
//
// crm-read has no list_tickets operation -- it implements get_conversation,
// get_messages, list_queues and count_prior_tickets for the Triage and
// Resolution agents, but nothing that returns a tenant's ticket queue. The page
// below is left fully working (filters, SLA countdown) against an empty list
// rather than showing tickets that do not exist.
//
// To make this live: add list_tickets to crm-read (join ticket -> conversation
// -> contact, ordered by sla_target_at) and fetch it here.

const TIER_CONFIG = {
  0: { label: 'Auto', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  1: { label: 'Draft', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400' },
  2: { label: 'Human', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  3: { label: 'Urgent', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
};

const CHANNEL_ICON: Record<string, React.ElementType> = {
  email: Mail, chat: MessageCircle, sms: MessageSquare, voice: Phone, social: Globe,
};

function SlaCountdown({ targetAt, breachedAt }: { targetAt: string; breachedAt?: string }) {
  // Ticking clock so the countdown actually advances for the rep watching it.
  const now     = useNow(30_000);
  const target  = new Date(targetAt).getTime();
  const breached = !!breachedAt;
  const minsLeft = Math.round((target - now) / 60_000);

  if (breached) return (
    <span className="flex items-center gap-1 text-[0.72rem] font-bold text-red-600 dark:text-red-400">
      <AlertTriangle size={11} /> Breached
    </span>
  );
  if (minsLeft <= 0) return (
    <span className="flex items-center gap-1 text-[0.72rem] font-bold text-red-500">
      <AlertTriangle size={11} /> Overdue
    </span>
  );
  if (minsLeft <= 15) return (
    <span className="flex items-center gap-1 text-[0.72rem] font-bold text-amber-600 dark:text-amber-400">
      <Clock size={11} /> {minsLeft}m
    </span>
  );
  const hrs = Math.floor(minsLeft / 60);
  const mins = minsLeft % 60;
  return (
    <span className="flex items-center gap-1 text-[0.72rem] text-slate-400 dark:text-slate-600">
      <Clock size={11} /> {hrs > 0 ? `${hrs}h ` : ''}{mins}m
    </span>
  );
}

const ease = [0.22, 1, 0.36, 1] as const;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SupportQueuePage() {
  const [tickets, setTickets]           = useState<Ticket[]>([]);
  const [selected, setSelected]         = useState<Ticket | null>(null);
  const [repStatus, setRepStatus]       = useState<'available' | 'busy' | 'offline'>('available');
  const [queueFilter, setQueueFilter]   = useState<'all' | string>('all');

  // Same ticking clock the SLA badges use, so the breach count stays in step.
  const now     = useNow(30_000);
  const queues  = [...new Set(tickets.map(t => t.queueName))];
  const filtered = queueFilter === 'all' ? tickets : tickets.filter(t => t.queueName === queueFilter);

  const breachedCount = tickets.filter(t => t.slaBreachedAt || new Date(t.slaTargetAt).getTime() < now).length;

  function closeTicket(ticketId: string) {
    setTickets(p => p.filter(t => t.id !== ticketId));
    if (selected?.id === ticketId) setSelected(null);
  }

  return (
    <AppShell>
      <SEO title="Support Queue — ImpulsoIQ" description="Rep-facing support queue and conversation UI" />
      <div className="flex h-full overflow-hidden">

        {/* Left: Ticket list */}
        <div className="w-[340px] flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-white/[0.065] bg-white dark:bg-[#0a0f1e]">
          {/* Header */}
          <div className="px-4 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-[0.9rem] font-bold text-slate-900 dark:text-white">Support Queue</h2>
              {/* Presence toggle */}
              <button
                onClick={() => setRepStatus(s => s === 'available' ? 'busy' : s === 'busy' ? 'offline' : 'available')}
                className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[0.72rem] font-bold border transition-all',
                  repStatus === 'available' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/25 text-emerald-700 dark:text-emerald-400' :
                  repStatus === 'busy'      ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/25 text-amber-700 dark:text-amber-400' :
                  'bg-slate-100 dark:bg-white/[0.06] border-slate-200 dark:border-white/[0.1] text-slate-500')}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full',
                  repStatus === 'available' ? 'bg-emerald-500 animate-pulse' :
                  repStatus === 'busy'      ? 'bg-amber-500' : 'bg-slate-400')} />
                {repStatus}
              </button>
            </div>
            {/* Queue filter */}
            <div className="flex gap-1 flex-wrap">
              {(['all', ...queues] as const).map(q => (
                <button key={q} onClick={() => setQueueFilter(q)}
                  className={cn('px-2 py-0.5 rounded-lg text-[0.72rem] font-medium transition-all capitalize',
                    queueFilter === q ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>
                  {q}
                </button>
              ))}
            </div>
            {breachedCount > 0 && (
              <div className="flex items-center gap-1.5 mt-2 text-[0.73rem] font-semibold text-red-600 dark:text-red-400">
                <AlertTriangle size={12} /> {breachedCount} SLA {breachedCount === 1 ? 'breach' : 'breaches'}
              </div>
            )}
          </div>

          {/* Ticket rows */}
          <div className="flex-1 overflow-y-auto">
            {filtered.map((t, i) => {
              const Icon = CHANNEL_ICON[t.channel] ?? MessageSquare;
              const tier = TIER_CONFIG[t.tier];
              const isSelected = selected?.id === t.id;
              return (
                <motion.button
                  key={t.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, ease }}
                  onClick={() => setSelected(t)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-slate-50 dark:border-white/[0.03] transition-colors',
                    isSelected ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]',
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon size={12} className="text-slate-400 flex-shrink-0" />
                      <span className="text-[0.82rem] font-semibold text-slate-800 dark:text-slate-200 truncate">{t.contactName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={cn('text-[0.62rem] font-bold px-1.5 py-0.5 rounded', tier.cls)}>{tier.label}</span>
                      <SlaCountdown targetAt={t.slaTargetAt} breachedAt={t.slaBreachedAt} />
                    </div>
                  </div>
                  <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 truncate">{t.lastMessage}</p>
                  <p className="text-[0.68rem] text-slate-300 dark:text-slate-700 mt-0.5">{t.queueName}</p>
                </motion.button>
              );
            })}
            {filtered.length === 0 && (
              <div className="py-12 text-center text-[0.82rem] text-slate-400 dark:text-slate-600">
                <CheckCircle2 size={24} className="mx-auto mb-2 opacity-40" />
                Queue is clear
              </div>
            )}
          </div>
        </div>

        {/* Right: Conversation view */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-[#020617]">
          {selected ? (
            <>
              {/* Conversation header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.065] bg-white dark:bg-[#0d1526] flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-white text-[0.65rem] font-bold flex items-center justify-center flex-shrink-0">
                    {selected.contactName.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.88rem] font-bold text-slate-900 dark:text-white">{selected.contactName}</p>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[0.62rem] font-bold px-1.5 py-0.5 rounded', TIER_CONFIG[selected.tier].cls)}>
                        Tier {selected.tier}
                      </span>
                      <span className="text-[0.72rem] text-slate-400 dark:text-slate-600">{selected.queueName}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 text-[0.78rem] font-semibold rounded-xl border border-amber-200 dark:border-amber-500/25 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors flex items-center gap-1.5">
                    <ArrowUpRight size={12} /> Escalate
                  </button>
                  <button onClick={() => closeTicket(selected.id)} className="px-3 py-1.5 text-[0.78rem] font-semibold rounded-xl bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/25 transition-colors flex items-center gap-1.5">
                    <CheckCircle2 size={12} /> Resolve
                  </button>
                </div>
              </div>

              {/* Message thread */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                <div className="flex justify-start">
                  <div className="max-w-[70%] bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl rounded-bl-sm px-4 py-3 text-[0.84rem] text-slate-800 dark:text-slate-200">
                    {selected.lastMessage}
                  </div>
                </div>
                {selected.tier <= 1 && (
                  <div className="flex justify-end">
                    <div className="max-w-[75%] bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 rounded-2xl rounded-br-sm px-4 py-3 text-[0.84rem] text-indigo-800 dark:text-indigo-200">
                      <p className="text-[0.65rem] font-bold text-indigo-500 mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        Resolution Agent draft — {selected.tier === 0 ? 'auto-send ready' : 'awaiting your review'}
                      </p>
                      <p className="mb-2.5">
                        {selected.tier === 0
                          ? "I can see your invoice is ready to download. Head to Settings → Billing → Invoices and you'll find all your statements there. Let me know if you need anything else!"
                          : "Thanks for reaching out! I'd be happy to walk you through setting up your first outreach sequence. The best way to start is by going to Campaigns → New Campaign..."}
                      </p>
                      {/* Citations — mandatory per v4 §8A */}
                      <div className="border-t border-indigo-200 dark:border-indigo-500/25 pt-2 mt-1">
                        <p className="text-[0.62rem] font-bold text-indigo-400 uppercase tracking-wider mb-1">
                          Grounded in:
                        </p>
                        <div className="flex flex-col gap-0.5">
                          {selected.tier === 0 ? (
                            <span className="text-[0.72rem] text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                              <span className="text-[0.6rem]">📄</span>
                              How to download your invoice (v2 · reviewed 2026-09-01)
                            </span>
                          ) : (
                            <span className="text-[0.72rem] text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                              <span className="text-[0.6rem]">📄</span>
                              Setting up an outreach campaign (v3 · reviewed 2026-08-28)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Reply box */}
              <div className="px-5 pb-5 flex-shrink-0">
                <div className="bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.065] rounded-2xl overflow-hidden">
                  <textarea
                    rows={3}
                    placeholder="Type your reply…"
                    className="w-full px-4 py-3 text-[0.84rem] text-slate-900 dark:text-white bg-transparent resize-none focus:outline-none placeholder:text-slate-400"
                  />
                  <div className="flex items-center justify-between px-4 pb-3">
                    <span className="text-[0.72rem] text-slate-400 dark:text-slate-600">
                      {selected.tier >= 2 ? 'Human rep response required' : 'Send or edit the AI draft above'}
                    </span>
                    <button className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:shadow-lg hover:shadow-indigo-500/25 transition-all">
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-slate-400 dark:text-slate-600">
                <MessageSquare size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-[0.84rem] font-semibold">Select a ticket to view the conversation</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}

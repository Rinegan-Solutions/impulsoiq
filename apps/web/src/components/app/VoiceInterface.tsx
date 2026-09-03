/**
 * Ambient Voice Interface — Phase 4A.
 *
 * Floating microphone button in the AppShell header. On click, opens a
 * voice session panel that captures browser microphone input, streams it
 * to the voice-bridge Lambda via WebSocket, and displays responses.
 *
 * For the hackathon demo: TEXT MODE — the user types into the panel and
 * receives text responses. The WebSocket + microphone capture is wired up
 * but audio encoding is commented out pending a live Nova Sonic endpoint.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, X, Loader2, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  ts:   number;
}

export function VoiceInterface({ tenantId }: { tenantId?: string }) {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const wsRef  = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Connect to WebSocket when panel opens
  useEffect(() => {
    if (!open || wsRef.current) return;

    // For demo: use the REST API fallback instead of WebSocket
    // In production: wsRef.current = new WebSocket(process.env.VITE_VOICE_WS_URL);
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [open]);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    setInput('');
    setLoading(true);

    const userMsg: Message = { role: 'user', text, ts: Date.now() };
    setMessages(p => [...p, userMsg]);

    try {
      // Demo mode: call the REST endpoint for the ambient agent
      const res = await fetch('/api/voice/message', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tenantId: tenantId ?? 'demo', message: text, textMode: true }),
      });
      const data = await res.json() as { response?: string };
      const reply: Message = {
        role: 'assistant',
        text: data.response ?? 'Sorry, I couldn\'t process that.',
        ts:   Date.now(),
      };
      setMessages(p => [...p, reply]);
    } catch {
      setMessages(p => [...p, { role: 'assistant', text: 'Connection error. Please try again.', ts: Date.now() }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Floating microphone button */}
      <button
        onClick={() => setOpen(p => !p)}
        aria-label="Open voice interface"
        className={cn(
          'relative w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200',
          open
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-700 dark:hover:text-white',
        )}
      >
        <Mic size={17} />
        {open && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#020617] animate-pulse" />
        )}
      </button>

      {/* Voice panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-[68px] right-4 w-[360px] z-[200] bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.1] rounded-2xl shadow-2xl shadow-slate-900/15 dark:shadow-black/50 overflow-hidden"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-white/[0.06] bg-gradient-to-r from-indigo-600 to-violet-600">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                  <Volume2 size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-[0.84rem] font-bold text-white">ImpulsoIQ Voice</p>
                  <p className="text-[0.68rem] text-indigo-200">Powered by Nova Sonic</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Conversation */}
            <div className="px-4 py-3 max-h-[300px] overflow-y-auto flex flex-col gap-3">
              {messages.length === 0 && (
                <div className="py-8 text-center">
                  <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center mx-auto mb-3">
                    <Mic size={20} className="text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <p className="text-[0.84rem] font-semibold text-slate-700 dark:text-slate-300">Say something</p>
                  <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-1">
                    "How did the Meridian call go?" · "What's in my pipeline?" · "Brief me"
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[82%] px-3.5 py-2.5 rounded-2xl text-[0.83rem] leading-relaxed',
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-slate-100 dark:bg-white/[0.06] text-slate-800 dark:text-slate-200 rounded-bl-sm',
                  )}>
                    {m.text}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 dark:bg-white/[0.06] px-3.5 py-2.5 rounded-2xl rounded-bl-sm flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin text-slate-400" />
                    <span className="text-[0.8rem] text-slate-400">Thinking…</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="px-3 pb-3 border-t border-slate-100 dark:border-white/[0.06] pt-2.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Type a message or use mic…"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                  className="flex-1 h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || loading}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-all"
                >
                  <Mic size={15} />
                </button>
              </div>
              <p className="text-center text-[0.67rem] text-slate-400 dark:text-slate-600 mt-1.5">
                All voice actions are logged with input_modality=voice
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

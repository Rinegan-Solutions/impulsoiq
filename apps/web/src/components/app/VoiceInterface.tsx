/**
 * Ambient Voice Interface — Phase 4A.
 *
 * Opens next to the Home greeting. Live speech goes browser PCM → voice-bridge
 * (Cognito) → presigned AgentCore /ws → Strands BidiAgent + Nova Sonic.
 * Typed messages use the same Sonic session when it is up, else HTTP text.
 *
 * AUTH: ?token=<Cognito ID token>&workspace=<slug>. voice-bridge verifies on
 * $connect. session_expired reconnects once with a fresh token.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, Mic, X, Loader2, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/useAuth';
import { getCurrentToken } from '@/lib/auth/cognito';
import { currentTenantSlug } from '@/lib/tenant';
import { PcmPlayer, startMicStream, textInputEvent } from '@/lib/voiceBidi';

const VOICE_WS_URL = import.meta.env.VITE_VOICE_WS_URL ?? '';

interface BridgeMessage {
  type: 'processing' | 'response' | 'error' | 'pong' | 'bidi_session' | 'bidi_unavailable';
  text?: string;
  error?: string;
  code?: string;
  url?: string;
  sessionId?: string;
}

interface BidiMessage {
  type?: string;
  audio?: string;
  text?: string;
  role?: string;
  sample_rate?: number;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  ts: number;
}

export function VoiceInterface() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState(false);
  const [micHint, setMicHint] = useState<string | null>(null);
  const bridgeRef = useRef<WebSocket | null>(null);
  const bidiRef = useRef<WebSocket | null>(null);
  const connectingRef = useRef<Promise<WebSocket> | null>(null);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const inFlightRef = useRef<{ text: string; retried: boolean } | null>(null);
  const retryingRef = useRef(false);
  const handleRef = useRef<(event: MessageEvent) => void>(() => undefined);
  const playerRef = useRef<PcmPlayer | null>(null);
  const micStopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!open || !bridgeRef.current) return;
    const id = window.setInterval(() => {
      const ws = bridgeRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 4 * 60_000);
    return () => window.clearInterval(id);
  }, [open]);

  function push(role: Message['role'], text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;
    setMessages((p) => {
      const last = p[p.length - 1];
      if (last && last.role === role && Date.now() - last.ts < 1500) {
        return [...p.slice(0, -1), { ...last, text: `${last.text} ${cleaned}`.trim(), ts: Date.now() }];
      }
      return [...p, { role, text: cleaned, ts: Date.now() }];
    });
  }

  function dropBridge() {
    const ws = bridgeRef.current;
    bridgeRef.current = null;
    connectingRef.current = null;
    ws?.close();
  }

  function dropBidi() {
    micStopRef.current?.();
    micStopRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    bidiRef.current?.close();
    bidiRef.current = null;
    setListening(false);
    setLive(false);
  }

  function teardown() {
    dropBidi();
    dropBridge();
    setLoading(false);
  }

  // Assigned in an effect rather than during render. The socket's onmessage
  // reads this ref asynchronously, so it only has to hold the latest closure by
  // the time a message arrives — and writing a ref while rendering is exactly
  // the kind of side effect that misbehaves under concurrent rendering.
  //
  // Declared BEFORE the connect effect below on purpose: effects run in
  // declaration order, so the handler is in place before anything opens a
  // socket that could deliver to it.
  useEffect(() => {
    handleRef.current = (event: MessageEvent) => {
      let msg: BridgeMessage;
      try { msg = JSON.parse(String(event.data)) as BridgeMessage; } catch { return; }

      if (msg.type === 'processing' || msg.type === 'pong') return;
      if (msg.type === 'bidi_session' && msg.url) {
        void attachBidi(msg.url);
        return;
      }
      if (msg.type === 'bidi_unavailable') {
        setMicHint(msg.error || 'Live voice is unavailable. Type instead.');
        return;
      }
      if (msg.type === 'response') {
        inFlightRef.current = null;
        push('assistant', msg.text || "Sorry, I couldn't process that.");
        setLoading(false);
        return;
      }
      if (msg.type !== 'error') return;

      const inFlight = inFlightRef.current;
      if (msg.code === 'session_expired' && inFlight && !inFlight.retried) {
        inFlight.retried = true;
        retryingRef.current = true;
        dropBridge();
        void deliverText(inFlight.text).finally(() => { retryingRef.current = false; });
        return;
      }
      inFlightRef.current = null;
      push('assistant', msg.error || 'Something went wrong. Please try again.');
      setLoading(false);
    };
  });


  function openBridge(): Promise<WebSocket> {
    const current = bridgeRef.current;
    if (current && current.readyState === WebSocket.OPEN) return Promise.resolve(current);
    if (connectingRef.current) return connectingRef.current;

    const pending = (async () => {
      const token = await getCurrentToken();
      if (!token) throw new Error('signed out');
      if (!VOICE_WS_URL) throw new Error('not configured');
      const url = new URL(VOICE_WS_URL);
      url.searchParams.set('token', token);
      const workspace = currentTenantSlug();
      if (workspace) url.searchParams.set('workspace', workspace);

      return new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url.toString());
        ws.onopen = () => {
          bridgeRef.current = ws;
          connectingRef.current = null;
          resolve(ws);
        };
        ws.onerror = () => {
          connectingRef.current = null;
          reject(new Error('assistant unreachable'));
        };
        ws.onclose = () => {
          if (bridgeRef.current === ws) bridgeRef.current = null;
          if (!retryingRef.current && inFlightRef.current) {
            inFlightRef.current = null;
            setLoading(false);
          }
        };
        ws.onmessage = (ev) => handleRef.current(ev);
      });
    })();

    pending.catch(() => { connectingRef.current = null; });
    connectingRef.current = pending;
    return pending;
  }

  async function bootLive() {
    if (!VOICE_WS_URL || !user) return;
    try {
      const ws = await openBridge();
      ws.send(JSON.stringify({ type: 'start', sessionId: sessionIdRef.current }));
    } catch {
      setMicHint(VOICE_WS_URL
        ? 'Could not reach the assistant.'
        : 'The assistant is not configured for this environment.');
    }
  }

  // Placed after bootLive and teardown are declared: referencing them earlier
  // relied on hoisting, which hides the dependency from both the reader and the
  // linter.
  useEffect(() => {
    if (open) {
      void bootLive();
      return;
    }
    teardown();
  }, [open]);

  useEffect(() => () => teardown(), []);

  async function attachBidi(url: string) {
    dropBidi();
    const player = new PcmPlayer(16000);
    playerRef.current = player;
    const ws = new WebSocket(url);
    bidiRef.current = ws;
    ws.onmessage = (ev) => {
      let data: BidiMessage;
      try { data = JSON.parse(String(ev.data)) as BidiMessage; } catch { return; }
      if (data.type === 'bidi_audio_stream' && data.audio) {
        void player.push(data.audio);
        return;
      }
      if (data.type === 'bidi_transcript_stream' && data.text) {
        const role = data.role === 'user' ? 'user' : 'assistant';
        push(role, data.text);
        if (role === 'assistant') setLoading(false);
        return;
      }
      if (data.type === 'bidi_interruption') {
        player.interrupt();
        setLoading(false);
      }
    };
    ws.onopen = async () => {
      setLive(true);
      setMicHint('Use headphones so the assistant does not hear itself.');
      try {
        const mic = await startMicStream((payload) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
        });
        micStopRef.current = mic.stop;
        setListening(true);
      } catch {
        setMicHint('Microphone permission was denied. You can still type.');
      }
    };
    ws.onclose = () => {
      if (bidiRef.current === ws) {
        bidiRef.current = null;
        setLive(false);
        setListening(false);
      }
    };
    ws.onerror = () => {
      setMicHint('Live voice dropped. You can still type.');
      setLive(false);
    };
  }

  async function deliverText(text: string) {
    const bidi = bidiRef.current;
    if (bidi && bidi.readyState === WebSocket.OPEN) {
      bidi.send(JSON.stringify(textInputEvent(text)));
      return;
    }
    try {
      const ws = await openBridge();
      ws.send(JSON.stringify({ type: 'text', message: text, sessionId: sessionIdRef.current }));
    } catch {
      inFlightRef.current = null;
      push('assistant', VOICE_WS_URL
        ? 'Could not reach the assistant. Please try again.'
        : 'The assistant is not configured for this environment.');
      setLoading(false);
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    setInput('');
    push('user', text);

    if (!VOICE_WS_URL || !user) {
      push('assistant', 'The assistant is not configured for this environment.');
      return;
    }

    setLoading(true);
    inFlightRef.current = { text, retried: false };
    await deliverText(text);
    if (bidiRef.current?.readyState === WebSocket.OPEN) setLoading(false);
  }

  function toggleMic() {
    if (listening) {
      micStopRef.current?.();
      micStopRef.current = null;
      setListening(false);
      return;
    }
    const bidi = bidiRef.current;
    if (!bidi || bidi.readyState !== WebSocket.OPEN) {
      setMicHint(live ? 'Reconnecting live voice…' : 'Live voice is starting. You can type in the meantime.');
      void bootLive();
      return;
    }
    void startMicStream((payload) => {
      if (bidi.readyState === WebSocket.OPEN) bidi.send(JSON.stringify(payload));
    }).then((mic) => {
      micStopRef.current = mic.stop;
      setListening(true);
      setMicHint('Use headphones so the assistant does not hear itself.');
    }).catch(() => setMicHint('Microphone permission was denied.'));
  }

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-label={open ? 'Close voice assistant' : 'Open voice assistant'}
        aria-expanded={open}
        className={cn(
          'relative w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200',
          open
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-700 dark:hover:text-white',
        )}
      >
        <Mic size={17} />
        {open && (
          <span className={cn(
            'absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-[#020617]',
            listening ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400',
          )} />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-1/2 top-full z-[200] mt-3 w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 bg-white dark:bg-[#0d1526] border border-slate-200 dark:border-white/[0.1] rounded-2xl shadow-2xl shadow-slate-900/15 dark:shadow-black/50 overflow-hidden text-left"
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-white/[0.06] bg-gradient-to-r from-indigo-600 to-violet-600">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                  <Volume2 size={14} className="text-white" />
                </div>
                <div>
                  <p className="text-[0.84rem] font-bold text-white">ImpulsoIQ Voice</p>
                  <p className="text-[0.68rem] text-indigo-200">
                    {listening ? 'Listening · Nova Sonic' : live ? 'Connected · Nova Sonic' : 'Pipeline, calls, and approvals'}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-white/70 hover:text-white transition-colors" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="px-4 py-3 max-h-[300px] overflow-y-auto flex flex-col gap-3">
              {messages.length === 0 && (
                <div className="py-8 text-center">
                  <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center mx-auto mb-3">
                    <Mic size={20} className="text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <p className="text-[0.84rem] font-semibold text-slate-700 dark:text-slate-300">Talk or type</p>
                  <p className="text-[0.75rem] text-slate-400 dark:text-slate-600 mt-1">
                    “What&apos;s in my pipeline?” · “Brief me on today”
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={`${m.ts}-${i}`} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
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

            <div className="px-3 pb-3 border-t border-slate-100 dark:border-white/[0.06] pt-2.5">
              {micHint && <p className="text-[0.72rem] text-amber-700 dark:text-amber-300 mb-1.5">{micHint}</p>}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={listening ? 'Listening…' : 'Type a message'}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input); } }}
                  className="flex-1 h-9 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition"
                />
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-label={listening ? 'Stop listening' : 'Speak'}
                  aria-pressed={listening}
                  className={cn(
                    'w-9 h-9 flex items-center justify-center rounded-xl transition-all',
                    listening
                      ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30'
                      : 'border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.05]',
                  )}
                >
                  <Mic size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void sendMessage(input)}
                  disabled={!input.trim() || loading}
                  aria-label="Send message"
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-all"
                >
                  <ArrowUp size={15} />
                </button>
              </div>
              <p className="text-center text-[0.67rem] text-slate-400 dark:text-slate-600 mt-1.5">
                Spoken and typed asks are logged the same way
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

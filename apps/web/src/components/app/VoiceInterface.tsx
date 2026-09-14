/**
 * Ambient Voice Interface — Phase 4A.
 *
 * Floating microphone button in the AppShell header. On click, opens a
 * voice session panel that captures browser microphone input, streams it
 * to the voice-bridge Lambda via WebSocket, and displays responses.
 *
 * TEXT MODE: the user types into the panel. Each message goes over the voice
 * WebSocket (VITE_VOICE_WS_URL) as {type:"text", message, sessionId}, and
 * voice-bridge answers {type:"response"} or {type:"error"}. Microphone capture
 * is not wired yet.
 *
 * AUTH: the socket opens with ?token=<Cognito ID token>&workspace=<slug>.
 * voice-bridge verifies the token on $connect and binds the connection to the
 * token's workspace; nothing tenant-shaped in a message is trusted. When the
 * token outlives its hour the bridge answers code "session_expired", and the
 * panel reconnects once with a fresh token and resends.
 *
 * This previously POSTed to /api/voice/message — a path that exists on no API
 * (it fell through to CloudFront and came back as index.html) — with a tenant
 * of 'demo' whenever none was passed, which was always. The tenant now comes
 * from the signed-in user's claim.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, X, Loader2, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/useAuth';
import { getCurrentToken } from '@/lib/auth/cognito';
import { currentTenantSlug } from '@/lib/tenant';

// Injected at build time from SSM (/impulsoiq/<env>/backend/voice_ws_url).
const VOICE_WS_URL = import.meta.env.VITE_VOICE_WS_URL ?? '';

interface BridgeMessage {
  type: 'processing' | 'response' | 'error' | 'pong';
  text?: string;
  error?: string;
  code?: string;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
  ts:   number;
}

export function VoiceInterface() {
  const { user } = useAuth();
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const wsRef         = useRef<WebSocket | null>(null);
  const connectingRef = useRef<Promise<WebSocket> | null>(null);
  // One conversation per panel lifetime, so the agent keeps context between turns.
  const sessionIdRef  = useRef<string>(crypto.randomUUID());
  // The message awaiting a reply, kept so an expired session can resend it once.
  const inFlightRef   = useRef<{ text: string; retried: boolean } | null>(null);
  const retryingRef   = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // The socket lives only while the panel is open.
  useEffect(() => {
    if (open) return;
    dropSocket();
  }, [open]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function push(role: Message['role'], text: string) {
    setMessages(p => [...p, { role, text, ts: Date.now() }]);
  }

  function dropSocket() {
    const ws = wsRef.current;
    wsRef.current = null;
    connectingRef.current = null;
    ws?.close();
  }

  function handleBridgeMessage(event: MessageEvent) {
    let msg: BridgeMessage;
    try { msg = JSON.parse(String(event.data)) as BridgeMessage; } catch { return; }

    if (msg.type === 'response') {
      inFlightRef.current = null;
      push('assistant', msg.text || "Sorry, I couldn't process that.");
      setLoading(false);
      return;
    }
    if (msg.type !== 'error') return;

    const inFlight = inFlightRef.current;
    if (msg.code === 'session_expired' && inFlight && !inFlight.retried) {
      // The bridge closes this connection; open a new one with a fresh token.
      inFlight.retried = true;
      retryingRef.current = true;
      dropSocket();
      void deliver(inFlight.text).finally(() => { retryingRef.current = false; });
      return;
    }
    inFlightRef.current = null;
    push('assistant', msg.error || 'Something went wrong. Please try again.');
    setLoading(false);
  }

  function openSocket(): Promise<WebSocket> {
    const current = wsRef.current;
    if (current && current.readyState === WebSocket.OPEN) return Promise.resolve(current);
    if (connectingRef.current) return connectingRef.current;

    const pending = (async () => {
      // getCurrentToken refreshes an expired ID token, so a reconnect always
      // presents a valid one.
      const token = await getCurrentToken();
      if (!token) throw new Error('signed out');
      const url = new URL(VOICE_WS_URL);
      url.searchParams.set('token', token);
      const workspace = currentTenantSlug();
      if (workspace) url.searchParams.set('workspace', workspace);

      return new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url.toString());
        ws.onopen = () => {
          wsRef.current = ws;
          connectingRef.current = null;
          resolve(ws);
        };
        // A refused $connect (401/403) surfaces here as a failed handshake.
        ws.onerror = () => {
          connectingRef.current = null;
          reject(new Error('assistant unreachable'));
        };
        ws.onclose = () => {
          if (wsRef.current === ws) wsRef.current = null;
          if (!retryingRef.current && inFlightRef.current) {
            inFlightRef.current = null;
            setLoading(false);
          }
        };
        ws.onmessage = handleBridgeMessage;
      });
    })();

    pending.catch(() => { connectingRef.current = null; });
    connectingRef.current = pending;
    return pending;
  }

  async function deliver(text: string) {
    try {
      const ws = await openSocket();
      ws.send(JSON.stringify({ type: 'text', message: text, sessionId: sessionIdRef.current }));
    } catch {
      inFlightRef.current = null;
      push('assistant', 'Could not reach the assistant. Please try again.');
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
    await deliver(text);
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
                    "What's in my pipeline?" · "Brief me on today"
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

/**
 * AppSync GraphQL real-time client for the Agent Control Panel.
 *
 * Uses the AppSync WebSocket protocol with a Cognito ID token. There is no
 * Amplify dependency — the handshake is small enough to own.
 *
 * https://docs.aws.amazon.com/appsync/latest/devguide/real-time-websocket-client.html
 */
import { getCurrentToken, getSessionUser } from '@/lib/auth/cognito';

const HTTP_URL = (import.meta.env.VITE_APPSYNC_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export interface AgentActionEvent {
  id: string;
  tenantId: string;
  agentRunId: string;
  agentType: string;
  action: string;
  status: string;
  occurredAt: string;
}

function realtimeUrl(httpUrl: string): { ws: string; host: string } | null {
  try {
    const u = new URL(httpUrl);
    const host = u.host;
    const wsHost = host.replace('appsync-api.', 'appsync-realtime-api.');
    return { ws: `wss://${wsHost}${u.pathname}`, host };
  } catch {
    return null;
  }
}

function b64(obj: unknown): string {
  return btoa(JSON.stringify(obj));
}

const SUBSCRIPTION = `subscription OnAgentAction($tenantId: String!) {
  onAgentAction(tenantId: $tenantId) {
    id tenantId agentRunId agentType action status occurredAt
  }
}`;

export function subscribeAgentActions(
  onEvent: (ev: AgentActionEvent) => void,
  onStatus: (live: boolean, detail?: string) => void,
): () => void {
  if (!HTTP_URL) {
    onStatus(false, 'VITE_APPSYNC_URL is not set');
    return () => undefined;
  }
  const parsed = realtimeUrl(HTTP_URL);
  if (!parsed) {
    onStatus(false, 'AppSync URL is invalid');
    return () => undefined;
  }

  let closed = false;
  let ws: WebSocket | null = null;
  let subId = '';

  void (async () => {
    const token = await getCurrentToken();
    const user = await getSessionUser();
    if (closed) return;
    if (!token || !user?.tenantId) {
      onStatus(false, 'Not signed in');
      return;
    }

    const header = b64({ host: parsed.host, Authorization: token });
    const payload = b64({});
    ws = new WebSocket(`${parsed.ws}?header=${header}&payload=${payload}`, ['graphql-ws']);

    ws.onopen = () => {
      ws?.send(JSON.stringify({ type: 'connection_init' }));
    };

    ws.onmessage = (msg) => {
      let frame: { type?: string; id?: string; payload?: { data?: { onAgentAction?: AgentActionEvent }; errors?: unknown } };
      try {
        frame = JSON.parse(String(msg.data)) as typeof frame;
      } catch {
        return;
      }
      if (frame.type === 'connection_ack') {
        subId = crypto.randomUUID();
        ws?.send(JSON.stringify({
          id: subId,
          type: 'start',
          payload: {
            data: JSON.stringify({
              query: SUBSCRIPTION,
              variables: { tenantId: user.tenantId },
            }),
            extensions: {
              authorization: { host: parsed.host, Authorization: token },
            },
          },
        }));
        onStatus(true);
        return;
      }
      if (frame.type === 'start_ack') {
        onStatus(true);
        return;
      }
      if (frame.type === 'error' || frame.payload?.errors) {
        onStatus(false, 'Subscription rejected');
        return;
      }
      const action = frame.payload?.data?.onAgentAction;
      if (action) onEvent(action);
    };

    ws.onerror = () => onStatus(false, 'WebSocket error');
    ws.onclose = () => {
      if (!closed) onStatus(false, 'Disconnected');
    };
  })();

  return () => {
    closed = true;
    if (ws && ws.readyState === WebSocket.OPEN && subId) {
      ws.send(JSON.stringify({ id: subId, type: 'stop' }));
    }
    ws?.close();
  };
}

export function appsyncConfigured(): boolean {
  return Boolean(HTTP_URL);
}

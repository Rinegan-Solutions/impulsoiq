/**
 * Advances a campaign sequence by one step.
 * Input: { steps, stepIndex } where stepIndex is the last completed index (-1 at start).
 */
export async function handler(event: {
  steps?: unknown;
  stepIndex?: number;
}): Promise<{
  done: boolean;
  type: string;
  waitSeconds: number;
  stepIndex: number;
  subject?: string;
  body?: string;
  title?: string;
}> {
  const steps = Array.isArray(event.steps) ? event.steps as Record<string, unknown>[] : [];
  const next = (typeof event.stepIndex === 'number' && Number.isFinite(event.stepIndex) ? event.stepIndex : -1) + 1;
  if (next >= steps.length) {
    return { done: true, type: 'done', waitSeconds: 0, stepIndex: next, subject: '', body: '', title: '' };
  }
  const step = steps[next] ?? {};
  const type = String(step.type ?? 'email');
  let waitSeconds = Number(step.waitSeconds ?? 0);
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0) waitSeconds = 0;
  if (type === 'wait' && waitSeconds < 1) waitSeconds = 1;
  return {
    done: false,
    type,
    waitSeconds,
    stepIndex: next,
    subject: typeof step.subject === 'string' ? step.subject : '',
    body: typeof step.body === 'string' ? step.body : '',
    title: typeof step.title === 'string' ? step.title : '',
  };
}

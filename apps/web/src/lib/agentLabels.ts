/**
 * Agent type labels, shared.
 *
 * These used to live inside AgentControlPanel, which meant the run detail view
 * and the research history would each have grown their own copy and drifted.
 * The keys are the `agent_type` CHECK roster in modules/data/schema.sql — if a
 * new agent is added there and not here, the raw snake_case name is shown rather
 * than a blank.
 */
export const AGENT_LABEL: Record<string, string> = {
  research_enrichment: 'Research',
  outreach:            'Outreach',
  voice:               'Voice',
  nurture:             'Nurture',
  clarification:       'Clarify',
  coordinator:         'Coord',
  forecasting_insight: 'Forecast',
  data_hygiene:        'Hygiene',
  ambient_interface:   'Ambient',
  deep_research:       'Research+',
  signal_listening:    'Signals',
  triage_escalation:   'Triage',
  resolution:          'Resolve',
  support_insight:     'Support',
};

/** Longer form, for headings where there is room for a real name. */
export const AGENT_FULL_LABEL: Record<string, string> = {
  research_enrichment: 'Research & enrichment',
  outreach:            'Outreach',
  voice:               'Voice call',
  nurture:             'Nurture',
  clarification:       'Clarification',
  coordinator:         'Coordinator',
  forecasting_insight: 'Forecasting insight',
  data_hygiene:        'Data hygiene',
  ambient_interface:   'Ambient assistant',
  deep_research:       'Deep research',
  signal_listening:    'Signal listening',
  triage_escalation:   'Triage & escalation',
  resolution:          'Resolution',
  support_insight:     'Support insight',
};

export function agentLabel(type: string): string {
  return AGENT_LABEL[type] ?? type;
}

export function agentFullLabel(type: string): string {
  return AGENT_FULL_LABEL[type] ?? type.replace(/_/g, ' ');
}

/** Runs long enough that a person starts them and leaves. */
export const LONG_RUNNING_AGENTS = new Set(['deep_research', 'forecasting_insight', 'support_insight']);

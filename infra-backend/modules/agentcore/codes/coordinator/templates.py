"""
Phase 5 workspace template definitions.

These are the canonical definitions of all 5 workspace templates.
Zero new agents — existing agents are reconfigured by injecting these
definitions into the SFN execution context as templateContext.

The Coordinator reads templateContext and:
  1. Overrides brandVoiceProfile for the Outreach agent
  2. Enforces complianceRules in pre-action checks
  3. Applies approvalGateConfig to every send/call step
  4. Restricts call types to template's allowed list

Template ACTIVATIONS (tenant-specific) are stored in the DSQL
workspace_template table. The definitions below never change per-tenant.
"""
from typing import Any

WORKSPACE_TEMPLATES: dict[str, dict[str, Any]] = {

    # ── 5A: Recruiting Coordination ─────────────────────────────────────────
    "recruiting_coordination": {
        "name":        "Recruiting Coordination",
        "persona":     "Ines",
        "phase":       "5A",
        "description": (
            "Interview confirmation, candidate outreach, and offer follow-up. "
            "v3 update: the Phase 2A contact-verification discipline applies to "
            "candidate contact information — the Research & Enrichment agent verifies "
            "candidate emails before any outreach; unverified emails route to human review."
        ),
        "agents":      ["research-enrichment", "outreach", "voice", "nurture"],

        "goalTemplate": (
            "Coordinate recruiting touchpoints for candidate {candidateName} "
            "applying for {role}. Goal: confirm interview, follow up on offer."
        ),

        # Tone overrides the sales default
        "brandVoiceProfile": (
            "professional, warm, candidate-experience-focused, empathetic. "
            "Always respectful of the candidate's time and privacy. "
            "Never pressure — this is invitation, not persuasion."
        ),

        "complianceRules": {
            "jurisdiction":         "employment_communications",
            "channels":             ["email", "call"],
            "requiredElements":     ["opt_out_link", "company_identity"],
            "prohibitedContent":    ["compensation_disclosure_without_approval",
                                     "aggressive_language"],
            "regulatoryFramework":  "employment_communications",
            "toneFixed":            False,
            # v3: same verification discipline from Phase 2A applies to candidates
            "emailVerificationRequired": True,
            "unverifiedEmailAction":     "force_human_review",
        },

        "approvalGateConfig": {
            # Stricter than sales: every interview schedule change needs human
            "mode":              "every_action",
            "requiresHumanFor":  ["interview_reschedule", "offer_extension",
                                   "rejection_communication"],
        },

        "triggerSource":  "new_candidate",
        "callTypes":      ["interview_confirmation", "scheduling", "offer_follow_up"],
        "maxTouches":     6,
        "requiresLegalReview": False,
    },

    # ── 5B: Accounts Receivable ─────────────────────────────────────────────
    # STRICTEST GUARDRAILS IN THE ENTIRE SYSTEM.
    # Must be reviewed by legal before activating for any tenant/region.
    "accounts_receivable": {
        "name":        "Accounts Receivable Follow-up",
        "persona":     "Renata",
        "phase":       "5B",
        "description": (
            "Payment reminder messages and calls — tone is fixed, escalation "
            "is deterministic. Legal review required before activation."
        ),
        "agents":      ["outreach", "voice", "nurture"],

        "goalTemplate": (
            "Follow up on overdue invoice #{invoiceNumber} for ${amount} "
            "due {dueDate} from {companyName}."
        ),

        # FIXED tone — cannot be overridden by LLM or tenant
        "brandVoiceProfile": (
            "polite, non-aggressive, informational, professional. "
            "FIXED TONE: the agent has ZERO discretion to escalate tone based on "
            "invoice lateness or amount. Escalation is handled by the deterministic "
            "escalation ladder, never by tone changes."
        ),

        "complianceRules": {
            "jurisdiction":                   "debt_communications",
            "toneFixed":                      True,   # HARD RULE — non-negotiable
            "prohibitedContent":              ["threatening_language", "harassment",
                                               "false_urgency", "false_statements",
                                               "misrepresentation"],
            # Deterministic escalation — NOT LLM judgment
            "escalationLadder": [
                {"daysOverdue": 0,  "action": "send_reminder_email"},
                {"daysOverdue": 7,  "action": "send_follow_up_email"},
                {"daysOverdue": 14, "action": "place_courtesy_call"},
                {"daysOverdue": 30, "action": "escalate_to_human"},   # ALWAYS human beyond 30d
            ],
            "callEscalationThreshold": {
                "daysOverdue": 30,
                "amountUsd":   5000,
                # EITHER condition triggers mandatory human escalation
            },
            "escalateToHumanBeyondThreshold": True,
            "fdcpaCompliant":          True,
            "regulatoryFramework":     "FDCPA_adjacent",
            "requiresLegalReview":     True,
            "gdprApplicable":          True,
        },

        "approvalGateConfig": {
            "mode":             "every_action",
            "requiresHumanFor": ["every_call", "legal_escalation", "every_send"],
        },

        "triggerSource":       "overdue_invoice",
        "callTypes":           ["payment_reminder", "payment_status_check"],
        "maxTouches":          4,
        "requiresLegalReview": True,
        "warningLabel":        "Requires legal review before activation",
    },

    # ── 5C: Vendor / Ops Coordination ───────────────────────────────────────
    "vendor_ops_coordination": {
        "name":        "Vendor & Ops Coordination",
        "persona":     "Tomás",
        "phase":       "5C",
        "description": (
            "Automated supplier status checks and delivery confirmations. "
            "Extracts structured status (on_schedule / delayed / new_eta)."
        ),
        "agents":      ["outreach", "voice"],

        "goalTemplate": (
            "Check delivery status for order #{orderNumber} expected {expectedDate} "
            "from vendor {vendorName}."
        ),

        "brandVoiceProfile": (
            "professional, concise, operational. Focus on structured status extraction. "
            "No persuasion — this is an information-gathering workflow."
        ),

        "complianceRules": {
            "jurisdiction":   "business_to_business",
            "channels":       ["email", "call"],
            "toneFixed":      False,
            "resultSchema":   {
                "status":  ["on_schedule", "delayed", "cancelled", "unknown"],
                "new_eta": "optional_date_string",
            },
        },

        "approvalGateConfig": {
            "mode": "exceptions_only",
            "requiresHumanFor": ["order_cancellation_confirmed"],
        },

        "triggerSource":       "pending_delivery",
        "callTypes":           ["delivery_confirmation", "status_check"],
        "maxTouches":          3,
        "requiresLegalReview": False,
    },

    # ── 5D: Appointment Scheduling & Reminders ───────────────────────────────
    "appointment_scheduling": {
        "name":        "Appointment Scheduling & Reminders",
        "persona":     "Sam",
        "phase":       "5D",
        "description": (
            "Confirmation messages and reminder calls for service businesses. "
            "Highest volume, lowest complexity — most automated configuration."
        ),
        "agents":      ["outreach", "voice"],

        "goalTemplate": (
            "Confirm appointment for {clientName} on {appointmentDate} "
            "at {appointmentTime} for {service}."
        ),

        "brandVoiceProfile": (
            "friendly, warm, efficient, service-business appropriate. "
            "Outcomes are binary: confirmed, reschedule requested, or cancelled."
        ),

        "complianceRules": {
            "jurisdiction":  "commercial_services",
            "channels":      ["sms", "call"],
            "toneFixed":     False,
            "resultSchema":  {
                "status": ["confirmed", "reschedule_requested", "cancelled", "no_response"],
                "new_time_preference": "optional_string",
            },
        },

        "approvalGateConfig": {
            # Least approval-gated configuration in the system
            "mode": "never",
        },

        "triggerSource":       "upcoming_appointment",
        "callTypes":           ["appointment_reminder", "appointment_confirmation"],
        "maxTouches":          2,
        "requiresLegalReview": False,
    },

    # ── 5E: Customer Success Renewal & Save Motion ───────────────────────────
    "customer_success_renewal": {
        "name":        "Customer Success & Renewal",
        "persona":     "Grace",
        "phase":       "5E",
        "description": (
            "Churn prevention, renewal reminders, and save calls triggered by "
            "usage-decline signals or upcoming renewal dates."
        ),
        "agents":      ["research-enrichment", "outreach", "voice", "nurture",
                        "forecasting-insight"],

        "goalTemplate": (
            "Proactive check-in with {contactName} at {companyName}. "
            "Renewal in {daysToRenewal} days. Usage signal: {usageSignal}."
        ),

        "brandVoiceProfile": (
            "consultative, value-oriented, empathetic, outcome-focused. "
            "Lead with customer value and outcomes — not renewal pressure. "
            "Goal: understand their situation and demonstrate ongoing value."
        ),

        "complianceRules": {
            "jurisdiction":      "commercial_communications",
            "channels":          ["email", "call"],
            "requiredElements":  ["unsubscribe_option"],
            "toneFixed":         False,
        },

        "approvalGateConfig": {
            "mode": "first_n",
            "n":    3,
            "requiresHumanFor": ["save_call_high_value_account"],
        },

        # Different trigger source — usage decline OR renewal approaching
        "triggerSource": "usage_decline_or_renewal_approaching",
        "callTypes":     ["check_in", "renewal_discussion", "save_call"],
        "maxTouches":    8,

        # Renewal-specific triggers
        "specialTrigger": {
            "usageDeclineThreshold": 0.30,  # 30% drop vs prior period
            "renewalWindowDays":     60,    # activate 60 days before renewal
        },

        "requiresLegalReview": False,
    },
}


def get_template(template_key: str) -> dict:
    """Return template definition or raise KeyError for unknown keys."""
    if template_key not in WORKSPACE_TEMPLATES:
        raise KeyError(f"Unknown workspace template: {template_key!r}. "
                       f"Valid keys: {list(WORKSPACE_TEMPLATES)}")
    return WORKSPACE_TEMPLATES[template_key]


def get_compliance_rules(template_key: str) -> dict:
    return get_template(template_key).get("complianceRules", {})


def requires_legal_review(template_key: str) -> bool:
    return get_template(template_key).get("requiresLegalReview", False)


def is_escalation_required(
    template_key: str,
    days_overdue: int = 0,
    amount_usd: float = 0.0,
) -> bool:
    """
    For 5B (accounts_receivable): returns True if the call must be
    escalated to a human instead of placed automatically.
    This is a DETERMINISTIC check — never LLM judgment.
    """
    rules = get_compliance_rules(template_key)
    threshold = rules.get("callEscalationThreshold", {})
    if not threshold:
        return False
    return (
        days_overdue >= threshold.get("daysOverdue", 999)
        or amount_usd >= threshold.get("amountUsd", float("inf"))
    )

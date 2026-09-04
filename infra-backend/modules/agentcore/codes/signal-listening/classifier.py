"""
Stage 1: Nova Micro first-pass signal classifier.

This is the cheap, high-volume gate that filters raw public signals before
they reach the expensive Research & Enrichment pipeline. Almost everything
gets filtered out here — that's the point.

Model: amazon.nova-micro-v1:0 (cheapest tier, no reasoning, binary output)
Volume: hundreds of raw signals → single-digit promoted candidates
Cost:   ~$0.0001 per classification (Nova Micro pricing)

DESIGN CONSTRAINT: This classifier identifies COMPANIES and BUSINESS PAIN
SIGNALS only. It NEVER attempts to deanonymize private individuals from
their social media post history. An anonymous poster's employer is NOT
inferred. Only named-company mentions or named-brand-complaint mentions are
considered valid signals. (v3 spec §Phase 4, 4C — permanent design constraint.)
"""
import json
import os
import boto3

REGION = os.environ.get("AWS_REGION", "eu-west-2")

# Nova Micro — cheapest tier, purpose-built for simple classification
# Overridable so the deployment picks the model, like every other agent.
# The us.* default was a US-only inference profile and does not resolve in
# eu-west-2; Terraform sets SIGNAL_CLASSIFIER_MODEL to the in-region id.
CLASSIFIER_MODEL = os.environ.get("SIGNAL_CLASSIFIER_MODEL", "amazon.nova-micro-v1:0")

# Daily token budget per tenant (hard-coded, not agent-discretionary per v3 spec)
DAILY_STAGE1_TOKEN_BUDGET = int(os.environ.get("SIGNAL_DAILY_STAGE1_TOKENS", "500000"))

CLASSIFIER_PROMPT = """\
You are a relevance classifier for a B2B sales intelligence system.

Read this public signal and answer ONLY with a JSON object.

Signal:
{signal_text}

Answer this question: Does this signal mention a NAMED COMPANY (not an anonymous user)
experiencing a business problem that a B2B sales/CRM/outreach software platform might solve?

Examples of qualifying signals:
- A company's job posting for "Head of Sales Operations" (growth signal)
- A named company's press release about expanding to new markets (growth signal)
- A Reddit post where someone says "at my company [Company Name] we're struggling with..." (pain signal)
- An industry forum post naming a company that switched CRM providers (intent signal)

Examples of NON-qualifying signals:
- An anonymous user's complaint (no company name, cannot identify)
- General industry news without a specific company focus
- A company you already know is a customer or in your CRM

Respond ONLY with this JSON:
{{
  "qualifies": true or false,
  "company_name": "The Named Company" or null,
  "signal_type": "job_posting" | "press_release" | "forum_pain_signal" | "news_signal" | null,
  "pain_summary": "One sentence describing the business pain" or null,
  "confidence": 0.0-1.0
}}
"""


def classify_signal(signal_text: str, bedrock_client=None) -> dict:
    """
    Pass one raw signal through Nova Micro for binary relevance classification.

    Returns:
        { qualifies: bool, company_name: str|None, signal_type: str|None,
          pain_summary: str|None, confidence: float }
    """
    if bedrock_client is None:
        bedrock_client = boto3.client("bedrock-runtime", region_name=REGION)

    prompt = CLASSIFIER_PROMPT.format(signal_text=signal_text[:2000])  # cap at 2K chars

    try:
        response = bedrock_client.invoke_model(
            modelId    = CLASSIFIER_MODEL,
            body       = json.dumps({
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 200,
                "temperature": 0.0,  # deterministic for classification
            }),
            contentType = "application/json",
            accept      = "application/json",
        )
        body   = json.loads(response["body"].read())
        text   = body.get("content", [{}])[0].get("text", "{}").strip()

        # Extract JSON from the response
        if text.startswith("{"):
            result = json.loads(text)
        else:
            # Fallback: look for JSON block
            import re
            match = re.search(r"\{.*\}", text, re.DOTALL)
            result = json.loads(match.group()) if match else {}

        return {
            "qualifies":    bool(result.get("qualifies", False)),
            "company_name": result.get("company_name"),
            "signal_type":  result.get("signal_type"),
            "pain_summary": result.get("pain_summary"),
            "confidence":   float(result.get("confidence", 0.0)),
        }

    except Exception as e:
        # On error: fail closed (don't promote the signal)
        print(f"classifier: error processing signal — failing closed: {e}")
        return {"qualifies": False, "company_name": None, "signal_type": None,
                "pain_summary": None, "confidence": 0.0}


def batch_classify(signals: list[dict], bedrock_client=None) -> list[dict]:
    """
    Classify a batch of raw signals. Returns only the qualifying ones.
    Filters out any signal with confidence < 0.7 even if qualifies=True.
    """
    if bedrock_client is None:
        bedrock_client = boto3.client("bedrock-runtime", region_name=REGION)

    promoted = []
    for signal in signals:
        text   = signal.get("text", "")
        source = signal.get("source", "unknown")
        url    = signal.get("url", "")

        result = classify_signal(text, bedrock_client)

        if result["qualifies"] and result["confidence"] >= 0.7:
            promoted.append({
                "rawText":    text[:500],  # keep only a snippet for the synthesis step
                "source":     source,
                "url":        url,
                "companyName":  result["company_name"],
                "signalType":   result["signal_type"],
                "painSummary":  result["pain_summary"],
                "confidence":   result["confidence"],
            })

    return promoted

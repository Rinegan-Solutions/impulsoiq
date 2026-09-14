"""
Company search backends for Deep Research.

Licensed enrichment URLs in this repo are contact-lookup endpoints, not a
company-search API. When that POST /search is missing, research still has to
return *named, citable* companies — Wikipedia, Wikidata, GDELT, and (in US
regions) Nova web grounding. Invented "Company 1" stubs stay last-resort and
off-prod only.
"""
from __future__ import annotations

import html
import json
import logging
import os
import re
from typing import Any
from urllib.parse import quote

import httpx

log = logging.getLogger("impulsoiq.research_search")

UA = (
    "ImpulsoIQ-DeepResearch/1.0 "
    "(https://impulsoiq.rinegansolutions.com; research-agent)"
)
HEADERS = {"User-Agent": UA, "Accept": "application/json"}


def _row(
    company: str,
    *,
    source: str,
    reason: str = "",
    url: str = "",
    confidence: float = 0.65,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    name = (company or "").strip()
    item = {
        "company": name,
        "company_name": name,
        "reason": reason or name,
        "source": source,
        "url": url,
        "signal": reason or name,
        "confidence": round(max(0.0, min(1.0, confidence)), 2),
    }
    if extra:
        item.update(extra)
    return item


def _dedupe(rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in rows:
        key = re.sub(r"[^a-z0-9]+", "", (row.get("company") or "").lower())
        if len(key) < 3 or key in seen:
            continue
        seen.add(key)
        out.append(row)
        if len(out) >= limit:
            break
    return out


def _json_array(text: str) -> list[Any]:
    blob = (text or "").strip()
    start, end = blob.find("["), blob.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(blob[start : end + 1])
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


_COURT = re.compile(r"\sv\.\s", re.I)
_TOPIC = re.compile(r"^(list of|history of|timeline of)\b", re.I)
_ORG = re.compile(
    r"\b(company|corporation|inc\.?|ltd\.?|limited|gmbh|plc|firm|provider|"
    r"vendor|startup|software|consulting|holdings|group)\b",
    re.I,
)

_VERTICALS = [
    (["emr", "ehr", "healthtech", "health tech", "healthcare", "health care"],
     "electronic health record software companies"),
    (["financial services", "fintech", "banking", "payments"],
     "financial technology companies"),
    (["fmcg", "consumer goods", "cpg"],
     "fast-moving consumer goods companies"),
    (["supply chain", "logistics", "scm"],
     "supply chain management software companies"),
    (["saas", "software"],
     "enterprise software companies"),
    (["consult", "product development", "delivery organization"],
     "information technology consulting companies"),
]


def query_variants(query: str) -> list[str]:
    raw = (query or "").strip()
    out: list[str] = []
    seen: set[str] = set()

    def add(text: str) -> None:
        t = re.sub(r"\s+", " ", text).strip(" \"'")
        key = t.lower()
        if len(t) < 4 or key in seen:
            return
        seen.add(key)
        out.append(t)

    if len(raw) <= 80:
        add(raw)
    lower = raw.lower()
    for keys, expanded in _VERTICALS:
        if any(k in lower for k in keys):
            add(expanded)
    if len(raw) <= 80:
        for part in re.split(r"\b(?:AND|OR|,|;)\b", raw):
            add(f"{part} company")
    return out or ([raw] if raw else [])


def _org_page(title: str, snippet: str) -> bool:
    if _COURT.search(title) or _TOPIC.search(title):
        return False
    blob = f"{title} {snippet}"
    return bool(_ORG.search(blob))


def wikipedia_search(query: str, limit: int) -> list[dict[str, Any]]:
    q = (query or "").strip()[:180]
    if not q:
        return []
    try:
        resp = httpx.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": q,
                "srlimit": min(max(limit, 5), 20),
                "format": "json",
                "utf8": 1,
            },
            headers=HEADERS,
            timeout=12,
        )
        if resp.status_code != 200:
            log.warning("wikipedia http %s", resp.status_code)
            return []
        hits = (resp.json().get("query") or {}).get("search") or []
    except Exception as exc:  # noqa: BLE001
        log.warning("wikipedia search failed: %s", exc)
        return []

    rows: list[dict[str, Any]] = []
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        title = str(hit.get("title") or "").strip()
        if not title:
            continue
        snippet = html.unescape(re.sub("<[^>]+>", "", str(hit.get("snippet") or "")))
        snippet = re.sub(r"\s+", " ", snippet).strip()
        if not _org_page(title, snippet):
            continue
        url = f"https://en.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}"
        rows.append(_row(
            title,
            source="wikipedia",
            reason=snippet or f"Wikipedia match for {q}",
            url=url,
            confidence=0.62,
        ))
    return rows


def wikidata_search(query: str, limit: int) -> list[dict[str, Any]]:
    q = (query or "").strip()[:120]
    if not q:
        return []
    # Search entities, then keep organisations / businesses.
    try:
        resp = httpx.get(
            "https://www.wikidata.org/w/api.php",
            params={
                "action": "wbsearchentities",
                "search": q,
                "language": "en",
                "type": "item",
                "limit": min(max(limit, 5), 20),
                "format": "json",
            },
            headers=HEADERS,
            timeout=12,
        )
        if resp.status_code != 200:
            return []
        hits = resp.json().get("search") or []
    except Exception as exc:  # noqa: BLE001
        log.warning("wikidata search failed: %s", exc)
        return []

    rows: list[dict[str, Any]] = []
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        label = str(hit.get("label") or "").strip()
        desc = str(hit.get("description") or "").strip().lower()
        if not label:
            continue
        orgish = any(w in desc for w in (
            "compan", "business", "enterprise", "corporation", "saas",
            "software", "consult", "health", "bank", "logistics", "retail",
            "manufacturer", "provider", "platform", "firm",
        ))
        if desc and not orgish:
            continue
        qid = str(hit.get("id") or "")
        url = f"https://www.wikidata.org/wiki/{qid}" if qid else ""
        rows.append(_row(
            label,
            source="wikidata",
            reason=str(hit.get("description") or f"Wikidata match for {q}"),
            url=url,
            confidence=0.68,
        ))
    return rows


def gdelt_search(query: str, limit: int) -> list[dict[str, Any]]:
    q = (query or "").strip()[:160]
    if not q:
        return []
    try:
        resp = httpx.get(
            "https://api.gdeltproject.org/api/v2/doc/doc",
            params={
                "query": q,
                "mode": "ArtList",
                "maxrecords": min(max(limit * 2, 10), 50),
                "timespan": "90d",
                "format": "json",
                "sort": "DateDesc",
            },
            headers=HEADERS,
            timeout=20,
        )
        if resp.status_code != 200:
            log.warning("gdelt http %s", resp.status_code)
            return []
        payload = resp.json()
        articles = payload.get("articles") if isinstance(payload, dict) else []
        if not isinstance(articles, list):
            articles = []
    except Exception as exc:  # noqa: BLE001
        log.warning("gdelt search failed: %s", exc)
        return []

    rows: list[dict[str, Any]] = []
    for art in articles:
        if not isinstance(art, dict):
            continue
        title = str(art.get("title") or "").strip()
        url = str(art.get("url") or "").strip()
        domain = str(art.get("domain") or "").strip()
        if not title:
            continue
        company = _company_from_headline(title) or domain.split(".")[0].replace("-", " ").title()
        if not company or company.lower() in {"www", "news", "blog"}:
            continue
        rows.append(_row(
            company,
            source="gdelt",
            reason=title,
            url=url,
            confidence=0.58,
            extra={"seenAt": art.get("seendate"), "domain": domain},
        ))
    return rows


_NOISE = re.compile(
    r"\b(the|a|an|and|or|for|with|from|after|raises|raised|launches|launch|"
    r"announces|announce|funding|series|round|report|says|new)\b",
    re.I,
)


def _company_from_headline(title: str) -> str:
    # "Acme Health raises Series B" → Acme Health
    left = re.split(r"\b(?:raises|raised|launches|launch|announces|to acquire|acquires)\b", title, maxsplit=1, flags=re.I)[0]
    left = re.sub(r"[:|–—-].*$", "", left).strip(" .,-")
    left = _NOISE.sub(" ", left)
    left = re.sub(r"\s+", " ", left).strip(" .,-")
    if 2 <= len(left) <= 80:
        return left
    return ""


def nova_grounded_search(query: str, strategy: str, limit: int) -> list[dict[str, Any]]:
    """Nova 2 web grounding — US CRIS only; fail closed to [] on any error."""
    region = os.environ.get("RESEARCH_GROUNDING_REGION", "us-east-1")
    model_id = os.environ.get("RESEARCH_GROUNDING_MODEL", "us.amazon.nova-2-lite-v1:0")
    prompt = (
        f"Find up to {limit} real companies matching this research need.\n"
        f"Strategy: {strategy}\n"
        f"Query: {query}\n\n"
        "Use web grounding. Only name companies you can cite from search results. "
        "Never invent names. Reply with a JSON array only, no markdown:\n"
        '[{"company":"...","reason":"...","url":"https://...","confidence":0.0}]\n'
        "confidence is 0-1. url must be a real source you grounded on."
    )
    try:
        import boto3
        from botocore.config import Config

        bedrock = boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=Config(read_timeout=120, retries={"max_attempts": 2}),
        )
        resp = bedrock.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            toolConfig={"tools": [{"systemTool": {"name": "nova_grounding"}}]},
            inferenceConfig={"maxTokens": 2500},
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("nova grounding failed: %s", exc)
        return []

    text = ""
    for block in ((resp.get("output") or {}).get("message") or {}).get("content") or []:
        if isinstance(block, dict) and block.get("text"):
            text += str(block["text"])
    rows: list[dict[str, Any]] = []
    for item in _json_array(text):
        if not isinstance(item, dict):
            continue
        name = str(item.get("company") or item.get("company_name") or "").strip()
        if not name:
            continue
        try:
            conf = float(item.get("confidence") or 0.7)
        except (TypeError, ValueError):
            conf = 0.7
        rows.append(_row(
            name,
            source="nova_grounding",
            reason=str(item.get("reason") or query),
            url=str(item.get("url") or ""),
            confidence=conf,
        ))
    return rows


def licensed_search(url: str, key: str, query: str, strategy: str, limit: int) -> list[dict[str, Any]]:
    try:
        resp = httpx.post(
            f"{url.rstrip('/')}/search",
            json={"query": query, "strategy": strategy, "limit": limit},
            headers={"X-API-Key": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )
        if resp.status_code != 200:
            log.warning("licensed search http %s", resp.status_code)
            return []
        payload = resp.json()
        results = payload.get("results") if isinstance(payload, dict) else payload
        if not isinstance(results, list):
            return []
    except Exception as exc:  # noqa: BLE001
        log.warning("licensed search failed: %s", exc)
        return []

    rows: list[dict[str, Any]] = []
    for item in results[:limit]:
        if isinstance(item, str):
            rows.append(_row(item, source="search_api", reason=query, confidence=0.7))
            continue
        if not isinstance(item, dict):
            continue
        name = str(item.get("company") or item.get("company_name") or item.get("name") or "").strip()
        if not name:
            continue
        rows.append(_row(
            name,
            source="search_api",
            reason=str(item.get("reason") or item.get("signal") or query),
            url=str(item.get("url") or item.get("website") or ""),
            confidence=float(item.get("confidence") or 0.7),
        ))
    return rows


def search_companies(query: str, strategy: str, limit: int) -> tuple[list[dict[str, Any]], list[str]]:
    """Run public (and optional licensed/Nova) backends. Returns (rows, sources_tried)."""
    tried: list[str] = []
    collected: list[dict[str, Any]] = []
    kind = (strategy or "").lower()
    variants = query_variants(query)

    def take(name: str, rows: list[dict[str, Any]]) -> None:
        if name not in tried:
            tried.append(name)
        collected.extend(rows)

    per = max(2, min(4, max(limit // max(len(variants), 1), 2)))
    gdelt_done = False
    for variant in variants:
        if kind in ("news_signal", "news_signals"):
            if not gdelt_done:
                take("gdelt", gdelt_search(variant, per))
                gdelt_done = True
            take("wikipedia", wikipedia_search(variant, per))
        else:
            take("wikipedia", wikipedia_search(variant, per))
            take("wikidata", wikidata_search(variant, per))
        if len(_dedupe(collected, limit)) >= limit:
            break

    merged = _dedupe(collected, limit)
    if len(merged) < max(3, limit // 2):
        take("nova_grounding", nova_grounded_search(query, strategy, limit))
        merged = _dedupe(collected, limit)
    return merged, tried


_WIKIDATA_ROLES = {
    "P169": "Chief Executive Officer",
    "P112": "Founder",
    "P488": "Chairperson",
    "P1037": "Director",
}


def _split_person(full: str) -> tuple[str, str] | None:
    cleaned = re.sub(r"\s+", " ", (full or "").strip())
    cleaned = re.sub(r"\s*\([^)]*\)\s*", " ", cleaned).strip(" ,.")
    if any(ch.isdigit() for ch in cleaned):
        return None
    parts = [p for p in cleaned.split(" ") if p and p.lower() not in {"inc", "inc.", "ltd", "llc", "the", "plc"}]
    if len(parts) < 2 or len(cleaned) < 5 or len(cleaned) > 80:
        return None
    if not parts[0][0].isupper() or not parts[-1][0].isupper():
        return None
    return parts[0], " ".join(parts[1:])


def _person_row(name: str, title: str, source: str, url: str = "") -> dict[str, Any] | None:
    split = _split_person(name)
    if not split:
        return None
    first, last = split
    return {
        "name": f"{first} {last}",
        "firstName": first,
        "lastName": last,
        "title": (title or "").strip()[:120],
        "source": source,
        "url": url,
    }


def _wikidata_qid(company: str) -> str:
    q = (company or "").strip()[:120]
    if not q:
        return ""
    try:
        resp = httpx.get(
            "https://www.wikidata.org/w/api.php",
            params={
                "action": "wbsearchentities",
                "search": q,
                "language": "en",
                "type": "item",
                "limit": 5,
                "format": "json",
            },
            headers=HEADERS,
            timeout=12,
        )
        if resp.status_code != 200:
            return ""
        hits = resp.json().get("search") or []
    except Exception as exc:  # noqa: BLE001
        log.warning("wikidata qid failed: %s", exc)
        return ""
    want = re.sub(r"[^a-z0-9]+", "", q.lower())
    for hit in hits:
        if not isinstance(hit, dict):
            continue
        label = str(hit.get("label") or "")
        key = re.sub(r"[^a-z0-9]+", "", label.lower())
        if key == want or want in key or key in want:
            return str(hit.get("id") or "")
    if hits and isinstance(hits[0], dict):
        return str(hits[0].get("id") or "")
    return ""


def wikidata_people(company: str, limit: int = 6) -> list[dict[str, Any]]:
    qid = _wikidata_qid(company)
    if not qid:
        return []
    props = " ".join(f"wdt:{p}" for p in _WIKIDATA_ROLES)
    sparql = f"""
    SELECT DISTINCT ?personLabel ?prop WHERE {{
      wd:{qid} ?prop ?person .
      VALUES ?prop {{ {props} }}
      ?person wdt:P31 wd:Q5 .
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
    }} LIMIT {max(1, min(limit, 8))}
    """
    try:
        resp = httpx.get(
            "https://query.wikidata.org/sparql",
            params={"query": sparql, "format": "json"},
            headers={**HEADERS, "Accept": "application/sparql-results+json"},
            timeout=20,
        )
        if resp.status_code != 200:
            log.warning("wikidata people http %s", resp.status_code)
            return []
        bindings = ((resp.json().get("results") or {}).get("bindings") or [])
    except Exception as exc:  # noqa: BLE001
        log.warning("wikidata people failed: %s", exc)
        return []

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for bind in bindings:
        if not isinstance(bind, dict):
            continue
        name = str(((bind.get("personLabel") or {}).get("value") or "")).strip()
        prop = str(((bind.get("prop") or {}).get("value") or ""))
        code = prop.rsplit("/", 1)[-1]
        title = _WIKIDATA_ROLES.get(code, "Executive")
        row = _person_row(name, title, "wikidata", f"https://www.wikidata.org/wiki/{qid}")
        if not row:
            continue
        key = re.sub(r"[^a-z0-9]+", "", row["name"].lower())
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)
    return rows


def nova_people(company: str, limit: int = 4) -> list[dict[str, Any]]:
    region = os.environ.get("RESEARCH_GROUNDING_REGION", "us-east-1")
    model_id = os.environ.get("RESEARCH_GROUNDING_MODEL", "us.amazon.nova-2-lite-v1:0")
    prompt = (
        f"Name up to {limit} real people who lead or founded {company} "
        "(CEO, founder, president, CRO, VP sales). "
        "Use web grounding. Only people you can cite. Never invent names or emails. "
        "JSON array only:\n"
        '[{"name":"First Last","title":"...","url":"https://..."}]'
    )
    try:
        import boto3
        from botocore.config import Config

        bedrock = boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=Config(read_timeout=45, retries={"max_attempts": 1}),
        )
        resp = bedrock.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            toolConfig={"tools": [{"systemTool": {"name": "nova_grounding"}}]},
            inferenceConfig={"maxTokens": 1200},
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("nova people failed for %s: %s", company, exc)
        return []

    text = ""
    for block in ((resp.get("output") or {}).get("message") or {}).get("content") or []:
        if isinstance(block, dict) and block.get("text"):
            text += str(block["text"])
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in _json_array(text):
        if not isinstance(item, dict):
            continue
        row = _person_row(
            str(item.get("name") or ""),
            str(item.get("title") or "Executive"),
            "nova_grounding",
            str(item.get("url") or ""),
        )
        if not row:
            continue
        key = re.sub(r"[^a-z0-9]+", "", row["name"].lower())
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)
        if len(rows) >= limit:
            break
    return rows


def search_people(company: str, limit: int = 4) -> list[dict[str, Any]]:
    """Public officers for a named company. Empty is allowed — never invent people."""
    cap = max(1, min(int(limit or 4), 6))
    collected = wikidata_people(company, cap)
    if len(collected) < 2:
        for row in nova_people(company, cap):
            key = re.sub(r"[^a-z0-9]+", "", row["name"].lower())
            if any(re.sub(r"[^a-z0-9]+", "", r["name"].lower()) == key for r in collected):
                continue
            collected.append(row)
            if len(collected) >= cap:
                break
    return collected[:cap]


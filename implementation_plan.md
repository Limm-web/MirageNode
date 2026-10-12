# MIRAGE-NODE :: Implementation Plan (living blueprint)

> This document tracks the long-term roadmap referenced by `README.md`.
> Checked items are implemented; the rest are concrete plans, not promises.

## 1. Non-IP attacker identification (fingerprinting) — ✅ DONE (core)
`src/lib/fingerprint.js` hashes stable headers (UA, Accept-Language,
Accept-Encoding, Sec-CH-UA, Sec-CH-UA-Platform). The memory store treats the
hash as a second blacklist dimension (`fp:<hash>` docs, same TTL as IPs), so
IP-rotating attackers on one device stay fast-routed to decoys.

**Pending:** JA3/JA4 TLS fingerprints (needs a TLS-terminating proxy injecting
headers), behavioral graphs (request cadence, endpoint ordering).

## 2. LLM-generated deception — ✅ FULL, plus P4 history adaptation
`src/lib/persona_forge.js`, integrated into `architect.js`:
- Gemini forges a unique persona per attack profile (serverHeader, status,
  extraHeaders, convincing fake success body) — official SDK path across the
  **key × model matrix** + curl REST fallback.
- Model output is UNTRUSTED DATA and passes a strict local validator before
  use: no control chars/CRLF in header values (anti response-splitting),
  RFC-token names (≤6 extras), integer status 200–599, pure-data body with
  bounded depth (≤6) and size (`PERSONA_MAX_BYTES`).
- Injected via `-e DECOY_PERSONA=<json>` at `docker run`; `fake_server.js`
  prefers it over the stock profile.
- Cache = profile + hash(attacker-history signature); TTL with ±15% jitter
  (personas age naturally) + in-flight dedupe.
- Absolute fail-soft: API down / quota / malformed output /
  `PERSONA_ENABLED=0` → stock persona; forge never blocks the decoy pipeline.

**P4 (history adaptation):** the gateway reads the attacker's Campaign Memory
summary and forwards it as `<ATTACKER_HISTORY>` (bounded counters/enums we
generated ourselves). When `knownEvents > 1`, Gemini crafts fiction that
subtly "recognizes" this class of intruder. Honest limitation: containers are
reused per profile, so an adapted persona takes effect on the spawn cycle that
creates/renews the container.

## 3. Campaign Memory Bank — ✅ FULL (v5.3)
`src/lib/campaign_memory.js`: TTL-free aggregates keyed by fingerprint hash
(firstSeen/lastSeen/event counts/attack types/profiles/bounded IP samples).
Dual backend (Firestore `campaign` collection | memory + local snapshot).
Boot-time hydration from Firestore + `ready()` gate so `/intel` never serves
an empty ledger after a cold start. Exposed via `/_mirage/intel`
(`campaigns` stats + `campaignList`) and consumed by the dashboard ledger.

## 4. Cross-department agent catalog — 🟡 PARTIAL
Live today: `GET /_mirage/agents` returns a self-describing manifest — per
agent `name/version/department/owner/role/capabilities/geapEquivalent/health`,
plus `catalogVersion`, `departmentsServed`, and a six-entry GEAP vocabulary
mapping (Registry/Gateway/Memory Bank/Model Armor-equivalent/Observability/
Runtime).

**Pending:** two-way publishing into a real GEAP Agent Registry feed.

## 5. Quota-aware key × model matrix — ✅ FULL (P4.5)
`src/lib/model_chain.js`: Gemini quotas are per-model per project, so both
agents walk every live (credential × model) combo key-major
(`gemini-3.5-flash → 3.6-flash → 3.7-flash` per key, then next key).
429 ⇒ combo cooldown (`MODEL_COOLDOWN_MS`); dead key ⇒ column dropped;
unknown model ⇒ permanent skip. Full-matrix exhaustion degrades to local
heuristics — pipeline never breaks. Unit-tested classifiers & ordering.

## 6. Observability — ✅ LIGHT (OpenTelemetry pending)
Trace-id per request + decision-latency logs + structured reasoning-chain
spans (`src/lib/trace_store.js`) exposed at `/_mirage/intel` and rendered in
the dashboard's Decision Trace panel.

**Pending:** OpenTelemetry SDK export (Cloud Trace/Prometheus), Sentinel
reasoning spans per path (SDK/REST/degraded) with token accounting.

## 7. Housekeeping — ✅ DONE
ISC `LICENSE`, cross-platform `npm run clean`, hermetic unit suite (51),
7-gate integration check, secret-scan commit gate, LF normalization via
`.gitignore`/`.gitattributes`/`.gcloudignore`, fully English codebase &
docs (hackathon language requirement).

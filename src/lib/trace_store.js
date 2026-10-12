/**
 * MIRAGE-NODE :: TRACE STORE (structured reasoning chain)
 * -------------------------------------------------------
 * Every gateway routing decision is recorded as one ring-buffer "span":
 * the reasoning steps (chain), the AI path used (via), verdict, reason,
 * and latency. Exposed via /_mirage/intel so auditors/judges can AUDIT THE
 * AGENTS' REASONING — an explicit Fortified Enterprise Fleet track theme
 * ("audit their reasoning", "runtime observability").
 *
 * Design: never-throw. Tracing must never break the main pipeline.
 */
const MAX_ENTRIES = Math.max(1, parseInt(process.env.TRACE_MAX || '500', 10));
const traces = []; // newest entries at the TAIL of the array

function recordTrace(entry = {}) {
    try {
        traces.push({
            traceId: entry.traceId || null,
            ts: entry.ts || Date.now(),
            ip: entry.ip || null,
            method: entry.method || '',
            url: entry.url || '',
            // Fingerprint truncated: enough for correlation, full hash never stored.
            fingerprint: entry.fingerprint ? String(entry.fingerprint).slice(0, 8) : null,
            decision: entry.decision || 'unknown',   // production | decoy | rejected | decoy-posthoc
            reason: String(entry.reason || '').slice(0, 300),
            chain: Array.isArray(entry.chain) ? entry.chain.map(String).slice(-12) : [],
            via: entry.via || null,                  // SDK | REST | cache | heuristic | null
            latencyMs: Number.isFinite(entry.latencyMs) ? entry.latencyMs : null,
            verdict: entry.verdict || null
        });
        if (traces.length > MAX_ENTRIES) traces.splice(0, traces.length - MAX_ENTRIES);
    } catch (_) { /* intentionally silent: observability must never be a failure point */ }
}

/** Last N entries, NEWEST FIRST (ready for dashboard/audit display). */
function recent(limit = 50) {
    const lim = parseInt(limit, 10);
    if (!Number.isFinite(lim) || lim <= 0) return []; // anti slice(-0): 0 MUST be empty
    const n = Math.min(lim, MAX_ENTRIES);
    return traces.slice(-n).reverse();
}

function size() { return traces.length; }

module.exports = { recordTrace, recent, size };

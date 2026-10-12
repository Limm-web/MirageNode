/**
 * MIRAGE-NODE :: CAMPAIGN MEMORY BANK (v5.3)
 * -------------------------------------------
 * The direct answer to the "Fortified Enterprise Fleet" track requirement:
 *   "how they safely maintain context across WEEKS of asynchronous operations".
 *
 * Unlike the blacklist (24h TTL, designed to forget for fairness), Campaign
 * Memory is intentionally TTL-FREE: it is the long-term memory of an attacker
 * CAMPAIGN - first seen, attack-type patterns, targeted profiles and frequency -
 * so agents can recognize an "old face" even weeks later or after a restart.
 *
 * Safe by design (compliance-friendly):
 *   - Primary key = fingerprint hash (never raw PII). IPs are bounded samples.
 *   - Only structured aggregates (numbers + enums); payloads are never stored.
 *   - Every container is bounded: anti memory-leak & anti data-hoarding.
 *   - Dual backend: Firestore (`campaign` collection) or in-memory + local
 *     snapshot `campaign.local.jsonl` so demos still prove cross-restart memory.
 *   - Never-throw: memory failures must never break the main pipeline.
 */

require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');

let firestoreDb = null;
let mode = 'memory';
if (process.env.FIRESTORE_PROJECT_ID || process.env.K_SERVICE /* Cloud Run */) {
    try {
        const { Firestore } = require('@google-cloud/firestore');
        const opts = {};
        if (process.env.FIRESTORE_PROJECT_ID) opts.projectId = process.env.FIRESTORE_PROJECT_ID;
        firestoreDb = new Firestore(opts);
        mode = 'firestore';
        console.log('[CAMPAIGN] Backend: Google Cloud Firestore (collection `campaign`).');
    } catch (e) {
        console.warn('[CAMPAIGN] Firestore failed to load, falling back to memory:', e.message);
    }
}

// Snapshot location can be overridden (used by unit tests for hermetic runs).
const SNAPSHOT_FILE = process.env.CAMPAIGN_SNAPSHOT_FILE
    || path.join(process.cwd(), 'campaign.local.jsonl');

// Hard bounds (anti memory-leak / anti data-hoarding)
const MAX_ATTACK_TYPES = 8;
const MAX_PROFILES = 4;
const MAX_IPS_PER_CAMPAIGN = 5;
const MAX_CAMPAIGNS_IN_MEMORY = 5000;

/** fingerprint -> aggregate campaign */
const campaigns = new Map();

/* ---------- Local snapshot (cross-restart persistence without Firestore) ---------- */
function loadSnapshot() {
    try {
        const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf8');
        const lines = raw.trim() ? raw.trim().split('\n') : [];
        let n = 0;
        for (const line of lines) {
            try {
                const doc = JSON.parse(line);
                if (doc && doc.key) { campaigns.set(doc.key, doc.data); n++; }
            } catch (_) {}
        }
        if (n > 0) console.log(`[CAMPAIGN] Local snapshot loaded: ${n} campaigns restored.`);
    } catch (_) { /* file not present yet -> start empty */ }
}

function appendSnapshot(key, data) {
    try { fs.appendFileSync(SNAPSHOT_FILE, JSON.stringify({ key, data }) + '\n'); } catch (_) {}
}

function docId(fingerprint, ip) {
    return fingerprint ? `fp:${fingerprint}` : (ip ? `ip:${ip}` : null);
}

/**
 * Record one attack event under the perpetrator's campaign.
 * Returns the updated safe-to-display summary; never throws.
 */
async function recordEvent(evt) {
    try {
        const key = docId(evt.fingerprint, evt.ip);
        if (!key) return null;

        const now = Date.now();
        let c = campaigns.get(key);
        if (!c) {
            c = {
                firstSeen: now,
                lastSeen: now,
                events: 0,
                attackTypes: {},   // enum/name -> count
                profiles: {},      // wordpress|api|generic -> count
                ips: [],           // bounded IP samples (observes NAT/rotation)
                lastVia: null
            };
            campaigns.set(key, c);
            // Anti memory-leak: evict the oldest campaign when the pool overflows.
            if (campaigns.size > MAX_CAMPAIGNS_IN_MEMORY) {
                const oldest = [...campaigns.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
                if (oldest) campaigns.delete(oldest[0]);
            }
        }

        c.lastSeen = now;
        c.events += 1;
        c.lastVia = evt.via || evt.async ? String(evt.via || (evt.async ? 'async' : '')) : (evt.via || null);

        const at = String(evt.attackType || 'unknown').slice(0, 40);
        if (!(at in c.attackTypes) && Object.keys(c.attackTypes).length >= MAX_ATTACK_TYPES) {
            // Evict the smallest count (LRU-ish over a tiny space).
            const minKey = Object.keys(c.attackTypes).reduce((a, b) => (c.attackTypes[a] <= c.attackTypes[b] ? a : b));
            delete c.attackTypes[minKey];
        }
        c.attackTypes[at] = (c.attackTypes[at] || 0) + 1;

        const pf = String(evt.profile || 'generic').slice(0, 16);
        if (!(pf in c.profiles) && Object.keys(c.profiles).length >= MAX_PROFILES) {
            const minKey = Object.keys(c.profiles).reduce((a, b) => (c.profiles[a] <= c.profiles[b] ? a : b));
            delete c.profiles[minKey];
        }
        c.profiles[pf] = (c.profiles[pf] || 0) + 1;

        if (evt.ip && !c.ips.includes(evt.ip)) {
            c.ips.push(evt.ip);
            if (c.ips.length > MAX_IPS_PER_CAMPAIGN) c.ips.shift(); // drop the oldest
        }

        if (mode === 'firestore') {
            try {
                await firestoreDb.collection('campaign').doc(key).set(
                    Object.assign({}, c, { updatedAt: now }), { merge: true }
                );
            } catch (e) {
                console.error('[CAMPAIGN] Firestore write failed:', e.message);
                appendSnapshot(key, c); // never lose the memory when the cloud hiccups
            }
        } else {
            appendSnapshot(key, c);
        }
        return summarize(key, c);
    } catch (e) {
        console.warn('[CAMPAIGN] recordEvent failed (ignored):', e.message);
        return null;
    }
}

/** Display-safe summary (no raw internal structures). */
function summarize(key, c) {
    const daysActive = Math.max(0, Math.round((c.lastSeen - c.firstSeen) / 86400000 * 10) / 10);
    return {
        key: key.startsWith('fp:') ? key.slice(0, 11) + '…' : key, // truncated fp (privacy)
        firstSeen: new Date(c.firstSeen).toISOString(),
        lastSeen: new Date(c.lastSeen).toISOString(),
        spanDays: daysActive,
        events: c.events,
        attackTypes: Object.assign({}, c.attackTypes),
        profiles: Object.assign({}, c.profiles),
        ipSamples: c.ips.length,
        lastVia: c.lastVia || null
    };
}

/** Fetch a campaign by fingerprint/ip (memory fast-path; Firestore fallback). */
async function getSummary(fingerprint, ip) {
    const key = docId(fingerprint, ip);
    if (!key) return null;
    let c = campaigns.get(key);
    if (!c && mode === 'firestore') {
        try {
            const doc = await firestoreDb.collection('campaign').doc(key).get();
            if (doc.exists) { c = doc.data(); campaigns.set(key, c); }
        } catch (_) {}
    }
    return c ? summarize(key, c) : null;
}

/** Last N campaigns (sorted by lastSeen desc) as display-safe summaries.
 *  Served via /_mirage/intel -> campaignList for the dashboard ledger. */
function recent(limit = 12) {
    return [...campaigns.entries()]
        .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
        .slice(0, Math.max(0, limit | 0))
        .map(([key, c]) => summarize(key, c));
}

/** Collective stats for the registry & intel dashboard. */
function stats() {
    let totalEvents = 0, returningHunters = 0;
    const now = Date.now();
    for (const [, c] of campaigns) {
        totalEvents += c.events;
        if (now - c.firstSeen > 3600 * 1000 || c.events > 1) returningHunters++;
    }
    return {
        backend: mode,
        campaignsTracked: campaigns.size,
        totalEvents,
        returningHunters,
        bounds: { maxAttackTypes: MAX_ATTACK_TYPES, maxIpsPerCampaign: MAX_IPS_PER_CAMPAIGN }
    };
}

loadSnapshot();

/**
 * Cloud mode: reload campaigns from Firestore into memory so the ledger/stats
 * survive instance restarts (context that truly spans weeks).
 * Never-throw: hydration failure only degrades display, never the pipeline.
 */
async function hydrateFromFirestore() {
    if (mode !== 'firestore') return;
    try {
        const snap = await firestoreDb.collection('campaign')
            .orderBy('lastSeen', 'desc').limit(300).get();
        let n = 0;
        snap.forEach((doc) => { campaigns.set(doc.id, doc.data()); n++; });
        if (n > 0) console.log(`[CAMPAIGN] Hydrated from Firestore: ${n} campaigns restored.`);
    } catch (e) {
        console.warn('[CAMPAIGN] Firestore hydration failed (ignored):', e.message);
    }
}

/** Readiness promise: resolves once cloud hydration completes (memoized). */
let readyPromise = null;
function ready() {
    if (!readyPromise) {
        readyPromise = mode === 'firestore' ? hydrateFromFirestore() : Promise.resolve();
    }
    return readyPromise;
}
ready(); // start ASAP; callers may still await ready()

module.exports = { recordEvent, getSummary, stats, recent, ready };

/**
 * MIRAGE-NODE :: MEMORY STORE (dual-backend)
 * -------------------------------------------
 * Backend A: Google Cloud Firestore  -> active when FIRESTORE_PROJECT_ID is set,
 *            or automatically on Cloud Run/GCE (ADC, no API key).
 * Backend B: In-memory + local snapshot (threat_intel.local.jsonl).
 *
 * Every blacklist entry carries a TTL (expiresAt): NAT addresses shared by many
 * people are not punished forever -> prevents permanent false positives.
 */

require('dotenv').config({ override: true });

let firestoreDb = null;
let mode = 'memory';

if (process.env.FIRESTORE_PROJECT_ID || process.env.K_SERVICE /* Cloud Run */) {
    try {
        const { Firestore } = require('@google-cloud/firestore');
        const opts = {};
        if (process.env.FIRESTORE_PROJECT_ID) opts.projectId = process.env.FIRESTORE_PROJECT_ID;
        firestoreDb = new Firestore(opts);
        mode = 'firestore';
        console.log('[STORE] Backend: Google Cloud Firestore.');
    } catch (e) {
        console.warn('[STORE] Firestore failed to load, falling back to memory:', e.message);
    }
}
if (mode === 'memory') {
    console.log('[STORE] Backend: in-memory (+local snapshot). Set FIRESTORE_PROJECT_ID for cloud mode.');
}

const TTL_MS = (parseInt(process.env.BLACKLIST_TTL_HOURS || '24', 10)) * 3600 * 1000;
const memBlacklist = new Map();     // ip -> { reason, expiresAt, hits }
const memFingerprints = new Map();  // fingerprint -> { reason, expiresAt, ip }

function normalizeIP(raw) {
    let ip = String(raw || '').trim();
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (ip === '::1') ip = '127.0.0.1';
    return ip;
}

function alive(entry) {
    return Boolean(entry && entry.expiresAt > Date.now());
}

async function isBlacklisted(ip, fingerprint) {
    ip = normalizeIP(ip);
    // Fast path in-memory (always populated by blacklist()).
    if (fingerprint && alive(memFingerprints.get(fingerprint))) return true;
    if (alive(memBlacklist.get(ip))) return true;

    if (mode === 'firestore') {
        try {
            const doc = await firestoreDb.collection('blacklist').doc(ip).get();
            if (doc.exists) {
                const d = doc.data() || {};
                if ((d.expiresAt || 0) > Date.now()) return true;
                firestoreDb.collection('blacklist').doc(ip).delete().catch(() => {}); // lazy cleanup
            }
            if (fingerprint) {
                const fdoc = await firestoreDb.collection('blacklist').doc(`fp:${fingerprint}`).get();
                if (fdoc.exists) {
                    const d = fdoc.data() || {};
                    if ((d.expiresAt || 0) > Date.now()) return true;
                    firestoreDb.collection('blacklist').doc(`fp:${fingerprint}`).delete().catch(() => {});
                }
            }
        } catch (e) {
            console.error('[STORE] Firestore read failed, using local cache:', e.message);
        }
    }
    return false;
}

async function blacklist(ip, reason = 'unspecified', fingerprint) {
    ip = normalizeIP(ip);
    const expiresAt = Date.now() + TTL_MS;
    const prev = memBlacklist.get(ip);
    memBlacklist.set(ip, { reason, expiresAt, hits: (alive(prev) ? prev.hits : 0) + 1 });
    if (fingerprint) memFingerprints.set(fingerprint, { reason, expiresAt, ip });

    if (mode === 'firestore') {
        try {
            await firestoreDb.collection('blacklist').doc(ip).set(
                { reason, expiresAt, updatedAt: Date.now() },
                { merge: true }
            );
            if (fingerprint) {
                await firestoreDb.collection('blacklist').doc(`fp:${fingerprint}`).set(
                    { reason, expiresAt, ip, updatedAt: Date.now() },
                    { merge: true }
                );
            }
        } catch (e) {
            console.error('[STORE] Firestore write failed:', e.message);
        }
    }
    return { ip, fingerprint, reason, expiresAt };
}

/** Persist a threat-intel report (TTP). Always appends the local snapshot too. */
async function recordThreat(report) {
    report.recordedAt = Date.now();
    if (mode === 'firestore') {
        try {
            const ref = await firestoreDb.collection('threat_intel').add(report);
            report.firestoreId = ref.id;
        } catch (e) {
            console.error('[STORE] Threat write failed:', e.message);
        }
    }
    try {
        require('fs').appendFileSync('threat_intel.local.jsonl', JSON.stringify(report) + '\n');
    } catch (_) {}
    return report;
}

// Periodic sweeper for expired in-memory entries
setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of memBlacklist) if (e.expiresAt <= now) memBlacklist.delete(ip);
    for (const [fp, e] of memFingerprints) if (e.expiresAt <= now) memFingerprints.delete(fp);
}, 60 * 60 * 1000).unref();

/**
 * Read the last N threat reports from the local snapshot (newest first).
 * Used by /_mirage/intel for the mini dashboard.
 */
function recentThreats(limit = 50) {
    if (!limit || limit <= 0) return [];
    try {
        const raw = require('fs').readFileSync(
            require('path').join(process.cwd(), 'threat_intel.local.jsonl'), 'utf8'
        );
        const lines = raw.trim() ? raw.trim().split('\n') : [];
        return lines.slice(-limit)
            .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
            .filter(Boolean)
            .reverse();
    } catch (_) {
        return [];
    }
}

module.exports = {
    normalizeIP,
    isBlacklisted,
    blacklist,
    recordThreat,
    recentThreats,
    get backend() { return mode; },
    _memSize() { return memBlacklist.size; },
    _memFingerprintSize() { return memFingerprints.size; }
};

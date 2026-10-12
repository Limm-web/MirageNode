/**
 * MIRAGE-NODE :: MODEL MATRIX (quota-aware key x model failover)
 * ---------------------------------------------------------------
 * Gemini quotas are PER-MODEL per project, so exhaustion of one combination
 * does not affect the others. This module builds every usable (key, model)
 * combo - key-major ordering, e.g.:
 *   K1 x m1, K1 x m2, K1 x m3, K2 x m1, K2 x m2, K2 x m3 ...
 * and temporarily cools down combos that return quota errors, permanently
 * skips unknown models (404) and dead keys (400 invalid key).
 *
 * Design: never-throw, zero network I/O, trivially unit-testable.
 */
require('dotenv').config({ override: true });

const COOLDOWN_MS = parseInt(process.env.MODEL_COOLDOWN_MS || '60000', 10);

function readKeys() {
    return [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY_2,
        process.env.GEMINI_API_KEY_3
    ].map((k) => (k || '').trim()).filter(Boolean);
}

function readModels() {
    // Primary model leads the chain; extras follow (deduped).
    const primary = (process.env.GEMINI_MODEL || '').trim();
    const def = 'gemini-3.5-flash,gemini-3.6-flash,gemini-3.7-flash';
    const extras = (process.env.GEMINI_MODEL_CHAIN || def)
        .split(',').map((s) => s.trim()).filter(Boolean);
    if (!primary) return extras;
    return [primary, ...extras.filter((m) => m !== primary)];
}

const exhaustedUntil = new Map(); // "key|model" -> timestamp
const badModels = new Set();      // "key|model" (404 / unsupported)
const badKeys = new Set();        // key (400 invalid key)

/** All live (key, model) combos, key-major, healthiest first. */
function entries() {
    const keys = readKeys().filter((k) => !badKeys.has(k));
    const models = readModels();
    const out = [];
    keys.forEach((key, ki) => {
        models.forEach((model) => {
            const id = key + '|' + model;
            if (badModels.has(id)) return;
            out.push({ key, model, id, label: `${model}@K${ki + 1}` });
        });
    });
    const now = Date.now();
    return out.sort((a, b) =>
        Number((exhaustedUntil.get(a.id) || 0) > now) -
        Number((exhaustedUntil.get(b.id) || 0) > now));
}

/** Quota hit -> short cooldown for this combo only. */
function markExhausted(entry) {
    if (entry && entry.id) exhaustedUntil.set(entry.id, Date.now() + COOLDOWN_MS);
}

/** Unknown/unsupported model -> never try this combo again. */
function markBadModel(entry) {
    if (entry && entry.id) badModels.add(entry.id);
}

/** Dead key -> drop every combo that shares it. */
function markBadKey(key) {
    if (key) badKeys.add(key);
}

function isQuotaError(err) {
    const status = err && (err.status ?? err.code);
    if (status === 429 || status === 'RESOURCE_EXHAUSTED') return true;
    return /\b429\b|RESOURCE_EXHAUSTED|(?:exceeded|exhausted)[^.]{0,40}quota|quota[^.]{0,40}(?:exceeded|exhausted)/i
        .test(String((err && (err.message || err)) || ''));
}

function isBadModel(err) {
    const status = err && (err.status ?? err.code);
    if (status === 404) return true;
    return /NOT_FOUND|is not found|not supported for|unsupported model/i
        .test(String((err && (err.message || err)) || ''));
}

function isBadKey(err, bodyText) {
    const msg = String((err && (err.message || err)) || '') + '\n' + String(bodyText || '');
    if (/API key not valid|API_KEY_INVALID/i.test(msg)) return true;
    const status = err && (err.status ?? err.code);
    return status === 400 && /api.?key/i.test(msg);
}

module.exports = { entries, markExhausted, markBadModel, markBadKey, isQuotaError, isBadModel, isBadKey };

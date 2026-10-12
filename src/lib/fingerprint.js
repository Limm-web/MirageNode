/**
 * MIRAGE-NODE :: CLIENT FINGERPRINT
 * ----------------------------------
 * Header-based client identity (not IP), used to catch attackers who rotate
 * IP addresses but keep the same device/client. Serves as the SECOND DIMENSION
 * of the blacklist: once a fingerprint has been flagged MALICIOUS, later
 * requests (even from a different IP) are fast-routed to a decoy.
 */
const crypto = require('crypto');

const FP_HEADERS = ['user-agent', 'accept-language', 'accept-encoding', 'sec-ch-ua', 'sec-ch-ua-platform'];

/**
 * Returns a 32-char hex fingerprint, or null when there is not enough signal.
 * Chosen headers rarely change between requests from the same client (these
 * are not cookies/sessions). No raw PII is stored -> hash only.
 */
function clientFingerprint(headers = {}) {
    const parts = FP_HEADERS.map((k) => String((headers && headers[k]) || '').trim()).join('|');
    if (!parts || parts === '||||') return null;
    return crypto.createHash('sha256').update(parts).digest('hex').slice(0, 32);
}

module.exports = { clientFingerprint, FP_HEADERS };

/**
 * MIRAGE-NODE :: HEURISTICS (deterministic local signature scan)
 * --------------------------------------------------------------
 * Used in two places:
 *   1. Sentinel (DEGRADED MODE) - last resort when the LLM is unreachable.
 *   2. Gateway  (fast PRE-SCAN) - catches OBVIOUS attacks instantly,
 *      without waiting for an LLM (the key to async-mode latency wins).
 *
 * Conservative by design: only very clear patterns are flagged. A flag means
 * "route to decoy", not "block" - so false positives never reject real users.
 */
const ATTACK_SIGNATURES = [
    { name: 'SQLi',          re: /(\bunion\b[\s\S]{0,20}\bselect\b)|('\s*(or|and)\s*'?[\w\s]*=)|(;\s*drop\s+table\b)|(\bsleep\s*\()|(\bbenchmark\s*\()/i },
    { name: 'PathTraversal', re: /(\.\.[\/\\]){2,}|(\/etc\/passwd)|(%2e%2e%2f)|(c:\\windows\\)/i },
    { name: 'CmdInjection',  re: /[;&|`]\s*(cat|id|whoami|ls|nc|wget|curl|rm)\b|\$\(/i },
    { name: 'XSS',           re: /<script\b|javascript:|onerror\s*=|onload\s*=/i },
    { name: 'Webshell',      re: /[?&](cmd|exec|eval|proc|command)=/i },
    // SSRF: target/url/host params pointing at loopback / private subnets / cloud metadata.
    { name: 'SSRF',          re: /(url|uri|host|hostname|target|target_uri|dest|redirect|next|return|callback)\s*=\s*(https?:\/\/)?(127\.0\.0\.1|localhost|169\.254\.169\.254|0\.0\.0\.0|10\.\d{1,3}\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i },
    // Prompt injection: attempts to hijack system instructions.
    { name: 'PromptInjection', re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompt|context)|forget\s+(all\s+)?(previous|prior)\s+(instructions|prompt)|disregard\s+(previous|above|all)|you\s+are\s+now\s+(?!.*(human|assistant))|jailbreak\s+mode|system\s+prompt\s*[:=]/i }
];

/**
 * Scan method + URL + body + User-Agent header for obvious attack patterns.
 * Returns { found: boolean, name: string|null }.
 */
function heuristicScan(method = '', url = '', body = '', headers = {}) {
    const ua = (headers && headers['user-agent']) || '';
    const haystack = `${method} ${url} ${body || ''} ${ua}`;
    for (const sig of ATTACK_SIGNATURES) {
        sig.re.lastIndex = 0;
        if (sig.re.test(haystack)) {
            console.log(`[HEURISTICS] Pattern detected: ${sig.name}.`);
            return { found: true, name: sig.name };
        }
    }
    return { found: false, name: null };
}

module.exports = { heuristicScan, ATTACK_SIGNATURES };

// MIRAGE-NODE GATEWAY :: Titik masuk seluruh trafik (v5.1 - hardening, dashboard,
// agent registry & reasoning-chain observability).
// dotenv paling awal; architect async dipanggil eksplisit (tanpa side-effect import).

require('dotenv').config({ override: true });

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const httpProxy = require('http-proxy');
const { analyzeRequestDetailed } = require('../agents/sentinel');
const { heuristicScan } = require('../lib/heuristics');
const { clientFingerprint } = require('../lib/fingerprint');
const store = require('../lib/memory_store');
const traceStore = require('../lib/trace_store');
const personaForge = require('../lib/persona_forge');
const architect = require('../agents/architect');
const campaignMemory = require('../lib/campaign_memory');

const TARGET_PRODUCTION = process.env.TARGET_PRODUCTION || 'http://localhost:3000';
const FALLBACK_HONEYPOT = process.env.FALLBACK_HONEYPOT || 'http://localhost:8080';
const MAX_BODY_BYTES = parseInt(process.env.MAX_BODY_BYTES || '1048576', 10); // 1 MB
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

/* ---------- Latency modes ----------
 * sync (DEFAULT, fail-closed): hold the request until the LLM verdict arrives,
 *   then route to production or a decoy. Strictly safe; normal users wait for
 *   Gemini (1-10s).
 * async (fail-open): forward to production NOW; LLM analysis runs in the
 *   background; on MALICIOUS the IP is blacklisted for future requests.
 * Prefer async for response speed; prefer sync for strict security.
 */
const LATENCY_MODE = (process.env.LATENCY_MODE || 'sync').toLowerCase();

/* ---------- Anti economic-DoS: cap NEW requests that may reach the LLM, per IP ---------- */
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '30', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const rateBuckets = new Map(); // ip -> { count, windowStart }

function rateLimitExceeded(ip) {
    const now = Date.now();
    let b = rateBuckets.get(ip);
    if (!b || now - b.windowStart >= RATE_LIMIT_WINDOW_MS) {
        b = { count: 0, windowStart: now };
        rateBuckets.set(ip, b);
        if (rateBuckets.size > 10000) { // anti mem-leak saat flood multi-IP
            for (const [k, v] of rateBuckets) {
                if (now - v.windowStart >= RATE_LIMIT_WINDOW_MS) rateBuckets.delete(k);
            }
        }
    }
    b.count++;
    return b.count > RATE_LIMIT_MAX;
}

/* ---------- Deteksi IP klien: hormati X-Forwarded-For hanya di balik proxy terpercaya ---------- */
function extractClientIP(req) {
    // On Cloud Run (K_SERVICE) / when TRUST_PROXY=1, remoteAddress is the load balancer, not the client.
    const trustProxy = process.env.TRUST_PROXY === '1' || Boolean(process.env.K_SERVICE);
    if (trustProxy) {
        const xff = req.headers['x-forwarded-for'];
        if (typeof xff === 'string' && xff.trim()) return store.normalizeIP(xff.split(',')[0].trim());
    }
    return store.normalizeIP(req.socket.remoteAddress);
}

/* ---------- Optional alert webhook (Slack/Discord/any JSON POST endpoint) ---------- */
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';
function sendAlert(report) {
    if (!ALERT_WEBHOOK_URL || typeof fetch !== 'function') return;
    fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text: `[MIRAGE-NODE] Attack detected from ${report.ip}: ${report.method} ${report.url}` +
                (report.verdict ? ` (${report.verdict.attack_type}, conf ${report.verdict.confidence})` : ''),
            report
        }),
        signal: AbortSignal.timeout(5000)
    }).catch(() => {}); // alerts must never disturb the main pipeline
}

/* ---------- Agent Registry (discovery) ----------
 * An explicit Fortified Enterprise Fleet theme: organizations must be able to
 * DISCOVER our agents. This endpoint is a self-describing manifest of agent
 * cards mapped onto GEAP (Gemini Enterprise Agent Platform) vocabulary.
 */
function agentRegistry() {
    const archStatus = architect.getStatus();
    return {
        service: 'MIRAGE-NODE',
        displayName: 'Mirage-Node :: Agentic Deception Gateway',
        version: '1.0.0',
        model: MODEL,
        framework: '@google/genai (GenAI SDK resmi Google)',
        stateBackend: store.backend,
        catalogVersion: '2.0',
        departmentsServed: ['security-operations', 'platform-engineering', 'compliance'],
        discoveryHint: 'Katalog agen lintas-departemen: tiap agen membawa version/department/owner.',
        geapMapping: {
            'Agent Registry': 'GET /_mirage/agents (manifest ini - discovery & metadata agen)',
            'Agent Gateway': 'src/gateway/gateway.js - routing + policy (rate-limit, blacklist ber-TTL, deception routing)',
            'Memory Bank': `${store.backend} blacklist + threat_intel - konteks penyerang lintas sesi (fast-route membacanya)`,
            'Model Armor (equivalent)': 'heuristic pre-scan + <PAYLOAD> fencing + structured enum output (anti prompt-injection/tool-poisoning)',
            'Agent Observability': 'GET /_mirage/intel?traces - rantai penalaran per keputusan (reasoning-chain spans)',
            'Agent Runtime': 'Node.js on Cloud Run (scale-to-zero ready); decoy = TTL-bounded hardened Docker container'
        },
        registeredAgents: [
            {
                name: 'sentinel',
                version: '3.1.0',
                department: 'security-operations',
                owner: 'soc@mirage-node.internal',
                role: 'Policy classifier - decides BENIGN vs MALICIOUS per request',
                model: MODEL,
                capabilities: [
                    'structured verdict (enum MALICIOUS|BENIGN + attack_type + confidence + reason)',
                    '3-layer failover: GenAI SDK > REST transport > local heuristics',
                    'anti prompt-injection: payload fencing + schema ketat'
                ],
                geapEquivalent: 'Model Armor (guardrails) + decision brain',
                health: { degradedModeAvailable: true, timeoutMs: parseInt(process.env.SENTINEL_TIMEOUT_MS || '10000', 10) }
            },
            {
                name: 'architect',
                version: '5.1.0',
                department: 'security-engineering',
                owner: 'deception-team@mirage-node.internal',
                role: 'Decoy orchestrator - selects, hardens, and manages bait containers',
                model: null,
                capabilities: [
                    'attack profile detection (wordpress|api|generic)',
                    'hardened container spawn (cap-drop ALL, no-new-privileges, read-only, honeynet isolation)',
                    'TTL reaper prevents container leaks; pool capped at MAX_DECOYS'
                ],
                geapEquivalent: 'Agent Gateway enforcement plane',
                health: archStatus
            },
            {
                name: 'persona-forge',
                version: '5.0.0',
                department: 'security-engineering',
                owner: 'deception-team@mirage-node.internal',
                role: 'Deception author - men-forge kepribadian decoy unik lewat Gemini',
                model: MODEL,
                capabilities: [
                    'unique persona generation per profile (convincing fake serverHeader/status/extraHeaders/body)',
                    'validasi lokal ketat: anti header-injection/CRLF, RFC-token, batas ukuran & kedalaman',
                    'cache TTL+jitter + dedupe in-flight (hemat kuota LLM)'
                ],
                geapEquivalent: 'Validated generation (Model Armor-style guardrail atas output LLM)',
                health: personaForge.stats()
            }
        ],
        generatedAt: new Date().toISOString()
    };
}

/* ---------- Endpoint internal: mini dashboard threat intel ---------- */
const DASHBOARD_HTML = path.join(__dirname, '..', '..', 'public', 'dashboard.html');

// Optional token protecting intel data. Empty => open dashboard (demo mode).
// Enable with DASHBOARD_TOKEN=<secret> in .env. Send via "Authorization: Bearer <token>"
// header or "?token=<token>" query.
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';

function timingSafeEqualStr(a, b) {
    // Constant-time comparison so token length never leaks via timing.
    let diff = a.length ^ b.length;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return diff === 0;
}

function isAuthorized(req) {
    if (!DASHBOARD_TOKEN) return true; // demo mode: open
    const h = req.headers['authorization'] || '';
    const bearer = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const query = new URL(req.url, 'http://x').searchParams.get('token') || '';
    const supplied = bearer || query;
    return supplied ? timingSafeEqualStr(supplied, DASHBOARD_TOKEN) : false;
}

function rejectUnauthorized(res) {
    res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="mirage-intel"'
    });
    res.end(JSON.stringify({ error: 'Unauthorized. Set header Authorization: Bearer <token>.' }));
}

/** Returns true when the request hit an internal endpoint and was served. */
function serveInternal(req, res) {
    if (req.url.startsWith('/_mirage')) {
        if (!isAuthorized(req)) return rejectUnauthorized(res), true;
        if (req.url.startsWith('/_mirage/intel')) {
            // Tunggu hidrasi Memory Bank agar ledger tak kosong di detik pertama.
            campaignMemory.ready().then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                backend: store.backend,
                campaigns: campaignMemory.stats(), // Memory Bank lintas-minggu
                campaignList: campaignMemory.recent(12), // baris Campaign Ledger
                threats: store.recentThreats(100),
                traces: traceStore.recent(50) // rantai penalaran (observability)
            }));
            });
            return true;
        }
        if (req.url.startsWith('/_mirage/agents')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(agentRegistry(), null, 2));
            return true;
        }
        if (req.url.startsWith('/_mirage/dashboard') || req.url === '/_mirage' || req.url === '/_mirage/') {
            try {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(fs.readFileSync(DASHBOARD_HTML));
            } catch (_) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Dashboard unavailable.');
            }
            return true;
        }
    }
    return false;
}

/* ---------- Reasoning-chain helper ----------
 * One call per routing decision. Never-throw: observability must never break
 * the main pipeline (trace_store is internally never-throw).
 */
function recordRoute(traceId, startedAt, clientIP, fingerprint, req, patch) {
    traceStore.recordTrace(Object.assign({
        traceId,
        ts: startedAt,
        ip: clientIP,
        fingerprint,
        method: req.method,
        url: req.url,
        latencyMs: Date.now() - startedAt
    }, patch));
}

async function routeToDecoy(req, res, clientIP, replayBuffer, traceId, startedAt, history) {
    const profile = architect.detectProfile(req.url, req.headers['user-agent']);
    const decoyPort = await architect.spawnDecoy(profile, history);
    const target = decoyPort ? `http://localhost:${decoyPort}` : FALLBACK_HONEYPOT;
    console.log(`[ROUTER] Attacker (${clientIP}) -> decoy[${profile}] ${target}`);
    if (traceId) console.log(`[TRACE ${traceId}] decision -> decoy[${profile}] in ${Date.now() - startedAt}ms`);
    const opts = { target };
    if (replayBuffer !== undefined) opts.buffer = require('stream').Readable.from([replayBuffer]);
    return proxy.web(req, res, opts);
}

/** Attack handling: blacklist (IP + fingerprint), record intel, alert, divert to decoy. */
async function handleAttack(req, res, clientIP, fullBody, verdict, fingerprint, traceId, startedAt) {
    console.log(`[SENTINEL-ALERT] ATTACK from ${clientIP}! Blacklisting + deception.`);
    await store.blacklist(clientIP, `MALICIOUS ${req.method} ${req.url}`, fingerprint);
    const report = await store.recordThreat({
        ip: clientIP,
        fingerprint: fingerprint || null,
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'] || '',
        body: fullBody.slice(0, 4000),
        profile: architect.detectProfile(req.url, req.headers['user-agent']),
        verdict: verdict || null
    });
    sendAlert(report);
    // Memory Bank: the campaign is recorded ACROSS WEEKS (no TTL, bounded aggregates).
    campaignMemory.recordEvent({
        fingerprint,
        ip: clientIP,
        attackType: (verdict && verdict.attack_type) || 'heuristic-hit',
        profile: architect.detectProfile(req.url, req.headers['user-agent'])
    }).catch(() => {});
    // P4: read the attacker's campaign so the decoy persona adapts to their history.
    const history = await campaignMemory.getSummary(fingerprint, clientIP).catch(() => null);
    return routeToDecoy(req, res, clientIP, fullBody, traceId, startedAt, history);
}

/** Async mode: proxy first, verify with the LLM in background, blacklist on MALICIOUS. */
function analyzeInBackground(clientIP, req, fullBody, fingerprint, traceId, startedAt) {
    console.log(`[GATEWAY][ASYNC] Background analysis: ${clientIP} ${req.method} ${req.url}`);
    analyzeRequestDetailed(req.method, req.url, req.headers, fullBody)
        .then((analysis) => {
            if (!analysis.malicious) {
                // Audit: post-hoc verification finished with a BENIGN result.
                recordRoute(traceId, startedAt, clientIP, fingerprint, req, {
                    decision: 'production-posthoc',
                    reason: 'background verification finished: BENIGN (production was already served)',
                    chain: ['pre-scan:PASS', 'async-proxy-production', 'background-sentinel:BENIGN'],
                    via: analysis.via || null,
                    verdict: analysis.verdict || null
                });
                return null;
            }
            console.log(`[SENTINEL-ASYNC] Confirmed MALICIOUS (post-hoc): ${clientIP} ${req.method} ${req.url}. IP blacklisted.`);
            recordRoute(traceId, startedAt, clientIP, fingerprint, req, {
                decision: 'decoy-posthoc',
                reason: 'background verification: MALICIOUS -> IP blacklisted for future requests',
                chain: ['pre-scan:PASS', 'async-proxy-production', 'background-sentinel:MALICIOUS', 'blacklist-write'],
                via: analysis.via || null,
                verdict: analysis.verdict || null
            });
            return store.blacklist(clientIP, `MALICIOUS ${req.method} ${req.url}`, fingerprint).then(() =>
                store.recordThreat({
                    ip: clientIP,
                    fingerprint: fingerprint || null,
                    method: req.method,
                    url: req.url,
                    userAgent: req.headers['user-agent'] || '',
                    body: fullBody.slice(0, 4000),
                    profile: architect.detectProfile(req.url, req.headers['user-agent']),
                    verdict: analysis.verdict,
                    async: true
                })
            ).then((report) => {
                sendAlert(report);
                campaignMemory.recordEvent({
                    fingerprint,
                    ip: clientIP,
                    attackType: (analysis.verdict && analysis.verdict.attack_type) || 'unknown',
                    profile: architect.detectProfile(req.url, req.headers['user-agent']),
                    via: 'async'
                }).catch(() => {});
            });
        })
        .catch((e) => console.error('[SENTINEL-ASYNC] Failed:', String(e.message).slice(0, 120)));
}

const proxy = httpProxy.createProxyServer({});

const server = http.createServer((req, res) => {
    if (serveInternal(req, res)) return;

    const traceId = crypto.randomBytes(4).toString('hex');
    const startedAt = Date.now();
    const clientIP = extractClientIP(req);
    const fingerprint = clientFingerprint(req.headers);
    console.log(`[TRACE ${traceId}] ${req.method} ${req.url} from ${clientIP} (fp=${fingerprint ? fingerprint.slice(0, 8) : '-'})`);

    store.isBlacklisted(clientIP, fingerprint).then(async (blocked) => {
        // ---- FAST ROUTE: returning offenders go straight to a decoy, zero LLM ----
        if (blocked) {
            recordRoute(traceId, startedAt, clientIP, fingerprint, req, {
                decision: 'decoy',
                reason: 'fast-route: IP/fingerprint already blacklisted (cross-session memory)',
                chain: ['blacklist-check:HIT', 'skip-LLM', 'route-decoy'],
                via: 'memory-bank'
            });
            // Returning offender: hand their history to the decoy (persona-per-fingerprint).
            const history = await campaignMemory.getSummary(fingerprint, clientIP).catch(() => null);
            return routeToDecoy(req, res, clientIP, undefined, traceId, startedAt, history);
        }

        // ---- RATE LIMIT (sync mode): shield the LLM budget from unique-request floods ----
        if (LATENCY_MODE === 'sync' && rateLimitExceeded(clientIP)) {
            console.warn(`[GATEWAY] Rate limit exceeded by ${clientIP} -> 429.`);
            recordRoute(traceId, startedAt, clientIP, fingerprint, req, {
                decision: 'rejected',
                reason: 'LLM rate limit exceeded (anti economic-DoS)',
                chain: ['blacklist-check:PASS', 'rate-limit:EXCEEDED']
            });
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Too Many Requests' }));
            return;
        }

        let body = [];
        let size = 0;

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                console.warn(`[GATEWAY] Body too large from ${clientIP} -> 413.`);
                req.destroy();
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Payload too large' }));
                return;
            }
            body.push(chunk);
        });

        req.on('end', async () => {
            const fullBody = Buffer.concat(body).toString();

            // ---- PRE-SCAN: OBVIOUS attacks handled instantly, without waiting for an LLM ----
            const h = heuristicScan(req.method, req.url, fullBody, req.headers);
            if (h.found) {
                console.log(`[GATEWAY] PRE-SCAN caught ${h.name} from ${clientIP} -> acting immediately.`);
                const verdictPS = {
                    verdict: 'MALICIOUS',
                    attack_type: h.name,
                    confidence: 1,
                    reason: 'pre-scan_heuristic'
                };
                recordRoute(traceId, startedAt, clientIP, fingerprint, req, {
                    decision: 'decoy',
                    reason: `pre-scan heuristic caught ${h.name} with zero LLM calls`,
                    chain: ['blacklist-check:PASS', `pre-scan:HIT(${h.name})`, 'blacklist-write', 'intel-record', 'route-decoy'],
                    via: 'heuristic',
                    verdict: verdictPS
                });
                return handleAttack(req, res, clientIP, fullBody, verdictPS, fingerprint, traceId, startedAt);
            }

            // ---- ASYNC MODE: forward to production NOW, verify in the background ----
            if (LATENCY_MODE !== 'sync') {
                if (rateLimitExceeded(clientIP)) {
                    console.warn(`[GATEWAY] Rate limit hit for ${clientIP} -> skipping LLM (async), still proxying to production.`);
                } else {
                    analyzeInBackground(clientIP, req, fullBody, fingerprint, traceId, startedAt);
                }
                console.log(`[TRACE ${traceId}] decision -> production (async) in ${Date.now() - startedAt}ms`);
                recordRoute(traceId, startedAt, clientIP, fingerprint, req, {
                    decision: 'production',
                    reason: 'async mode: production served instantly, Sentinel verifies in background',
                    chain: ['blacklist-check:PASS', 'pre-scan:PASS', 'async-proxy-production', 'background-sentinel:pending']
                });
                const bufferStream = require('stream').Readable.from([fullBody]);
                return proxy.web(req, res, { target: TARGET_PRODUCTION, buffer: bufferStream });
            }

            // ---- SYNC MODE (fail-closed): wait for the LLM verdict before deciding ----
            try {
                console.log(`[GATEWAY] Analyzing request from ${clientIP} to ${req.url}...`);
                const analysis = await analyzeRequestDetailed(req.method, req.url, req.headers, fullBody);

                if (analysis.malicious) {
                    recordRoute(traceId, startedAt, clientIP, fingerprint, req, {
                        decision: 'decoy',
                        reason: `Sentinel MALICIOUS (${analysis.verdict && analysis.verdict.attack_type})`,
                        chain: ['blacklist-check:PASS', 'pre-scan:PASS', 'sentinel:MALICIOUS', 'blacklist-write', 'intel-record', 'route-decoy'],
                        via: analysis.via || null,
                        verdict: analysis.verdict || null
                    });
                    return handleAttack(req, res, clientIP, fullBody, analysis.verdict, fingerprint, traceId, startedAt);
                }

                console.log(`[TRACE ${traceId}] decision -> production (BENIGN) in ${Date.now() - startedAt}ms`);
                recordRoute(traceId, startedAt, clientIP, fingerprint, req, {
                    decision: 'production',
                    reason: 'Sentinel BENIGN: passed through to production',
                    chain: ['blacklist-check:PASS', 'pre-scan:PASS', 'sentinel:BENIGN'],
                    via: analysis.via || null,
                    verdict: analysis.verdict || null
                });
                const bufferStream = require('stream').Readable.from([fullBody]);
                proxy.web(req, res, { target: TARGET_PRODUCTION, buffer: bufferStream });
            } catch (error) {
                console.error('[GATEWAY-ERROR]', error);
                if (!res.headersSent) {
                    res.writeHead(500);
                    res.end('Gateway Error');
                }
            }
        });
    }).catch((e) => {
        console.error('[GATEWAY-FATAL]', e);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end('Gateway Error');
        }
    });
});

proxy.on('error', (err, req, res) => {
    console.error('[PROXY ERROR]', err.message);
    if (!res.headersSent) {
        res.writeHead(502);
        res.end('Target server offline.');
    }
});

const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
    console.log(`[GATEWAY] Mirage-Node live on port ${PORT} | store=${store.backend}`);
    console.log(`[GATEWAY] Dashboard intel : http://localhost:${PORT}/_mirage/dashboard`);
    console.log(`[GATEWAY] Agent registry  : http://localhost:${PORT}/_mirage/agents`);
});

/* ---------- Shutdown bersih: tutup listener & hentikan seluruh decoy ---------- */
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[GATEWAY] Received ${signal} -> graceful shutdown...`);
    server.close();
    Promise.race([
        architect.shutdownAll().catch(() => {}),
        new Promise((r) => setTimeout(r, 4000))
    ]).finally(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

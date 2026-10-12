/**
 * MIRAGE-NODE HONEYPOT :: fake_server (multi-profile)
 * ----------------------------------------------------
 * The DECOY_PROFILE env var picks the decoy personality:
 *   wordpress | api | generic
 * Forensic logs go to LOG_DIR (volume-mounted by the Architect) so TTP
 * evidence survives even when the container is destroyed.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROFILE = (process.env.DECOY_PROFILE || 'generic').toLowerCase();
const LOG_DIR = process.env.LOG_DIR || '/app/logs';

function appendLog(obj) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.appendFileSync(path.join(LOG_DIR, 'attacker_payloads.jsonl'), JSON.stringify(obj) + '\n');
    } catch (e) {
        try { fs.appendFileSync('attacker_payloads.fallback.log', JSON.stringify(obj) + '\n'); } catch (_) {}
    }
}

const PERSONAS = {
    wordpress: {
        serverHeader: 'Apache/2.4.41 (Unix)',
        extraHeaders: { 'X-Powered-By': 'PHP/7.4.3' },
        respond: (url) => ({
            status: url && url.includes('wp-login') ? 200 : 200,
            body: {
                status: 'success',
                message: 'Login successful. Redirecting to dashboard...',
                data: { id: 1, user_login: 'admin', role: 'administrator', hash: '$P$BpB5fJcXlZ9vJxK.9Qz8mN2pL4oI7uY' },
                wp_version: '6.4.2'
            }
        })
    },
    api: {
        serverHeader: 'gunicorn/20.1.0',
        extraHeaders: {},
        respond: () => ({
            status: 200,
            body: {
                ok: true,
                result: [{ id: 1, username: 'admin', token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.sig' }],
                db_time: new Date().toISOString()
            }
        })
    },
    generic: {
        serverHeader: 'nginx/1.24.0',
        extraHeaders: {},
        respond: () => ({
            status: 200,
            body: {
                status: 'success',
                message: 'Query executed',
                data: [{ id: 1, username: 'admin', hash: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918' }]
            }
        })
    }
};

const persona = PERSONAS[PROFILE] || PERSONAS.generic;

/** Persona selection: custom DECOY_PERSONA JSON wins when set; otherwise the stock profile. */
function buildPersona() {
    if (process.env.DECOY_PERSONA) {
        try {
            const custom = JSON.parse(process.env.DECOY_PERSONA);
            return {
                serverHeader: custom.serverHeader || persona.serverHeader,
                extraHeaders: custom.extraHeaders || {},
                respond: (url) => ({
                    status: Number.isInteger(custom.status) ? custom.status : persona.respond(url).status,
                    body: custom.body || persona.respond(url).body
                })
            };
        } catch (_) {
            // Malformed persona JSON -> fall back to the stock profile.
        }
    }
    return persona;
}

const activePersona = buildPersona();

const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c.toString(); if (body.length > 512000) req.destroy(); });
    req.on('end', () => {
        // Internal health endpoint - not an attack, never logged
        if (req.url === '/_health') {
            res.writeHead(200); res.end('ok');
            return;
        }

        appendLog({
            timestamp: new Date().toISOString(),
            profile: PROFILE,
            method: req.method,
            url: req.url,
            headers: req.headers,
            payload: body,
            sourceNote: 'captured-by-mirage-decoy'
        });
        console.log(`[HONEYPOT:${PROFILE}] Payload captured: ${req.method} ${req.url}`);

        const r = activePersona.respond(req.url);
        res.writeHead(r.status, {
            'Content-Type': 'application/json',
            'Server': activePersona.serverHeader,
            ...activePersona.extraHeaders
        });
        res.end(JSON.stringify(r.body));
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`[HONEYPOT:${PROFILE}] Shadow decoy live on port ${PORT}`);
});

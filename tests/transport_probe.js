/**
 * TRANSPORT PROBE :: Mencari penyebab 401 pada Node padahal curl OK.
 * Variasi: baseline, Accept header, User-Agent mirip curl, tanpa gzip.
 */
require('dotenv').config();
const KEY = process.env.GEMINI_API_KEY || '';
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-3.5-flash'}:generateContent`;
const BODY = JSON.stringify({ contents: [{ parts: [{ text: 'Reply exactly: PONG' }] }] });

const BASE_HEADERS = { 'Content-Type': 'application/json', 'x-goog-api-key': KEY };

const VARIANTS = [
    ['V1 baseline (seperti SDK)', { ...BASE_HEADERS }],
    ['V2 + Accept: */*', { ...BASE_HEADERS, 'Accept': '*/*' }],
    ['V3 + UA curl', { ...BASE_HEADERS, 'Accept': '*/*', 'User-Agent': 'curl/8.9.1' }],
    ['V4 + tanpa gzip', { ...BASE_HEADERS, 'Accept': '*/*', 'User-Agent': 'curl/8.9.1', 'Accept-Encoding': 'identity' }]
];

(async () => {
    console.log(`Target: ${URL_}\n`);
    for (const [name, headers] of VARIANTS) {
        try {
            const r = await fetch(URL_, { method: 'POST', headers, body: BODY });
            const t = await r.text();
            const verdict = r.ok ? `OK -> "${(t.match(/"text":"([^"]*)"/) || [, '?'])[1]}"` : `HTTP ${r.status}`;
            console.log(`${name.padEnd(30)} => ${verdict}`);
        } catch (e) {
            console.log(`${name.padEnd(30)} => NETWORK-ERROR: ${e.message}`);
        }
    }
})();

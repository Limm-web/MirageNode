/**
 * MODEL PROBE :: Menguji kombinasi [key AQ.] x [berbagai generasi model]
 * Tujuan: membuktikan apakah token ini memang hanya mendukung model terbaru.
 */
require('dotenv').config();
const KEY = process.env.GEMINI_API_KEY || '';
const MODELS = [
    'gemini-3.5-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-2.5-flash'
];

(async () => {
    console.log(`Key prefix: ${KEY.slice(0, 4)}***\n`);
    for (const m of MODELS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
        try {
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
                body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply exactly: PONG' }] }] })
            });
            const t = await r.text();
            const short = r.ok
                ? `OK -> "${(t.match(/"text":"([^"]*)"/) || [, '?'])[1]}"`
                : `code=${(t.match(/"code":(\d+)/) || [, '?'])[1]} reason=${(t.match(/"reason":"([^"]*)"/) || [, '?'])[1]} status=${(t.match(/"status":"([^"]*)"/) || [, '?'])[1]}${/not found|NOT_FOUND/i.test(t) ? ' [MODEL NOT FOUND]' : ''}`;
            console.log(`${m.padEnd(20)} HTTP ${String(r.status).padEnd(3)} ${short}`);
        } catch (e) {
            console.log(`${m.padEnd(20)} NETWORK-ERROR: ${e.message}`);
        }
    }
})();

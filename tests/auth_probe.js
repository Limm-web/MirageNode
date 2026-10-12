/**
 * AUTH PROBE :: Find which credential strategy the Gemini server accepts
 * Menguji 3 metode: x-goog-api-key header, query param ?key=, Authorization Bearer.
 */
require('dotenv').config();
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const BODY = JSON.stringify({ contents: [{ parts: [{ text: 'Reply exactly: PONG' }] }] });

async function probe(name, url, headers) {
    try {
        const r = await fetch(url, { method: 'POST', headers, body: BODY });
        const t = await r.text();
        console.log(`[${name}]`);
        console.log(`   HTTP ${r.status}`);
        console.log(`   ${t.slice(0, 160).replace(/\n/g, ' ')}`);
        console.log('');
        return r.ok;
    } catch (e) {
        console.log(`[${name}] NETWORK-ERROR: ${e.message}\n`);
        return false;
    }
}

(async () => {
    console.log(`Model: ${MODEL} | Key prefix: ${KEY.slice(0, 4)}***\n`);

    await probe('A) Header x-goog-api-key', BASE,
        { 'Content-Type': 'application/json', 'x-goog-api-key': KEY });

    await probe('B) Query param ?key=', BASE + '?key=' + encodeURIComponent(KEY),
        { 'Content-Type': 'application/json' });

    await probe('C) Authorization: Bearer', BASE,
        { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY });
})();

/**
 * FINAL PROBE :: Menutup semua hipotesis
 * T1: GET /models via Node fetch  -> kalau 401, SELURUH Node ditolak (TLS fingerprint).
 * T2: POST via Node http2 + header lengkap persis curl -> uji terakhir jalur murni Node.
 */
const http2 = require('http2');
require('dotenv').config();
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

(async () => {
    // ---- T1: GET models via fetch ----
    try {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
            headers: { 'x-goog-api-key': KEY }
        });
        console.log(`T1 GET /models via Node fetch   => HTTP ${r.status}`);
    } catch (e) {
        console.log(`T1 GET /models via Node fetch   => ERROR ${e.message}`);
    }

    // ---- T2: POST via http2 with headers identical to curl ----
    await new Promise((resolve) => {
        const BODY = JSON.stringify({ contents: [{ parts: [{ text: 'PONG' }] }] });
        const client = http2.connect('https://generativelanguage.googleapis.com');
        client.on('error', (e) => { console.log(`T2 POST via http2+full-hdr      => CONN-ERROR ${e.message}`); resolve(); });
        const req = client.request({
            ':method': 'POST',
            ':path': `/v1beta/models/${MODEL}:generateContent`,
            ':scheme': 'https',
            ':authority': 'generativelanguage.googleapis.com',
            'user-agent': 'curl/8.9.1',
            'accept': '*/*',
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(BODY),
            'x-goog-api-key': KEY
        });
        let data = '';
        req.on('response', (h) => { this._status = h[':status']; });
        req.on('data', (c) => data += c);
        req.on('end', () => {
            const ok = data.includes('"text"');
            console.log(`T2 POST via http2+full-hdr      => ${ok ? 'OK - PONG diterima!' : `HTTP ${this._status} masih ditolak`}`);
            client.close();
            resolve();
        });
        req.end(BODY);
    });

    console.log('\nConclusion: if both fail while curl always succeeds =>');
    console.log('penyebabnya TLS fingerprint (Schannel vs OpenSSL), bukan kode kita.');
})();

/**
 * H2 PROBE :: Menguji apakah HTTP/2 adalah kunci diterimanya token AQ.
 */
const http2 = require('http2');
require('dotenv').config();

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const BODY = JSON.stringify({ contents: [{ parts: [{ text: 'Reply exactly: PONG' }] }] });

const client = http2.connect('https://generativelanguage.googleapis.com');
client.on('error', (e) => { console.error('H2-CONN-ERROR:', e.message); process.exit(1); });

const req = client.request({
    ':method': 'POST',
    ':path': `/v1beta/models/${MODEL}:generateContent`,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(BODY),
    'x-goog-api-key': KEY
});

let data = '';
req.on('response', (h) => console.log(`HTTP status : ${h[':status']}`));
req.on('data', (c) => data += c);
req.on('end', () => {
    try {
        const j = JSON.parse(data);
        const text = j.candidates && j.candidates[0].content.parts[0].text;
        console.log(`Model reply : ${text}`);
        console.log(text.includes('PONG') ? '\n>>> HASIL: HTTP/2 BERHASIL - akar masalah ketemu!' : '\n>>> HTTP/2 lolos auth tapi jawaban tak terduga.');
    } catch (_) {
        console.log(`Raw: ${data.slice(0, 200)}`);
    }
    client.close();
});
req.end(BODY);

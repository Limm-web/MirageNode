/**
 * FLAP PROBE :: Run all 3 transports in parallel at once to trace the 401 pattern.
 */
require('dotenv').config();
const { spawn } = require('child_process');
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const BODY = JSON.stringify({ contents: [{ parts: [{ text: 'PONG' }] }] });

function curlSpawn(label) {
    return new Promise((res) => {
        const p = spawn('curl', ['-s', '--max-time', '20', '-X', 'POST',
            '-H', 'Content-Type: application/json',
            '-H', `x-goog-api-key: ${KEY}`,
            '--data-binary', '@-', URL_], { windowsHide: true });
        let o = '';
        p.stdout.on('data', d => o += d);
        p.on('close', () => res(`${label}: ${o.includes('"text"') ? '200 OK' : o.includes('401') ? '401' : '?'}`));
        p.stdin.write(BODY); p.stdin.end();
    });
}

(async () => {
    console.log('--- ENV CHECK ---');
    ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'NODE_OPTIONS'].forEach(k =>
        console.log(`${k.padEnd(14)} = ${process.env[k] || '(kosong)'}`));

    console.log('\n--- PUTARAN 1 ---');
    console.log(await curlSpawn('spawn-curl'));
    try {
        const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: BODY });
        console.log(`node-fetch    : HTTP ${r.status}`);
    } catch (e) { console.log('node-fetch    : ERR', e.message); }

    await new Promise(r => setTimeout(r, 1500));

    console.log('--- PUTARAN 2 (1.5 detik kemudian) ---');
    console.log(await curlSpawn('spawn-curl'));
})();

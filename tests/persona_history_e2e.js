// E2E P4 :: history-adapted persona proof -> writes _e2e_result.txt
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let out = '';
function req(pathname, method = 'GET', body = null) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request({ host: '127.0.0.1', port: 8888, path: pathname, method,
            headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
            timeout: 8000 }, (rs) => { rs.resume(); rs.on('end', () => resolve(rs.statusCode)); });
        r.on('error', () => resolve(0));
        r.on('timeout', () => { r.destroy(); resolve(0); });
        if (data) r.write(data);
        r.end();
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const gw = spawn(process.execPath, ['src/gateway/gateway.js'], {
        env: { ...process.env, TARGET_PRODUCTION: 'http://127.0.0.1:3000' }
    });
    const collect = (d) => { out += d.toString(); };
    gw.stdout.on('data', collect);
    gw.stderr.on('data', collect);

    for (let i = 0; i < 25; i++) { await sleep(400); if (out.includes('aktif di Port')) break; }

    await req('/api/login', 'POST', { username: "admin' OR 1=1 --", password: 'x' });

    for (let i = 0; i < 45; i++) {
        await sleep(1000);
        if (/New persona cached|rejected by validator/.test(out)) break;
    }

    await sleep(500);
    await req('/api/login', 'POST', { username: "admin' UNION SELECT * FROM users--", password: 'y' });
    await sleep(3000);

    const forged = /New persona cached/.test(out);
    const adapted = /history-adapted/.test(out);
    const routerOk = /\[ROUTER\] Attacker/.test(out);
    const fastRoute = /fast-route/i.test(out);

    const relevant = out.split('\n')
        .filter(l => /FORGE|ARCHITECT|ROUTER|SENTINEL-ALERT|STORE|GATEWAY\]|CAMPAIGN/.test(l))
        .slice(-15).join('\n');

    fs.writeFileSync('_e2e_result.txt',
        relevant + '\n\nRESULT ' + JSON.stringify({ forged, adapted, routerOk, fastRoute }));
    try { gw.kill(); } catch (_) {}
    process.exit(0);
})();

/**
 * BOOT CHECK :: Nyalakan fake_server (decoy) dan gateway sebagai proses anak,
 * pastikan keduanya listen, lalu matikan. Tanpa panggilan LLM.
 */
const { spawn } = require('child_process');
const http = require('http');

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function get(urlStr) {
    return new Promise((resolve) => {
        const req = http.get(urlStr, (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => resolve({ status: res.statusCode, body: b.slice(0, 60) }));
        });
        req.on('error', (e) => resolve({ status: 0, body: e.message }));
        req.setTimeout(2500, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    });
}

function boot(label, cmd, args, match, healthPort, extraEnv) {
    return new Promise(async (resolve) => {
        const p = spawn(cmd, args, {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, ...(extraEnv || {}) }
        });
        let out = '';
        p.stdout.on('data', (d) => (out += d));
        p.stderr.on('data', (d) => (out += d));

        let ok = false;
        for (let i = 0; i < 10; i++) {
            await wait(500);
            if (out.includes(match)) { ok = true; break; }
            if (p.exitCode !== null) break;
        }

        if (ok && healthPort) {
            const h = await get(`http://127.0.0.1:${healthPort}/_health`);
            ok = h.status === 200;
            console.log(`${label}: listen=${ok} health=${h.status} body="${h.body}"`);
        } else {
            console.log(`${label}: ${ok ? 'OK' : 'GAGAL'} | log: ${out.replace(/\n/g, ' | ').slice(0, 160)}`);
        }

        try { p.kill(); } catch (_) {}
        resolve(ok);
    });
}

(async () => {
    // Decoy langsung di host memakai port uji 8090 (hindari bentrok fallback kontainer di 8080)
    const r1 = await boot('DECOY  ', process.execPath,
        ['honeypot/fake_server.js'],
        'Decoy bayangan aktif', 8090, { PORT: '8090', LOG_DIR: './tmp_boot_logs' });

    const r2 = await boot('GATEWAY', process.execPath,
        ['src/gateway/gateway.js'],
        'Mirage-Node aktif', null, { PORT: '8899' });

    console.log(`\nBOOT-RESULT: decoy=${r1 ? 'PASS' : 'FAIL'} gateway=${r2 ? 'PASS' : 'FAIL'}`);
    process.exit(r1 && r2 ? 0 : 1);
})();

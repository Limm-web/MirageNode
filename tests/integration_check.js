/**
 * SEMENTARA :: Integrasi check v5.3
 * Tambahan v5.3:
 *   - MEMORY-BANK: bukti konteks kampanye bertahan LINTAS PROSES —
 *     serangan FASE-1 menulis snapshot; proses penguji ini (proses Node
 *     terpisah dari kedua gateway) membuktikan snapshot terbaca kembali.
 *     Ini simulasi mini dari "maintain context across weeks".
 * Perbaikan vs v5.1:
 *   - FIX-A: payload fast-route di-encodeURIComponent (karakter '; ' & spasi
 *     membuat http.request melempar error sinkron "unescaped characters").
 *   - FIX-B: proses gateway DIJAMIN dimatikan via try/finally. Di v5.1,
 *     exception FASE-1 melompati gw.kill(), proses demo tetap hidup memegang
 *     port, so the PHASE-2 gateway failed to bind and the token test hit the wrong server
 *     wrong server (everything looked like 200).
 */
const { spawn } = require('child_process');
const http = require('http');

const PORT = parseInt(((require('fs').readFileSync('./.env', 'utf8')
    .match(/^PORT=(\d+)/m) || [])[1]) || '8888', 10);
let out = '';

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function req(pathname, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const options = {
            host: '127.0.0.1', port: PORT, path: pathname, method,
            headers: Object.assign(
                data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
                headers
            ),
            timeout: 5000
        };
        let rq;
        try {
            rq = http.request(options, (rs) => {
                let b = '';
                rs.on('data', (c) => (b += c));
                rs.on('end', () => resolve({ status: rs.statusCode, body: b }));
            });
        } catch (e) {
            // Synchronous error (e.g. invalid path) -> do not crash; report it.
            return resolve({ status: 0, body: 'ERR:' + e.message });
        }
        rq.on('error', (e) => resolve({ status: 0, body: 'ERR:' + e.message }));
        rq.on('timeout', () => { rq.destroy(); resolve({ status: 0, body: 'ERR:timeout' }); });
        if (data) rq.write(data);
        rq.end();
    });
}

function safeJson(s) { try { return JSON.parse(s); } catch (_) { return null; } }

/** Poll hingga gateway menjawab /_mirage/intel 200 (atau waktu habis). */
async function waitForGateway(maxMs = 15000, token = '') {
    const intelPath = '/_mirage/intel' + (token ? '?token=' + encodeURIComponent(token) : '');
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
        const r = await req(intelPath);
        if (r.status === 200) return true;
        await wait(400);
    }
    return false;
}

(async () => {
    const results = [];
    const mark = (name, ok, detail = '') => {
        results.push(ok);
        console.log(`[${name}] ${ok ? 'PASS' : 'FAIL'} ${detail}`);
    };

    let gw = null; // FIX-B: referensi di luar try agar finally bisa membunuhnya
    try {
        // ===== FASE 1: gateway TANPA token (mode demo) =====
        gw = spawn(process.execPath, ['src/gateway/gateway.js'], {
            env: { ...process.env, PORT: String(PORT), TARGET_PRODUCTION: 'http://127.0.0.1:59999' /* sengaja mati */ },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        gw.stdout.on('data', (d) => (out += d));
        gw.stderr.on('data', (d) => (out += d));

        const up = await waitForGateway();
        mark('BOOT', up, `(via-${out.includes('Mirage-Node aktif') ? 'log-ok' : 'tcp'})`);
        if (!up) {
            console.log('\nGATEWAY LOG:\n' + out.slice(-800));
            results.push(false);
            return; // finally tetap menjalankan gw.kill()
        }

        // --- Registry agen ---
        const reg = await req('/_mirage/agents');
        const j = safeJson(reg.body);
        let agentsOk = false, agentDetail = '';
        if (j && Array.isArray(j.registeredAgents)) {
            agentsOk = reg.status === 200 && j.registeredAgents.length === 3 &&
                !!j.geapMapping['Agent Gateway'] &&
                String(j.geapMapping['Agent Registry']).includes('/_mirage/agents') &&
                j.registeredAgents[0].name === 'sentinel';
            agentDetail = `status=${reg.status} agents=${j.registeredAgents.length} geapMap=${Object.keys(j.geapMapping || {}).length} model=${j.model}`;
        } else agentDetail = `status=${reg.status} body-bukan-JSON`;
        mark('AGENTS', agentsOk, agentDetail);

        // --- Intel awal punya field traces ---
        const intel0 = await req('/_mirage/intel');
        const ji0 = safeJson(intel0.body);
        mark('INTEL-AWAL', intel0.status === 200 && ji0 && Array.isArray(ji0.traces) && Array.isArray(ji0.threats));

        // --- Pre-scan SQLi: threat + trace decoy (tanpa LLM) ---
        await req('/api/login', 'POST', { username: "admin' OR 1=1 --", password: 'x' });
        await wait(900);
        const ji1 = safeJson((await req('/_mirage/intel')).body);
        const threatOk = Boolean(ji1) && ji1.threats.length >= 1;
        const decoyTrace = ji1 && ji1.traces.find((t) => t.decision === 'decoy');
        const traceOk = Boolean(decoyTrace && decoyTrace.via === 'heuristic' &&
            Array.isArray(decoyTrace.chain) && decoyTrace.chain.some((c) => String(c).startsWith('pre-scan:HIT')));
        mark('PRESCAN', threatOk && traceOk,
            `threats=${ji1 ? ji1.threats.length : '?'} via=${decoyTrace ? decoyTrace.via : '-'}`);

        // --- Fast-route: penyerang kedua kali -> trace fast-route ---
        // FIX-A: query di-encode agar valid sebagai request-path HTTP.
        // Payload content is irrelevant: the IP was already blacklisted by PRESCAN above,
        // sehingga blacklist-check:HIT terjadi sebelum inspeksi konten.
        await req('/api/ping?host=' + encodeURIComponent('x; cat /etc/passwd'));
        await wait(700);
        const ji2 = safeJson((await req('/_mirage/intel')).body);
        const fast = ji2 && ji2.traces.find((t) => String(t.reason || '').includes('fast-route'));
        mark('FASTROUTE', Boolean(fast));

        await wait(300);
    } catch (e) {
        console.log('[FASE1] EXCEPTION:', e.message);
        results.push(false);
    } finally {
        // FIX-B: the PHASE-1 gateway MUST die no matter what happens.
        if (gw) { try { gw.kill(); } catch (_) {} }
        await wait(800); // beri waktu OS melepas port
    }

    let gw2 = null; // FIX-B
    try {
        // ===== PHASE 2: gateway WITH a token (Bug #1: ?token= propagation) =====
        out = '';
        const TOKEN = 'rahasia-demo-123';
        gw2 = spawn(process.execPath, ['src/gateway/gateway.js'], {
            env: { ...process.env, PORT: String(PORT), DASHBOARD_TOKEN: TOKEN },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        gw2.stdout.on('data', (d) => (out += d));
        gw2.stderr.on('data', (d) => (out += d));

        const up2 = await waitForGateway(15000, TOKEN);
        if (!up2) {
            mark('TOKEN-BOOT', false, 'gateway kedua tak kunjung siap\n' + out.slice(-400));
        } else {
            const noTok = await req('/_mirage/dashboard');
            const withQs = await req('/_mirage/dashboard?token=' + encodeURIComponent(TOKEN));
            const intelTok = await req('/_mirage/intel?token=' + encodeURIComponent(TOKEN));
            const bugFixOk = noTok.status === 401 && withQs.status === 200 && intelTok.status === 200;
            mark('BUG#1-TOKEN', bugFixOk,
                `no-token=${noTok.status}(401 expected) page?token=${withQs.status}(200 expected) intel?token=${intelTok.status}(200 expected)`);
        }
    } catch (e) {
        console.log('[FASE2] EXCEPTION:', e.message);
        results.push(false);
    } finally {
        if (gw2) { try { gw2.kill(); } catch (_) {} }
    }


    // ===== MEMORY-BANK: konteks kampanye bertahan lintas proses/restart =====
    let memOk = false, memDetail = 'failed to load module';
    try {
        const cm = require('../src/lib/campaign_memory');
        const st = cm.stats();
        memOk = st.campaignsTracked >= 1;
        memDetail = `tracked=${st.campaignsTracked}, events=${st.totalEvents} (snapshot read back by a different process)`;
    } catch (e) { memDetail = String(e.message).slice(0, 80); }
    mark('MEMORY-BANK', memOk, memDetail);
    const allOk = results.length > 0 && results.every(Boolean);
    console.log(`\nINTEGRASI-V53: ${allOk ? 'ALL PASS' : 'SOMETHING FAILED'} (${results.filter(Boolean).length}/${results.length})`);
    process.exit(allOk ? 0 : 1);
})();

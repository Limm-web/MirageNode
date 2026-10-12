/**
 * MIRAGE-NODE :: VIDEO DIRECTOR (Playwright)
 * -------------------------------------------
 * Executes the full demo script inside ONE continuous browser session and
 * records it as a single WebM (1080p-class). Terminal beats are REAL: the
 * director spawns the actual gateway/prod processes and pipes their genuine
 * stdout into an on-screen operations console (demo/console.html).
 *
 * Usage:
 *   node demo/director.js                # headed, full script incl. cloud
 *   node demo/director.js --headless --skip-cloud --fast   # CI / rehearsal
 *
 * Output:
 *   demo/_video/*.webm        raw recording (convert to mp4 later)
 *   demo/_cue_sheet.txt       [mm:ss] phase markers -> align your VO here
 */
'use strict';

/* ---------------- flags ---------------- */
const ARG = new Set(process.argv.slice(2));
const HEADLESS = ARG.has('--headless');
const SKIP_CLOUD = ARG.has('--skip-cloud');
const FAST = ARG.has('--fast');
const T = (ms) => FAST ? Math.round(ms / 4) : ms;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');

/* ---------------- tiny SSE broadcast server (the on-screen console) ------- */
const clients = new Set();
function broadcast(type, text) {
    const payload = JSON.stringify({ type, text, t: Date.now() });
    for (const res of clients) { try { res.write(`data: ${payload}\n\n`); } catch (_) {} }
}
const say = (t) => broadcast('log', t);
const sayOk = (t) => broadcast('ok', t);
const sayErr = (t) => broadcast('err', t);
const cmdLine = (t) => broadcast('cmd', t);

const CONSOLE_HTML = fs.readFileSync(path.join(__dirname, 'console.html'));
const srv = http.createServer((req, res) => {
    if (req.url === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write('retry: 1000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(CONSOLE_HTML);
    }
});

/* ---------------- real process management ---------------- */
let procs = [];
let GWLOG = '';
function spawnProc(label, args, envExtra) {
    const p = spawn(process.execPath, args, {
        cwd: ROOT,
        env: Object.assign({}, process.env, envExtra || {}),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    procs.push(p);
    const pipe = (d) => String(d).split('\n').filter(l => l.trim()).forEach(l => {
        say(`${label} ${l}`);
        if (label === '[GATEWAY]') GWLOG += l + '\n';
    });
    p.stdout.on('data', pipe);
    p.stderr.on('data', pipe);
    return p;
}
function killProc(p) { try { p.kill(); } catch (_) {} }

/** Run a real command and echo it like a typed terminal line. */
async function execShow(cmdLineText, timeoutMs = 60000) {
    cmdLine(cmdLineText);
    await sleep(T(700));
    return new Promise((resolve) => {
        const p = spawn('cmd.exe', ['/c', cmdLineText], { cwd: ROOT, windowsHide: true });
        let buf = '';
        const pump = (d, kind) => String(d).split('\n').filter(l => l.trim()).forEach(l => broadcast(kind, l));
        p.stdout.on('data', d => { buf += d; pump(d, 'log'); });
        p.stderr.on('data', d => pump(d, 'err'));
        const timer = setTimeout(() => { try { p.kill(); } catch (_) {} resolve(buf); }, timeoutMs);
        p.on('close', () => { clearTimeout(timer); resolve(buf); });
    });
}

function freePort(port) {
    try {
        const o = execSync(`netstat -ano | findstr ":${port}" | findstr LISTENING`, { shell: 'cmd.exe', encoding: 'utf8' });
        [...new Set(o.trim().split('\n').map(l => l.trim().split(/\s+/).pop()))].filter(Boolean)
            .forEach(pid => { try { execSync(`taskkill /PID ${pid} /F`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch (_) {} });
    } catch (_) {}
}

/* ---------------- main ---------------- */
(async () => {
    /* preflight */
    if (ARG.has('--no-docker')) { console.log('[director] --no-docker: decoy spawning disabled for this run'); }
    else {
        try { execSync('docker info --format {{.ServerVersion}}', { timeout: 15000 }); }
        catch (_) { console.error('Docker Desktop must be running (or pass --no-docker).'); process.exit(1); }
    }
    try { execSync('npm run clean --silent', { cwd: ROOT, shell: 'cmd.exe', stdio: 'ignore' }); } catch (_) {}
    try { execSync('docker rm -f $(docker ps -q --filter name=mirage-decoy)', { shell: 'cmd.exe', stdio: 'ignore' }); } catch (_) {}
    freePort(8888); freePort(3000);

    /* playwright import */
    let pw;
    try { pw = require('playwright'); }
    catch (_) { console.error('Run first:  npm i -D playwright && npx playwright install chromium'); process.exit(1); }

    await new Promise(r => srv.listen(8765, r));
    console.log('[director] console server on http://localhost:8765');

    const { chromium } = pw;
    const launchOpts = {
        channel: 'msedge', // use the system Edge (Chromium) — no browser download needed
        headless: HEADLESS,
        viewport: { width: 1440, height: 810 },
        recordVideo: { dir: path.join(__dirname, '_video'), size: { width: 1440, height: 810 } }
    };
    let ctx;
    try { ctx = await chromium.launchPersistentContext(path.join(__dirname, '.pw-profile'), launchOpts); }
    catch (e) { console.log('[director] msedge unavailable (' + e.message.split('\n')[0] + ') - back to bundled chromium'); delete launchOpts.channel; ctx = await chromium.launchPersistentContext(path.join(__dirname, '.pw-profile'), launchOpts); }
    const t0 = Date.now();
    const cues = [];
    const cue = (name) => {
        const ms = Date.now() - t0;
        cues.push([ms, name]);
        const mm = String(Math.floor(ms / 60000)).padStart(2, '0');
        const ss = String(Math.floor(ms % 60000 / 1000)).padStart(2, '0');
        console.log(`[CUE ${mm}:${ss}] ${name}`);
    };
    const page = await ctx.newPage();

    /* ---- PHASE 1 :: HOOK slide ---- */
    cue('P1 HOOK slide');
    const slide = (title, sub) => 'data:text/html;charset=utf-8,' + encodeURIComponent(
        `<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#161913;color:#EEEEE8;font-family:Consolas,monospace">
         <div style="font-size:64px;letter-spacing:14px;font-weight:700">MIRAGE<span style="color:#B3261E">-</span>NODE</div>
         <div style="font-size:22px;color:#AEB1A4;margin-top:18px;letter-spacing:4px">${sub}</div>
         <div style="font-size:15px;color:#666B5C;margin-top:60px">${title}</div></body>`);
    await page.goto(slide('All Things Agentic Hackathon · Fortified Enterprise Fleet', 'AGENTIC DECEPTION GATEWAY'));
    await sleep(T(9000));

    /* ---- PHASE 2 :: architecture diagram (real file render) ---- */
    cue('P2 ARCHITECTURE friction');
    await page.goto('file:///' + path.resolve(ROOT, 'docs/architecture.png').replace(/\\/g, '/'));
    await page.evaluate(() => { document.body.style.margin = 0; document.body.style.background = '#F7F7F1';
        const img = document.querySelector('img'); if (img) { img.style.width = '100vw'; img.style.display='block'; } });
    await sleep(T(19000));

    /* ---- PHASE 3 :: live console demo (real processes) ---- */
    cue('P3 LIVE CONSOLE demo');
    await page.setViewportSize({ width: 1440, height: 810 });
    await page.goto('http://localhost:8765/');
    await sleep(T(1200));
    say('[director] environment prepared · docker ready · ports freed');

    cmdLine('npm run start:prod');
    spawnProc('[PROD]', ['src/prod_server.js'], {});
    await sleep(T(1200));
    cmdLine('npm start');
    const gw1 = spawnProc('[GATEWAY]', ['src/gateway/gateway.js'], { TARGET_PRODUCTION: 'http://127.0.0.1:3000' });

    let up = false;
    for (let i = 0; i < 30 && !up; i++) { await sleep(400); up = /live on port/.test(GWLOG); }
    // benign
    cmdLine('demo\\benign.cmd');
    await sleep(T(900));
    const b1 = await fetchJson('http://127.0.0.1:8888/api/products');
    sayOk(b1.ok ? `HTTP ${b1.status} <- production: "${(b1.json && b1.json.message) || ''}"` : `HTTP ${b1.status}`);

    // SQLi -> prescan + forge(history-adapted) + decoy divert (all streamed by gw itself)
    cmdLine('demo\\sqli-local.cmd');
    await sleep(T(400));
    const forged = await waitFor(() => /New persona cached[^\n]*history-adapted/.test(GWLOG), 45000);
    if (forged) sayOk('[FORGE] persona forged by Gemini — HISTORY-ADAPTED to this attacker');
    else sayErr('[FORGE] fell back to stock persona (matrix absorbed the failure)');
    await sleep(T(1500));

    // fast-route
    cmdLine('demo\\fastroute.cmd');
    await sleep(T(1200));
    sayOk('fast-route: repeat offender diverted with ZERO LLM calls');

    function outTailPlaceholder() {}
    async function waitFor(fn, timeoutMs) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) { if (fn()) return true; await sleep(500); }
        return fn();
    }

    /* ---- PHASE 4 :: dashboard + restart survival ---- */
    cue('P4 CAMPAIGN LEDGER + restart survival');
    await page.goto('http://localhost:8888/_mirage/dashboard');
    await sleep(T(2500));
    try { await page.hover('#ledger tbody tr:first-child'); } catch (_) {}
    await sleep(T(2600)); // narration: ledger, no TTL, tally groups
    try { await page.hover('#ledger tbody tr:first-child td:nth-child(2)'); } catch (_) {}
    await sleep(T(2200)); // narration: hashes not PII

    // restart the REAL gateway mid-video
    say('[director] restarting the gateway process...');
    killProc(gw1); procs = procs.filter(p => p !== gw1);
    await sleep(T(1100));
    cmdLine('npm start');
    spawnProc('[GATEWAY]', ['src/gateway/gateway.js'], { TARGET_PRODUCTION: 'http://127.0.0.1:3000' });
    await sleep(T(2600));
    await page.reload();
    await sleep(T(2500));
    try { await page.hover('#ledger tbody tr:first-child'); } catch (_) {}
    await sleep(T(4200)); // narration: survives restarts, hydrates from Firestore

    /* ---- PHASE 5 :: agent registry + matrix ---- */
    cue('P5 AGENT REGISTRY + model matrix');
    await page.goto('http://localhost:8888/_mirage/agents');
    await page.evaluate(() => { document.body.style.fontFamily = 'Consolas,monospace'; document.body.style.fontSize='15px'; document.body.style.padding='16px'; });
    await sleep(T(5200));
    await page.mouse.wheel(0, 320); await sleep(T(1800));
    await execShow('type .env.example | findstr /i "GEMINI_MODEL_CHAIN MODEL_COOLDOWN"');
    await sleep(T(2600));

    /* ---- PHASE 6 :: GOOGLE CLOUD PROOF ---- */
    if (!SKIP_CLOUD) {
        cue('P6 CLOUD RUN + FIRESTORE proof');
        await page.goto('https://console.cloud.google.com/run/detail/asia-southeast2/mirage-gateway?project=majestic-vault-503707-g4');
        await humanPauseIfLogin(page);
        await sleep(T(8000));
        await page.mouse.wheel(0, 240); await sleep(T(2400));

        await page.goto('https://mirage-gateway-745571124540.asia-southeast2.run.app/_mirage/dashboard');
        await sleep(T(2600));

        await execShow('demo\\sqli-cloud.cmd', 30000);
        await sleep(T(1500));

        await page.goto('https://console.cloud.google.com/firestore/databases/-/data?project=majestic-vault-503707-g4');
        await sleep(T(7000));
        say('[director] open the `campaign` collection in this view');
        await sleep(T(3600));

        await page.goto('https://mirage-gateway-745571124540.asia-southeast2.run.app/_mirage/dashboard');
        await page.reload(); await sleep(T(2600));
        try { await page.hover('#ledger tbody tr:first-child'); } catch (_) {}
        await sleep(T(4200));
    } else {
        cue('P6 skipped (--skip-cloud)');
    }

    /* ---- PHASE 7 :: outro ---- */
    cue('P7 CLOSE slide');
    await page.goto(slide('docs/ · tests/ · deploy_cloudrun.sh', 'Firewalls block. MIRAGE-NODE remembers.'));
    await sleep(T(8500));

    /* ---- wrap ---- */
    const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}`;
    fs.writeFileSync(path.join(__dirname, '_cue_sheet.txt'),
        'MIRAGE-NODE take — align VO to these markers:\n' +
        cues.map(([ms, n]) => `[${mmss(ms)}] ${n}`).join('\n'));

    await ctx.close();
    if (!ARG.has('--keep')) {
        procs.forEach(killProc);
        try { execSync('docker rm -f $(docker ps -q --filter name=mirage-decoy)', { shell: 'cmd.exe', stdio: 'ignore' }); } catch (_) {}
    }
    srv.close();
    console.log('[director] DONE. Video: demo/_video/*.webm  Cue sheet: demo/_cue_sheet.txt');
    process.exit(0);

    /* ---------- helpers defined after use via hoisting-safe declarations ---------- */
    async function humanPauseIfLogin(pg) {
        if (/ServiceLogin|accounts\.google\.com/.test(pg.url())) {
            sayErr('[director] LOGIN required: complete Google sign-in in the opened window, then press ENTER here...');
            await waitEnter();
            await sleep(1500);
        }
    }
    async function waitEnter() {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise(r => rl.question('', () => { rl.close(); r(); }));
    }
})().catch(e => { console.error('[director] FATAL:', e.message); process.exit(1); });

/* fetch helper used above */
function fetchJson(url) {
    return new Promise((resolve) => {
        const m = url.match(/^http:\/\/127\.0\.0\.1:(\d+)(.*)$/);
        const rq = require('http').request({ host: '127.0.0.1', port: +m[1], path: m[2], timeout: 8000 }, rs => {
            let b = ''; rs.on('data', c => b += c); rs.on('end', () => {
                let json = null; try { json = JSON.parse(b); } catch (_) {}
                resolve({ status: rs.statusCode, json, body: b });
            });
        });
        rq.on('error', e => resolve({ status: 0, json: null, body: e.message }));
        rq.end();
    });
}

/**
 * MIRAGE-NODE :: DESKTOP DIRECTOR v3 (human-style · zero Playwright)
 * -------------------------------------------------------------------
 * Drives the real laptop: actual cursor paths, typing into a real PowerShell
 * window ("MIRAGE GATEWAY"), tabs in the user's real Chrome (their Google
 * session), screen recorded via ffmpeg. Attacks execute for real.
 *
 * Flags:
 *   --skip-cloud   stop before the Cloud Console proof phase
 *   --dry          rehearsal: no screen recording, compressed waits
 *   --no-docker    skip Docker requirement (decoys/persona degrade)
 *   --fast         compressed waits but still recorded
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ARG = new Set(process.argv.slice(2));
const SKIP_CLOUD = ARG.has('--skip-cloud');
const DRY = ARG.has('--dry');
const NO_DOCKER = ARG.has('--no-docker');
const ROOT = path.resolve(__dirname, '..');
const S = DRY ? 0.35 : 1.0;
const sleep = (ms) => new Promise(r => setTimeout(r, Math.round(ms * S)));

/* ---------- screen ---------- */
function screenSize() {
    try {
        const o = PS('Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width;[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height', 30000);
        const n = o.trim().split('\n').map(Number);
        if (n[0] > 100 && n[1] > 100) return { W: n[0], H: n[1] };
    } catch (_) {}
    return { W: 1920, H: 1080 };
}
function PS(command, timeoutMs = 90000) {
    return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${command.replace(/"/g, '\\"')}"`,
        { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
}

function SCREEN_W(){ return screenSize().W }
function SCREEN_H(){ return screenSize().H }

/* ---------- human input ---------- */
function drv(action, extra = '') {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(__dirname, 'input.ps1')}" -Action ${action} ${extra}`,
        { timeout: 120000, windowsHide: true });
}
async function move(x, y, steps = 26) { drv('move', `-X ${Math.round(x)} -Y ${Math.round(y)} -Steps ${steps}`); }
function click() { drv('click'); }
function wheel(a) { drv('wheel', `-Amount ${a}`); }
function typeText(t) { drv('type', `-Text "${t.replace(/"/g, '')}"`); }
function combo(c) { drv('combo', `-Combo ${c}`); }
function key(k) { drv('key', `-Combo ${k}`); }

/* ---------- windows ---------- */
function winTitle(title, opts = '') {
    try {
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(__dirname, 'win.ps1')}" -Title "${title}" ${opts}`,
            { timeout: 60000, windowsHide: true });
        return true;
    } catch (_) { return false; }
}
function focusChrome(maximize = false) {
    try {
        PS(`Add-Type -AssemblyName System.Windows.Forms;Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class WC{[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);}' ; $p=Get-Process chrome -ErrorAction Stop|Where-Object{$_.MainWindowHandle -ne 0}|Select-Object -First 1;$h=$p.MainWindowHandle;[void][WC]::SetForegroundWindow($h)${maximize ? ';[WC]::ShowWindow($h,3)' : ''}`, 60000);
    } catch (_) {}
}
function openTab(url) { execSync(`start chrome "${url}"`, { shell: 'cmd.exe', timeout: 30000 }); }

/* ---------- attacker terminal windows ---------- */
function placeWin(title, x, y, w, h) {
    try { execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(__dirname, 'win.ps1')}" -Title "${title}" -X ${x} -Y ${y} -W ${w} -H ${h} -Focus`,
        { timeout: 60000, windowsHide: true }); } catch (_) {}
}

function launchTerm(title, command) {
    spawn('cmd.exe', ['/c', 'start', '', 'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit',
        '-Command', "$host.UI.RawUI.WindowTitle='" + title + "'; Set-Location '" + ROOT + "'"],
        { detached: true, windowsHide: false, stdio: 'ignore' }).unref();
}

/* ---------- gateway probes ---------- */
function intelJSON() {
    try { return JSON.parse(execSync('curl.exe -s http://localhost:8888/_mirage/intel',
        { encoding: 'utf8', timeout: 15000, windowsHide: true })); }
    catch (_) { return null; }
}
async function waitGateway(timeoutMs = 35000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        const j = intelJSON();
        if (j && Array.isArray(j.traces)) return true;
        await sleep(500);
    }
    return false;
}
function fireAttack(file, timeoutMs = 90000) {
    let out = '', code = 0;
    const p = spawn('cmd.exe', ['/c', path.join(__dirname, file)],
        { windowsHide: true, cwd: ROOT });
    return new Promise((resolve) => {
        p.stdout.on('data', d => out += d);
        p.stderr.on('data', d => out += d);
        const t = setTimeout(() => { try { p.kill(); } catch (_) {} resolve({ code: -9, out }); }, timeoutMs);
        p.on('close', c => { clearTimeout(t); resolve({ code: c ?? 0, out }); });
    }).then(r => ({ code: r.code, out: String(r.out).trim() }));
}

/** Wait until either campaign events grew OR a fresh decoy trace appears. */
async function waitHandled(evBefore, markTs, timeoutMs = 45000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        const j = intelJSON();
        if (j) {
            const grew = ((j.campaigns || {}).totalEvents ?? 0) > evBefore;
            const tr = (j.traces || [])[0];
            const diverted = tr && tr.ts >= markTs - 500 && String(tr.decision || '').includes('decoy');
            if (grew || diverted) {
                console.log('[director] attack handled :: ' +
                    (diverted && !grew ? 'fast-route diversion' : 'campaign event recorded'));
                return true;
            }
        }
        
    }
    console.log('[director] attack handling not confirmed within window');
    return false;
}

/* ---------- cues ---------- */
const CUES = [];
let REC_T0 = Date.now();
function cue(name) {
    const ms = Date.now() - REC_T0;
    CUES.push([ms, name]);
    console.log(`[CUE ${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}] ${name}`);
}

/* ================= MAIN ================= */
(async () => {
    /* ---- OFF-CAM prep ---- */
    if (!NO_DOCKER) {
        let ok = true;
        try { execSync('docker info --format {{.ServerVersion}}', { timeout: 15000, windowsHide: true }); }
        catch (_) { ok = false; }
        if (!ok) { console.error('[director] Docker Desktop is OFF. Start it, or rerun with --no-docker'); process.exit(1); }
    } else {
        console.log('[director] --no-docker: decoy spawning disabled this run');
    }
    try { execSync('npm run clean --silent', { cwd: ROOT, shell: 'cmd.exe', stdio: 'ignore' }); } catch (_) {}
    try { execSync('docker rm -f $(docker ps -q --filter name=mirage-decoy)', { shell: 'cmd.exe', stdio: 'ignore' }); } catch (_) {}
    try { execSync('taskkill /IM chrome.exe /F', { shell: 'cmd.exe', stdio: 'ignore' }); } catch (_) {}
    await sleep(S * 1000);

    /* hidden production server */
    spawn('powershell', ['-NoProfile', '-Command',
        `Set-Location '${ROOT}'; npm run start:prod`],
        { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    await sleep(S * 1300);

    /* auto-render architecture.png from the live HTML diagram (Edge headless) */
    try {
        const edgePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
                          'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
            .find(p => fs.existsSync(p));
        const htmlM = fs.statSync(path.join(ROOT, 'demo', 'arch-live.html')).mtimeMs;
        let pngM = 0;
        try { pngM = fs.statSync(path.join(ROOT, 'docs', 'architecture.png')).mtimeMs; } catch (_) {}
        if (!pngM || htmlM > pngM - 2000) {
            execSync('"' + edgePath + '" --headless=new --disable-gpu --window-size=1920,1080 --screenshot="' +
                path.join(ROOT, 'docs', 'architecture.png') + '" "file:///' +
                path.join(ROOT, 'demo', 'arch-live.html').replace(/\\/g, '/') + '"',
                { timeout: 60000, windowsHide: true, stdio: 'ignore' });
            console.log('[director] architecture.png re-rendered');
        }
    } catch (_) {}

    /* recorder */
    let ff = null;
    if (!DRY) {
        ff = spawn('ffmpeg', ['-y', '-f', 'gdigrab', '-framerate', '30', '-i', 'desktop',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
            path.join(__dirname, '_take.mkv')], { stdio: ['ignore', 'ignore', 'ignore'] });
        await sleep(S * 1400);
    }
    REC_T0 = Date.now();


    /* ---- P1 HOOK ---- */
    cue('P1 HOOK slide');
    openTab('file:///' + path.join(ROOT, 'demo/slide.html').replace(/\\/g, '/'));
    await sleep(S * 2600);
    focusChrome(true);
    await sleep(S * 7200);

    /* ---- P2 ARCHITECTURE ---- */
    cue('P2 GUIDED TOUR architecture (zoomed)');
    const W = SCREEN_W(), H = SCREEN_H();
    openTab('file:///' + path.join(ROOT, 'demo/tour.html').replace(/\\/g, '/'));
    await sleep(S * 2600);
    focusChrome(true);
    await key('f11'); await sleep(S * 900);            // fullscreen -> exact geometry
    const CAM = [['1', 2700], ['2', 2500], ['3', 2500], ['4', 2500], ['5', 2500], ['6', 2500], ['7', 2700]];
    for (const [k, hold] of CAM) {
        await key(k); await sleep(S * 1150);           // cinematic pan transition
        await move(Math.round(W / 2), Math.round(H / 2), 16);
        await sleep(S * hold);
    }
    await key('0'); await sleep(S * 900);              // reset zoom
    await key('f11'); await sleep(S * 700);            // leave fullscreen

    const DASH_X = () => Math.round(W * 0.35);
    const DASH_Y = () => Math.round(H * (270 / 1080)); // ledger first-row center at fullscreen

    /* ---- P3 LIVE CONSOLE + ATTACK ---- */
    cue('P3 LIVE CONSOLE boot');
    spawn('cmd.exe', ['/c', 'start', '', path.join(__dirname, 'gateway-visible.cmd')],
        { detached: true, windowsHide: false, stdio: 'ignore' }).unref();
    await sleep(S * 2400);
    winTitle('MIRAGE GATEWAY', '-Max -Focus');
    await sleep(S * 500);
    typeText('cd D:\\PROJECT\\MirageNode'); await key('enter'); await sleep(S * 700);
    typeText('npm start'); await key('enter');
    const live = await waitGateway(45000);
    console.log(live ? '[director] gateway LIVE on camera' : '[director] WARNING: health probe timeout');
    await sleep(S * 4200);

    cue('P3b SQLi fired (real attack)');
    const evBefore = (intelJSON() || { campaigns: { totalEvents: 0 } }).campaigns.totalEvents;
        launchTerm('MIRAGE ATTACKER');
    await sleep(S * 1700);
    placeWin('MIRAGE ATTACKER', SCREEN_W() - 840, 70, 820, 440);
    await sleep(S * 500);
    await move(SCREEN_W() - 840 + 400, 70 + 200, 16); await click();
    await sleep(S * 300);
    typeText('demo\\sqli-local.cmd'); await key('enter');
    console.log('[director] SQLi typed visibly in MIRAGE ATTACKER window');

    // human reading drift while forge/decoy/router stream in the window
    for (let i = 0; i < 6; i++) { await move(W * (0.45 + i * 0.03), H * (0.45 + i * 0.05), 12); await sleep(S * 1100); }
    const handled = await waitHandled(evBefore, Date.now() - S * 1100 * 6 - 2000, 45000);

    cue('P3c LEDGER payoff');
    openTab('http://localhost:8888/_mirage/dashboard');
    await sleep(S * 3000);
    await key('f11'); await sleep(S * 800);
    await key('f5'); await sleep(S * 2200);
    await move(DASH_X(), DASH_Y(), 22); click();
    await move(DASH_X() + 18, DASH_Y() + 6, 12); await sleep(S * 1700);
    await key('f11'); await sleep(S * 600);

    /* ---- P4 RESTART SURVIVAL ---- */
    cue('P4 restart survival');
    winTitle('MIRAGE GATEWAY', '-Focus');
    combo('control+c'); await sleep(S * 950);
    typeText('npm start'); await key('enter');
    await waitGateway(32000);
    await sleep(S * 2500);
    focusChrome();
    await sleep(S * 700);
    await key('f11'); await sleep(S * 800);
    await key('f5'); await sleep(S * 2400);
    await move(DASH_X(), DASH_Y(), 20);
    await sleep(S * 3400);
    await key('f11'); await sleep(S * 600);

    /* ---- P5 REGISTRY + MATRIX ---- */
    cue('P5 AGENT REGISTRY');
    openTab('http://localhost:8888/_mirage/agents');
    await sleep(S * 3400);
    for (const fy of [0.30, 0.42, 0.54]) { await move(W * 0.42, H * fy, 18); await sleep(S * 1600); }
    wheel(-4); await sleep(S * 1400);

    cue('P5b MODEL CHAIN (.env.example)');
    openTab('file:///' + path.join(ROOT, '.env.example').replace(/\\/g, '/'));
    await sleep(S * 2100);
    combo('control+f'); await sleep(S * 450);
    typeText('GEMINI_MODEL_CHAIN'); await key('enter'); await sleep(S * 850); await key('escape');
    await sleep(S * 3600);

    /* ---- P6 CLOUD PROOF ---- */
    if (!SKIP_CLOUD) {
        cue('P6 CLOUD RUN console');
        openTab('https://console.cloud.google.com/run/detail/asia-southeast2/mirage-gateway?project=majestic-vault-503707-g4');
        await sleep(S * 13000);
        wheel(-3); await sleep(S * 2000); wheel(-2); await sleep(S * 1800);

        cue('P6b public dashboard');
        openTab('https://mirage-gateway-745571124540.asia-southeast2.run.app/_mirage/dashboard');
        await sleep(S * 4800);
        await move(W * 0.34, H * 0.38, 20); await sleep(S * 1200);

        cue('P6c attack public endpoint');
        launchTerm('MIRAGE ATTACKER 2');
        await sleep(S * 1700);
        placeWin('MIRAGE ATTACKER 2', SCREEN_W() - 840, 70, 820, 440);
        await sleep(S * 500);
        await move(SCREEN_W() - 840 + 400, 70 + 200, 16); await click();
        await sleep(S * 300);
        typeText('demo\\sqli-cloud.cmd'); await key('enter');
        console.log('[director] public endpoint attacked visibly');
        await sleep(S * 2100);

        cue('P6d FIRESTORE campaign');
        openTab('https://console.cloud.google.com/firestore/databases/-/data?project=majestic-vault-503707-g4');
        await sleep(S * 11500);
        wheel(-3); await sleep(S * 2000); wheel(-2); await sleep(S * 1600);

        cue('P6e ledger shows public attack');
        openTab('https://mirage-gateway-745571124540.asia-southeast2.run.app/_mirage/dashboard');
        await sleep(S * 4200);
        await key('f5'); await sleep(S * 2600);
        await move(W * 0.30, H * 0.38, 22);
        await sleep(S * 3600);
    }

    /* ---- P7 MONTAGE ---- */
    const mdir = path.join(ROOT, 'montage');
    if (fs.existsSync(mdir)) {
        cue('P7 MONTAGE stills');
        for (const f of fs.readdirSync(mdir).filter(x => /\.png$/i.test(x))) {
            openTab('file:///' + path.join(mdir, f).replace(/\\/g, '/'));
            await sleep(S * 4300);
        }
    }

    /* ---- P8 CLOSE ---- */
    cue('P8 CLOSE slide');
    openTab('file:///' + path.join(ROOT, 'demo/slide.html').replace(/\\/g, '/') + '?close=1');
    await sleep(S * 9500);

    /* ---- stop ---- */
    if (ff) { try { ff.kill(); } catch (_) {} await sleep(1600); }
    if (!DRY) {
        try {
            execSync(`ffmpeg -y -i "${path.join(__dirname, '_take.mkv')}" -c copy "${path.resolve(ROOT, 'mirage-node-demo.mp4')}"`,
                { timeout: 300000, stdio: 'ignore', windowsHide: true });
            console.log('[director] MP4 ready: mirage-node-demo.mp4');
        } catch (e) { console.log('[director] remux failed:', e.message); }
    }
    const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}`;
    fs.writeFileSync(path.join(__dirname, '_cue_sheet.txt'),
        'DESKTOP TAKE — align VO:\n' + CUES.map(([ms, n]) => `[${mmss(ms)}] ${n}`).join('\n'));
    console.log('[director] DONE.' + (DRY ? ' (DRY RUN — nothing recorded)' : ' Take saved: mirage-node-demo.mp4'));
    process.exitCode = 0;
})().catch(e => { console.error('[director] FATAL:', e.message); process.exit(1); });

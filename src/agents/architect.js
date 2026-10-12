/**
 * MIRAGE-NODE :: DECEPTION ARCHITECT (async, non-blocking, self-cleaning)
 * -----------------------------------------------------------------------
 * - No side effects on import (explicit init).
 * - Attack-profile detection -> spawn the MATCHING hardened decoy container.
 * - v5.5 (P4): decoy personas are LLM-forged and can be ADAPTED TO THE
 *   ATTACKER'S CAMPAIGN HISTORY (persona-per-fingerprint) via Persona Forge.
 * - v5.1: race-safe spawning - parallel callers share one spawn promise per
 *   profile; no more duplicate docker runs or port conflicts.
 * - getStatus(): metadata feed for the /_mirage/agents Agent Registry.
 * - Hardened sandbox: cap-drop ALL, no-new-privileges, read-only fs, limited
 *   tmpfs, CPU/RAM limits, isolated 'honeynet' network.
 * - Decoy forensic logs are volume-mounted to the host (decoy_logs/).
 * - Graceful degradation: no Docker? Intel keeps running without decoys.
 * - Anti self-DoS: pool capped at MAX_DECOYS; same-profile decoys are reused.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const path = require('path');
const fs = require('fs');

const execFileP = promisify(execFile);
const personaForge = require('../lib/persona_forge');

const MAX_DECOYS = parseInt(process.env.MAX_DECOYS || '4', 10);
const BASE_PORT = parseInt(process.env.DECOY_BASE_PORT || '8081', 10);
const LOG_DIR = path.resolve('decoy_logs');
// TTL decoy: kontainer sementara, bukan pelabuhan permanen (hemat resource).
const DECOY_TTL_MS = parseInt(process.env.DECOY_TTL_MINUTES || '30', 10) * 60 * 1000;

let dockerProbePromise = null;    // memo: cek daemon cukup sekali
let imageBuildPromise = null;     // memo: build the image once (retried on failure)
let networkReadyPromise = null;   // memo: pastikan jaringan honeynet ada
const active = new Map();         // profile -> { port, containerId }
const inflightSpawns = new Map(); // profile -> Promise<port|null> (anti-race v5.1)
let lastDockerAvailable = false;  // last known status, surfaced by registry/discovery

/** Run docker commands without a shell -> injection-proof, never blocks the event loop. */
function docker(args) {
    return execFileP('docker', args);
}

function probeDocker() {
    if (!dockerProbePromise) {
        dockerProbePromise = docker(['info'])
            .then(() => { lastDockerAvailable = true; console.log('[ARCHITECT] Docker available.'); return true; })
            .catch(() => {
                lastDockerAvailable = false;
                console.warn('[ARCHITECT] Docker unavailable - intel keeps running without decoys.');
                return false;
            });
    }
    return dockerProbePromise;
}

function buildImage() {
    if (!imageBuildPromise) {
        imageBuildPromise = docker(['build', '-q', '-t', 'mirage-honeypot', './honeypot'])
            .then(() => true)
            .catch((e) => {
                imageBuildPromise = null; // izinkan retry pada request berikutnya
                console.error('[ARCHITECT-ERROR] Image build failed:', String(e.message).slice(0, 120));
                return false;
            });
    }
    return imageBuildPromise;
}

function ensureNetwork() {
    if (!networkReadyPromise) {
        networkReadyPromise = docker(['network', 'inspect', 'honeynet'])
            .catch(() => docker(['network', 'create', '--driver', 'bridge', 'honeynet']))
            .catch((e) => {
                networkReadyPromise = null;
                throw e;
            });
    }
    return networkReadyPromise;
}

/** Pick the decoy profile from URL / User-Agent traits. */
function detectProfile(url = '', ua = '') {
    const s = `${url} ${ua}`.toLowerCase();
    if (s.includes('wp-admin') || s.includes('wordpress') || s.includes('wp-login')) return 'wordpress';
    if (s.includes('/api') || s.includes('.json') || s.includes('graphql')) return 'api';
    return 'generic';
}

/**
 * Forge a decoy persona for a profile (Blueprint #2). Returns a compact JSON string
 * or null when forging fails/is unavailable -> the honeypot uses its stock persona.
 * Absolutely fail-soft: forge must NEVER break decoy spawning.
 */
async function forgePersona(profile, history) {
    try {
        return await personaForge.getPersona(profile, { history });
    } catch (e) {
        console.warn(`[ARCHITECT] Persona forge failed (${String(e.message).slice(0, 90)}) -> stock persona.`);
        return null;
    }
}

/**
 * Titik masuk publik spawn decoy — ANTI-RACE (v5.1):
 * memo promise per profil sehingga pemanggil paralel berbagi satu spawn.
 * Return nomor port host, atau null bila tidak bisa spawn.
 */
/**
 * Spawn (or reuse) a decoy for `profile`. `history` is the attacker's
 * campaign summary from the Memory Bank; when provided, the decoy persona
 * is forged to reflect that history (persona-per-fingerprint, P4).
 * Note: containers are reused per profile, so a history-adapted persona
 * takes effect on the spawn cycle that creates/renews the container.
 */
async function spawnDecoy(profile, history) {
    if (active.has(profile)) return active.get(profile).port;

    const running = inflightSpawns.get(profile);
    if (running) return running;

    const p = doSpawnDecoy(profile, history).finally(() => inflightSpawns.delete(profile));
    inflightSpawns.set(profile, p);
    return p;
}

/** Implementasi spawn sesungguhnya (hanya dijalankan SEKALI per profil). */
async function doSpawnDecoy(profile, history) {
    if (!(await probeDocker())) return null;
    if (!(await buildImage())) return null;
    try { await ensureNetwork(); } catch (_) {}

    // Re-check after await (another caller may have finished spawning this profile).
    if (active.has(profile)) return active.get(profile).port;

    if (active.size >= MAX_DECOYS) {
        // Pool full: reuse an existing decoy instead of spawning a new one (anti self-DoS).
        const fallbackProfile = active.get('generic') ? 'generic' : [...active.keys()][0];
        if (fallbackProfile) return active.get(fallbackProfile).port;
        return null;
    }

    const usedPorts = new Set([...active.values()].map((v) => v.port));
    let port = BASE_PORT;
    while (usedPorts.has(port)) port++;

    const name = `mirage-decoy-${profile}-${port}`;
    fs.mkdirSync(LOG_DIR, { recursive: true });

    // v5.5: LLM-forged persona, optionally adapted to the attacker's
    // campaign history. Null -> container falls back to stock persona.
    const personaJson = await forgePersona(profile, history);

    const args = [
        'run', '-d',
        '--name', name,
        '--network', 'honeynet',
        '-p', `${port}:8080`,
        '--memory=128m',
        '--cpus=0.5',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt', 'no-new-privileges',
        '--tmpfs', '/tmp:rw,size=16m,noexec',
        '-v', `${LOG_DIR}:/app/logs`,
        '-e', `DECOY_PROFILE=${profile}`,
        'mirage-honeypot'
    ];
    if (personaJson) args.push('-e', `DECOY_PERSONA=${personaJson}`);

    /** Poll the container's /_health until ready (in-container app needs a few seconds). */
    function waitForDecoyReady(targetPort, timeoutMs = 8000) {
        const started = Date.now();
        return new Promise((resolve) => {
            const retryOrTimeout = () => {
                if (Date.now() - started >= timeoutMs) return resolve(false);
                setTimeout(attempt, 300);
            };
            const attempt = () => {
                const req = http.get({ host: '127.0.0.1', port: targetPort, path: '/_health', timeout: 1000 }, (res) => {
                    res.resume();
                    if (res.statusCode === 200) return resolve(true);
                    retryOrTimeout();
                });
                req.on('error', retryOrTimeout);
                req.on('timeout', () => { req.destroy(); retryOrTimeout(); });
            };
            attempt();
        });
    }

    // Transient retries (e.g. a just-created honeynet network not fully ready yet).
    const MAX_ATTEMPTS = parseInt(process.env.DECOY_SPAWN_RETRIES || '2', 10);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const { stdout } = await docker(args);
            const containerId = stdout.trim();
            active.set(profile, { port, containerId });
            scheduleReaper(profile, containerId);
            // Wait until the container truly serves traffic before the gateway uses the port.
            const ready = await waitForDecoyReady(port);
            if (!ready) console.warn(`[ARCHITECT] Decoy '${profile}' not ready within deadline; using it best-effort.`);
            console.log(`[ARCHITECT] Decoy '${profile}' standing by on :${port} (${containerId.slice(0, 8)}), TTL ${Math.round(DECOY_TTL_MS / 60000)} min` +
                (attempt > 1 ? ` (attempt ${attempt})` : '') +
                (personaJson ? ` [LLM persona ${personaJson.length}B${history ? ', history-adapted' : ''}]` : ' [stock persona]'));
            return port;
        } catch (e) {
            console.error(`[ARCHITECT] Spawn decoy '${profile}' failed (attempt ${attempt}/${MAX_ATTEMPTS}):`, String(e.message).slice(0, 120));
            // Clean up partial container so retries never clash on names.
            try { await docker(['rm', '-f', name]); } catch (_) {}
            if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 800));
        }
    }
    console.error('[ARCHITECT-ERROR] Decoy spawn kept failing after all attempts.');
    return null;
}

/** Reaper: TTL-expired decoys are terminated and removed automatically (no container leaks). */
function scheduleReaper(profile, containerId) {
    const timer = setTimeout(async () => {
        console.log(`[ARCHITECT] Decoy '${profile}' reached TTL -> terminating.`);
        try { await docker(['rm', '-f', containerId]); } catch (_) {}
        const cur = active.get(profile);
        if (cur && cur.containerId === containerId) active.delete(profile);
    }, DECOY_TTL_MS);
    timer.unref();
}

/** Registry metadata (discovery): served by GET /_mirage/agents. */
function getStatus() {
    return {
        dockerAvailable: lastDockerAvailable,
        activeDecoys: [...active.keys()],
        maxDecoys: MAX_DECOYS,
        decoyTtlMinutes: Math.round(DECOY_TTL_MS / 60000)
    };
}

/** Graceful shutdown: terminate every active decoy (called by gateway on SIGTERM/SIGINT). */
async function shutdownAll() {
    const jobs = [];
    for (const [, d] of active) jobs.push(docker(['rm', '-f', d.containerId]).catch(() => {}));
    const n = jobs.length;
    active.clear();
    await Promise.all(jobs);
    if (n > 0) console.log(`[ARCHITECT] ${n} decoys terminated on shutdown.`);
}

module.exports = { initWarmPool: probeDocker, spawnDecoy, detectProfile, shutdownAll, getStatus };

/**
 * SECRET SCAN :: gerbang anti-bocor sebelum commit.
 *
 * Memindai output `git diff` (working tree) untuk pola kredensial umum:
 *   - Google API key (AIza...)
 *   - Private key PEM
 *   - Penugasan api_key/secret/password dengan nilai panjang
 *   - Bearer token & JWT
 *
 * Pakai:
 *   node scripts/secret_scan.js            # scan unstaged + staged vs HEAD
 *   node scripts/secret_scan.js --cached   # scan apa yang AKAN di-commit saja
 *
 * Exit code: 0 = bersih, 1 = ditemukan indikasi kredensial (blokir commit).
 */
'use strict';

const { execSync } = require('child_process');

const PATTERNS = [
    { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/ },
    { name: 'Private key PEM', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
    { name: 'Assignment rahasia', re: /(api[_-]?key|apisecret|client[_-]?secret|password|passwd|auth[_-]?token)\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}["']/i },
    { name: 'Bearer token hardcoded', re: /authorization['"]?\s*[:=]\s*["']bearer\s+[A-Za-z0-9._-]{20,}/i },
];

// Heuristik nilai placeholder resmi yang TIDAK boleh dianggap bocor.
const ALLOW = /(?:your[_-]?api[_-]?key|<[^>]+>|\$\{|\{\{|\.\.\.|xxxxx|example|placeholder|changeme)/i;

const args = new Set(process.argv.slice(2));
const cmd = args.has('--cached')
    ? 'git diff --cached -U0'
    : 'git diff HEAD -U0';

let diff;
try {
    diff = execSync(cmd, { maxBuffer: 1e8, encoding: 'utf8' });
} catch (e) {
    // git exit 1 saat tidak ada diff -> bukan error bagi kita
    diff = e.stdout || '';
}

let hits = 0;
for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const content = line.slice(1);
    // Baris komentar murni berisi instruksi placeholder diabaikan bila cocok ALLOW
    for (const { name, re } of PATTERNS) {
        if (re.test(content)) {
            const value = content.match(re)[0];
            if (ALLOW.test(value)) continue;
            hits++;
            console.error(`[SECRET-SCAN] ${name}: ${line.trim().slice(0, 140)}`);
        }
    }
}

if (hits > 0) {
    console.error(`\n[SECRET-SCAN] DITOLAK: ${hits} indikasi kredensial. Jangan commit!`);
    process.exit(1);
}
console.log('[SECRET-SCAN] Bersih — tidak ada pola kredensial.');

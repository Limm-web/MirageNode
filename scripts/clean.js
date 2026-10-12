/**
 * MIRAGE-NODE :: CLEAN (lintas-platform)
 * Menghapus artefak runtime tanpa bergantung pada perintah Unix `rm -rf`
 * (aman dijalankan di Windows CMD, PowerShell, maupun shell POSIX).
 */
const fs = require('fs');
const path = require('path');

const TARGETS = [
    'decoy_logs',
    'tmp_boot_logs',
    'threat_intel.local.jsonl',
    'attacker_payloads.fallback.log',
    'attacker_payloads.jsonl',
    'gateway_debug.log',
    'campaign.local.jsonl'
];

let removed = 0;
for (const t of TARGETS) {
    const p = path.resolve(t);
    try {
        fs.rmSync(p, { recursive: true, force: true });
        removed++;
        console.log(`[CLEAN] dihapus: ${t}`);
    } catch (_) { /* sudah tidak ada -> lanjut */ }
}
console.log(`[CLEAN] selesai (${removed} target diproses).`);

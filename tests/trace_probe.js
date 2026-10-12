require('dotenv').config();
const { execFileSync } = require('child_process');
try {
    console.log('== curl versi dari dalam Node ==');
    console.log(execFileSync('curl', ['--version']).toString().split('\n')[0]);
    console.log('\n== kirim POST + trace ==');
    execFileSync('curl', [
        '-s', '-S', '--max-time', '25',
        '--trace-ascii', 'tests/trace_spawn.txt',
        '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-H', `x-goog-api-key: ${process.env.GEMINI_API_KEY}`,
        '-d', JSON.stringify({ contents: [{ parts: [{ text: 'PONG' }] }] }),
        `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-3.5-flash'}:generateContent`
    ], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().slice(0, 100);
    console.log('(selesai, trace tersimpan)');
} catch (e) {
    console.error('ERR:', e.message.slice(0, 300));
}

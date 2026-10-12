require('dotenv').config();
const { spawn } = require('child_process');
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const URL_ = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const BODY = JSON.stringify({ contents: [{ parts: [{ text: 'PONG' }] }] });

function run(label, extraArgs, useStdin) {
    return new Promise((res) => {
        const p = spawn('curl', ['-s', '-S', '--max-time', '20', '-X', 'POST',
            '-H', 'Content-Type: application/json',
            '-H', `x-goog-api-key: ${KEY}`,
            ...extraArgs, URL_], { windowsHide: true });
        let o = '', e = '';
        p.stdout.on('data', d => o += d);
        p.stderr.on('data', d => e += d);
        p.on('close', () => {
            console.log(`${label}`);
            console.log(`   stdout: ${o.replace(/\s+/g, ' ').slice(0, 130) || '(kosong)'}`);
            if (e) console.log(`   stderr: ${e.slice(0, 100)}`);
            res();
        });
        if (useStdin) { p.stdin.write(BODY); p.stdin.end(); }
    });
}

(async () => {
    await run('VA -d inline:', ['-d', BODY], false);
    await run('VB stdin+CL :', ['--data-binary', '@-', '-H', `Content-Length: ${Buffer.byteLength(BODY)}`], true);
    await run('VC chunked  :', ['--data-binary', '@-'], true);
})();

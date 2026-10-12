/**
 * MIRAGE-NODE :: GEMINI TRANSPORT (curl wrapper)
 * -----------------------------------------------
 * Forensic note: a mass-401 incident was traced to a stale Windows user-level
 * environment variable (HKCU\Environment) holding an old GEMINI_API_KEY that
 * silently overrode .env because dotenv does not override by default. dotenv
 * is therefore forced with override:true.
 *
 * Security: the payload is piped through STDIN (--data-binary @-) ->
 * immune to argv length limits and shell injection (spawn without shell).
 */

const { spawn } = require('child_process');
require('dotenv').config({ override: true });

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function generateContent({ model, body, timeoutMs = 10000, apiKey }) {
    apiKey = (apiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
        return Promise.reject(new Error('GEMINI_API_KEY is not set'));
    }

    return new Promise((resolve, reject) => {
        const args = [
            '-s', '-S',
            '--max-time', String(Math.ceil(timeoutMs / 1000)),
            '-X', 'POST',
            '-H', 'Content-Type: application/json',
            '-H', `x-goog-api-key: ${apiKey}`,
            '--data-binary', '@-',
            '-w', '\n%{http_code}',
            `${BASE_URL}/models/${model}:generateContent`
        ];

        const proc = spawn('curl', args, { windowsHide: true });

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error(`TRANSPORT_TIMEOUT (${timeoutMs}ms)`));
        }, timeoutMs);

        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });

        proc.on('error', (e) => {
            clearTimeout(timer);
            reject(new Error('CURL_UNAVAILABLE: ' + e.message));
        });

        proc.on('close', () => {
            clearTimeout(timer);
            const nl = stdout.lastIndexOf('\n');
            const httpCode = parseInt(stdout.slice(nl + 1).trim(), 10);
            const rawBody = nl > 0 ? stdout.slice(0, nl) : stdout;

            let json = null;
            try { json = JSON.parse(rawBody); } catch (_) { /* stays null */ }

            if (json === null) {
                return reject(new Error('INVALID_RESPONSE: ' + (stderr || rawBody).slice(0, 200)));
            }
            resolve({
                status: httpCode,
                ok: httpCode >= 200 && httpCode < 300,
                json
            });
        });

        proc.stdin.write(body);
        proc.stdin.end();
    });
}

module.exports = { generateContent, BASE_URL };

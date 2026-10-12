/**
 * SMOKE TEST :: verify Sentinel's real transport path
 * Jalankan: npm run smoke
 */
require('dotenv').config();
const { generateContent } = require('../src/lib/gemini_curl');

(async () => {
    const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    console.log(`[SMOKE] Model    : ${model}`);
    console.log(`[SMOKE] Transport: curl-wrapper`);

    try {
        const resp = await generateContent({
            model,
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply exactly: PONG' }] }] }),
            timeoutMs: 15000
        });
        const text = resp.json.candidates[0].content.parts[0].text;
        console.log(`[SMOKE] Reply    : ${text.trim()}`);
        console.log('[SMOKE] STATUS   : PASS - production path ready.');
        process.exit(0);
    } catch (err) {
        console.error(`[SMOKE] STATUS   : FAIL - ${err.message}`);
        process.exit(1);
    }
})();

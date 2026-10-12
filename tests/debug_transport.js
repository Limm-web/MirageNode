require('dotenv').config();
const { generateContent } = require('../src/lib/gemini_curl');

(async () => {
    try {
        const resp = await generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply exactly: PONG' }] }] }),
            timeoutMs: 15000
        });
        console.log('HTTP  :', resp.status);
        console.log('BODY  :', JSON.stringify(resp.json, null, 2).slice(0, 1200));
    } catch (e) {
        console.error('ERROR :', e.message);
    }
})();

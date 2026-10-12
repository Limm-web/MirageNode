const axios = require('axios');

const TARGET_URL = 'http://127.0.0.1:8888';

async function firePayload(description, method, urlPath, payloadData) {
    console.log(`\n[WARGAME] Firing: ${description}`);
    try {
        const response = await axios({
            method: method,
            url: `${TARGET_URL}${urlPath}`,
            data: payloadData,
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });
        console.log(`[TARGET RESPONSE] Status: ${response.status}`);
        console.log(`[TARGET RESPONSE] Body:`, response.data);
    } catch (error) {
        if (error.response) {
            console.log(`[TARGET RESPONSE] Status: ${error.response.status}`);
        } else {
            console.error(`[TARGET ERROR]`, error.message);
        }
    }
}

async function startWargame() {
    console.log('==================================================');
    console.log('   MIRAGE-NODE E2E AUTONOMOUS WARGAME INITIATED');
    console.log('==================================================');

    // 1. Normal traffic (should reach the Production Server; if prod is down the
    //    gateway will still proxy and surface its own error)
    await firePayload("Normal user access (benign)", "GET", "/api/products", null);

    // 2. Sniper shot: SQL injection payload (Sentinel must catch this)
    await firePayload("Killer SQL injection attack", "POST", "/api/login", {
        username: "admin' OR 1=1 --",
        password: "password123"
    });

    // 3. Follow-up: same IP after flagging - the gateway must divert straight
    //    to the Honeypot without asking Gemini again (fast-route)
    await firePayload("Command injection attack", "GET", "/api/ping?host=127.0.0.1; cat /etc/passwd", null);

    console.log('\n[WARGAME] Attack simulation finished. Inspect your Gateway and Honeypot logs.');
}

// Berikan waktu sejenak agar sistem bisa bangun sebelum ditembak
setTimeout(startWargame, 2000);


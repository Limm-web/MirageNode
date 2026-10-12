/**
 * LIVE HARNESS :: End-to-end test of Sentinel with real payloads.
 * Ini validasi akhir P0: LLM hidup, klasifikasi benar.
 */
const { analyzeRequest } = require('../src/agents/sentinel');

(async () => {
    const cases = [
        { name: 'SQL Injection',  expectMalicious: true,  m: 'POST', u: '/api/login',           b: JSON.stringify({ username: "admin' OR 1=1 --", password: 'pass123' }) },
        { name: 'Path Traversal', expectMalicious: true,  m: 'GET',  u: '/download?file=../../etc/passwd', b: '' },
        { name: 'User Normal',    expectMalicious: false, m: 'GET',  u: '/api/products?page=1', b: '' }
    ];

    let pass = 0;
    for (const c of cases) {
        const got = await analyzeRequest(c.m, c.u, { 'user-agent': 'harness' }, c.b);
        const ok = got === c.expectMalicious;
        if (ok) pass++;
        console.log(`${ok ? '[PASS]' : '[FAIL]'} ${c.name.padEnd(15)} (detected=${got}, expected=${c.expectMalicious})`);
    }
    console.log(`\nHASIL: ${pass}/${cases.length} lulus.`);
    process.exit(pass === cases.length ? 0 : 1);
})();

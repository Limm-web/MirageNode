/** Uji deteksi profil Architect */
const { detectProfile } = require('../src/agents/architect');

const cases = [
    ['/wp-admin/setup', '', 'wordpress'],
    ['/', 'Mozilla wp-login.php', 'wordpress'],
    ['/api/users', '', 'api'],
    ['/graphql', '', 'api'],
    ['/images/logo.png', '', 'generic']
];

let pass = 0;
for (const [url, ua, expect] of cases) {
    const got = detectProfile(url, ua);
    const ok = got === expect;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'} "${url}" +ua"${ua}" -> ${got} (harap ${expect})`);
}
console.log(`\nARCH-RESULT: ${pass}/${cases.length} lulus`);
process.exit(pass === cases.length ? 0 : 1);

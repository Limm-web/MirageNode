/** Uji roundtrip Memory Store + normalisasi IP */
const s = require('../src/lib/memory_store');

(async () => {
    await s.blacklist('1.2.3.4', 'tes');
    const hit = await s.isBlacklisted('::ffff:1.2.3.4'); // harus cocok setelah normalisasi
    const miss = await s.isBlacklisted('5.6.7.8');
    await s.recordThreat({ ip: '1.2.3.4', url: '/tes', profile: 'generic' });

    console.log(`STORE-TEST: blacklist(ip-normalized)=${hit} | ip-lain=${miss} | backend=${s.backend}`);
    if (hit === true && miss === false) {
        console.log('STORE-TEST: PASS');
        process.exit(0);
    }
    console.log('STORE-TEST: FAIL');
    process.exit(1);
})();

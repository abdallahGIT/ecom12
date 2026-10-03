const assert = require('node:assert/strict');
const app = require('../server');
const utils = app.productUtils;
const ecotrack = require('../ecotrack');

assert.equal(utils.normalizeProductSlug('  منتج جديد !!! '), 'منتج-جديد');
assert.match(utils.normalizeProductSlug('!!!'), /^seed-/);
assert.equal(utils.parseStock(0, 50), 0);
assert.equal(utils.parseStock('12.8', 50), 12);
assert.equal(utils.parseMoney(0, 2500), 0);
assert.equal(utils.isValidAlgerianPhone('0555123456'), true);
assert.equal(utils.isValidAlgerianPhone('+213555123456'), true);
assert.equal(utils.isValidAlgerianPhone('06 55 12 34 56'), true);
assert.equal(utils.isValidAlgerianPhone('055512345'), false);
assert.equal(utils.isValidAlgerianPhone('0155123456'), false);
assert.equal(utils.normalizeAlgerianPhone('+213 555 123 456'), '+213555123456');
assert.deepEqual(
  utils.normalizeProductImages([' /uploads/a.jpg ', '', null, 'https://x/y.jpg']),
  ['/uploads/a.jpg', 'https://x/y.jpg']
);
assert.deepEqual(
  utils.normalizeProductFeatures([{ icon: '🌿', label: 'جيد' }, { label: '' }]),
  [{ icon: '🌿', label: 'جيد' }]
);
const serverSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
assert.doesNotMatch(serverSource, /INSERT INTO products[\s\S]{0,1200}'lavender'/i);
assert.match(serverSource, /DELETE FROM products WHERE slug = 'lavender'/i);
assert.deepEqual(
  ecotrack.normalizeFees([
    { wilaya_id: 16, tarif: '600', tarif_stopdesk: '400' },
    { wilaya_id: 57, tarif: 1200, tarif_stopdesk: 900 }
  ]),
  [
    { wilayaId: 16, ecoWilayaId: 16, home: 600, stopDesk: 400 },
    { wilayaId: 49, ecoWilayaId: 57, home: 1200, stopDesk: 900 }
  ]
);

console.log('product regression tests: PASS');

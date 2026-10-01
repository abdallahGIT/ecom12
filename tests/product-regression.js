const assert = require('node:assert/strict');
const app = require('../server');
const utils = app.productUtils;
const ecotrack = require('../ecotrack');

assert.equal(utils.normalizeProductSlug('  منتج جديد !!! '), 'منتج-جديد');
assert.match(utils.normalizeProductSlug('!!!'), /^seed-/);
assert.equal(utils.parseStock(0, 50), 0);
assert.equal(utils.parseStock('12.8', 50), 12);
assert.equal(utils.parseMoney(0, 2500), 0);
assert.deepEqual(
  utils.normalizeProductImages([' /uploads/a.jpg ', '', null, 'https://x/y.jpg']),
  ['/uploads/a.jpg', 'https://x/y.jpg']
);
assert.deepEqual(
  utils.normalizeProductFeatures([{ icon: '🌿', label: 'جيد' }, { label: '' }]),
  [{ icon: '🌿', label: 'جيد' }]
);
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

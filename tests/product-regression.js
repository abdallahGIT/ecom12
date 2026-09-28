const assert = require('node:assert/strict');
const app = require('../server');
const utils = app.productUtils;

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

console.log('product regression tests: PASS');

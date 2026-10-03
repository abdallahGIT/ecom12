const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');

// Node does not load .env files automatically; do so before reading DATABASE_URL.
// In Vercel/production the process environment remains authoritative.
try { process.loadEnvFile(); } catch { /* .env is optional in deployed environments */ }

const {
  getSettings: getEcoTrackSettings,
  validateToken: validateEcoTrackToken,
  getWilayas: getEcoTrackWilayas,
  createParcel: createEcoTrackParcel,
  updateParcel: updateEcoTrackParcel,
  validateParcel: validateEcoTrackParcel,
  deleteParcel: deleteEcoTrackParcel,
  addUpdate: addEcoTrackUpdate,
  getUpdates: getEcoTrackUpdates,
  getTrackingInfo: getEcoTrackTrackingInfo,
  getTrackingsInfo: getEcoTrackTrackingsInfo,
  askReturn: askEcoTrackReturn,
  validateReturns: validateEcoTrackReturns,
  getLabel: getEcoTrackLabel,
  listOrders: listEcoTrackOrders,
  listOrdersByStatus: listEcoTrackOrdersByStatus,
  getDesks: getEcoTrackDesks,
  getFees: getEcoTrackFees,
  normalizeFees: normalizeEcoTrackFees,
  getProducts: getEcoTrackProducts,
  getCommunes: getEcoTrackCommunes,
  normalizeStatus: normalizeEcoTrackStatus
} = require('./ecotrack');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (
  process.env.NODE_ENV === 'production' || process.env.VERCEL ? '' : 'ecom12'
);
const ADMIN_SESSION_TTL = 7 * 24 * 60 * 60;

function createAdminSession() {
  const expires = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL;
  const payload = `admin.${expires}`;
  const signature = crypto.createHmac('sha256', ADMIN_PASSWORD).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function hasValidAdminSession(req) {
  if (!ADMIN_PASSWORD) return false;
  const header = req.headers.cookie || '';
  const match = header.match(/(?:^|;\s*)ecom12_admin=([^;]+)/);
  if (!match) return false;
  const [scope, expiresText, signature] = decodeURIComponent(match[1]).split('.');
  const expires = Number(expiresText);
  if (scope !== 'admin' || !Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000) || !signature) return false;
  const expected = crypto.createHmac('sha256', ADMIN_PASSWORD).update(`admin.${expires}`).digest('hex');
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `ecom12_admin=${encodeURIComponent(token)}; Max-Age=${ADMIN_SESSION_TTL}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', 'ecom12_admin=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
}

function isProtectedApi(req) {
  const pathName = req.path;
  if (pathName === '/api/upload') return true;
  if (pathName === '/api/settings' || pathName.startsWith('/api/ecotrack/')) return true;
  if (pathName === '/api/products') return req.method !== 'GET' || req.query.all === 'true';
  if (pathName.startsWith('/api/products/')) return req.method !== 'GET';
  if (pathName === '/api/orders') return req.method === 'GET';
  if (pathName.startsWith('/api/orders/')) return true;
  if (pathName === '/api/leads') return req.method !== 'POST';
  if (pathName.startsWith('/api/leads/')) return true;
  return false;
}

// ==========================================
// 1. DATABASE CONNECTION (NEON POSTGRESQL)
// ==========================================
const DATABASE_URL = process.env.DATABASE_URL;

// Clean connection URL for pg client
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL.replace('&channel_binding=require', '').replace('channel_binding=require&', ''),
      ssl: {
        rejectUnauthorized: false
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
    : null;

function normalizeProductSlug(value, fallback = `seed-${Date.now()}`) {
  const source = String(value || '').trim().toLowerCase();
  const slug = source
    .normalize('NFKC')
    .replace(/[^\w\u0600-\u06FF\u0750-\u077F0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110);
  return slug || fallback;
}

function parseMoney(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function parseStock(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function normalizeAlgerianPhone(value) {
  return String(value || '').replace(/[\s().-]/g, '');
}

function isValidAlgerianPhone(value) {
  return /^(?:\+213[5-7]\d{8}|0[5-7]\d{8})$/.test(normalizeAlgerianPhone(value));
}

function normalizeProductImages(images) {
  const source = Array.isArray(images) ? images : (typeof images === 'string' && images.trim() ? [images] : []);
  return source
    .map(image => String(image || '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeProductFeatures(features) {
  if (!Array.isArray(features)) return [];
  return features
    .filter(feature => feature && typeof feature === 'object')
    .map(feature => ({ icon: String(feature.icon || '🌿').slice(0, 8), label: String(feature.label || '').trim().slice(0, 120) }))
    .filter(feature => feature.label)
    .slice(0, 12);
}

// Cache database initialization promise
let dbInitPromise = null;
let deliveryRatesCache = null;

async function initDb() {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured. Add it to the Vercel project environment variables.');
  }

  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    let client;
    try {
      client = await pool.connect();
      console.log('✅ Connected to Neon PostgreSQL database successfully.');
      await client.query('BEGIN');
      // Serialize cold-start migrations across local workers and Vercel instances.
      await client.query('SELECT pg_advisory_xact_lock(1200123401);');

      // 1. Products table (Seed products catalog)
      await client.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          slug VARCHAR(120) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          subtitle TEXT,
          description TEXT,
          price_1 INT NOT NULL DEFAULT 2500,
          price_2 INT NOT NULL DEFAULT 4200,
          price_3 INT NOT NULL DEFAULT 5600,
          stock INT NOT NULL DEFAULT 50,
          images JSONB NOT NULL DEFAULT '[]'::jsonb,
          features JSONB NOT NULL DEFAULT '[]'::jsonb,
          pixel_id VARCHAR(32),
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 2. Orders table
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(50) PRIMARY KEY,
          product_id INT REFERENCES products(id) ON DELETE SET NULL,
          product_name VARCHAR(255),
          full_name VARCHAR(255) NOT NULL,
          phone VARCHAR(50) NOT NULL,
          willaya VARCHAR(100),
          baladia VARCHAR(100),
          quantity INT NOT NULL DEFAULT 1,
          price INT NOT NULL DEFAULT 0,
          status VARCHAR(50) NOT NULL DEFAULT 'new',
          note TEXT,
          delivery_fee_pending BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 3. Leads table (Auto-captured client info without confirming)
      await client.query(`
        CREATE TABLE IF NOT EXISTS leads (
          id VARCHAR(50) PRIMARY KEY,
          session_token VARCHAR(100) UNIQUE,
          product_id INT REFERENCES products(id) ON DELETE SET NULL,
          product_name VARCHAR(255),
          full_name VARCHAR(255),
          phone VARCHAR(50),
          willaya VARCHAR(100),
          willaya_id INT,
          baladia VARCHAR(100),
          quantity INT NOT NULL DEFAULT 1,
          price INT NOT NULL DEFAULT 0,
          delivery_fee INT NOT NULL DEFAULT 0,
          status VARCHAR(50) NOT NULL DEFAULT 'abandoned',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Migrations to ensure all columns exist
      await client.query(`
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT;
        ALTER TABLE orders ALTER COLUMN willaya DROP NOT NULL;
        ALTER TABLE orders ALTER COLUMN baladia DROP NOT NULL;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(24) DEFAULT 'home';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee INT NOT NULL DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_pending BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS pixel_id VARCHAR(32);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_tracking VARCHAR(120);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_status VARCHAR(120);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_updated_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_reference VARCHAR(255);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_activity JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_shipped_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_return_status VARCHAR(80);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_last_error TEXT;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_raw_response JSONB;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS willaya_id INT;
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS willaya_id INT;
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS delivery_fee INT NOT NULL DEFAULT 0;
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      `);

      // 4. Settings table (Pixel, EcoTrack, etc.)
      await client.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key VARCHAR(100) PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Move seeded product images to the smaller WebP assets without changing custom uploads.
      await client.query(`
        UPDATE products
        SET images = replace(
          replace(
            replace(
              replace(images::text, 'assets/slide-1.jpg', 'assets/slide-1.webp'),
              'assets/slide-2.jpg', 'assets/slide-2.webp'
            ),
            'assets/slide-3.jpg', 'assets/slide-3.webp'
          ),
          'assets/lavender.png', 'assets/lavender.webp'
        )::jsonb
        WHERE images::text LIKE '%assets/slide-%.jpg%'
           OR images::text LIKE '%assets/lavender.png%';
      `);

      // Lavender was a legacy catalog seed. Remove it from existing databases and
      // never recreate it; historical orders/leads keep their product name snapshot.
      await client.query(`
        UPDATE orders
        SET product_id = NULL
        WHERE product_id IN (SELECT id FROM products WHERE slug = 'lavender');
        UPDATE leads
        SET product_id = NULL
        WHERE product_id IN (SELECT id FROM products WHERE slug = 'lavender');
        DELETE FROM products WHERE slug = 'lavender';
      `);

      // Seed default product if table is empty
      const productCountRes = await client.query('SELECT COUNT(*) FROM products;');
      const count = parseInt(productCountRes.rows[0].count, 10);
      if (count === 0) {
        console.log('🌱 Seeding initial seed product: بذور الكاكي...');
        await client.query(`
          INSERT INTO products (slug, name, subtitle, description, price_1, price_2, price_3, stock, images, features, is_active)
          VALUES (
            'kaki',
            'بذور الكاكي الفاخرة',
            'طبيعية 100% · زراعة منزلية سهلة · توصيل لكافة الولايات',
            'بذور الكاكي الفاخرة، بذور طبيعية منتقاة بعناية للزراعة في الحدائق والمنازل مع جودة إنتاجية ممتازة وتوصيل لكافة الولايات 58 والدفع عند الاستلام.',
            2500,
            4200,
            5600,
            50,
            $1::jsonb,
            $2::jsonb,
            true
          );
        `, [
          JSON.stringify([
            'assets/slide-1.webp',
            'assets/slide-2.webp',
            'assets/slide-3.webp'
          ]),
          JSON.stringify([
            { icon: '🌿', label: 'طبيعية 100%' },
            { icon: '🌱', label: 'زراعة منزلية' },
            { icon: '📦', label: 'توصيل مضمون' }
          ])
        ]);
      }

      await client.query('COMMIT');
      console.log('✅ Database schema verified and ready.');
    } catch (err) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch {}
      }
      throw new Error(`Database initialization failed: ${err.message}`, { cause: err });
    } finally {
      if (client) client.release();
    }
  })();

  dbInitPromise = dbInitPromise.catch(err => {
    dbInitPromise = null;
    throw err;
  });
  return dbInitPromise;
}

async function getLiveDeliveryRates() {
  await initDb();
  const settings = await getEcoTrackSettings(pool);
  const tokenHash = crypto.createHash('sha256').update(settings.token || '').digest('hex');
  const cacheKey = `${settings.provider}:${settings.baseUrl}:${tokenHash}`;
  if (deliveryRatesCache?.cacheKey === cacheKey && deliveryRatesCache.expiresAt > Date.now()) {
    return { ...deliveryRatesCache.value, settings };
  }

  const fees = normalizeEcoTrackFees(await getEcoTrackFees(settings));
  const value = { fees };
  deliveryRatesCache = { cacheKey, expiresAt: Date.now() + 5 * 60 * 1000, value };
  return { ...value, settings };
}

// Trigger initial DB setup
initDb().catch(e => console.warn('Non-blocking DB init:', e.message));

// ==========================================
// 2. MIDDLEWARE & UPLOADS
// ==========================================
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Admin page and management APIs require a signed HttpOnly session cookie.
app.use((req, res, next) => {
  const isAdminPage = req.path === '/admin' || req.path === '/admin.html';
  if ((isAdminPage || isProtectedApi(req)) && !hasValidAdminSession(req)) {
    if (isAdminPage) return res.sendFile(path.join(__dirname, 'admin-login.html'));
    return res.status(401).json({ success: false, error: 'يجب تسجيل الدخول إلى لوحة الإدارة أولاً', loginRequired: true });
  }
  next();
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ success: false, error: 'يجب ضبط ADMIN_PASSWORD في إعدادات البيئة قبل تفعيل لوحة الإدارة' });
  }
  const password = String(req.body?.password || '');
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'كلمة المرور غير صحيحة' });
  }
  setAdminCookie(res, createAdminSession());
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  clearAdminCookie(res);
  res.json({ success: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: hasValidAdminSession(req) });
});

// Upload directory handling (safe for both local & Vercel serverless)
const isVercel = Boolean(process.env.VERCEL);
const uploadsDir = isVercel ? path.join('/tmp', 'uploads') : path.join(__dirname, 'uploads');

try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (err) {
  console.warn('Upload directory fallback to memory:', err.message);
}

// Use memory storage on Vercel to return data URIs, or disk storage locally
const storage = isVercel 
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        const uniqueName = `seed-${Date.now()}-${Math.round(Math.random() * 1E6)}${ext}`;
        cb(null, uniqueName);
      }
    });

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('الملف المرفوع يجب أن يكون صورة'));
    }
  }
});

// Serve static files
if (fs.existsSync(uploadsDir)) {
  app.use('/uploads', express.static(uploadsDir));
}
app.use(express.static(__dirname));

// ==========================================
// 3. API ENDPOINTS
// ==========================================

// Health Check & Stats
app.get('/api/health', async (req, res) => {
  try {
    await initDb();
    const timeRes = await pool.query('SELECT NOW() as current_time;');
    const prodRes = await pool.query('SELECT COUNT(*) FROM products;');
    const orderRes = await pool.query('SELECT COUNT(*) FROM orders;');
    const leadRes = await pool.query("SELECT COUNT(*) FROM leads WHERE status != 'converted';");

    res.json({
      status: 'ok',
      db: 'connected',
      neon_time: timeRes.rows[0].current_time,
      counts: {
        products: parseInt(prodRes.rows[0].count, 10),
        orders: parseInt(orderRes.rows[0].count, 10),
        leads: parseInt(leadRes.rows[0].count, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});

// ------------------------------------------
// Photo Upload API
// ------------------------------------------
app.post('/api/upload', upload.array('photos', 6), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'لم يتم اختيار أي صورة' });
    }

    const fileUrls = req.files.map(f => {
      if (isVercel && f.buffer) {
        // Convert to data URI for serverless persistence without S3/disk
        return `data:${f.mimetype};base64,${f.buffer.toString('base64')}`;
      }
      return `/uploads/${f.filename}`;
    });

    res.json({ success: true, urls: fileUrls });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------
// Products API (Seed Products Management)
// ------------------------------------------

// GET all products
app.get('/api/products', async (req, res) => {
  try {
    await initDb();
    const includeAll = req.query.all === 'true';
    const slug = typeof req.query.slug === 'string' ? normalizeProductSlug(req.query.slug) : null;
    const query = slug
      ? 'SELECT * FROM products WHERE slug = $1 LIMIT 1;'
      : includeAll
        ? 'SELECT * FROM products ORDER BY id DESC;'
        : 'SELECT * FROM products WHERE is_active = true ORDER BY id ASC;';
    const result = await pool.query(query, slug ? [slug] : []);
    res.json({ success: true, products: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single product by id or slug
app.get('/api/products/:identifier', async (req, res) => {
  try {
    await initDb();
    const { identifier } = req.params;
    const isNum = /^\d+$/.test(identifier);
    const query = isNum
      ? 'SELECT * FROM products WHERE id = $1;'
      : 'SELECT * FROM products WHERE slug = $1;';
    const result = await pool.query(query, [identifier]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'المنتج غير موجود' });
    }
    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create new seed product
app.post('/api/products', async (req, res) => {
  try {
    await initDb();
    const {
      name,
      slug,
      subtitle,
      description,
      price_1,
      price_2,
      price_3,
      stock,
      images,
      features,
      pixelId,
      is_active
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'اسم المنتج/البذور مطلوب' });
    }

    const cleanSlug = normalizeProductSlug(slug, `seed-${Date.now()}`);
    let imagesArr = normalizeProductImages(images);

    if (imagesArr.length === 0) {
      imagesArr = ['assets/slide-1.webp'];
    }

    const normalizedFeatures = normalizeProductFeatures(features);
    const featuresArr = normalizedFeatures.length > 0 ? normalizedFeatures : [
      { icon: '🌿', label: 'طبيعية 100%' },
      { icon: '🌱', label: 'زراعة منزلية' },
      { icon: '📦', label: 'توصيل مضمون' }
    ];

    const result = await pool.query(`
      INSERT INTO products (
        slug, name, subtitle, description,
        price_1, price_2, price_3, stock,
        images, features, pixel_id, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
      RETURNING *;
    `, [
      cleanSlug,
      name.trim(),
      subtitle || 'طبيعية 100% · زراعة منزلية سهلة · توصيل لكافة الولايات',
      description || '',
      parseMoney(price_1, 2500),
      parseMoney(price_2, 4200),
      parseMoney(price_3, 5600),
      parseStock(stock, 50),
      JSON.stringify(imagesArr),
      JSON.stringify(featuresArr),
      pixelId ? String(pixelId).trim().replace(/\D/g, '').slice(0, 32) || null : null,
      is_active !== undefined ? Boolean(is_active) : true
    ]);

    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    console.error('Error adding product:', err);
    const duplicate = err.code === '23505' && String(err.constraint || '').includes('slug');
    res.status(duplicate ? 409 : 500).json({ success: false, error: duplicate ? 'هذا الرابط مستخدم لمنتج آخر. اختر Slug مختلفاً.' : err.message });
  }
});

// PUT update product
app.put('/api/products/:id', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    const {
      name,
      slug,
      subtitle,
      description,
      price_1,
      price_2,
      price_3,
      stock,
      images,
      features,
      pixelId,
      is_active
    } = req.body;

    const result = await pool.query(`
      UPDATE products SET
        name = COALESCE($1, name),
        slug = COALESCE($2, slug),
        subtitle = COALESCE($3, subtitle),
        description = COALESCE($4, description),
        price_1 = COALESCE($5, price_1),
        price_2 = COALESCE($6, price_2),
        price_3 = COALESCE($7, price_3),
        stock = COALESCE($8, stock),
        images = CASE WHEN $9::jsonb IS NOT NULL THEN $9::jsonb ELSE images END,
        features = CASE WHEN $10::jsonb IS NOT NULL THEN $10::jsonb ELSE features END,
        pixel_id = COALESCE($11, pixel_id),
        is_active = COALESCE($12, is_active)
      WHERE id = $13
      RETURNING *;
    `, [
      name !== undefined ? String(name).trim() || null : null,
      slug !== undefined ? normalizeProductSlug(slug, `seed-${id}`) : null,
      subtitle !== undefined ? subtitle : null,
      description !== undefined ? description : null,
      price_1 !== undefined ? parseMoney(price_1, null) : null,
      price_2 !== undefined ? parseMoney(price_2, null) : null,
      price_3 !== undefined ? parseMoney(price_3, null) : null,
      stock !== undefined ? parseStock(stock, null) : null,
      images !== undefined ? JSON.stringify(normalizeProductImages(images)) : null,
      features !== undefined ? JSON.stringify(normalizeProductFeatures(features)) : null,
      pixelId !== undefined ? String(pixelId).trim().replace(/\D/g, '').slice(0, 32) || null : null,
      is_active !== undefined ? Boolean(is_active) : null,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'المنتج غير موجود' });
    }

    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    const duplicate = err.code === '23505' && String(err.constraint || '').includes('slug');
    res.status(duplicate ? 409 : 500).json({ success: false, error: duplicate ? 'هذا الرابط مستخدم لمنتج آخر. اختر Slug مختلفاً.' : err.message });
  }
});

// DELETE product
app.delete('/api/products/:id', async (req, res) => {
  let client;
  try {
    await initDb();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, error: 'معرّف المنتج غير صالح' });
    }

    client = await pool.connect();
    await client.query('BEGIN');
    // Preserve historical orders and leads if an older Neon schema has a restrictive FK.
    await client.query('UPDATE orders SET product_id = NULL WHERE product_id = $1;', [id]);
    await client.query('UPDATE leads SET product_id = NULL WHERE product_id = $1;', [id]);
    const deleted = await client.query('DELETE FROM products WHERE id = $1 RETURNING id;', [id]);
    if (!deleted.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'المنتج غير موجود' });
    }
    await client.query('COMMIT');
    res.json({ success: true, message: 'تم حذف المنتج بنجاح' });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    console.error('Error deleting product:', err);
    const foreignKeyFailure = err.code === '23503';
    res.status(foreignKeyFailure ? 409 : 500).json({
      success: false,
      error: foreignKeyFailure ? 'لا يمكن حذف المنتج لأنه مرتبط بسجلات أخرى' : err.message
    });
  } finally {
    if (client) client.release();
  }
});

// ------------------------------------------
// Orders API
// ------------------------------------------

// GET all orders
app.get('/api/orders', async (req, res) => {
  try {
    await initDb();
    const { status, search } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(full_name) LIKE $${params.length} OR
        phone LIKE $${params.length} OR
        LOWER(willaya) LIKE $${params.length} OR
        LOWER(baladia) LIKE $${params.length} OR
        LOWER(id) LIKE $${params.length}
      )`;
    }

    query += ' ORDER BY created_at DESC;';

    const result = await pool.query(query, params);
    res.json({ success: true, orders: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create confirmed order
app.post('/api/orders', async (req, res) => {
  let client;
  try {
    await initDb();
    const {
      id,
      fullName,
      phone,
      willaya,
      baladia,
      quantity,
      price,
      productId,
      productName,
      sessionToken,
      note,
      deliveryType,
      deliveryFee,
      willayaId
    } = req.body;

    const cleanName = String(fullName || '').trim() || 'زبون بدون اسم';
    const normalizedPhone = normalizeAlgerianPhone(phone);
    if (!isValidAlgerianPhone(normalizedPhone)) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال رقم هاتف جزائري صحيح' });
    }

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 3) {
      return res.status(400).json({ success: false, error: 'الكمية المطلوبة يجب أن تكون بين 1 و3 علب' });
    }
    const numericProductId = Number(productId);
    if (!Number.isInteger(numericProductId) || numericProductId < 1) {
      return res.status(400).json({ success: false, error: 'المنتج المطلوب غير صالح' });
    }

    const isAdminOrder = hasValidAdminSession(req);
    const normalizedDeliveryType = deliveryType === 'stop_desk' ? 'stop_desk' : 'home';
    const normalizedWilayaId = Number(willayaId);
    let finalDeliveryFee = parseStock(deliveryFee, 0);
    let deliveryFeePending = false;
    if (!isAdminOrder) {
      if (!Number.isInteger(normalizedWilayaId) || normalizedWilayaId < 1 || normalizedWilayaId > 58) {
        return res.status(400).json({ success: false, error: 'يرجى اختيار ولاية صحيحة' });
      }
      try {
        const { fees } = await getLiveDeliveryRates();
        const wilayaFee = fees.find(item => item.wilayaId === normalizedWilayaId);
        const authoritativeFee = wilayaFee?.[normalizedDeliveryType === 'stop_desk' ? 'stopDesk' : 'home'];
        if (Number.isFinite(authoritativeFee)) {
          finalDeliveryFee = authoritativeFee;
        } else {
          finalDeliveryFee = 0;
          deliveryFeePending = true;
        }
      } catch (rateError) {
        console.error('Could not verify delivery fee:', rateError);
        finalDeliveryFee = 0;
        deliveryFeePending = true;
      }
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const productResult = await client.query(
      'SELECT * FROM products WHERE id = $1 AND ($2::boolean OR is_active = true) FOR UPDATE',
      [numericProductId, isAdminOrder]
    );
    const product = productResult.rows[0];
    if (!product) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'المنتج غير موجود أو غير متاح' });
    }
    if (product.stock < qty) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'الكمية المطلوبة غير متوفرة حالياً' });
    }

    const tierPrice = Number(product[`price_${qty}`]);
    const finalPrice = isAdminOrder ? parseMoney(price, tierPrice) : tierPrice;
    const orderId = `ORD-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const result = await client.query(`
      INSERT INTO orders (
        id, product_id, product_name, full_name, phone,
        willaya, willaya_id, baladia, quantity, price, delivery_fee, delivery_fee_pending, status, note, delivery_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'new', $13, $14)
      RETURNING *;
    `, [
      orderId,
      product.id,
      product.name,
      cleanName,
      normalizedPhone,
      willaya ? willaya.trim() : 'غير محدد',
      Number.isInteger(normalizedWilayaId) && normalizedWilayaId >= 1 && normalizedWilayaId <= 58 ? normalizedWilayaId : null,
      baladia ? baladia.trim() : '',
      qty,
      finalPrice,
      finalDeliveryFee,
      deliveryFeePending,
      String(note || '').slice(0, 2000),
      normalizedDeliveryType
    ]);

    // If sessionToken was attached, mark corresponding lead as converted
    if (sessionToken) {
      await client.query(`
        INSERT INTO leads (
          id, session_token, product_id, product_name, full_name, phone,
          willaya, willaya_id, baladia, quantity, price, delivery_fee, status, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'converted', CURRENT_TIMESTAMP)
        ON CONFLICT (session_token) DO UPDATE SET
          product_id = EXCLUDED.product_id,
          product_name = EXCLUDED.product_name,
          full_name = EXCLUDED.full_name,
          phone = EXCLUDED.phone,
          willaya = EXCLUDED.willaya,
          willaya_id = EXCLUDED.willaya_id,
          baladia = EXCLUDED.baladia,
          quantity = EXCLUDED.quantity,
          price = EXCLUDED.price,
          delivery_fee = EXCLUDED.delivery_fee,
          status = 'converted',
          updated_at = CURRENT_TIMESTAMP;
      `, [
        `LEAD-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        String(sessionToken).slice(0, 100),
        product.id,
        product.name,
        cleanName,
        normalizedPhone,
        willaya ? willaya.trim() : 'غير محدد',
        Number.isInteger(normalizedWilayaId) && normalizedWilayaId >= 1 && normalizedWilayaId <= 58 ? normalizedWilayaId : null,
        baladia ? baladia.trim() : '',
        qty,
        finalPrice,
        finalDeliveryFee
      ]);
    }

    await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2;', [qty, product.id]);
    await client.query('COMMIT');

    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    console.error('Error placing order:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) client.release();
  }
});

// PATCH update single order status
async function updateOrderStatusWithStock(client, order, status) {
  const quantity = Number(order.quantity) || 1;
  if (order.product_id && ['new', 'confirmed'].includes(order.status) && status === 'cancelled') {
    await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2;', [quantity, order.product_id]);
  } else if (order.product_id && order.status === 'cancelled' && status !== 'cancelled') {
    const reserved = await client.query(
      'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id;',
      [quantity, order.product_id]
    );
    if (!reserved.rows[0]) {
      const error = new Error('المخزون لا يكفي لإعادة تفعيل هذا الطلب');
      error.status = 409;
      throw error;
    }
  }

  return client.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *;', [status, order.id]);
}

app.patch('/api/orders/:id/status', async (req, res) => {
  let client;
  try {
    await initDb();
    const { id } = req.params;
    const { status } = req.body;
    if (!['new', 'confirmed', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'حالة الطلب غير صالحة' });
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE;', [id]);
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    }
    const result = await updateOrderStatusWithStock(client, existing.rows[0], status);
    await client.query('COMMIT');

    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    res.status(err.status || 500).json({ success: false, error: err.message });
  } finally {
    if (client) client.release();
  }
});

app.patch('/api/orders/:id/delivery-fee', async (req, res) => {
  try {
    await initDb();
    const fee = Number(req.body?.deliveryFee);
    if (!Number.isInteger(fee) || fee < 0) {
      return res.status(400).json({ success: false, error: 'أدخل رسوم توصيل صحيحة بالدينار الجزائري' });
    }
    const result = await pool.query(
      'UPDATE orders SET delivery_fee = $1, delivery_fee_pending = false WHERE id = $2 RETURNING *;',
      [fee, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST bulk update order status
app.post('/api/orders/bulk-status', async (req, res) => {
  let client;
  try {
    await initDb();
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'لم يتم تحديد طلبات' });
    }
    if (!['new', 'confirmed', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, error: 'حالة الطلب غير صالحة' });
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const orders = await client.query(
      'SELECT * FROM orders WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE;',
      [ids]
    );
    for (const order of orders.rows) {
      await updateOrderStatusWithStock(client, order, status);
    }
    await client.query('COMMIT');

    res.json({ success: true, updatedCount: orders.rowCount });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    res.status(err.status || 500).json({ success: false, error: err.message });
  } finally {
    if (client) client.release();
  }
});

// ------------------------------------------
// EcoTrack Algeria courier API (official API coverage)
// ------------------------------------------
function ecoError(res, err) {
  res.status(err.status === 429 ? 429 : 502).json({ success: false, error: err.message, retryAfter: err.retryAfter || null });
}
async function ecoOrder(id) {
  await initDb();
  const result = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] || null;
}
async function saveEcoOrder(id, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  const fields = entries.map(([key]) => key); const values = entries.map(([, value]) => value);
  const set = fields.map((key, i) => `${key} = $${i + 1}`).join(', ');
  return (await pool.query(`UPDATE orders SET ${set} WHERE id = $${values.length + 1} RETURNING *`, [...values, id])).rows[0];
}
app.get('/api/ecotrack/validate', async (req, res) => { try { await initDb(); const settings = await getEcoTrackSettings(pool); const result = await validateEcoTrackToken(settings); res.json({ success: result?.success !== false, result, provider: settings.provider }); } catch (err) { ecoError(res, err); } });
app.get('/api/ecotrack/wilayas', async (req, res) => { try { await initDb(); const settings = await getEcoTrackSettings(pool); res.json({ success: true, wilayas: await getEcoTrackWilayas(settings) }); } catch (err) { ecoError(res, err); } });
app.get('/api/ecotrack/communes/:wilayaId', async (req, res) => { try { await initDb(); const settings = await getEcoTrackSettings(pool); res.json({ success: true, communes: await getEcoTrackCommunes(req.params.wilayaId, settings) }); } catch (err) { ecoError(res, err); } });
app.get('/api/ecotrack/desks', async (req, res) => { try { await initDb(); const settings = await getEcoTrackSettings(pool); res.json({ success: true, desks: await getEcoTrackDesks(settings) }); } catch (err) { ecoError(res, err); } });
app.get('/api/ecotrack/fees', async (req, res) => { try { await initDb(); const settings = await getEcoTrackSettings(pool); res.json({ success: true, fees: await getEcoTrackFees(settings), provider: settings.provider }); } catch (err) { ecoError(res, err); } });
app.get('/api/shipping/wilayas', async (req, res) => {
  try {
    await initDb();
    const settings = await getEcoTrackSettings(pool);
    const wilayas = await getEcoTrackWilayas(settings);
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json({ success: true, wilayas, provider: settings.provider });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message, wilayas: [] });
  }
});
app.get('/api/shipping/wilayas/:wilayaId/communes', async (req, res) => {
  try {
    await initDb();
    const wilayaId = Number(req.params.wilayaId);
    if (!Number.isInteger(wilayaId) || wilayaId < 1 || wilayaId > 58) {
      return res.status(400).json({ success: false, error: 'رقم الولاية غير صالح', communes: [] });
    }
    const settings = await getEcoTrackSettings(pool);
    const communes = await getEcoTrackCommunes(wilayaId, settings);
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json({ success: true, communes, provider: settings.provider });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message, communes: [] });
  }
});
app.get('/api/delivery-fees', async (req, res) => {
  try {
    const { fees, settings } = await getLiveDeliveryRates();
    const byWilaya = Object.fromEntries(fees.map(fee => [fee.wilayaId, { home: fee.home, stopDesk: fee.stopDesk }]));
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json({ success: true, fees: byWilaya, provider: settings.provider });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message, fees: {} });
  }
});
app.get('/api/ecotrack/products', async (req, res) => { try { await initDb(); const settings = await getEcoTrackSettings(pool); res.json({ success: true, products: await getEcoTrackProducts(settings), provider: settings.provider }); } catch (err) { ecoError(res, err); } });

app.post('/api/orders/:id/ecotrack/push', async (req, res) => {
  try {
    const order = await ecoOrder(req.params.id); if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    if (order.ecotrack_tracking) return res.status(409).json({ success: false, error: `الطلب مرفوع مسبقاً برقم التتبع ${order.ecotrack_tracking}` });
    if (order.status !== 'confirmed') return res.status(409).json({ success: false, error: 'يجب تأكيد الطلب قبل رفعه إلى EcoTrack' });
    if (order.delivery_fee_pending) return res.status(409).json({ success: false, error: 'حدد رسوم التوصيل أولاً قبل رفع الطلب إلى EcoTrack' });
    const settings = await getEcoTrackSettings(pool); const pushed = await createEcoTrackParcel({ ...order, delivery_type: req.body?.deliveryType || order.delivery_type }, settings);
    const updated = await saveEcoOrder(req.params.id, { ecotrack_tracking: pushed.tracking, ecotrack_reference: String(order.id), ecotrack_status: 'prete_a_expedier', ecotrack_updated_at: new Date(), ecotrack_last_error: null, ecotrack_raw_response: JSON.stringify(pushed.response) });
    res.json({ success: true, tracking: pushed.tracking, order: updated });
  } catch (err) { ecoError(res, err); }
});
app.post('/api/orders/ecotrack/bulk-push', async (req, res) => {
  try { await initDb(); const ids = Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids : null; const query = ids ? "SELECT * FROM orders WHERE id = ANY($1::text[]) AND status = 'confirmed' AND ecotrack_tracking IS NULL AND delivery_fee_pending = false" : "SELECT * FROM orders WHERE status = 'confirmed' AND ecotrack_tracking IS NULL AND delivery_fee_pending = false"; const orders = (await pool.query(query, ids ? [ids] : [])).rows; const results = { total: orders.length, pushed: [], failed: [] }; const settings = await getEcoTrackSettings(pool); for (const order of orders) { try { const pushed = await createEcoTrackParcel(order, settings); await saveEcoOrder(order.id, { ecotrack_tracking: pushed.tracking, ecotrack_reference: String(order.id), ecotrack_status: 'prete_a_expedier', ecotrack_updated_at: new Date(), ecotrack_raw_response: JSON.stringify(pushed.response) }); results.pushed.push({ id: order.id, tracking: pushed.tracking }); } catch (err) { await saveEcoOrder(order.id, { ecotrack_last_error: err.message, ecotrack_updated_at: new Date() }); results.failed.push({ id: order.id, error: err.message }); } } res.json({ success: true, ...results }); } catch (err) { ecoError(res, err); }
});
app.post('/api/orders/:id/ecotrack/update', async (req, res) => { try { const order = await ecoOrder(req.params.id); if (!order?.ecotrack_tracking) return res.status(409).json({ success: false, error: 'لا يوجد رقم تتبع لهذا الطلب' }); const settings = await getEcoTrackSettings(pool); const response = await updateEcoTrackParcel(order.ecotrack_tracking, req.body || {}, settings); const updated = await saveEcoOrder(req.params.id, { ecotrack_updated_at: new Date(), ecotrack_raw_response: JSON.stringify(response), ecotrack_last_error: null }); res.json({ success: true, response, order: updated }); } catch (err) { ecoError(res, err); } });
app.post('/api/orders/:id/ecotrack/validate', async (req, res) => { try { const order = await ecoOrder(req.params.id); if (!order?.ecotrack_tracking) return res.status(409).json({ success: false, error: 'لا يوجد رقم تتبع لهذا الطلب' }); const response = await validateEcoTrackParcel(order.ecotrack_tracking, Boolean(req.body?.pickup), await getEcoTrackSettings(pool)); const updated = await saveEcoOrder(req.params.id, { ecotrack_status: 'expedie', ecotrack_shipped_at: new Date(), ecotrack_updated_at: new Date(), ecotrack_raw_response: JSON.stringify(response) }); res.json({ success: true, response, order: updated }); } catch (err) { ecoError(res, err); } });
app.post('/api/orders/:id/ecotrack/cancel', async (req, res) => { try { const order = await ecoOrder(req.params.id); if (!order?.ecotrack_tracking) return res.status(409).json({ success: false, error: 'لا يوجد رقم تتبع لهذا الطلب' }); const response = await deleteEcoTrackParcel(order.ecotrack_tracking, await getEcoTrackSettings(pool)); const updated = await saveEcoOrder(req.params.id, { ecotrack_status: 'cancelled', ecotrack_return_status: null, ecotrack_updated_at: new Date(), ecotrack_raw_response: JSON.stringify(response) }); res.json({ success: true, response, order: updated }); } catch (err) { ecoError(res, err); } });
app.post('/api/orders/ecotrack/bulk-cancel', async (req, res) => { try { await initDb(); const ids = Array.isArray(req.body?.ids) ? req.body.ids : []; if (!ids.length) return res.status(400).json({ success: false, error: 'حدد طلبات مشحونة أولاً' }); const orders = (await pool.query('SELECT * FROM orders WHERE id = ANY($1::text[]) AND ecotrack_tracking IS NOT NULL', [ids])).rows; const settings = await getEcoTrackSettings(pool); const results = { total: orders.length, cancelled: [], failed: [] }; for (const order of orders) { try { await deleteEcoTrackParcel(order.ecotrack_tracking, settings); await saveEcoOrder(order.id, { ecotrack_status: 'cancelled', ecotrack_updated_at: new Date() }); results.cancelled.push(order.id); } catch (err) { results.failed.push({ id: order.id, error: err.message }); } } res.json({ success: true, ...results }); } catch (err) { ecoError(res, err); } });
app.post('/api/orders/:id/ecotrack/note', async (req, res) => { try { const content = String(req.body?.content || '').trim(); if (!content) return res.status(400).json({ success: false, error: 'أدخل نص الملاحظة' }); const order = await ecoOrder(req.params.id); if (!order?.ecotrack_tracking) return res.status(409).json({ success: false, error: 'لا يوجد رقم تتبع لهذا الطلب' }); const response = await addEcoTrackUpdate(order.ecotrack_tracking, content, await getEcoTrackSettings(pool)); res.json({ success: true, response }); } catch (err) { ecoError(res, err); } });
app.get('/api/orders/:id/ecotrack/updates', async (req, res) => { try { const order = await ecoOrder(req.params.id); if (!order?.ecotrack_tracking) return res.status(409).json({ success: false, error: 'لا يوجد رقم تتبع لهذا الطلب' }); res.json({ success: true, updates: await getEcoTrackUpdates(order.ecotrack_tracking, await getEcoTrackSettings(pool)) }); } catch (err) { ecoError(res, err); } });
app.get('/api/orders/:id/ecotrack/tracking', async (req, res) => { try { const order = await ecoOrder(req.params.id); if (!order?.ecotrack_tracking) return res.status(409).json({ success: false, error: 'لا يوجد رقم تتبع لهذا الطلب' }); res.json({ success: true, tracking: await getEcoTrackTrackingInfo(order.ecotrack_tracking, await getEcoTrackSettings(pool)) }); } catch (err) { ecoError(res, err); } });
app.post('/api/orders/:id/ecotrack/return', async (req, res) => { try { const order = await ecoOrder(req.params.id); if (!order?.ecotrack_tracking) return res.status(409).json({ success: false, error: 'لا يوجد رقم تتبع لهذا الطلب' }); const response = await askEcoTrackReturn(order.ecotrack_tracking, await getEcoTrackSettings(pool)); const updated = await saveEcoOrder(req.params.id, { ecotrack_return_status: 'requested', ecotrack_updated_at: new Date(), ecotrack_raw_response: JSON.stringify(response) }); res.json({ success: true, response, order: updated }); } catch (err) { ecoError(res, err); } });
app.post('/api/orders/ecotrack/validate-returns', async (req, res) => { try { const ids = Array.isArray(req.body?.ids) ? req.body.ids : []; if (!ids.length) return res.status(400).json({ success: false, error: 'حدد الطلبات المرتجعة' }); await initDb(); const rows = (await pool.query('SELECT id, ecotrack_tracking FROM orders WHERE id = ANY($1::text[]) AND ecotrack_tracking IS NOT NULL', [ids])).rows; const response = await validateEcoTrackReturns(rows.map(row => row.ecotrack_tracking), await getEcoTrackSettings(pool)); await pool.query("UPDATE orders SET ecotrack_return_status = 'received', ecotrack_updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::text[])", [rows.map(row => row.id)]); res.json({ success: true, response, received: rows.map(row => row.id) }); } catch (err) { ecoError(res, err); } });
app.get('/api/orders/:id/ecotrack/label', async (req, res) => { try { const order = await ecoOrder(req.params.id); if (!order?.ecotrack_tracking) return res.status(409).json({ success: false, error: 'لا يوجد رقم تتبع لهذا الطلب' }); const result = await getEcoTrackLabel(order.ecotrack_tracking, await getEcoTrackSettings(pool)); if (!Buffer.isBuffer(result.data)) return res.status(502).json({ success: false, error: 'لم يرجع EcoTrack ملف PDF صالحاً' }); res.set('Content-Type', result.contentType || 'application/pdf'); res.set('Content-Disposition', `attachment; filename="ecotrack-${order.ecotrack_tracking}.pdf"`); res.send(result.data); } catch (err) { ecoError(res, err); } });
app.get('/api/ecotrack/orders', async (req, res) => { try { const settings = await getEcoTrackSettings(pool); res.json({ success: true, orders: await listEcoTrackOrders(settings, Number(req.query.page) || 1, { start_date: req.query.start_date, end_date: req.query.end_date, tracking: req.query.tracking }) }); } catch (err) { ecoError(res, err); } });
app.get('/api/ecotrack/orders/status', async (req, res) => { try { const settings = await getEcoTrackSettings(pool); res.json({ success: true, orders: await listEcoTrackOrdersByStatus(settings, { trackings: req.query.trackings, status: req.query.status }) }); } catch (err) { ecoError(res, err); } });
app.get('/api/ecotrack/trackings', async (req, res) => { try { const trackings = String(req.query.trackings || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, 100); if (!trackings.length) return res.status(400).json({ success: false, error: 'أدخل أرقام التتبع' }); res.json({ success: true, tracking: await getEcoTrackTrackingsInfo(trackings, await getEcoTrackSettings(pool)) }); } catch (err) { ecoError(res, err); } });
app.post('/api/orders/ecotrack/sync', async (req, res) => { try { await initDb(); const settings = await getEcoTrackSettings(pool); const first = await listEcoTrackOrders(settings, 1, {}); const parcels = Array.isArray(first?.data) ? [...first.data] : []; const lastPage = Math.max(1, Number(first?.last_page || first?.meta?.last_page || 1)); for (let page = 2; page <= lastPage; page += 1) { const next = await listEcoTrackOrders(settings, page, {}); if (Array.isArray(next?.data)) parcels.push(...next.data); } let synced = 0; for (const parcel of parcels) { const tracking = String(parcel.tracking || parcel.tracking_number || ''); const reference = String(parcel.reference || ''); if (!tracking && !reference) continue; const match = tracking ? await pool.query('SELECT id FROM orders WHERE ecotrack_tracking = $1 OR id = $2 LIMIT 1', [tracking, reference]) : await pool.query('SELECT id FROM orders WHERE id = $1 LIMIT 1', [reference]); if (!match.rows[0]) continue; const normalized = normalizeEcoTrackStatus(parcel.status); const nextStatus = normalized === 'delivered' ? 'delivered' : ['returning', 'cancelled'].includes(normalized) ? 'cancelled' : null; await saveEcoOrder(match.rows[0].id, { ecotrack_tracking: tracking || undefined, ecotrack_status: String(parcel.status || ''), ecotrack_updated_at: new Date(), ecotrack_raw_response: JSON.stringify(parcel), ...(nextStatus ? { status: nextStatus } : {}) }); synced += 1; } res.json({ success: true, fetched: parcels.length, synced }); } catch (err) { ecoError(res, err); } });

app.delete('/api/orders/:id', async (req, res) => {
  let client;
  try {
    await initDb();
    const { id } = req.params;
    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE;', [id]);
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    }
    const order = existing.rows[0];
    if (order.product_id && ['new', 'confirmed'].includes(order.status)) {
      await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2;', [Number(order.quantity) || 1, order.product_id]);
    }
    await client.query('DELETE FROM orders WHERE id = $1;', [id]);
    await client.query('COMMIT');
    res.json({ success: true, message: 'تم حذف الطلب بنجاح' });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) client.release();
  }
});

// ------------------------------------------
// 4. LEADS API (Auto-Capture unconfirmed clients)
// ------------------------------------------

// GET all leads (Abandoned carts / unconfirmed clients)
app.get('/api/leads', async (req, res) => {
  try {
    await initDb();
    const { status, search } = req.query;
    let query = 'SELECT * FROM leads WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(full_name) LIKE $${params.length} OR
        phone LIKE $${params.length} OR
        LOWER(willaya) LIKE $${params.length} OR
        LOWER(baladia) LIKE $${params.length}
      )`;
    }

    query += ' ORDER BY updated_at DESC;';

    const result = await pool.query(query, params);
    res.json({ success: true, leads: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST auto-capture or update draft lead
app.post('/api/leads', async (req, res) => {
  try {
    await initDb();
    const {
      sessionToken,
      fullName,
      phone,
      willaya,
      willayaId,
      baladia,
      quantity,
      price,
      deliveryFee,
      productId,
      productName
    } = req.body;

    const normalizedPhone = normalizeAlgerianPhone(phone);
    if (!isValidAlgerianPhone(normalizedPhone)) {
      return res.status(422).json({ success: false, error: 'رقم الهاتف الجزائري غير صالح', validPhoneRequired: true });
    }

    const token = sessionToken || `sess_${crypto.randomUUID()}`;
    const leadId = `LEAD-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const qty = parseInt(quantity, 10) || 1;
    const finalPrice = parseInt(price, 10) || 0;
    const finalDeliveryFee = parseStock(deliveryFee, 0);

    const query = `
      INSERT INTO leads (
        id, session_token, product_id, product_name,
        full_name, phone, willaya, willaya_id, baladia,
        quantity, price, delivery_fee, status, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'abandoned', CURRENT_TIMESTAMP)
      ON CONFLICT (session_token) DO UPDATE SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), leads.full_name),
        phone = COALESCE(NULLIF(EXCLUDED.phone, ''), leads.phone),
        willaya = COALESCE(NULLIF(EXCLUDED.willaya, ''), leads.willaya),
        willaya_id = COALESCE(EXCLUDED.willaya_id, leads.willaya_id),
        baladia = COALESCE(NULLIF(EXCLUDED.baladia, ''), leads.baladia),
        quantity = EXCLUDED.quantity,
        price = EXCLUDED.price,
        delivery_fee = EXCLUDED.delivery_fee,
        product_id = COALESCE(EXCLUDED.product_id, leads.product_id),
        product_name = COALESCE(EXCLUDED.product_name, leads.product_name),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const result = await pool.query(query, [
      leadId,
      token,
      productId ? parseInt(productId, 10) : null,
      productName || 'بذور الكاكي الفاخرة',
      fullName ? fullName.trim() : '',
      normalizedPhone,
      willaya ? willaya.trim() : '',
      willayaId ? parseInt(willayaId, 10) : null,
      baladia ? baladia.trim() : '',
      qty,
      finalPrice,
      finalDeliveryFee
    ]);

    res.json({ success: true, lead: result.rows[0], sessionToken: token });
  } catch (err) {
    console.error('Error auto-capturing lead:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH update lead status
app.patch('/api/leads/:id/status', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    const { status } = req.body;

    const result = await pool.query(`
      UPDATE leads SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *;
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'الزبون غير موجود' });
    }

    res.json({ success: true, lead: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST convert lead to official confirmed order
app.post('/api/leads/:id/convert', async (req, res) => {
  let client;
  try {
    await initDb();
    const { id } = req.params;
    client = await pool.connect();
    await client.query('BEGIN');
    const leadRes = await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE;', [id]);
    if (!leadRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'الزبون غير موجود' });
    }

    const lead = leadRes.rows[0];
    if (lead.status === 'converted') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'تم تحويل هذا الزبون إلى طلب مسبقاً' });
    }
    if (!lead.product_id || !isValidAlgerianPhone(lead.phone)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ success: false, error: 'بيانات الزبون أو المنتج غير مكتملة' });
    }
    const quantity = Number(lead.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) {
      await client.query('ROLLBACK');
      return res.status(422).json({ success: false, error: 'كمية الزبون غير صالحة' });
    }
    const productResult = await client.query('SELECT id, price_1, price_2, price_3 FROM products WHERE id = $1 FOR UPDATE;', [lead.product_id]);
    const product = productResult.rows[0];
    if (!product) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'المنتج المرتبط بالزبون غير موجود' });
    }
    const officialPrice = Number(product[`price_${quantity}`]);
    const stockResult = await client.query(
      'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id;',
      [quantity, lead.product_id]
    );
    if (!stockResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'المخزون لا يكفي لتحويل هذا الزبون إلى طلب' });
    }

    const orderId = `ORD-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const orderRes = await client.query(`
      INSERT INTO orders (
        id, product_id, product_name, full_name, phone,
        willaya, willaya_id, baladia, quantity, price, delivery_fee, status, note
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'confirmed', $12)
      RETURNING *;
    `, [
      orderId,
      lead.product_id,
      lead.product_name || 'بذور الكاكي الفاخرة',
      lead.full_name || 'زبون تم الاتصال به',
      lead.phone,
      lead.willaya || 'غير محدد',
      lead.willaya_id,
      lead.baladia || '',
      quantity,
      officialPrice,
      lead.delivery_fee || 0,
      'تم تأكيد الطلب هاتفياً من السلة المهجورة'
    ]);

    await client.query("UPDATE leads SET status = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = $1;", [id]);
    await client.query('COMMIT');

    res.json({ success: true, order: orderRes.rows[0] });
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) client.release();
  }
});

// DELETE single lead
app.delete('/api/leads/:id', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    const result = await pool.query('DELETE FROM leads WHERE id = $1 RETURNING id;', [id]);
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'الزبون غير موجود' });
    res.json({ success: true, message: 'تم حذف الزبون بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------
// 5. SETTINGS API
// ------------------------------------------
app.get('/api/public-settings', async (req, res) => {
  try {
    await initDb();
    const result = await pool.query("SELECT value FROM settings WHERE key = 'pixel_id' LIMIT 1;");
    const storedPixelId = String(result.rows[0]?.value || '').trim();
    const pixelId = /^\d{10,20}$/.test(storedPixelId) && storedPixelId !== '1808629570178310'
      ? storedPixelId
      : null;
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      settings: { pixel_id: pixelId }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    await initDb();
    const result = await pool.query('SELECT * FROM settings;');
    const settingsMap = {};
    result.rows.forEach(r => {
      settingsMap[r.key] = ['ecotrack_token', 'ecotrack_key'].includes(r.key) ? (r.value ? '••••••••' : '') : r.value;
    });
    res.json({ success: true, settings: settingsMap });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    await initDb();
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
      if (key === 'pixel_id') {
        const pixelId = String(value || '').trim();
        if (pixelId && (!/^\d{10,20}$/.test(pixelId) || pixelId === '1808629570178310')) {
          return res.status(400).json({ success: false, error: 'Pixel ID غير صالح أو قديم' });
        }
      }
      if (['ecotrack_token', 'ecotrack_key'].includes(key) && (!value || String(value).includes('••••'))) continue;
      await pool.query(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
      `, [key, String(value)]);
    }
    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route fallbacks for direct navigation
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Keep API failures machine-readable for the admin dashboard, including Multer errors.
app.use((err, req, res, next) => {
  if (!req.path.startsWith('/api/')) return next(err);
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'حجم الصورة كبير جداً (الحد الأقصى 2 ميغابايت للصورة)'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'يمكن رفع 6 صور كحد أقصى لكل منتج'
        : 'تعذر معالجة الصور المرفوعة';
    return res.status(400).json({ success: false, error: message });
  }
  return res.status(err.status || 500).json({ success: false, error: err.message || 'حدث خطأ في الخادم' });
});

// Start Server if executed directly (Local Node.js)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 E-Commerce Backend Server running on port ${PORT}`);
    console.log(`🌐 Landing Page: http://localhost:${PORT}/index.html`);
    console.log(`📊 Admin Page:   http://localhost:${PORT}/admin.html`);
  });
}

// Export Express app for Vercel Serverless Function
module.exports = app;
module.exports.productUtils = {
  normalizeProductSlug,
  parseMoney,
  parseStock,
  normalizeAlgerianPhone,
  isValidAlgerianPhone,
  normalizeProductImages,
  normalizeProductFeatures
};

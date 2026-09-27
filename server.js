const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
const {
  getSettings: getEcoTrackSettings,
  createParcel: createEcoTrackParcel,
  listOrders: listEcoTrackOrders,
  cancelParcel: cancelEcoTrackParcel,
  getFees: getEcoTrackFees,
  getProducts: getEcoTrackProducts,
  getCommunes: getEcoTrackCommunes,
  normalizeStatus: normalizeEcoTrackStatus
} = require('./ecotrack');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Cache database initialization promise
let dbInitPromise = null;

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
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_tracking VARCHAR(120);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_status VARCHAR(120);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS ecotrack_updated_at TIMESTAMP WITH TIME ZONE;
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS willaya_id INT;
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
            'assets/slide-1.jpg',
            'assets/slide-2.jpg',
            'assets/slide-3.jpg'
          ]),
          JSON.stringify([
            { icon: '🌿', label: 'طبيعية 100%' },
            { icon: '🌱', label: 'زراعة منزلية' },
            { icon: '📦', label: 'توصيل مضمون' }
          ])
        ]);
      }

      console.log('✅ Database schema verified and ready.');
    } catch (err) {
      console.error('⚠️ Database connection/initialization error:', err.message);
    } finally {
      if (client) client.release();
    }
  })();

  return dbInitPromise;
}

// Trigger initial DB setup
initDb().catch(e => console.warn('Non-blocking DB init:', e.message));

// ==========================================
// 2. MIDDLEWARE & UPLOADS
// ==========================================
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

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
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
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
app.post('/api/upload', upload.array('photos', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'لم يتم اختيار أي صورة' });
    }

    const fileUrls = req.files.map(f => {
      if (isVercel && f.buffer) {
        // Convert to data URI for serverless persistence without S3/disk
        return `data:${f.mimetype};base64,${f.buffer.toString('base64')}`;
      }
      return `uploads/${f.filename}`;
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
    const query = includeAll 
      ? 'SELECT * FROM products ORDER BY id DESC;' 
      : 'SELECT * FROM products WHERE is_active = true ORDER BY id DESC;';
    
    const result = await pool.query(query);
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
      is_active
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'اسم المنتج/البذور مطلوب' });
    }

    const cleanSlug = (slug && slug.trim())
      ? slug.trim().toLowerCase().replace(/[^\w\u0621-\u064A0-9]+/g, '-').replace(/^-+|-+$/g, '')
      : `seed-${Date.now()}`;

    // Ensure images is an array
    let imagesArr = [];
    if (Array.isArray(images)) {
      imagesArr = images.filter(img => typeof img === 'string' && img.trim().length > 0);
    } else if (typeof images === 'string' && images.trim()) {
      imagesArr = [images.trim()];
    }

    if (imagesArr.length === 0) {
      imagesArr = ['assets/slide-1.jpg'];
    }

    const featuresArr = Array.isArray(features) && features.length > 0 ? features : [
      { icon: '🌿', label: 'طبيعية 100%' },
      { icon: '🌱', label: 'زراعة منزلية' },
      { icon: '📦', label: 'توصيل مضمون' }
    ];

    const result = await pool.query(`
      INSERT INTO products (
        slug, name, subtitle, description,
        price_1, price_2, price_3, stock,
        images, features, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
      RETURNING *;
    `, [
      cleanSlug,
      name.trim(),
      subtitle || 'طبيعية 100% · زراعة منزلية سهلة · توصيل لكافة الولايات',
      description || '',
      parseInt(price_1, 10) || 2500,
      parseInt(price_2, 10) || 4200,
      parseInt(price_3, 10) || 5600,
      parseInt(stock, 10) || 50,
      JSON.stringify(imagesArr),
      JSON.stringify(featuresArr),
      is_active !== undefined ? Boolean(is_active) : true
    ]);

    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ success: false, error: err.message });
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
        is_active = COALESCE($11, is_active)
      WHERE id = $12
      RETURNING *;
    `, [
      name ? name.trim() : null,
      slug ? slug.trim() : null,
      subtitle !== undefined ? subtitle : null,
      description !== undefined ? description : null,
      price_1 !== undefined ? parseInt(price_1, 10) : null,
      price_2 !== undefined ? parseInt(price_2, 10) : null,
      price_3 !== undefined ? parseInt(price_3, 10) : null,
      stock !== undefined ? parseInt(stock, 10) : null,
      images ? JSON.stringify(images) : null,
      features ? JSON.stringify(features) : null,
      is_active !== undefined ? Boolean(is_active) : null,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'المنتج غير موجود' });
    }

    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE product
app.delete('/api/products/:id', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    await pool.query('DELETE FROM products WHERE id = $1;', [id]);
    res.json({ success: true, message: 'تم حذف المنتج بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      deliveryType
    } = req.body;

    if (!fullName || !phone) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال الاسم ورقم الهاتف' });
    }

    const orderId = id || `ORD-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
    const qty = parseInt(quantity, 10) || 1;
    const finalPrice = parseInt(price, 10) || 0;

    const result = await pool.query(`
      INSERT INTO orders (
        id, product_id, product_name, full_name, phone,
        willaya, baladia, quantity, price, status, note, delivery_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, $11)
      RETURNING *;
    `, [
      orderId,
      productId ? parseInt(productId, 10) : null,
      productName || 'بذور الكاكي الفاخرة',
      fullName.trim(),
      phone.trim(),
      willaya ? willaya.trim() : 'غير محدد',
      baladia ? baladia.trim() : '',
      qty,
      finalPrice,
      note || '',
      deliveryType === 'stop_desk' ? 'stop_desk' : 'home'
    ]);

    // If sessionToken was attached, mark corresponding lead as converted
    if (sessionToken) {
      await pool.query(`
        UPDATE leads SET status = 'converted', updated_at = CURRENT_TIMESTAMP
        WHERE session_token = $1 OR phone = $2;
      `, [sessionToken, phone.trim()]);
    }

    // Deduct product stock
    if (productId) {
      await pool.query(`
        UPDATE products SET stock = GREATEST(0, stock - $1) WHERE id = $2;
      `, [qty, parseInt(productId, 10)]);
    }

    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    console.error('Error placing order:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH update single order status
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    const { status } = req.body;

    const result = await pool.query(`
      UPDATE orders SET status = $1 WHERE id = $2 RETURNING *;
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    }

    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST bulk update order status
app.post('/api/orders/bulk-status', async (req, res) => {
  try {
    await initDb();
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'لم يتم تحديد طلبات' });
    }

    await pool.query(`
      UPDATE orders SET status = $1 WHERE id = ANY($2::text[]);
    `, [status, ids]);

    res.json({ success: true, updatedCount: ids.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------
// EcoTrack Algeria courier API
// ------------------------------------------
app.get('/api/ecotrack/communes/:wilayaId', async (req, res) => {
  try {
    await initDb();
    const settings = await getEcoTrackSettings(pool);
    const communes = await getEcoTrackCommunes(req.params.wilayaId, settings);
    res.json({ success: true, communes });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.get('/api/ecotrack/fees', async (req, res) => {
  try {
    await initDb();
    const settings = await getEcoTrackSettings(pool);
    const fees = await getEcoTrackFees(settings);
    res.json({ success: true, fees, provider: settings.provider });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.get('/api/ecotrack/products', async (req, res) => {
  try {
    await initDb();
    const settings = await getEcoTrackSettings(pool);
    const products = await getEcoTrackProducts(settings);
    res.json({ success: true, products, provider: settings.provider });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.post('/api/orders/:id/ecotrack/push', async (req, res) => {
  try {
    await initDb();
    const result = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    const order = result.rows[0];
    if (order.ecotrack_tracking) return res.status(409).json({ success: false, error: `الطلب مرفوع مسبقاً برقم التتبع ${order.ecotrack_tracking}` });
    if (order.status !== 'confirmed') return res.status(409).json({ success: false, error: 'يجب تأكيد الطلب قبل رفعه إلى EcoTrack' });
    const settings = await getEcoTrackSettings(pool);
    const pushed = await createEcoTrackParcel({ ...order, delivery_type: req.body?.deliveryType || order.delivery_type }, settings);
    const updated = await pool.query('UPDATE orders SET ecotrack_tracking = $1, ecotrack_status = $2, ecotrack_updated_at = CURRENT_TIMESTAMP, status = \'confirmed\' WHERE id = $3 RETURNING *', [pushed.tracking, 'created', req.params.id]);
    res.json({ success: true, tracking: pushed.tracking, order: updated.rows[0] });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.post('/api/orders/ecotrack/bulk-push', async (req, res) => {
  try {
    await initDb();
    const ids = Array.isArray(req.body?.ids) && req.body.ids.length ? req.body.ids : null;
    const query = ids ? "SELECT * FROM orders WHERE id = ANY($1::text[]) AND status = 'confirmed' AND ecotrack_tracking IS NULL" : "SELECT * FROM orders WHERE status = 'confirmed' AND ecotrack_tracking IS NULL";
    const orders = (await pool.query(query, ids ? [ids] : [])).rows;
    const results = { total: orders.length, pushed: [], failed: [] };
    const settings = await getEcoTrackSettings(pool);
    for (const order of orders) {
      try {
        const pushed = await createEcoTrackParcel(order, settings);
        await pool.query('UPDATE orders SET ecotrack_tracking = $1, ecotrack_status = $2, ecotrack_updated_at = CURRENT_TIMESTAMP, status = \'confirmed\' WHERE id = $3', [pushed.tracking, 'created', order.id]);
        results.pushed.push({ id: order.id, tracking: pushed.tracking });
      } catch (err) {
        results.failed.push({ id: order.id, error: err.message });
      }
    }
    res.json({ success: true, ...results });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.post('/api/orders/:id/ecotrack/cancel', async (req, res) => {
  try {
    await initDb();
    const result = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [req.params.id]);
    const order = result.rows[0];
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    if (!order.ecotrack_tracking) return res.status(409).json({ success: false, error: 'لا يوجد رقم تتبع لهذا الطلب' });
    const settings = await getEcoTrackSettings(pool);
    await cancelEcoTrackParcel(order.ecotrack_tracking, settings);
    const updated = await pool.query('UPDATE orders SET ecotrack_tracking = NULL, ecotrack_status = \'cancelled\', ecotrack_updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *', [req.params.id]);
    res.json({ success: true, order: updated.rows[0] });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.post('/api/orders/ecotrack/bulk-cancel', async (req, res) => {
  try {
    await initDb();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'حدد طلبات مشحونة أولاً' });
    const orders = (await pool.query('SELECT * FROM orders WHERE id = ANY($1::text[]) AND ecotrack_tracking IS NOT NULL', [ids])).rows;
    const settings = await getEcoTrackSettings(pool);
    const results = { total: orders.length, cancelled: [], failed: [] };
    for (const order of orders) {
      try {
        await cancelEcoTrackParcel(order.ecotrack_tracking, settings);
        await pool.query('UPDATE orders SET ecotrack_tracking = NULL, ecotrack_status = \'cancelled\', ecotrack_updated_at = CURRENT_TIMESTAMP WHERE id = $1', [order.id]);
        results.cancelled.push(order.id);
      } catch (err) { results.failed.push({ id: order.id, error: err.message }); }
    }
    res.json({ success: true, ...results });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

app.post('/api/orders/ecotrack/sync', async (req, res) => {
  try {
    await initDb();
    const settings = await getEcoTrackSettings(pool);
    const first = await listEcoTrackOrders(settings, 1, 100);
    const parcels = Array.isArray(first?.data) ? [...first.data] : (Array.isArray(first?.orders) ? [...first.orders] : []);
    const lastPage = Math.max(1, Number(first?.last_page || first?.meta?.last_page || 1));
    for (let page = 2; page <= lastPage; page += 1) {
      const next = await listEcoTrackOrders(settings, page, 100);
      if (Array.isArray(next?.data)) parcels.push(...next.data);
    }
    let synced = 0;
    for (const parcel of parcels) {
      const tracking = String(parcel.tracking || parcel.tracking_number || '');
      const reference = String(parcel.reference || '');
      if (!tracking && !reference) continue;
      const match = tracking
        ? await pool.query('SELECT id FROM orders WHERE ecotrack_tracking = $1 OR id = $2 LIMIT 1', [tracking, reference])
        : await pool.query('SELECT id FROM orders WHERE id = $1 LIMIT 1', [reference]);
      if (!match.rows[0]) continue;
      const normalized = normalizeEcoTrackStatus(parcel.status);
      const nextStatus = normalized === 'delivered' ? 'delivered' : ['returning', 'cancelled'].includes(normalized) ? 'cancelled' : null;
      await pool.query('UPDATE orders SET ecotrack_tracking = COALESCE(NULLIF($1, \'\'), ecotrack_tracking), ecotrack_status = $2, ecotrack_updated_at = CURRENT_TIMESTAMP, status = COALESCE($3, status) WHERE id = $4', [tracking, String(parcel.status || ''), nextStatus, match.rows[0].id]);
      synced += 1;
    }
    res.json({ success: true, fetched: parcels.length, synced });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// DELETE single order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    await pool.query('DELETE FROM orders WHERE id = $1;', [id]);
    res.json({ success: true, message: 'تم حذف الطلب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      productId,
      productName
    } = req.body;

    // Ignore if phone or name is empty
    if ((!phone || phone.trim().length < 6) && (!fullName || fullName.trim().length < 2)) {
      return res.json({ success: false, message: 'معلومات غير كافية للحفظ' });
    }

    const token = sessionToken || `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const leadId = `LEAD-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
    const qty = parseInt(quantity, 10) || 1;
    const finalPrice = parseInt(price, 10) || 0;

    const query = `
      INSERT INTO leads (
        id, session_token, product_id, product_name,
        full_name, phone, willaya, willaya_id, baladia,
        quantity, price, status, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'abandoned', CURRENT_TIMESTAMP)
      ON CONFLICT (session_token) DO UPDATE SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), leads.full_name),
        phone = COALESCE(NULLIF(EXCLUDED.phone, ''), leads.phone),
        willaya = COALESCE(NULLIF(EXCLUDED.willaya, ''), leads.willaya),
        willaya_id = COALESCE(EXCLUDED.willaya_id, leads.willaya_id),
        baladia = COALESCE(NULLIF(EXCLUDED.baladia, ''), leads.baladia),
        quantity = EXCLUDED.quantity,
        price = EXCLUDED.price,
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
      phone ? phone.trim() : '',
      willaya ? willaya.trim() : '',
      willayaId ? parseInt(willayaId, 10) : null,
      baladia ? baladia.trim() : '',
      qty,
      finalPrice
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
  try {
    await initDb();
    const { id } = req.params;
    const leadRes = await pool.query('SELECT * FROM leads WHERE id = $1;', [id]);
    if (leadRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'الزبون غير موجود' });
    }

    const lead = leadRes.rows[0];
    const orderId = `ORD-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;

    const orderRes = await pool.query(`
      INSERT INTO orders (
        id, product_id, product_name, full_name, phone,
        willaya, baladia, quantity, price, status, note
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', $10)
      RETURNING *;
    `, [
      orderId,
      lead.product_id,
      lead.product_name || 'بذور الكاكي الفاخرة',
      lead.full_name || 'زبون تم الاتصال به',
      lead.phone,
      lead.willaya || 'غير محدد',
      lead.baladia || '',
      lead.quantity || 1,
      lead.price || 0,
      'تم تأكيد الطلب هاتفياً من السلة المهجورة'
    ]);

    // Mark lead as converted
    await pool.query("UPDATE leads SET status = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = $1;", [id]);

    // Deduct stock if product ID exists
    if (lead.product_id) {
      await pool.query('UPDATE products SET stock = GREATEST(0, stock - $1) WHERE id = $2;', [lead.quantity || 1, lead.product_id]);
    }

    res.json({ success: true, order: orderRes.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE single lead
app.delete('/api/leads/:id', async (req, res) => {
  try {
    await initDb();
    const { id } = req.params;
    await pool.query('DELETE FROM leads WHERE id = $1;', [id]);
    res.json({ success: true, message: 'تم حذف الزبون بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------
// 5. SETTINGS API
// ------------------------------------------
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

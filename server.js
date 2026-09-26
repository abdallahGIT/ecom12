const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. DATABASE CONNECTION (NEON POSTGRESQL)
// ==========================================
// Raw connection string provided by user
const NEON_CONNECTION_STRING = process.env.DATABASE_URL || 
  "postgresql://neondb_owner:npg_G84KNtlCZgrx@ep-curly-night-zak08u4u-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require";

// Clean connection URL for pg client
const cleanDbUrl = NEON_CONNECTION_STRING.replace('&channel_binding=require', '').replace('channel_binding=require&', '');

const pool = new Pool({
  connectionString: cleanDbUrl,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Test and initialize database schema
async function initDb() {
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Connected to Neon PostgreSQL database successfully.');

    // 1. Products table
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
        willaya VARCHAR(100) NOT NULL,
        baladia VARCHAR(100) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        price INT NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'new',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Settings table
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
          'بذور الكاكي',
          'طبيعية 100% · زراعة منزلية سهلة · توصيل لكافة الولايات',
          'بذور الكاكي الفاخرة، بذور طبيعية منتقاة بعناية للزراعة في الحدائق والمنازل مع جودة إنتاجية ممتازة.',
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
}

initDb();

// ==========================================
// 2. MIDDLEWARE & UPLOADS
// ==========================================
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage for product photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const uniqueName = `seed-${Date.now()}-${Math.round(Math.random() * 1E6)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('الملف المرفوع يجب أن يكون صورة'));
    }
  }
});

// Serve static files
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// ==========================================
// 3. API ENDPOINTS
// ==========================================

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() as current_time;');
    res.json({
      status: 'ok',
      db: 'connected',
      neon_time: r.rows[0].current_time
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
    const fileUrls = req.files.map(f => `/uploads/${f.filename}`);
    res.json({ success: true, urls: fileUrls });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------
// Products API (Multi-Seed Management)
// ------------------------------------------

// GET all products
app.get('/api/products', async (req, res) => {
  try {
    const includeInactive = req.query.all === 'true';
    const query = includeInactive 
      ? 'SELECT * FROM products ORDER BY id ASC;' 
      : 'SELECT * FROM products WHERE is_active = true ORDER BY id ASC;';
    
    const result = await pool.query(query);
    res.json({ success: true, products: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single product by id or slug
app.get('/api/products/:identifier', async (req, res) => {
  try {
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

    if (!name) {
      return res.status(400).json({ success: false, error: 'اسم المنتج مطلوب' });
    }

    const generatedSlug = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^\w\u0621-\u064A0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `seed-${Date.now()}`;

    // Ensure images is an array
    const imagesArr = Array.isArray(images) ? images : [];
    const featuresArr = Array.isArray(features) ? features : [
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
      generatedSlug,
      name,
      subtitle || 'طبيعية 100% · زراعة منزلية سهلة · توصيل لكافة الولايات',
      description || '',
      parseInt(price_1, 10) || 2500,
      parseInt(price_2, 10) || 4200,
      parseInt(price_3, 10) || 5600,
      parseInt(stock, 10) || 50,
      JSON.stringify(imagesArr),
      JSON.stringify(featuresArr),
      is_active !== undefined ? is_active : true
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
        images = COALESCE($9::jsonb, images),
        features = COALESCE($10::jsonb, features),
        is_active = COALESCE($11, is_active)
      WHERE id = $12
      RETURNING *;
    `, [
      name,
      slug,
      subtitle,
      description,
      price_1 !== undefined ? parseInt(price_1, 10) : null,
      price_2 !== undefined ? parseInt(price_2, 10) : null,
      price_3 !== undefined ? parseInt(price_3, 10) : null,
      stock !== undefined ? parseInt(stock, 10) : null,
      images ? JSON.stringify(images) : null,
      features ? JSON.stringify(features) : null,
      is_active,
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
    const { status, search } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
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

// POST create order
app.post('/api/orders', async (req, res) => {
  try {
    const {
      fullName,
      phone,
      willaya,
      baladia,
      quantity,
      price,
      productId,
      productName
    } = req.body;

    if (!fullName || !phone || !willaya || !baladia) {
      return res.status(400).json({ success: false, error: 'يرجى إكمال جميع الحقول المطلوبة' });
    }

    const orderId = `ORD-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90 + 10)}`;
    const qty = parseInt(quantity, 10) || 1;
    const finalPrice = parseInt(price, 10) || 0;

    const result = await pool.query(`
      INSERT INTO orders (
        id, product_id, product_name, full_name, phone,
        willaya, baladia, quantity, price, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new')
      RETURNING *;
    `, [
      orderId,
      productId ? parseInt(productId, 10) : null,
      productName || 'بذور الكاكي',
      fullName,
      phone,
      willaya,
      baladia,
      qty,
      finalPrice
    ]);

    // Deduct stock if product ID exists
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

// DELETE single order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM orders WHERE id = $1;', [id]);
    res.json({ success: true, message: 'تم حذف الطلب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ------------------------------------------
// Settings API (Pixel & EcoTrack)
// ------------------------------------------
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings;');
    const settingsMap = {};
    result.rows.forEach(r => { settingsMap[r.key] = r.value; });
    res.json({ success: true, settings: settingsMap });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    for (const [key, value] of entries) {
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

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 E-Commerce Backend Server running on port ${PORT}`);
  console.log(`🌐 Landing Page: http://localhost:${PORT}/index.html`);
  console.log(`📊 Admin Page:   http://localhost:${PORT}/admin.html`);
});

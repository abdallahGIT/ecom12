// ======================================================
// ECOTRACK & SEED MANAGEMENT ADMIN DASHBOARD (NEON DB)
// Product CRUD, Captured Leads (Abandoned), Orders & Sync
// ======================================================

let currentOrders = [];
let currentLeads = [];
let currentProducts = [];
let activeFilter = "all";
let searchQuery = "";
let leadsSearchQuery = "";
let currentTableTab = "orders";
let currentProductImages = []; // Array of image URLs for the modal
const deletingProductIds = new Set();
let productsLoadError = "";
let ordersLoadError = "";
let leadsLoadError = "";
let dashboardRefreshInFlight = false;

async function fetchAdminJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.loginRequired) {
    window.location.replace('/admin');
    throw new Error('انتهت جلسة الإدارة. يرجى تسجيل الدخول مجدداً.');
  }
  if (!res.ok) throw new Error(data.error || `خطأ من الخادم (${res.status})`);
  return { res, data };
}

document.addEventListener("DOMContentLoaded", async () => {
  initEventListeners();
  initWilayaDropdownInAddModal();
  
  // Initial DB Loads
  await checkDbHealth();
  await loadProducts();
  await loadOrders();
  await loadLeads();
  await loadApiSettings();

  // Keep phone-verified leads and new orders visible to staff without a manual refresh.
  window.setInterval(async () => {
    if (document.visibilityState !== 'visible' || dashboardRefreshInFlight) return;
    dashboardRefreshInFlight = true;
    try {
      await loadLeads();
      if (!document.querySelector('.order-check:checked')) await loadOrders();
    } finally {
      dashboardRefreshInFlight = false;
    }
  }, 15000);
});

// ======================================================
// 1. DATABASE HEALTH & CONNECTION STATUS
// ======================================================
async function checkDbHealth() {
  const badge = document.getElementById("dbStatusBadge");
  const text = document.getElementById("dbStatusText");

  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.status === 'ok' && data.db === 'connected') {
      if (badge) {
        badge.className = "db-status-badge online";
        badge.title = `قاعدة بيانات Neon متصلة ⚡ (توقيت السيرفر: ${data.neon_time})`;
      }
      if (text) {
        text.textContent = `🟢 Neon DB متصل (${data.counts.products} منتجات · ${data.counts.orders} طلبات · ${data.counts.leads} سلات مهجورة)`;
      }
      return true;
    }
  } catch (err) {
    console.warn("⚠️ Database health check failed:", err);
  }

  if (badge) {
    badge.className = "db-status-badge offline";
    badge.title = "تعذر الاتصال بقاعدة بيانات Neon";
  }
  if (text) {
    text.textContent = "🔴 قاعدة البيانات غير متصلة؛ لا يمكن حفظ التغييرات حالياً";
  }
  return false;
}

// ======================================================
// 2. SEED PRODUCTS MANAGEMENT (CRUD)
// ======================================================
async function loadProducts() {
  const grid = document.getElementById("productsGrid");
  const select = document.getElementById("newOrderProductSelect");

  try {
    const { data } = await fetchAdminJson('/api/products?all=true');
    if (data.success && Array.isArray(data.products)) {
      currentProducts = data.products;
      productsLoadError = "";
    } else {
      throw new Error(data.error || 'استجابة المنتجات غير صالحة');
    }
  } catch (err) {
    console.error("Could not fetch products from DB:", err);
    currentProducts = [];
    productsLoadError = err.message;
  }

  // Populate manual order product selector
  if (select) {
    select.innerHTML = '';
    currentProducts.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.price_1} د.ج)`;
      select.appendChild(opt);
    });
  }

  renderProductsGrid();
  updateActiveStockDisplay();
}

function renderProductsGrid() {
  const grid = document.getElementById("productsGrid");
  if (!grid) return;

  if (currentProducts.length === 0) {
    grid.innerHTML = `
      <div class="loading-placeholder">
        ${productsLoadError ? `تعذر تحميل المنتجات: ${escapeHtml(productsLoadError)}` : 'لا توجد منتجات بذور مضافة حالياً. اضغط على "+ إضافة منتج بذور جديد" للبدء.'}
      </div>
    `;
    return;
  }

  grid.innerHTML = "";

  currentProducts.forEach(prod => {
    const card = document.createElement("div");
    card.className = "product-card";

    let images = [];
    try {
      images = typeof prod.images === 'string' ? JSON.parse(prod.images) : (prod.images || []);
    } catch {
      images = [prod.images];
    }
    const mainImg = (images && images.length > 0) ? images[0] : 'assets/slide-1.webp';
    const productUrl = prod.slug
      ? `${window.location.origin}/?p=${encodeURIComponent(prod.slug)}`
      : `${window.location.origin}/`;

    card.innerHTML = `
      <div class="product-card-top">
        <img src="${escapeHtml(mainImg)}" alt="${escapeHtml(prod.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/slide-1.webp'">
        <span class="product-status-tag ${prod.is_active ? '' : 'inactive'}">
          ${prod.is_active ? 'معروض بالمتجر ✓' : 'غير معروض ✕'}
        </span>
      </div>
      <div class="product-card-body">
        <h3 class="product-card-title">${escapeHtml(prod.name)}</h3>
        <p class="product-card-sub">${escapeHtml(prod.subtitle || 'بذور طبيعية عالية الجودة')}</p>

        <div class="product-prices-row">
          <div class="price-pill-item">
            <span class="price-pill-label">1 علبة</span>
            <span class="price-pill-val">${(prod.price_1 || 2500).toLocaleString("fr-FR")} د.ج</span>
          </div>
          <div class="price-pill-item">
            <span class="price-pill-label">2 علب</span>
            <span class="price-pill-val" style="color:#059669;">${(prod.price_2 || 4200).toLocaleString("fr-FR")} د.ج</span>
          </div>
          <div class="price-pill-item">
            <span class="price-pill-label">3 علب</span>
            <span class="price-pill-val">${(prod.price_3 || 5600).toLocaleString("fr-FR")} د.ج</span>
          </div>
        </div>

        <div style="margin:12px 0 4px; padding:10px; border:1px solid #E2E8F0; border-radius:10px; background:#F8FAFC;">
          <div style="font-size:.76rem; font-weight:800; color:#475569; margin-bottom:6px;">🔗 رابط المنتج</div>
          <div style="display:flex; gap:6px; align-items:center; direction:ltr;">
            <input type="text" value="${escapeHtml(productUrl)}" readonly aria-label="رابط ${escapeHtml(prod.name)}" style="min-width:0; flex:1; padding:7px 8px; border:1px solid #CBD5E1; border-radius:7px; background:#fff; color:#334155; font-size:.72rem;" onclick="this.select()">
            <button type="button" class="btn-tbl" onclick="copyProductLink(${escapeHtml(JSON.stringify(productUrl))})" title="نسخ رابط المنتج">نسخ</button>
          </div>
        </div>

        <div class="product-card-footer">
          <span class="stock-indicator">📦 المخزون: <strong>${prod.stock || 0} علبة</strong></span>
          <div class="prod-actions">
            <a class="btn-tbl" href="${escapeHtml(productUrl)}" target="_blank" rel="noopener" title="فتح المنتج في المتجر">🔗 فتح الرابط</a>
            <button class="btn-tbl edit-btn" onclick="openEditProductModal(${Number(prod.id)})" title="تعديل المنتج">✏️ تعديل</button>
            <button type="button" class="btn-tbl delete" onclick="handleDeleteProduct(${Number(prod.id)}, this)" title="حذف المنتج">🗑️</button>
          </div>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

window.copyProductLink = async function(url) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else {
      const input = document.createElement('textarea');
      input.value = url;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.focus();
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    alert('✓ تم نسخ رابط المنتج');
  } catch (err) {
    alert('تعذر نسخ الرابط. يمكنك تحديده ونسخه يدوياً.');
  }
};

// Product Modal Handlers
function openNewProductModal() {
  const modal = document.getElementById("productModal");
  const form = document.getElementById("seedProductForm");
  const title = document.getElementById("productModalTitle");
  const editId = document.getElementById("editProductId");

  if (!modal || !form) return;

  form.reset();
  if (editId) editId.value = "";
  if (title) title.textContent = "🌱 إضافة منتج بذور جديد";
  
  currentProductImages = ['assets/slide-1.webp', 'assets/slide-2.webp', 'assets/slide-3.webp'];
  renderImagePreviews();

  document.getElementById("prodPrice1").value = 2500;
  document.getElementById("prodPrice2").value = 4200;
  document.getElementById("prodPrice3").value = 5600;
  document.getElementById("prodStock").value = 50;
  document.getElementById("prodIsActive").checked = true;

  modal.classList.add("active");
}

window.openEditProductModal = function(productId) {
  const prod = currentProducts.find(p => p.id === productId);
  if (!prod) return;

  const modal = document.getElementById("productModal");
  const title = document.getElementById("productModalTitle");
  const editId = document.getElementById("editProductId");

  if (!modal) return;

  if (title) title.textContent = `✏️ تعديل المنتج: ${prod.name}`;
  if (editId) editId.value = prod.id;

  document.getElementById("prodName").value = prod.name || "";
  document.getElementById("prodSlug").value = prod.slug || "";
  document.getElementById("prodSubtitle").value = prod.subtitle || "";
  document.getElementById("prodDescription").value = prod.description || "";
  document.getElementById("prodPrice1").value = prod.price_1 || 2500;
  document.getElementById("prodPrice2").value = prod.price_2 || 4200;
  document.getElementById("prodPrice3").value = prod.price_3 || 5600;
  document.getElementById("prodStock").value = prod.stock !== undefined ? prod.stock : 50;
  document.getElementById("prodIsActive").checked = Boolean(prod.is_active);

  try {
    currentProductImages = typeof prod.images === 'string' ? JSON.parse(prod.images) : (prod.images || []);
  } catch {
    currentProductImages = [prod.images];
  }
  renderImagePreviews();

  modal.classList.add("active");
};

function renderImagePreviews() {
  const container = document.getElementById("imagesPreviewGrid");
  if (!container) return;

  container.innerHTML = "";

  currentProductImages.filter(Boolean).forEach((imgUrl, index) => {
    const box = document.createElement("div");
    box.className = "preview-thumb-box";
    box.innerHTML = `
      <img src="${escapeHtml(imgUrl)}" alt="Preview" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/slide-1.webp'">
      <button type="button" class="preview-remove-btn" onclick="removeProductImage(${index})" title="حذف الصورة">✕</button>
    `;
    container.appendChild(box);
  });
}

window.removeProductImage = function(index) {
  currentProductImages.splice(index, 1);
  renderImagePreviews();
};

function readNumberInput(id, fallback, minimum = 0) {
  const value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) && value >= minimum ? Math.floor(value) : fallback;
}

async function prepareImageForUpload(file) {
  if (file.size <= 180 * 1024 || !/^image\/(jpeg|png|webp|avif)$/i.test(file.type)) return file;

  const bitmap = await createImageBitmap(file);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('تعذر تجهيز الصورة للرفع');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (!blob) throw new Error('تعذر ضغط الصورة');
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
}

async function handlePhotoFilesUpload(files) {
  if (!files || files.length === 0) return;

  const formData = new FormData();
  const dropText = document.querySelector('.dropzone-text');
  if (dropText) dropText.textContent = "جاري رفع الصور إلى السيرفر...";

  try {
    for (const file of Array.from(files).slice(0, 6)) {
      formData.append('photos', await prepareImageForUpload(file));
    }
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.urls)) {
      currentProductImages = currentProductImages.concat(data.urls);
      renderImagePreviews();
    } else {
      alert("تعذر رفع الصور: " + (data.error || "خطأ غير معروف"));
    }
  } catch (err) {
    alert("فشل رفع الصور: " + err.message);
  } finally {
    if (dropText) dropText.textContent = "اضغط هنا لاختيار صور من جهازك أو اسحبها إلى هنا";
  }
}

window.handleDeleteProduct = async function(productId, button) {
  const normalizedId = String(productId);
  if (deletingProductIds.has(normalizedId)) return;
  const productName = currentProducts.find(product => String(product.id) === String(productId))?.name || `رقم ${productId}`;
  if (confirm(`هل أنت متأكد من حذف المنتج "${productName}" نهائياً من قاعدة بيانات Neon؟`)) {
    deletingProductIds.add(normalizedId);
    if (button) {
      button.disabled = true;
      button.textContent = '⏳';
    }
    try {
      const { data } = await fetchAdminJson(`/api/products/${encodeURIComponent(productId)}`, { method: 'DELETE' });
      if (!data.success) throw new Error(data.error || 'تعذر حذف المنتج');
      await loadProducts();
      await checkDbHealth();
    } catch (err) {
      alert(err.message || 'فشل الاتصال بالسيرفر. لم يتم حذف المنتج.');
    } finally {
      deletingProductIds.delete(normalizedId);
    }
  }
};

// ======================================================
// 3. ORDERS MANAGEMENT (NEON DB)
// ======================================================
async function loadOrders() {
  try {
    const { data } = await fetchAdminJson('/api/orders');
    if (data.success && Array.isArray(data.orders)) {
      ordersLoadError = "";
      currentOrders = data.orders.map(o => {
        const fullName = o.full_name ?? o.fullName ?? '';
        const phone = o.phone ?? '';
        return {
          id: o.id,
          fullName,
          phone,
          willaya: o.willaya ?? o.wilaya ?? '',
          baladia: o.baladia ?? '',
          quantity: Number(o.quantity) || 1,
          price: Number(o.price) || 0,
          deliveryFee: Number(o.delivery_fee ?? o.deliveryFee) || 0,
          deliveryFeePending: Boolean(o.delivery_fee_pending ?? o.deliveryFeePending),
          productName: o.product_name ?? o.productName ?? '',
          status: o.status || 'new',
          deliveryType: o.delivery_type ?? o.deliveryType ?? 'home',
          ecotrackTracking: o.ecotrack_tracking ?? o.ecotrackTracking ?? '',
          ecotrackStatus: o.ecotrack_status ?? o.ecotrackStatus ?? '',
          ecotrackReturnStatus: o.ecotrack_return_status ?? o.ecotrackReturnStatus ?? '',
          note: o.note ?? '',
          createdAt: o.created_at || o.createdAt
            ? new Date(o.created_at || o.createdAt).toLocaleString("fr-FR", { hour12: false })
            : '-'
        };
      });
    } else {
      throw new Error(data.error || 'استجابة الطلبات غير صالحة');
    }
  } catch (err) {
    console.error("Could not fetch orders from DB:", err);
    currentOrders = [];
    ordersLoadError = err.message;
  }

  renderMetrics();
  renderStockAndPipeline();
  renderOrdersTable();
}

function renderMetrics() {
  const total = currentOrders.length;
  const confirmed = currentOrders.filter(o => o.status === "confirmed").length;
  const delivered = currentOrders.filter(o => o.status === "delivered").length;
  const pending = currentOrders.filter(o => o.status === "new").length;
  const leadsCount = currentLeads.filter(l => l.status !== "converted").length;
  
  const revenue = currentOrders
    .filter(o => o.status === "confirmed" || o.status === "delivered")
    .reduce((sum, o) => sum + (o.price || 0), 0);

  const mTotal = document.getElementById("metricTotal");
  const mConf = document.getElementById("metricConfirmed");
  const mPend = document.getElementById("metricPending");
  const mLeads = document.getElementById("metricLeads");
  const mRev = document.getElementById("metricRevenue");

  if (mTotal) mTotal.textContent = total;
  if (mConf) mConf.textContent = confirmed + delivered;
  if (mPend) mPend.textContent = pending;
  if (mLeads) mLeads.textContent = leadsCount;
  if (mRev) mRev.textContent = `${revenue.toLocaleString("fr-FR")} د.ج`;

  const oTab = document.getElementById("ordersTabCount");
  const lTab = document.getElementById("leadsTabCount");
  if (oTab) oTab.textContent = total;
  if (lTab) lTab.textContent = leadsCount;
}

function renderStockAndPipeline() {
  const newOrders = currentOrders.filter(o => o.status === "new");
  const confOrders = currentOrders.filter(o => o.status === "confirmed");
  const delivOrders = currentOrders.filter(o => o.status === "delivered");
  const cancelOrders = currentOrders.filter(o => o.status === "cancelled");
  const leadsUnconfirmed = currentLeads.filter(l => l.status !== "converted");

  // Pipeline counts
  const pLeads = document.getElementById("pipeLeads");
  const pNew = document.getElementById("pipeNew");
  const pConf = document.getElementById("pipeConf");
  const pDeliv = document.getElementById("pipeDeliv");
  const pCancel = document.getElementById("pipeCancel");

  if (pLeads) pLeads.textContent = leadsUnconfirmed.length;
  if (pNew) pNew.textContent = newOrders.length;
  if (pConf) pConf.textContent = confOrders.length;
  if (pDeliv) pDeliv.textContent = delivOrders.length;
  if (pCancel) pCancel.textContent = cancelOrders.length;

  updateActiveStockDisplay();
}

function updateActiveStockDisplay() {
  const activeProduct = currentProducts.find(p => p.is_active) || currentProducts[0];
  const totalStock = activeProduct ? (activeProduct.stock || 0) : 50;

  const newOrders = currentOrders.filter(o => o.status === "new");
  const pendingUnits = newOrders.reduce((sum, o) => sum + (o.quantity || 1), 0);
  const availableStock = Math.max(0, totalStock - pendingUnits);

  const sCount = document.getElementById("stockCount");
  const sPending = document.getElementById("stockPending");
  const sAvailable = document.getElementById("stockAvailable");
  const sBadge = document.getElementById("stockStatusBadge");

  if (sCount) sCount.textContent = totalStock;
  if (sPending) sPending.textContent = `${pendingUnits} علبة`;
  if (sAvailable) sAvailable.textContent = `${availableStock} علبة`;

  if (sBadge) {
    if (availableStock > 15) {
      sBadge.textContent = "جيد ✓";
      sBadge.style.background = "#DCFCE7";
      sBadge.style.color = "#166534";
    } else if (availableStock > 0) {
      sBadge.textContent = "منخفض ⚠️";
      sBadge.style.background = "#FEF3C7";
      sBadge.style.color = "#B45309";
    } else {
      sBadge.textContent = "نفذ المخزون ✕";
      sBadge.style.background = "#FEE2E2";
      sBadge.style.color = "#B91C1C";
    }
  }
}

async function adjustActiveStock(delta) {
  const activeProduct = currentProducts.find(p => p.is_active) || currentProducts[0];
  if (!activeProduct) return;

  const newStock = Math.max(0, (activeProduct.stock || 0) + delta);
  activeProduct.stock = newStock;

  try {
    await fetch(`/api/products/${activeProduct.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: newStock })
    });
  } catch (err) {
    console.warn("Could not sync stock to server:", err);
  }

  renderProductsGrid();
  renderStockAndPipeline();
}

function renderOrdersTable() {
  const tbody = document.getElementById("ordersTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const masterCheck = document.getElementById("masterCheck");
  if (masterCheck) masterCheck.checked = false;

  let filtered = currentOrders.filter(o => {
    const matchesFilter = (activeFilter === "all") || (o.status === activeFilter);
    const q = searchQuery.toLowerCase();
    const matchesSearch = 
      (o.fullName && o.fullName.toLowerCase().includes(q)) ||
      (o.phone && o.phone.includes(q)) ||
      (o.willaya && o.willaya.toLowerCase().includes(q)) ||
      (o.baladia && o.baladia.toLowerCase().includes(q)) ||
      (o.id && o.id.toLowerCase().includes(q));

    return matchesFilter && matchesSearch;
  });

  const countLabel = document.getElementById("tableCountLabel");
  if (countLabel) countLabel.textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 30px; color: #888;">
          ${ordersLoadError ? `تعذر تحميل الطلبات: ${escapeHtml(ordersLoadError)}` : 'لا توجد طلبات مطابقة للبحث أو التصفية الحالية.'}
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((o, index) => {
    const tr = document.createElement("tr");

    const statusMap = {
      new: { label: "جديد ⏳", class: "new" },
      confirmed: { label: "مؤكد ✓", class: "confirmed" },
      delivered: { label: "تم التوصيل 📦", class: "delivered" },
      cancelled: { label: "ملغى ✕", class: "cancelled" }
    };

    const statusInfo = statusMap[o.status] || { label: o.status, class: "new" };

    tr.innerHTML = `
      <td><input type="checkbox" class="order-check" value="${o.id}"></td>
      <td style="font-weight: 800; color: #64748B;">${escapeHtml(o.id || `ORD-${1000 + index}`)}</td>
      <td style="font-weight:700; color:#065F46;">${escapeHtml(o.productName || 'بذور الكاكي')}</td>
      <td><strong>${escapeHtml(o.fullName)}</strong></td>
      <td dir="ltr" style="text-align: right;">
        <a href="tel:${o.phone}" style="color: #0A0A0A; text-decoration: none; font-weight: 700;">${escapeHtml(o.phone)}</a>
        <a href="https://wa.me/213${cleanPhone(o.phone)}" target="_blank" style="margin-right: 4px; text-decoration: none;" title="محادثة واتساب">💬</a>
      </td>
      <td>${escapeHtml(o.willaya || "")} ${o.baladia ? `· ${escapeHtml(o.baladia)}` : ''}</td>
      <td style="text-align: center; font-weight: 700;">${o.quantity || 1} علبة</td>
      <td style="font-weight: 900;">
        ${o.deliveryFeePending
          ? `${(o.price || 0).toLocaleString("fr-FR")} د.ج <div style="font-size:.72rem;color:#B45309;margin-top:4px;">+ رسوم التوصيل قيد التأكيد</div>`
          : `${((o.price || 0) + (o.deliveryFee || 0)).toLocaleString("fr-FR")} د.ج <div style="font-size:.7rem;color:#64748B;margin-top:4px;">المنتج ${ (o.price || 0).toLocaleString("fr-FR")} + التوصيل ${(o.deliveryFee || 0).toLocaleString("fr-FR")}</div>`}
      </td>
      <td>
        <span class="status-badge ${statusInfo.class}">${statusInfo.label}</span>
        ${o.deliveryFeePending ? `<div style="font-size:.72rem;color:#B45309;font-weight:800;margin-top:5px;">⚠ رسوم التوصيل غير محددة</div>` : ''}
        ${o.ecotrackTracking ? `<div style="font-size:.72rem;color:#2563EB;margin-top:4px;direction:ltr;">EcoTrack: ${escapeHtml(o.ecotrackTracking)}</div>` : ''}
        ${o.ecotrackStatus ? `<div style="font-size:.7rem;color:#64748B;margin-top:2px;">EcoTrack: ${escapeHtml(o.ecotrackStatus)}</div>` : ''}
        ${o.ecotrackReturnStatus ? `<div style="font-size:.7rem;color:#B45309;margin-top:2px;">مرتجع: ${escapeHtml(o.ecotrackReturnStatus)}</div>` : ''}
      </td>
      <td style="font-size: 0.78rem; color: #64748B;">${o.createdAt || "-"}</td>
      <td>
        <div class="action-cell">
          ${o.status !== "confirmed" ? `<button class="btn-tbl confirm" onclick="handleStatusChange('${o.id}', 'confirmed')" title="تأكيد الطلب">تأكيد</button>` : ''}
          ${o.status !== "delivered" ? `<button class="btn-tbl deliver" onclick="handleStatusChange('${o.id}', 'delivered')" title="تم التوصيل">توصيل</button>` : ''}
          ${o.status !== "cancelled" ? `<button class="btn-tbl cancel" onclick="handleStatusChange('${o.id}', 'cancelled')" title="إلغاء الطلب">إلغاء</button>` : ''}
          ${o.deliveryFeePending ? `<button class="btn-tbl confirm" onclick="handleSetDeliveryFee('${o.id}')" title="تسجيل رسوم التوصيل بعد تأكيدها">تحديد رسوم التوصيل</button>` : ''}
          ${o.ecotrackTracking ? `<button class="btn-tbl" onclick="updateEcoTrackOrder('${o.id}')" title="تعديل قبل الترحيل">تعديل</button><button class="btn-tbl cancel" onclick="cancelEcoTrack('${o.id}')" title="إلغاء الشحنة من EcoTrack">إلغاء الشحنة</button><button class="btn-tbl confirm" onclick="validateEcoTrack('${o.id}')" title="ترحيل الشحنة">ترحيل</button><button class="btn-tbl" onclick="addEcoTrackNote('${o.id}')" title="إضافة ملاحظة">ملاحظة</button><button class="btn-tbl" onclick="downloadEcoTrackLabel('${o.id}')" title="تحميل الملصق PDF">PDF</button><button class="btn-tbl" onclick="showEcoTrackUpdates('${o.id}')" title="عرض تحديثات التتبع">تتبع</button><button class="btn-tbl cancel" onclick="requestEcoTrackReturn('${o.id}')" title="طلب إرجاع">إرجاع</button>` : (o.status === 'confirmed' ? `<button class="btn-tbl confirm" onclick="pushToEcoTrack('${o.id}')" title="رفع الطلب إلى EcoTrack">🚚 رفع للشحن</button>` : '')}
          <button class="btn-tbl delete" onclick="handleDeleteOrder('${o.id}')" title="حذف">🗑️</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

window.handleStatusChange = async function(orderId, newStatus) {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحديث حالة الطلب');
    await loadOrders();
  } catch (err) {
    alert(err.message || 'تعذر الاتصال بالخادم. لم تتغير حالة الطلب.');
  }
};

window.handleSetDeliveryFee = async function(orderId) {
  const rawFee = prompt('أدخل رسوم التوصيل المؤكدة بالدينار الجزائري:');
  if (rawFee === null) return;
  const deliveryFee = Number(rawFee.trim());
  if (!Number.isInteger(deliveryFee) || deliveryFee < 0) {
    alert('أدخل مبلغاً صحيحاً بالدينار الجزائري.');
    return;
  }
  try {
    const { data } = await fetchAdminJson(`/api/orders/${encodeURIComponent(orderId)}/delivery-fee`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryFee })
    });
    if (!data.success) throw new Error(data.error || 'تعذر حفظ رسوم التوصيل');
    await loadOrders();
  } catch (err) {
    alert(err.message || 'تعذر حفظ رسوم التوصيل.');
  }
};

window.pushToEcoTrack = async function(orderId) {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/ecotrack/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (!data.success) return alert('فشل رفع الطلب إلى EcoTrack: ' + (data.error || 'خطأ غير معروف'));
    alert(`✓ تم رفع الطلب إلى EcoTrack\nرقم التتبع: ${data.tracking}`);
    await loadOrders();
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.validateEcoTrack = async function(orderId) {
  const pickup = confirm('هل تريد طلب استلام الطرد من EcoTrack؟\nاضغط إلغاء للترحيل بدون طلب استلام.');
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/ecotrack/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pickup }) });
    const data = await res.json();
    if (!data.success) return alert('فشل ترحيل الشحنة: ' + (data.error || 'خطأ غير معروف'));
    alert('✓ تم ترحيل الشحنة إلى EcoTrack');
    await loadOrders();
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.updateEcoTrackOrder = async function(orderId) {
  const order = currentOrders.find(item => String(item.id) === String(orderId));
  if (!order) return;
  const amount = prompt('المبلغ الإجمالي مع التوصيل (دج):', String(order.price || ''));
  if (amount === null) return;
  const address = prompt('عنوان التوصيل:', `${order.baladia || ''} - ${order.willaya || ''}`);
  if (address === null) return;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/ecotrack/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ montant: Math.max(0, Number(amount) || 0), adresse: address.trim() }) });
    const data = await res.json();
    if (!data.success) return alert('فشل تعديل الشحنة: ' + (data.error || 'خطأ غير معروف'));
    alert('✓ تم تعديل الشحنة في EcoTrack');
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.addEcoTrackNote = async function(orderId) {
  const content = prompt('اكتب ملاحظة الشحنة:');
  if (!content || !content.trim()) return;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/ecotrack/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content.trim() }) });
    const data = await res.json();
    if (!data.success) return alert('فشل إضافة الملاحظة: ' + (data.error || 'خطأ غير معروف'));
    alert('✓ تمت إضافة الملاحظة');
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.showEcoTrackUpdates = async function(orderId) {
  try {
    const [updatesRes, trackingRes] = await Promise.all([fetch(`/api/orders/${encodeURIComponent(orderId)}/ecotrack/updates`), fetch(`/api/orders/${encodeURIComponent(orderId)}/ecotrack/tracking`)]);
    const updates = await updatesRes.json(); const tracking = await trackingRes.json();
    if (!updates.success && !tracking.success) return alert(updates.error || tracking.error || 'تعذر جلب التتبع');
    const items = Array.isArray(updates.updates) ? updates.updates : [];
    const status = tracking.tracking?.status || tracking.tracking?.activity || '';
    alert(`الحالة الحالية: ${status || 'غير متاحة'}\n\n${items.map(item => `${item.created_at || ''} — ${item.remarque || ''}`).join('\n') || 'لا توجد تحديثات مسجلة'}`);
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.requestEcoTrackReturn = async function(orderId) {
  if (!confirm('هل تريد طلب إرجاع هذه الشحنة من EcoTrack؟')) return;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/ecotrack/return`, { method: 'POST' }); const data = await res.json();
    if (!data.success) return alert('فشل طلب الإرجاع: ' + (data.error || 'خطأ غير معروف'));
    alert('✓ تم إرسال طلب الإرجاع إلى EcoTrack'); await loadOrders();
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.downloadEcoTrackLabel = async function(orderId) {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/ecotrack/label`);
    if (!res.ok) { const data = await res.json().catch(() => ({})); return alert(data.error || 'تعذر تحميل الملصق'); }
    const blob = await res.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `ecotrack-${orderId}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { alert('فشل تحميل الملصق: ' + err.message); }
};

window.cancelEcoTrack = async function(orderId) {
  if (!confirm('هل تريد إلغاء الشحنة من EcoTrack؟')) return;
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/ecotrack/cancel`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) return alert('تعذر إلغاء الشحنة: ' + (data.error || 'خطأ غير معروف'));
    alert('✓ تم إلغاء الشحنة من EcoTrack.');
    await loadOrders();
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.syncEcoTrackStatuses = async function() {
  try {
    const res = await fetch('/api/orders/ecotrack/sync', { method: 'POST' });
    const data = await res.json();
    if (!data.success) return alert('فشلت المزامنة: ' + (data.error || 'خطأ غير معروف'));
    alert(`✓ تمت المزامنة: ${data.synced} من ${data.fetched} شحنة`);
    await loadOrders();
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.bulkEcoTrackAction = async function(action) {
  const ids = Array.from(document.querySelectorAll('.order-check:checked')).map(cb => cb.value);
  if (!ids.length) return alert('حدد طلباً واحداً على الأقل أولاً');
  if (action === 'cancel' && !confirm('هل تريد إلغاء الشحنات المحددة من EcoTrack؟')) return;
  const endpoint = action === 'push' ? '/api/orders/ecotrack/bulk-push' : '/api/orders/ecotrack/bulk-cancel';
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    const data = await res.json();
    if (!data.success) return alert(data.error || 'تعذر تنفيذ الإجراء');
    const count = action === 'push' ? (data.pushed || []).length : (data.cancelled || []).length;
    alert(`✓ تم تنفيذ الإجراء على ${count} طلب` + (data.failed?.length ? `، وفشل ${data.failed.length}` : ''));
    await loadOrders();
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.validateEcoTrackReturns = async function() {
  const ids = Array.from(document.querySelectorAll('.order-check:checked')).map(cb => cb.value);
  if (!ids.length) return alert('حدد الطلبات المرتجعة أولاً');
  if (!confirm('هل تريد تأكيد استلام المرتجعات المحددة؟')) return;
  try {
    const res = await fetch('/api/orders/ecotrack/validate-returns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    const data = await res.json();
    if (!data.success) return alert(data.error || 'تعذر تأكيد المرتجعات');
    alert(`✓ تم تأكيد استلام ${data.received?.length || 0} مرتجع`);
    await loadOrders();
  } catch (err) { alert('فشل الاتصال بـ EcoTrack: ' + err.message); }
};

window.handleDeleteOrder = async function(orderId) {
  if (confirm(`هل أنت متأكد من حذف الطلب ${orderId} نهائياً؟`)) {
    try {
      const { data } = await fetchAdminJson(`/api/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
      if (!data.success) throw new Error(data.error || 'تعذر حذف الطلب');
      await loadOrders();
    } catch (err) {
      alert(err.message || 'تعذر الاتصال بالخادم. لم يتم حذف الطلب.');
    }
  }
};

window.bulkAction = async function(newStatus) {
  const selected = Array.from(document.querySelectorAll(".order-check:checked")).map(cb => cb.value);
  if (selected.length === 0) {
    alert("يرجى تحديد طلب واحد على الأقل لتطبيق الإجراء");
    return;
  }

  const statusArabic = {
    confirmed: "تأكيد",
    delivered: "توصيل",
    cancelled: "إلغاء"
  }[newStatus] || newStatus;

  if (confirm(`هل تريد ${statusArabic} ${selected.length} طلب/طلبات محددة في قاعدة البيانات؟`)) {
    try {
      const res = await fetch('/api/orders/bulk-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, status: newStatus })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'تعذر تحديث الطلبات المحددة');
      await loadOrders();
    } catch (err) {
      alert(err.message || 'تعذر الاتصال بالخادم. لم تتغير الطلبات.');
    }
  }
};

// ======================================================
// 4. CAPTURED LEADS (ABANDONED WITHOUT CONFIRMING)
// ======================================================
async function loadLeads() {
  try {
    const { data } = await fetchAdminJson('/api/leads');
    if (data.success && Array.isArray(data.leads)) {
      leadsLoadError = "";
      currentLeads = data.leads.map(l => ({
        id: l.id,
        sessionToken: l.session_token,
        fullName: l.full_name || 'بدون اسم',
        phone: l.phone || 'غير مسجل',
        willaya: l.willaya || 'غير محدد',
        baladia: l.baladia || '',
        quantity: l.quantity || 1,
        price: l.price || 0,
        productName: l.product_name || 'بذور الكاكي',
        status: l.status || 'abandoned',
        updatedAt: l.updated_at ? formatTimeAgo(new Date(l.updated_at)) : '-'
      }));
    } else {
      throw new Error(data.error || 'استجابة العملاء غير صالحة');
    }
  } catch (err) {
    console.error("Could not fetch leads from DB:", err);
    currentLeads = [];
    leadsLoadError = err.message;
  }

  renderMetrics();
  renderStockAndPipeline();
  renderLeadsTable();
}

function renderLeadsTable() {
  const tbody = document.getElementById("leadsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const q = leadsSearchQuery.toLowerCase();
  const filtered = currentLeads.filter(l => {
    return (
      l.fullName.toLowerCase().includes(q) ||
      l.phone.includes(q) ||
      l.willaya.toLowerCase().includes(q) ||
      l.baladia.toLowerCase().includes(q) ||
      l.id.toLowerCase().includes(q)
    );
  });

  const countLabel = document.getElementById("leadsCountLabel");
  if (countLabel) countLabel.textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 30px; color: #888;">
          ${leadsLoadError ? `تعذر تحميل العملاء: ${escapeHtml(leadsLoadError)}` : 'لا توجد سلات مهجورة أو زبائن لم يؤكدوا حالياً.'}
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(lead => {
    const tr = document.createElement("tr");

    const statusBadge = lead.status === 'converted' 
      ? '<span class="status-badge confirmed">تم التحويل لطلب ✓</span>'
      : lead.status === 'contacted'
      ? '<span class="status-badge contacted">تم الاتصال به 📞</span>'
      : '<span class="status-badge abandoned">لم يضغط تأكيد ⚠️</span>';

    const pClean = cleanPhone(lead.phone);
    const waLink = pClean ? `https://wa.me/213${pClean}?text=${encodeURIComponent(`مرحباً ${lead.fullName}، لاحظنا اهتمامك بطلب ${lead.productName} عبر متجرنا، هل تود تأكيد عنوان التوصيل؟`)}` : '#';
    const telLink = lead.phone ? `tel:${lead.phone}` : '#';

    tr.innerHTML = `
      <td style="font-weight: 800; color: #E11D48;">${escapeHtml(lead.id)}</td>
      <td><strong>${escapeHtml(lead.fullName)}</strong></td>
      <td dir="ltr" style="text-align: right; font-weight:800;">
        ${escapeHtml(lead.phone)}
      </td>
      <td>${escapeHtml(lead.willaya)} ${lead.baladia ? `· ${escapeHtml(lead.baladia)}` : ''}</td>
      <td style="text-align: center; font-weight: 700;">${lead.quantity} علبة</td>
      <td style="font-weight: 900; color:#0F172A;">${(lead.price || 0).toLocaleString("fr-FR")} د.ج</td>
      <td style="font-size: 0.78rem; color: #64748B;">${lead.updatedAt}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="action-cell">
          ${lead.phone && lead.phone !== 'غير مسجل' ? `
            <a href="${waLink}" target="_blank" class="btn-tbl wa-btn" title="مراسلة فورية عبر واتساب">💬 واتساب</a>
            <a href="${telLink}" class="btn-tbl call-btn" title="اتصال هاتفي مباشر">📞 اتصال</a>
          ` : ''}
          ${lead.status !== 'converted' ? `
            <button class="btn-tbl confirm" onclick="handleConvertLead('${lead.id}')" title="تحويل فوري لطلب مؤكد">✓ تحويل لطلب</button>
            <button class="btn-tbl edit-btn" onclick="handleMarkLeadContacted('${lead.id}')" title="تحديد كتم الاتصال">📞 تم الاتصال</button>
          ` : ''}
          <button class="btn-tbl delete" onclick="handleDeleteLead('${lead.id}')" title="حذف">🗑️</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

window.handleConvertLead = async function(leadId) {
  try {
    const res = await fetch(`/api/leads/${leadId}/convert`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`✓ تم تحويل الزبون إلى طلب رسمي مؤكد برقم: ${data.order.id}`);
      await loadLeads();
      await loadOrders();
    } else {
      alert("خطأ: " + data.error);
    }
  } catch (err) {
    alert("فشل التحويل: " + err.message);
  }
};

window.handleMarkLeadContacted = async function(leadId) {
  try {
    await fetch(`/api/leads/${leadId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'contacted' })
    });
    await loadLeads();
  } catch (err) {
    console.warn("Could not update lead status:", err);
  }
};

window.handleDeleteLead = async function(leadId) {
  if (confirm(`هل أنت متأكد من حذف الزبون ${leadId}؟`)) {
    try {
      const { data } = await fetchAdminJson(`/api/leads/${encodeURIComponent(leadId)}`, { method: 'DELETE' });
      if (!data.success) throw new Error(data.error || 'تعذر حذف الزبون');
      await loadLeads();
    } catch (err) {
      alert(err.message || 'تعذر الاتصال بالخادم. لم يتم حذف الزبون.');
    }
  }
};

window.switchTableTab = function(tabName) {
  currentTableTab = tabName;
  const ordersBtn = document.getElementById("tabOrdersBtn");
  const leadsBtn = document.getElementById("tabLeadsBtn");
  const ordersView = document.getElementById("ordersViewContainer");
  const leadsView = document.getElementById("leadsViewContainer");

  if (tabName === "orders") {
    ordersBtn.classList.add("active");
    leadsBtn.classList.remove("active");
    ordersView.style.display = "block";
    leadsView.style.display = "none";
  } else {
    ordersBtn.classList.remove("active");
    leadsBtn.classList.add("active");
    ordersView.style.display = "none";
    leadsView.style.display = "block";
  }
};

// ======================================================
// 5. EVENT LISTENERS & MODALS
// ======================================================
function initEventListeners() {
  // Orders Search & Filter
  const searchInput = document.getElementById("tableSearch");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim();
      renderOrdersTable();
    });
  }

  const statusFilter = document.getElementById("statusFilter");
  if (statusFilter) {
    statusFilter.addEventListener("change", (e) => {
      activeFilter = e.target.value;
      renderOrdersTable();
    });
  }

  // Leads Search
  const leadsSearch = document.getElementById("leadsSearch");
  if (leadsSearch) {
    leadsSearch.addEventListener("input", (e) => {
      leadsSearchQuery = e.target.value.trim();
      renderLeadsTable();
    });
  }

  // Export CSV
  const exportBtn = document.getElementById("exportCsvBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportOrdersToCsv);
  }

  // Stock adjustments (+/- 5)
  const stockMinus = document.getElementById("stockMinus");
  const stockPlus = document.getElementById("stockPlus");
  if (stockMinus) stockMinus.addEventListener("click", () => adjustActiveStock(-5));
  if (stockPlus) stockPlus.addEventListener("click", () => adjustActiveStock(5));

  // Product Modal Controls
  const openProdBtn1 = document.getElementById("openProductModalBtn");
  const openProdBtn2 = document.getElementById("openProductModalBtn2");
  const closeProdModal = document.getElementById("closeProductModal");
  const cancelProdModal = document.getElementById("cancelProductModal");
  const prodModal = document.getElementById("productModal");

  if (openProdBtn1) openProdBtn1.addEventListener("click", openNewProductModal);
  if (openProdBtn2) openProdBtn2.addEventListener("click", openNewProductModal);
  if (closeProdModal && prodModal) closeProdModal.addEventListener("click", () => prodModal.classList.remove("active"));
  if (cancelProdModal && prodModal) cancelProdModal.addEventListener("click", () => prodModal.classList.remove("active"));

  // Product Image Files Input
  const fileInput = document.getElementById("prodPhotoFiles");
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      handlePhotoFilesUpload(e.target.files);
      e.target.value = "";
    });
  }

  // Manual Image URL Add
  const addUrlBtn = document.getElementById("addManualImgBtn");
  const urlInput = document.getElementById("manualImageUrlInput");
  if (addUrlBtn && urlInput) {
    addUrlBtn.addEventListener("click", () => {
      const u = urlInput.value.trim();
      if (u && /^(https?:\/\/|\/|data:image\/|assets\/|uploads\/)/i.test(u)) {
        currentProductImages.push(u);
        renderImagePreviews();
        urlInput.value = "";
      } else if (u) {
        alert("أدخل رابط صورة يبدأ بـ https:// أو / أو assets/");
      }
    });
  }

  // Product Form Submit
  const productForm = document.getElementById("seedProductForm");
  if (productForm) {
    productForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const editId = document.getElementById("editProductId").value;
      const name = document.getElementById("prodName").value.trim();
      const slug = document.getElementById("prodSlug").value.trim();
      const subtitle = document.getElementById("prodSubtitle").value.trim();
      const description = document.getElementById("prodDescription").value.trim();
      const price_1 = readNumberInput("prodPrice1", 2500);
      const price_2 = readNumberInput("prodPrice2", 4200);
      const price_3 = readNumberInput("prodPrice3", 5600);
      const stock = readNumberInput("prodStock", 50);
      const is_active = document.getElementById("prodIsActive").checked;

      if (!name) {
        alert("اسم المنتج مطلوب");
        return;
      }
      if (![price_1, price_2, price_3].every(value => value > 0)) {
        alert("يجب أن تكون أسعار العروض أكبر من صفر");
        return;
      }

      const payload = {
        name,
        slug,
        subtitle,
        description,
        price_1,
        price_2,
        price_3,
        stock,
        images: currentProductImages.length > 0 ? currentProductImages : ['assets/slide-1.webp'],
        is_active
      };

      const saveButton = document.getElementById("saveProductBtn");
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = "جاري الحفظ...";
      }

      try {
        const url = editId ? `/api/products/${editId}` : '/api/products';
        const method = editId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({ success: false, error: `خطأ من الخادم (${res.status})` }));
        if (data.success) {
          alert(`✓ تم حفظ منتج البذور بنجاح في قاعدة بيانات Neon!`);
          document.getElementById("productModal").classList.remove("active");
          await loadProducts();
          checkDbHealth();
        } else {
          alert("خطأ: " + (data.error || "تعذر الحفظ"));
        }
      } catch (err) {
        alert("فشل الاتصال: " + err.message);
      } finally {
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = "💾 حفظ منتج البذور في قاعدة البيانات";
        }
      }
    });
  }

  // Manual Order Modal
  const addOrderBtn = document.getElementById("addOrderBtn");
  const addModal = document.getElementById("addOrderModal");
  const closeAddModal = document.getElementById("closeAddModal");
  const cancelAddModal = document.getElementById("cancelAddModal");

  if (addOrderBtn && addModal) addOrderBtn.addEventListener("click", () => addModal.classList.add("active"));
  if (closeAddModal && addModal) closeAddModal.addEventListener("click", () => addModal.classList.remove("active"));
  if (cancelAddModal && addModal) cancelAddModal.addEventListener("click", () => addModal.classList.remove("active"));

  // Manual Order Form Submit
  const newOrderForm = document.getElementById("manualOrderForm");
  if (newOrderForm) {
    newOrderForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const prodSelect = document.getElementById("newOrderProductSelect");
      const productId = prodSelect ? parseInt(prodSelect.value, 10) : null;
      const productName = prodSelect ? prodSelect.options[prodSelect.selectedIndex]?.text : "بذور الكاكي";
      const fullName = document.getElementById("newFullName").value.trim();
      const phone = document.getElementById("newPhone").value.trim();
      const willayaSelect = document.getElementById("newWillayaSelect");
      const willayaName = willayaSelect.options[willayaSelect.selectedIndex]?.text || "";
      const baladia = document.getElementById("newBaladiaSelect").value.trim();
      const qty = parseInt(document.getElementById("newQty").value, 10) || 1;
      const price = parseInt(document.getElementById("newPrice").value, 10) || 4200;
      const note = document.getElementById("newNote").value.trim();

      if (!fullName || !phone || !willayaName) {
        alert("يرجى ملء جميع الحقول الإلزامية");
        return;
      }

      const orderPayload = {
        fullName,
        phone,
        willaya: willayaName,
        baladia,
        quantity: qty,
        price,
        productId,
        productName,
        note
      };

      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderPayload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !data.order?.id) {
          throw new Error(data.error || 'تعذر حفظ الطلب');
        }
        alert(`✓ تم حفظ الطلب برقم: ${data.order.id}`);
        newOrderForm.reset();
        addModal.classList.remove("active");
        await loadOrders();
      } catch (err) {
        console.error("Manual order could not be saved:", err);
        alert(err.message || 'تعذر الاتصال بالخادم. لم يتم حفظ الطلب.');
      }
    });
  }

  // APIs Modal
  const openApiModalBtn = document.getElementById("openApiModalBtn");
  const apiModal = document.getElementById("apiSettingsModal");
  const closeApiModal = document.getElementById("closeApiModal");
  const saveApiBtn = document.getElementById("saveApiSettingsBtn");
  const validateEcoBtn = document.getElementById("validateEcoTrackBtn");

  if (openApiModalBtn && apiModal) openApiModalBtn.addEventListener("click", () => apiModal.classList.add("active"));
  if (closeApiModal && apiModal) closeApiModal.addEventListener("click", () => apiModal.classList.remove("active"));
  if (saveApiBtn) saveApiBtn.addEventListener("click", saveApiSettings);
  if (validateEcoBtn) validateEcoBtn.addEventListener("click", async () => {
    try {
      const res = await fetch('/api/ecotrack/validate');
      const data = await res.json();
      if (!data.success) return alert('فشل التحقق: ' + (data.result?.message || data.error || 'توكن غير صالح'));
      alert('✓ EcoTrack متصل بنجاح: ' + (data.result?.message || 'VALID_TOKEN'));
    } catch (err) { alert('فشل الاتصال: ' + err.message); }
  });
}

// ======================================================
// 6. WILAYAS & UTILS
// ======================================================
function initWilayaDropdownInAddModal() {
  const willayaSelect = document.getElementById("newWillayaSelect");
  const baladiaSelect = document.getElementById("newBaladiaSelect");
  const qtySelect = document.getElementById("newQty");
  const priceInput = document.getElementById("newPrice");

  if (!willayaSelect || !baladiaSelect) return;

  WILAYAS_DATA.forEach(w => {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = w.name;
    willayaSelect.appendChild(opt);
  });

  willayaSelect.addEventListener("change", () => {
    const selectedId = parseInt(willayaSelect.value, 10);
    baladiaSelect.innerHTML = '<option value="">اختر البلدية</option>';
    if (!selectedId) return;

    const wilayaObj = WILAYAS_DATA.find(w => w.id === selectedId);
    if (wilayaObj && wilayaObj.baladias) {
      wilayaObj.baladias.forEach(b => {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = b;
        baladiaSelect.appendChild(opt);
      });
    }
  });

  if (qtySelect && priceInput) {
    qtySelect.addEventListener("change", () => {
      const q = parseInt(qtySelect.value, 10);
      const prices = { 1: 2500, 2: 4200, 3: 5600 };
      priceInput.value = prices[q] || 4200;
    });
  }
}

function cleanPhone(phone) {
  if (!phone) return "";
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("0")) p = p.substring(1);
  return p;
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatTimeAgo(date) {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  return date.toLocaleDateString("fr-FR");
}

window.toggleAllCheckboxes = function(master) {
  const checkboxes = document.querySelectorAll(".order-check");
  checkboxes.forEach(cb => { cb.checked = master.checked; });
};

window.selectAllVisible = function() {
  const checkboxes = document.querySelectorAll(".order-check");
  const master = document.getElementById("masterCheck");
  checkboxes.forEach(cb => { cb.checked = true; });
  if (master) master.checked = true;
};

// Export CSV (Excel)
function exportOrdersToCsv() {
  if (currentOrders.length === 0) {
    alert("لا توجد طلبات للتصدير حالياً.");
    return;
  }

  const headers = ["رقم الطلب", "التاريخ", "المنتج", "الاسم الكامل", "رقم الهاتف", "الولاية", "البلدية", "الكمية", "سعر المنتج", "رسوم التوصيل", "حالة رسوم التوصيل", "الإجمالي", "الحالة"];
  
  const rows = currentOrders.map(o => [
    `"${o.id || ''}"`,
    `"${o.createdAt || ''}"`,
    `"${o.productName || ''}"`,
    `"${o.fullName || ''}"`,
    `"${o.phone || ''}"`,
    `"${o.willaya || ''}"`,
    `"${o.baladia || ''}"`,
    `"${o.quantity || 1}"`,
    `"${o.price || 0}"`,
    `"${o.deliveryFeePending ? '' : (o.deliveryFee || 0)}"`,
    `"${o.deliveryFeePending ? 'قيد التأكيد' : 'مؤكدة'}"`,
    `"${o.deliveryFeePending ? '' : ((o.price || 0) + (o.deliveryFee || 0))}"`,
    `"${o.status || ''}"`
  ]);

  let csvContent = "\uFEFF"; // UTF-8 BOM for Arabic support
  csvContent += headers.join(",") + "\r\n";
  rows.forEach(r => {
    csvContent += r.join(",") + "\r\n";
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `kaki_orders_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// API Settings
async function loadApiSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.success && data.settings) {
      if (data.settings.pixel_id && data.settings.pixel_id !== '1808629570178310') {
        document.getElementById("pixelIdInput").value = data.settings.pixel_id;
      }
      if (data.settings.ecotrack_provider) document.getElementById("ecotrackProviderInput").value = data.settings.ecotrack_provider;
      if (data.settings.ecotrack_url) document.getElementById("ecotrackUrlInput").value = data.settings.ecotrack_url;
      if (data.settings.ecotrack_token || data.settings.ecotrack_key) document.getElementById("ecotrackKeyInput").value = data.settings.ecotrack_token || data.settings.ecotrack_key;
      if (data.settings.ecotrack_store) document.getElementById("ecotrackStoreInput").value = data.settings.ecotrack_store;
    }
  } catch (err) {
    console.warn("Could not load API settings from DB:", err);
  }
}

async function saveApiSettings() {
  const pixelVal = document.getElementById("pixelIdInput").value.trim();
  const ecoKeyVal = document.getElementById("ecotrackKeyInput").value.trim();
  const ecoStoreVal = document.getElementById("ecotrackStoreInput").value.trim();
  const ecoProviderVal = document.getElementById("ecotrackProviderInput").value.trim().toLowerCase();
  const ecoUrlVal = document.getElementById("ecotrackUrlInput").value.trim();

  if (pixelVal && (!/^\d{10,20}$/.test(pixelVal) || pixelVal === '1808629570178310')) {
    alert('يرجى إدخال Pixel ID صالح. تم منع Pixel ID القديم.');
    return;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pixel_id: pixelVal,
        ecotrack_provider: ecoProviderVal,
        ecotrack_url: ecoUrlVal,
        ecotrack_token: ecoKeyVal,
        ecotrack_store: ecoStoreVal,
      })
    });
    const data = await res.json();
    if (data.success) {
      alert("✓ تم حفظ إعدادات الربط مع Facebook Pixel و EcoTrack في قاعدة بيانات Neon!");
      document.getElementById("apiSettingsModal").classList.remove("active");
    }
  } catch (err) {
    alert("فشل الحفظ: " + err.message);
  }
}

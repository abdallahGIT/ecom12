// ======================================================
// ECOTRACK ADMIN DASHBOARD LOGIC
// Excel-Like Table, Order Confirmation, CRUD, CSV, APIs
// ======================================================

let currentOrders = [];
let activeFilter = "all";
let searchQuery = "";

document.addEventListener("DOMContentLoaded", () => {
  loadOrders();
  initWilayaDropdownInAddModal();
  initEventListeners();
  loadApiSettings();
});

// ======================================================
// 1. DATA LOADING & METRICS
// ======================================================
function getStoredStock() {
  const s = localStorage.getItem("kaki_stock_count");
  return s !== null ? parseInt(s, 10) : 50;
}

function setStoredStock(val) {
  const clamped = Math.max(0, val);
  localStorage.setItem("kaki_stock_count", clamped);
  renderStockAndPipeline();
}

function loadOrders() {
  currentOrders = OrderManager.getOrders();
  renderMetrics();
  renderStockAndPipeline();
  renderTable();
}

function renderMetrics() {
  const total = currentOrders.length;
  const confirmed = currentOrders.filter(o => o.status === "confirmed").length;
  const delivered = currentOrders.filter(o => o.status === "delivered").length;
  const pending = currentOrders.filter(o => o.status === "new").length;
  
  const revenue = currentOrders
    .filter(o => o.status === "confirmed" || o.status === "delivered")
    .reduce((sum, o) => sum + (o.price || 0), 0);

  const mTotal = document.getElementById("metricTotal");
  const mConf = document.getElementById("metricConfirmed");
  const mPend = document.getElementById("metricPending");
  const mRev = document.getElementById("metricRevenue");

  if (mTotal) mTotal.textContent = total;
  if (mConf) mConf.textContent = confirmed + delivered;
  if (mPend) mPend.textContent = pending;
  if (mRev) mRev.textContent = `${revenue.toLocaleString("fr-FR")} د.ج`;
}

function renderStockAndPipeline() {
  const newOrders = currentOrders.filter(o => o.status === "new");
  const confOrders = currentOrders.filter(o => o.status === "confirmed");
  const delivOrders = currentOrders.filter(o => o.status === "delivered");
  const cancelOrders = currentOrders.filter(o => o.status === "cancelled");

  // Pipeline counts
  const pNew = document.getElementById("pipeNew");
  const pConf = document.getElementById("pipeConf");
  const pDeliv = document.getElementById("pipeDeliv");
  const pCancel = document.getElementById("pipeCancel");

  if (pNew) pNew.textContent = newOrders.length;
  if (pConf) pConf.textContent = confOrders.length;
  if (pDeliv) pDeliv.textContent = delivOrders.length;
  if (pCancel) pCancel.textContent = cancelOrders.length;

  // Stock calculations
  const pendingUnits = newOrders.reduce((sum, o) => sum + (o.quantity || 1), 0);
  const totalStock = getStoredStock();
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

// ======================================================
// 2. RENDER EXCEL-LIKE DATA TABLE
// ======================================================
function renderTable() {
  const tbody = document.getElementById("ordersTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  // Reset master checkbox
  const masterCheck = document.getElementById("masterCheck");
  if (masterCheck) masterCheck.checked = false;

  // Filter & Search
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
  if (countLabel) countLabel.textContent = `(${filtered.length} طلب)`;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 30px; color: #888;">
          لا توجد طلبات مطابقة للبحث أو التصفية الحالية.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((o, index) => {
    const tr = document.createElement("tr");

    // Status translation & badge
    const statusMap = {
      new: { label: "جديد ⏳", class: "new" },
      confirmed: { label: "مؤكد ✓", class: "confirmed" },
      delivered: { label: "تم التوصيل 📦", class: "delivered" },
      cancelled: { label: "ملغى ✕", class: "cancelled" }
    };

    const statusInfo = statusMap[o.status] || { label: o.status, class: "new" };

    tr.innerHTML = `
      <td><input type="checkbox" class="order-check" value="${o.id}"></td>
      <td style="font-weight: 800; color: #64748B;">${o.id || `ORD-${1000 + index}`}</td>
      <td><strong>${escapeHtml(o.fullName)}</strong></td>
      <td dir="ltr" style="text-align: right;">
        <a href="tel:${o.phone}" style="color: #0A0A0A; text-decoration: none; font-weight: 700;">${escapeHtml(o.phone)}</a>
        <a href="https://wa.me/213${cleanPhone(o.phone)}" target="_blank" style="margin-right: 4px; text-decoration: none;" title="محادثة واتساب">💬</a>
      </td>
      <td>${escapeHtml(o.willaya || "")} ${o.baladia ? `· ${escapeHtml(o.baladia)}` : ''}</td>
      <td style="text-align: center; font-weight: 700;">${o.quantity || 1} علبة</td>
      <td style="font-weight: 900;">${(o.price || 0).toLocaleString("fr-FR")} د.ج</td>
      <td>
        <span class="status-badge ${statusInfo.class}">${statusInfo.label}</span>
      </td>
      <td style="font-size: 0.78rem; color: #64748B;">${o.createdAt || "-"}</td>
      <td>
        <div class="action-cell">
          ${o.status !== "confirmed" ? `<button class="btn-tbl confirm" onclick="handleStatusChange('${o.id}', 'confirmed')" title="تأكيد الطلب">تأكيد</button>` : ''}
          ${o.status !== "delivered" ? `<button class="btn-tbl" onclick="handleStatusChange('${o.id}', 'delivered')" title="تم التوصيل">توصيل</button>` : ''}
          ${o.status !== "cancelled" ? `<button class="btn-tbl cancel" onclick="handleStatusChange('${o.id}', 'cancelled')" title="إلغاء الطلب">إلغاء</button>` : ''}
          <button class="btn-tbl delete" onclick="handleDeleteOrder('${o.id}')" title="حذف">🗑️</button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
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

// ======================================================
// 3. ORDER ACTIONS (CONFIRM, CANCEL, DELETE)
// ======================================================
window.handleStatusChange = function(orderId, newStatus) {
  OrderManager.updateStatus(orderId, newStatus);
  loadOrders();
};

window.handleDeleteOrder = function(orderId) {
  if (confirm(`هل أنت متأكد من حذف الطلب ${orderId} نهائياً؟`)) {
    OrderManager.deleteOrder(orderId);
    loadOrders();
  }
};

// ======================================================
// 4. EVENT LISTENERS (SEARCH, FILTER, MODALS)
// ======================================================
function initEventListeners() {
  // Search
  const searchInput = document.getElementById("tableSearch");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim();
      renderTable();
    });
  }

  // Filter Select
  const statusFilter = document.getElementById("statusFilter");
  if (statusFilter) {
    statusFilter.addEventListener("change", (e) => {
      activeFilter = e.target.value;
      renderTable();
    });
  }

  // Export CSV (Excel)
  const exportBtn = document.getElementById("exportCsvBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportOrdersToCsv);
  }

  // Add Order Modal Controls
  const addOrderBtn = document.getElementById("addOrderBtn");
  const addModal = document.getElementById("addOrderModal");
  const closeAddModal = document.getElementById("closeAddModal");
  const cancelAddModal = document.getElementById("cancelAddModal");

  if (addOrderBtn && addModal) {
    addOrderBtn.addEventListener("click", () => addModal.classList.add("active"));
  }
  if (closeAddModal) {
    closeAddModal.addEventListener("click", () => addModal.classList.remove("active"));
  }
  if (cancelAddModal) {
    cancelAddModal.addEventListener("click", () => addModal.classList.remove("active"));
  }

  // Add Order Form Submit
  const newOrderForm = document.getElementById("manualOrderForm");
  if (newOrderForm) {
    newOrderForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fullName = document.getElementById("newFullName").value.trim();
      const phone = document.getElementById("newPhone").value.trim();
      const willayaSelect = document.getElementById("newWillayaSelect");
      const willayaId = parseInt(willayaSelect.value, 10);
      const willayaName = willayaSelect.options[willayaSelect.selectedIndex]?.text || "";
      const baladia = document.getElementById("newBaladiaSelect").value.trim();
      const qty = parseInt(document.getElementById("newQty").value, 10) || 1;
      const customPrice = parseInt(document.getElementById("newPrice").value, 10) || APP_CONFIG.offers[qty].price;

      if (!fullName || !phone || !willayaId) {
        alert("يرجى ملء جميع الحقول الإلزامية");
        return;
      }

      OrderManager.addOrder({
        fullName,
        phone,
        willaya: willayaName,
        willayaId,
        baladia,
        quantity: qty,
        price: customPrice,
        status: "confirmed"
      });

      newOrderForm.reset();
      addModal.classList.remove("active");
      loadOrders();
    });
  }

  // API Settings Modal Controls
  const openApiModalBtn = document.getElementById("openApiModalBtn");
  const apiModal = document.getElementById("apiSettingsModal");
  const closeApiModal = document.getElementById("closeApiModal");
  const saveApiBtn = document.getElementById("saveApiSettingsBtn");

  if (openApiModalBtn && apiModal) {
    openApiModalBtn.addEventListener("click", () => apiModal.classList.add("active"));
  }
  if (closeApiModal) {
    closeApiModal.addEventListener("click", () => apiModal.classList.remove("active"));
  }
  if (saveApiBtn) {
    saveApiBtn.addEventListener("click", saveApiSettings);
  }

  // Stock adjustments
  const stockMinus = document.getElementById("stockMinus");
  const stockPlus = document.getElementById("stockPlus");
  if (stockMinus) {
    stockMinus.addEventListener("click", () => {
      setStoredStock(getStoredStock() - 5);
    });
  }
  if (stockPlus) {
    stockPlus.addEventListener("click", () => {
      setStoredStock(getStoredStock() + 5);
    });
  }
}

// Bulk Selection & Actions
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

window.bulkAction = function(newStatus) {
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

  if (confirm(`هل تريد ${statusArabic} ${selected.length} طلب/طلبات محددة؟`)) {
    selected.forEach(id => {
      OrderManager.updateStatus(id, newStatus);
    });
    loadOrders();
  }
};

// Populate Wilaya in Add Order Modal
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
      if (APP_CONFIG.offers[q]) {
        priceInput.value = APP_CONFIG.offers[q].price;
      }
    });
  }
}

// ======================================================
// 5. EXPORT TO CSV (EXCEL COMPATIBLE WITH BOM)
// ======================================================
function exportOrdersToCsv() {
  if (currentOrders.length === 0) {
    alert("لا توجد طلبات للتصدير حالياً.");
    return;
  }

  const headers = ["رقم الطلب", "التاريخ", "الاسم الكامل", "رقم الهاتف", "الولاية", "البلدية", "الكمية", "السعر الإجمالي", "الحالة"];
  
  const rows = currentOrders.map(o => [
    `"${o.id || ''}"`,
    `"${o.createdAt || ''}"`,
    `"${o.fullName || ''}"`,
    `"${o.phone || ''}"`,
    `"${o.willaya || ''}"`,
    `"${o.baladia || ''}"`,
    `"${o.quantity || 1}"`,
    `"${o.price || 0}"`,
    `"${o.status || ''}"`
  ]);

  let csvContent = "\uFEFF"; // UTF-8 BOM for Arabic support in Excel
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

// ======================================================
// 6. API CONFIGURATION MANAGEMENT
// ======================================================
function loadApiSettings() {
  const pixelInput = document.getElementById("pixelIdInput");
  const ecotrackKeyInput = document.getElementById("ecotrackKeyInput");
  const ecotrackStoreInput = document.getElementById("ecotrackStoreInput");
  const ecotrackUrlInput = document.getElementById("ecotrackUrlInput");

  const savedPixel = localStorage.getItem("kaki_pixel_id") || APP_CONFIG.pixel.pixelId;
  const savedKey = localStorage.getItem("kaki_ecotrack_key") || APP_CONFIG.ecotrack.apiToken;
  const savedStore = localStorage.getItem("kaki_ecotrack_store") || APP_CONFIG.ecotrack.storeId;
  const savedUrl = localStorage.getItem("kaki_ecotrack_url") || APP_CONFIG.ecotrack.apiUrl;

  if (pixelInput) pixelInput.value = savedPixel;
  if (ecotrackKeyInput) ecotrackKeyInput.value = savedKey;
  if (ecotrackStoreInput) ecotrackStoreInput.value = savedStore;
  if (ecotrackUrlInput) ecotrackUrlInput.value = savedUrl;
}

function saveApiSettings() {
  const pixelVal = document.getElementById("pixelIdInput").value.trim();
  const ecoKeyVal = document.getElementById("ecotrackKeyInput").value.trim();
  const ecoStoreVal = document.getElementById("ecotrackStoreInput").value.trim();
  const ecoUrlVal = document.getElementById("ecotrackUrlInput").value.trim();

  localStorage.setItem("kaki_pixel_id", pixelVal);
  localStorage.setItem("kaki_ecotrack_key", ecoKeyVal);
  localStorage.setItem("kaki_ecotrack_store", ecoStoreVal);
  localStorage.setItem("kaki_ecotrack_url", ecoUrlVal);

  APP_CONFIG.pixel.pixelId = pixelVal;
  APP_CONFIG.ecotrack.apiToken = ecoKeyVal;
  APP_CONFIG.ecotrack.storeId = ecoStoreVal;
  APP_CONFIG.ecotrack.apiUrl = ecoUrlVal;

  alert("✓ تم حفظ إعدادات الربط مع Facebook Pixel و EcoTrack بنجاح!");
  document.getElementById("apiSettingsModal").classList.remove("active");
}

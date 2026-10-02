// ======================================================
// KAKI SEEDS & STOREFRONT LOGIC
// Dynamic Products, Image Slider, Wilaya Selector,
// Automatic Lead Capture (Drafts) & Order Submission
// ======================================================

let currentProduct = null;
let selectedQty = 2; // Default to 2 packs
let sessionToken = null;
let leadCaptureTimer = null;
let deliveryFees = {};
let shippingWilayas = WILAYAS_DATA;
let deliveryProvider = '';
let deliveryFeesReady = false;
let deliveryFeesLoading = true;
let communesRequestId = 0;
const communesCache = new Map();
let lastSavedLeadSignature = '';
let queuedLeadPayload = null;
const pixelLeadPhones = new Set();
let leadCaptureInFlight = false;
let pixelInitiateCheckoutSent = false;
let pixelPurchaseSent = false;
let pixelReady = false;
let pixelInitializationFinished = false;
const pendingPixelEvents = [];

async function initializePixel() {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('/api/public-settings', {
        cache: 'no-store',
        signal: controller.signal
      });
      const data = await response.json();
      if (response.ok && data.success && typeof data.settings?.pixel_id === 'string') {
        APP_CONFIG.pixel.pixelId = data.settings.pixel_id.trim();
      }
    } catch (err) {
      console.warn('Could not load the saved Pixel ID; using the configured fallback:', err);
    } finally {
      window.clearTimeout(timeout);
    }

    pixelReady = await APP_CONFIG.pixel.init();
  } catch (err) {
    console.warn('Could not initialize Meta Pixel:', err);
  } finally {
    pixelInitializationFinished = true;
    if (pixelReady) {
      while (pendingPixelEvents.length) {
        const { eventName, params } = pendingPixelEvents.shift();
        trackPixelEvent(eventName, params);
      }
      const requestedProductSlug = new URLSearchParams(window.location.search).get('p');
      trackPixelEvent('ViewContent', {
        content_ids: [requestedProductSlug || 'storefront'],
        content_type: 'product',
        content_name: requestedProductSlug || APP_CONFIG.product.name
      });
    } else {
      pendingPixelEvents.length = 0;
      console.warn('Meta Pixel events are not being sent because the Meta library did not load.');
    }
  }
}

function trackPixelEvent(eventName, params) {
  if (!pixelInitializationFinished) {
    pendingPixelEvents.push({ eventName, params });
    return;
  }
  if (!pixelReady) return;
  try {
    APP_CONFIG.pixel.track(eventName, params);
  } catch (err) {
    // Pixel failures must never interrupt checkout or lead persistence.
    console.warn(`Could not send Meta Pixel ${eventName} event:`, err);
  }
}

function getPixelContentId() {
  const requestedProductSlug = new URLSearchParams(window.location.search).get('p');
  return String(requestedProductSlug || (currentProduct && (currentProduct.id || currentProduct.slug)) || 'storefront');
}

function isValidAlgerianPhone(value) {
  const phone = String(value || '').replace(/[\s().-]/g, '');
  return /^(?:\+213[5-7]\d{8}|0[5-7]\d{8})$/.test(phone);
}

function normalizeAlgerianPhone(value) {
  return String(value || '').replace(/[\s().-]/g, '');
}

function escapeAttribute(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

document.addEventListener("DOMContentLoaded", async () => {
  initSessionToken();
  initSmoothScroll();
  initWilayaSelector();
  initializePixel();
  initPixelLeadTracking();
  initPixelInitiateCheckout();
  initPixelPurchaseTracking();
  initAutoLeadCapture();
  
  // Load product and live delivery data before initializing checkout controls.
  await Promise.all([loadActiveProduct(), loadDeliveryFees(), loadShippingWilayas()]);
  triggerAutoLeadCapture();

  // Initialize UI features
  initSlider();
  initOfferSelector();
  initOrderForm();

});

// ======================================================
// 1. SESSION TOKEN INITIALIZATION (FOR LEAD TRACKING)
// ======================================================
function initSessionToken() {
  sessionToken = sessionStorage.getItem("ecom_lead_session_token");
  if (!sessionToken) {
    sessionToken = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem("ecom_lead_session_token", sessionToken);
  }
}

async function loadDeliveryFees() {
  try {
    const response = await fetch('/api/delivery-fees');
    const data = await response.json();
    if (response.ok && data.success && data.fees && typeof data.fees === 'object') {
      deliveryFees = data.fees;
      deliveryProvider = String(data.provider || '');
      deliveryFeesReady = true;
    }
  } catch (err) {
    console.warn('Could not load live delivery fees:', err);
  } finally {
    deliveryFeesLoading = false;
    updateTotalPrice();
  }
}

async function loadShippingWilayas() {
  try {
    const response = await fetch('/api/shipping/wilayas');
    const data = await response.json();
    if (!response.ok || !data.success || !Array.isArray(data.wilayas) || !data.wilayas.length) return;

    shippingWilayas = data.wilayas.map(item => {
      const id = Number(item.id);
      const known = WILAYAS_DATA.find(wilaya => wilaya.id === id);
      return { ...known, id, name: known?.name || item.name, baladias: known?.baladias || [] };
    }).filter(item => Number.isInteger(item.id) && item.id >= 1 && item.id <= 58 && item.name);

    const willayaSelect = document.getElementById('willayaSelect');
    if (!willayaSelect) return;
    const selectedId = willayaSelect.value;
    willayaSelect.innerHTML = '<option value="">اختر الولاية</option>';
    shippingWilayas.forEach(wilaya => {
      const option = document.createElement('option');
      option.value = wilaya.id;
      option.textContent = wilaya.name;
      willayaSelect.appendChild(option);
    });
    willayaSelect.value = selectedId;
  } catch (err) {
    console.warn('Could not load provider wilayas; using built-in list:', err);
  }
}

async function loadShippingCommunes(wilayaId, requestId) {
  const baladiaSelect = document.getElementById('baladiaSelect');
  if (!baladiaSelect) return;
  const staticCommunes = shippingWilayas.find(wilaya => wilaya.id === wilayaId)?.baladias || [];
  baladiaSelect.disabled = true;
  baladiaSelect.innerHTML = '<option value="">جار تحميل البلديات...</option>';

  try {
    let communes = communesCache.get(wilayaId);
    if (!communes) {
      const response = await fetch(`/api/shipping/wilayas/${wilayaId}/communes`);
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.communes)) {
        throw new Error(data.error || 'تعذر تحميل البلديات');
      }
      communes = data.communes.map(item => String(item.name || '').trim()).filter(Boolean);
      communesCache.set(wilayaId, communes);
    }
    if (requestId !== communesRequestId) return;
    populateCommuneOptions(baladiaSelect, communes.length ? communes : staticCommunes);
  } catch (err) {
    if (requestId !== communesRequestId) return;
    console.warn('Could not load provider communes; using built-in list:', err);
    populateCommuneOptions(baladiaSelect, staticCommunes);
  }
}

function populateCommuneOptions(select, communes) {
  select.innerHTML = '<option value="">اختر البلدية</option>';
  [...new Set(communes)].sort((a, b) => a.localeCompare(b, 'ar')).forEach(commune => {
    const option = document.createElement('option');
    option.value = commune;
    option.textContent = commune;
    select.appendChild(option);
  });
  select.disabled = communes.length === 0;
}

// ======================================================
// 2. DYNAMIC PRODUCT LOADING FROM NEON DB
// ======================================================
async function loadActiveProduct() {
  try {
    // Check if a specific product slug is in URL query (?p=slug)
    const urlParams = new URLSearchParams(window.location.search);
    const slugParam = urlParams.get('p');
    const res = await fetch(slugParam
      ? `/api/products?slug=${encodeURIComponent(slugParam)}`
      : '/api/products');
    const data = await res.json();

    if (data.success && Array.isArray(data.products) && data.products.length > 0) {
      currentProduct = data.products.find(p => slugParam && p.slug === slugParam) || data.products[0];

      if (currentProduct) {
        applyProductToUI(currentProduct);
      }
    }
  } catch (err) {
    console.warn("Could not fetch active product from DB, using fallback config:", err);
  } finally {
    document.body.classList.remove('product-loading');
  }
}

function applyProductToUI(product) {
  // Update Product Name
  const heroTitle = document.querySelector(".hero-title");
  if (heroTitle && product.name) heroTitle.textContent = product.name;
  document.title = `${product.name} | اطلب الآن الدفع عند الاستلام`;

  // Update Prices in APP_CONFIG
  if (product.price_1) APP_CONFIG.offers[1].price = product.price_1;
  if (product.price_2) {
    APP_CONFIG.offers[2].price = product.price_2;
    APP_CONFIG.offers[2].oldPrice = product.price_1 * 2;
    APP_CONFIG.offers[2].save = (product.price_1 * 2) - product.price_2;
  }
  if (product.price_3) {
    APP_CONFIG.offers[3].price = product.price_3;
    APP_CONFIG.offers[3].oldPrice = product.price_1 * 3;
    APP_CONFIG.offers[3].save = (product.price_1 * 3) - product.price_3;
  }

  // Update Offers Grid in HTML
  const offer1Price = document.querySelector('.offer-option[data-qty="1"] .offer-price');
  const offer2Price = document.querySelector('.offer-option[data-qty="2"] .offer-price');
  const offer2Save = document.querySelector('.offer-option[data-qty="2"] .offer-save');
  const offer3Price = document.querySelector('.offer-option[data-qty="3"] .offer-price');
  const offer3Save = document.querySelector('.offer-option[data-qty="3"] .offer-save');

  if (offer1Price) offer1Price.textContent = `${APP_CONFIG.offers[1].price.toLocaleString("fr-FR")} د.ج`;
  if (offer2Price) offer2Price.textContent = `${APP_CONFIG.offers[2].price.toLocaleString("fr-FR")} د.ج`;
  if (offer2Save && APP_CONFIG.offers[2].save > 0) offer2Save.textContent = `وفّر ${APP_CONFIG.offers[2].save.toLocaleString("fr-FR")} د.ج`;
  if (offer3Price) offer3Price.textContent = `${APP_CONFIG.offers[3].price.toLocaleString("fr-FR")} د.ج`;
  if (offer3Save && APP_CONFIG.offers[3].save > 0) offer3Save.textContent = `وفّر ${APP_CONFIG.offers[3].save.toLocaleString("fr-FR")} د.ج`;

  // Update Images Slider if product has custom images
  let images = [];
  try {
    images = typeof product.images === 'string' ? JSON.parse(product.images) : product.images;
  } catch {
    images = [product.images];
  }

  if (Array.isArray(images) && images.length > 0) {
    const track = document.getElementById("sliderTrack");
    const dotsContainer = document.getElementById("sliderDots");

    if (track && dotsContainer) {
      track.innerHTML = "";
      dotsContainer.innerHTML = "";

      images.forEach((imgSrc, idx) => {
        const slide = document.createElement("div");
        slide.className = "slide";
        const image = String(imgSrc || '').trim() || 'assets/slide-1.webp';
        slide.innerHTML = `<img src="${escapeAttribute(image)}" alt="${escapeAttribute(product.name)} - صورة ${idx + 1}" width="500" height="500" decoding="async" ${idx === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} onerror="this.onerror=null;this.src='assets/slide-1.webp'">`;
        track.appendChild(slide);

        const dot = document.createElement("span");
        dot.className = `slider-dot ${idx === 0 ? 'active' : ''}`;
        dot.dataset.index = idx;
        dotsContainer.appendChild(dot);
      });
    }
  }
}

// ======================================================
// 3. IMAGE SLIDER LOGIC
// ======================================================
function initSlider() {
  const track = document.getElementById("sliderTrack");
  const prevBtn = document.getElementById("sliderPrev");
  const nextBtn = document.getElementById("sliderNext");
  const wrapper = document.querySelector(".slider-wrapper");

  if (!track || !wrapper) return;

  let currentIndex = 0;
  let startX = 0;
  let isDragging = false;

  function getSlides() { return document.querySelectorAll(".slide"); }
  function getDots() { return document.querySelectorAll(".slider-dot"); }

  function updateSlider(index) {
    const slides = getSlides();
    const dots = getDots();
    if (slides.length === 0) return;

    currentIndex = (index + slides.length) % slides.length;
    track.style.transition = "transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)";
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === currentIndex);
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => updateSlider(currentIndex - 1));
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => updateSlider(currentIndex + 1));
  }

  const dotsContainer = document.getElementById("sliderDots");
  if (dotsContainer) {
    dotsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("slider-dot")) {
        const target = parseInt(e.target.dataset.index, 10);
        updateSlider(target);
      }
    });
  }

  // Touch Swipe
  wrapper.addEventListener("touchstart", (e) => {
    isDragging = true;
    startX = e.touches[0].clientX;
  }, { passive: true });

  wrapper.addEventListener("touchend", (e) => {
    if (!isDragging) return;
    isDragging = false;
    const endX = e.changedTouches[0].clientX;
    const diff = endX - startX;
    if (diff > 40) {
      updateSlider(currentIndex - 1);
    } else if (diff < -40) {
      updateSlider(currentIndex + 1);
    }
  });
}

// ======================================================
// 4. WILAYAS & BALADIAS DYNAMIC DROPDOWN
// ======================================================
function initWilayaSelector() {
  const willayaSelect = document.getElementById("willayaSelect");
  const baladiaSelect = document.getElementById("baladiaSelect");

  if (!willayaSelect || !baladiaSelect) return;

  // Clear and populate 58 Wilayas
  willayaSelect.innerHTML = '<option value="">اختر الولاية</option>';
  shippingWilayas.forEach(w => {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = w.name;
    willayaSelect.appendChild(opt);
  });

  // Handle Wilaya change
  willayaSelect.addEventListener("change", () => {
    const selectedId = parseInt(willayaSelect.value, 10);
    const requestId = ++communesRequestId;
    baladiaSelect.innerHTML = '<option value="">اختر البلدية</option>';

    if (!selectedId) {
      baladiaSelect.disabled = true;
      updateTotalPrice();
      triggerAutoLeadCapture();
      return;
    }

    loadShippingCommunes(selectedId, requestId);
    updateTotalPrice();
    triggerAutoLeadCapture();
  });
}

// ======================================================
// 5. DYNAMIC PRICING & QUANTITY SELECTOR
// ======================================================
function getSelectedDeliveryFee() {
  const wilayaSelect = document.getElementById('willayaSelect');
  const wilayaId = wilayaSelect ? parseInt(wilayaSelect.value, 10) : 0;
  const fee = deliveryFees[wilayaId] || deliveryFees[String(wilayaId)];
  if (!wilayaId || !deliveryFeesReady || !fee) return null;
  const value = Number(fee.home ?? fee.tarif ?? fee.price);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function updateTotalPrice() {
  const offer = APP_CONFIG.offers[selectedQty] || APP_CONFIG.offers[1];
  const deliveryFee = getSelectedDeliveryFee();
  const totalPriceDisplay = document.getElementById('totalPriceDisplay');
  const oldPriceDisplay = document.getElementById('oldPriceDisplay');
  const deliveryFeeDisplay = document.getElementById('deliveryFeeDisplay');
  const total = offer.price + (deliveryFee ?? 0);

  if (totalPriceDisplay) totalPriceDisplay.textContent = `${total.toLocaleString('fr-FR')} ${APP_CONFIG.product.currency}`;
  if (oldPriceDisplay && offer.oldPrice) {
    oldPriceDisplay.textContent = `${(offer.oldPrice + (deliveryFee ?? 0)).toLocaleString('fr-FR')} ${APP_CONFIG.product.currency}`;
  }
  if (deliveryFeeDisplay) {
    const wilayaSelect = document.getElementById('willayaSelect');
    if (!wilayaSelect?.value) deliveryFeeDisplay.textContent = 'رسوم التوصيل: اختر الولاية';
    else if (deliveryFeesLoading) deliveryFeeDisplay.textContent = 'جار تحميل تسعيرة التوصيل...';
    else if (!deliveryFeesReady) deliveryFeeDisplay.textContent = 'سيتم تأكيد رسوم التوصيل هاتفياً';
    else if (deliveryFee === null) deliveryFeeDisplay.textContent = 'سيتم تأكيد رسوم التوصيل هاتفياً';
    else deliveryFeeDisplay.textContent = `رسوم التوصيل${deliveryProvider ? ` (${deliveryProvider})` : ''}: ${deliveryFee.toLocaleString('fr-FR')} ${APP_CONFIG.product.currency}`;
  }
  return { productPrice: offer.price, deliveryFee, total };
}

function initOfferSelector() {
  const offerCards = document.querySelectorAll(".offer-option");
  const priceDisplay = document.getElementById("totalPriceDisplay");
  const oldPriceDisplay = document.getElementById("oldPriceDisplay");

  function setOffer(qty) {
    selectedQty = qty;
    const offer = APP_CONFIG.offers[qty];

    offerCards.forEach(card => {
      const cardQty = parseInt(card.dataset.qty, 10);
      card.classList.toggle("selected", cardQty === qty);
    });

    if (priceDisplay && offer) {
      updateTotalPrice();
      
      if (offer.oldPrice && oldPriceDisplay) {
        oldPriceDisplay.style.display = "inline";
      } else if (oldPriceDisplay) {
        oldPriceDisplay.style.display = "none";
      }
    }

    triggerAutoLeadCapture();
  }

  offerCards.forEach(card => {
    card.addEventListener("click", () => {
      const qty = parseInt(card.dataset.qty, 10);
      setOffer(qty);
    });
  });

  // Initial set
  setOffer(2);
}

// ======================================================
// 6. AUTO-CAPTURE CLIENT INFO (BEFORE CLICKING CONFIRM)
// ======================================================
function initAutoLeadCapture() {
  const phoneInput = document.getElementById("phone");
  const fullNameInput = document.getElementById("fullName");
  const willayaSelect = document.getElementById("willayaSelect");
  const baladiaSelect = document.getElementById("baladiaSelect");

  // Capture immediately after a complete, valid phone is typed or autofilled.
  const debouncedCapture = () => {
    clearTimeout(leadCaptureTimer);
    leadCaptureTimer = setTimeout(triggerAutoLeadCapture, 100);
  };

  if (phoneInput) {
    phoneInput.addEventListener("input", debouncedCapture);
    phoneInput.addEventListener("change", triggerAutoLeadCapture);
    phoneInput.addEventListener("blur", triggerAutoLeadCapture);
    phoneInput.addEventListener("focus", () => setTimeout(triggerAutoLeadCapture, 0));
  }
  if (fullNameInput) {
    fullNameInput.addEventListener("input", debouncedCapture);
    fullNameInput.addEventListener("change", triggerAutoLeadCapture);
    fullNameInput.addEventListener("blur", triggerAutoLeadCapture);
  }
  if (willayaSelect) {
    willayaSelect.addEventListener("change", triggerAutoLeadCapture);
  }
  if (baladiaSelect) {
    baladiaSelect.addEventListener("change", triggerAutoLeadCapture);
  }
  window.addEventListener('pageshow', triggerAutoLeadCapture);
  window.addEventListener('online', triggerAutoLeadCapture);
  triggerAutoLeadCapture();
}

async function triggerAutoLeadCapture() {
  const phoneInput = document.getElementById("phone");
  const fullNameInput = document.getElementById("fullName");
  const willayaSelect = document.getElementById("willayaSelect");
  const baladiaSelect = document.getElementById("baladiaSelect");

  const phone = normalizeAlgerianPhone(phoneInput ? phoneInput.value : "");
  const fullName = fullNameInput ? fullNameInput.value.trim() : "";
  const willayaId = willayaSelect ? parseInt(willayaSelect.value, 10) : null;
  const willayaName = willayaSelect && willayaSelect.selectedIndex >= 0 
    ? willayaSelect.options[willayaSelect.selectedIndex].text 
    : "";
  const baladia = baladiaSelect ? baladiaSelect.value.trim() : "";

  if (!isValidAlgerianPhone(phone)) return;

  const offer = APP_CONFIG.offers[selectedQty] || APP_CONFIG.offers[1];
  const deliveryFee = getSelectedDeliveryFee();
  const prodName = currentProduct ? currentProduct.name : APP_CONFIG.product.name;
  const prodId = currentProduct ? currentProduct.id : null;

  const payload = {
    sessionToken,
    fullName,
    phone,
    willaya: willayaId ? willayaName : "",
    willayaId: willayaId || null,
    baladia,
    quantity: selectedQty,
    price: offer.price,
    deliveryFee,
    productId: prodId,
    productName: prodName
  };

  const signature = JSON.stringify(payload);
  if (signature === lastSavedLeadSignature) return;
  if (leadCaptureInFlight) {
    queuedLeadPayload = payload;
    return;
  }

  leadCaptureInFlight = true;
  let nextPayload = payload;
  try {
    while (nextPayload) {
      const nextSignature = JSON.stringify(nextPayload);
      if (nextSignature !== lastSavedLeadSignature) {
        try {
          const requestOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextPayload)
          };
          if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            requestOptions.signal = AbortSignal.timeout(5000);
          }
          const response = await fetch('/api/leads', requestOptions);
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.success) {
            throw new Error(result.error || `تعذر حفظ بيانات الزبون (${response.status})`);
          }
          lastSavedLeadSignature = nextSignature;
        } catch (err) {
          console.warn("Could not sync draft lead to DB:", err);
        }
      }
      nextPayload = queuedLeadPayload;
      queuedLeadPayload = null;
    }
  } finally {
    leadCaptureInFlight = false;
    if (queuedLeadPayload) triggerAutoLeadCapture();
  }
}

function initPixelInitiateCheckout() {
  const form = document.getElementById('kakiOrderForm');
  if (!form) return;

  const trackInitiateCheckout = () => {
    if (pixelInitiateCheckoutSent) return;
    pixelInitiateCheckoutSent = true;

    const productName = currentProduct ? currentProduct.name : APP_CONFIG.product.name;
    trackPixelEvent('InitiateCheckout', {
      content_ids: [getPixelContentId()],
      content_type: 'product',
      content_name: productName,
      num_items: selectedQty
    });
  };

  // Treat the first interaction anywhere inside the order form as checkout start.
  ['pointerdown', 'focusin', 'input', 'change'].forEach(eventName => {
    form.addEventListener(eventName, trackInitiateCheckout);
  });

  window.addEventListener('pageshow', () => {
    const customerFields = ['fullName', 'phone', 'willayaSelect', 'baladiaSelect']
      .map(id => document.getElementById(id))
      .filter(Boolean);
    if (customerFields.some(field => String(field.value || '').trim())) trackInitiateCheckout();
  }, { once: true });
}

function initPixelPurchaseTracking() {
  const submitButton = document.getElementById('submitOrderBtn');
  if (!submitButton) return;

  submitButton.addEventListener('click', () => {
    if (pixelPurchaseSent) return;
    pixelPurchaseSent = true;

    const productName = currentProduct ? currentProduct.name : APP_CONFIG.product.name;
    trackPixelEvent('Purchase', {
      content_ids: [getPixelContentId()],
      content_type: 'product',
      content_name: productName,
      num_items: selectedQty
    });
  });
}

function initPixelLeadTracking() {
  const phoneInput = document.getElementById('phone');
  if (!phoneInput) return;

  const captureLeadPixel = () => {
    const phone = normalizeAlgerianPhone(phoneInput.value);
    if (!isValidAlgerianPhone(phone) || pixelLeadPhones.has(phone)) return;
    pixelLeadPhones.add(phone);

    const productName = currentProduct ? currentProduct.name : APP_CONFIG.product.name;
    trackPixelEvent('Lead', {
      content_ids: [getPixelContentId()],
      content_type: 'product',
      content_name: productName,
      num_items: selectedQty,
      lead_source: 'valid_phone_input'
    });
  };

  phoneInput.addEventListener('input', captureLeadPixel);
  phoneInput.addEventListener('change', captureLeadPixel);
  phoneInput.addEventListener('blur', captureLeadPixel);
  phoneInput.addEventListener('focus', () => setTimeout(captureLeadPixel, 0));
  window.addEventListener('pageshow', captureLeadPixel);
  captureLeadPixel();
}

// ======================================================
// 7. ORDER FORM SUBMISSION
// ======================================================
function initOrderForm() {
  const form = document.getElementById("kakiOrderForm");
  const modal = document.getElementById("successModal");
  const modalClose = document.getElementById("modalCloseBtn");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullNameInput = document.getElementById("fullName");
    const phoneInput = document.getElementById("phone");
    const willayaSelect = document.getElementById("willayaSelect");
    const baladiaSelect = document.getElementById("baladiaSelect");

    const fullName = fullNameInput.value.trim();
    const phone = phoneInput.value.trim();
    const willayaId = parseInt(willayaSelect.value, 10);
    const baladia = baladiaSelect.value.trim();

    if (!isValidAlgerianPhone(phone)) {
      alert("يرجى إدخال رقم جزائري صحيح: 05/06/07 + 8 أرقام أو +213 + 9 أرقام");
      phoneInput.focus();
      return;
    }

    if (!fullName) {
      alert("يرجى كتابة الاسم الكامل");
      fullNameInput.focus();
      return;
    }

    if (!willayaId) {
      alert("يرجى اختيار الولاية");
      willayaSelect.focus();
      return;
    }

    if (!baladia) {
      alert("يرجى اختيار البلدية");
      baladiaSelect.focus();
      return;
    }

    const wilayaObj = shippingWilayas.find(w => w.id === willayaId);
    const offer = APP_CONFIG.offers[selectedQty] || APP_CONFIG.offers[1];
    const pricing = updateTotalPrice();
    const prodName = currentProduct ? currentProduct.name : APP_CONFIG.product.name;
    const prodId = currentProduct ? currentProduct.id : null;

    const submitBtn = document.getElementById("submitOrderBtn");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>جاري التأكيد...</span>`;

    // Construct Order Payload
    let newOrder = {
      fullName,
      phone,
      willaya: wilayaObj ? wilayaObj.name : "غير محدد",
      willayaId,
      baladia,
      quantity: selectedQty,
      price: offer.price,
      deliveryFee: pricing.deliveryFee ?? 0,
      productId: prodId,
      productName: prodName,
      sessionToken
    };

    // Confirm the order was committed before showing a success message.
    try {
      const resp = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrder)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.success || !data.order?.id) {
        throw new Error(data.error || 'تعذر حفظ الطلب. يرجى المحاولة مرة أخرى.');
      }
      newOrder.id = data.order.id;
      newOrder.deliveryFeePending = Boolean(data.order.delivery_fee_pending);
    } catch (err) {
      console.error("Order could not be saved:", err);
      submitBtn.disabled = false;
      submitBtn.classList.remove("confirmed");
      submitBtn.innerHTML = `<span>تأكيد الطلب الآن</span>`;
      alert(err.message || 'تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
      return;
    }

    // EcoTrack dispatch is intentionally server-side and is triggered from the admin dashboard.
    // This keeps the courier token out of the browser and lets staff verify each order first.

    // Update submit button to confirmed state
    submitBtn.classList.add("confirmed");
    submitBtn.innerHTML = `<span>✓ تم استلام طلبك بنجاح!</span>`;
    submitBtn.disabled = true;

    // 6. Display Confirmation Modal
    document.getElementById("modalOrderId").textContent = newOrder.id;
    document.getElementById("modalOrderDetails").textContent = 
      `${fullName} · ${wilayaObj ? wilayaObj.name : ''} (${baladia}) · ${selectedQty} علب · ${newOrder.deliveryFeePending ? `${offer.price} ${APP_CONFIG.product.currency} + رسوم التوصيل تؤكد هاتفياً` : `${pricing.total} ${APP_CONFIG.product.currency}`}`;

    modal.classList.add("active");

    // Clear session lead token for new session
    sessionStorage.removeItem("ecom_lead_session_token");
    initSessionToken();
    lastSavedLeadSignature = '';
    queuedLeadPayload = null;
    pixelLeadPhones.clear();
    pixelInitiateCheckoutSent = false;

    // Reset Form inputs for fresh state if they dismiss modal
    form.reset();
  });

  if (modalClose && modal) {
    modalClose.addEventListener("click", () => {
      modal.classList.remove("active");
    });
  }
}

// ======================================================
// 8. SMOOTH SCROLL CTA LOGIC
// ======================================================
function initSmoothScroll() {
  const heroCta = document.getElementById("heroCtaBtn");
  const orderSection = document.getElementById("order-section");

  if (heroCta && orderSection) {
    heroCta.addEventListener("click", (e) => {
      e.preventDefault();
      orderSection.scrollIntoView({ behavior: "smooth" });
    });
  }
}

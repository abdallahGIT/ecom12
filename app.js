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

function escapeAttribute(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

document.addEventListener("DOMContentLoaded", async () => {
  initSessionToken();
  initSmoothScroll();
  initWilayaSelector();
  
  // Load product and live delivery data before initializing checkout controls.
  await Promise.all([loadActiveProduct(), loadDeliveryFees()]);

  // Initialize UI features
  initSlider();
  initOfferSelector();
  initAutoLeadCapture();
  initOrderForm();

  // Initialize Facebook Pixel if configured
  APP_CONFIG.pixel.init();
  APP_CONFIG.pixel.track("ViewContent", {
    content_name: currentProduct ? currentProduct.name : APP_CONFIG.product.name,
    currency: "DZD",
    value: APP_CONFIG.offers[1].price
  });
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
    if (data.success && data.fees && typeof data.fees === 'object') {
      deliveryFees = data.fees;
    }
  } catch (err) {
    console.warn('Could not load live delivery fees:', err);
  }
}

// ======================================================
// 2. DYNAMIC PRODUCT LOADING FROM NEON DB
// ======================================================
async function loadActiveProduct() {
  try {
    // Check if a specific product slug is in URL query (?p=slug)
    const urlParams = new URLSearchParams(window.location.search);
    const slugParam = urlParams.get('p');

    const res = await fetch(slugParam ? `/api/products?slug=${encodeURIComponent(slugParam)}` : '/api/products');
    const data = await res.json();

    if (data.success && Array.isArray(data.products) && data.products.length > 0) {
      currentProduct = data.products.find(p => !slugParam || p.slug === slugParam) || data.products[0];

      if (currentProduct) {
        applyProductToUI(currentProduct);
      }
    }
  } catch (err) {
    console.warn("Could not fetch active product from DB, using fallback config:", err);
  }
}

function applyProductToUI(product) {
  // Each landing-page slug can carry its own Pixel; it is initialized after this function runs.
  if (product.pixel_id) {
    APP_CONFIG.pixel.pixelId = String(product.pixel_id).trim();
  }

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
        const image = String(imgSrc || '').trim() || 'assets/slide-1.jpg';
        slide.innerHTML = `<img src="${escapeAttribute(image)}" alt="${escapeAttribute(product.name)} - صورة ${idx + 1}" width="500" height="500" ${idx === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} onerror="this.onerror=null;this.src='assets/slide-1.jpg'">`;
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
  WILAYAS_DATA.forEach(w => {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = w.name;
    willayaSelect.appendChild(opt);
  });

  // Handle Wilaya change
  willayaSelect.addEventListener("change", () => {
    const selectedId = parseInt(willayaSelect.value, 10);
    baladiaSelect.innerHTML = '<option value="">اختر البلدية</option>';

    if (!selectedId) {
      baladiaSelect.disabled = true;
      updateTotalPrice();
      triggerAutoLeadCapture();
      return;
    }

    const wilayaObj = WILAYAS_DATA.find(w => w.id === selectedId);
    if (wilayaObj && wilayaObj.baladias) {
      wilayaObj.baladias.forEach(b => {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = b;
        baladiaSelect.appendChild(opt);
      });
      baladiaSelect.disabled = false;
    }
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
  return fee ? Number(fee.home || fee.tarif || fee.price || 0) : 0;
}

function updateTotalPrice() {
  const offer = APP_CONFIG.offers[selectedQty] || APP_CONFIG.offers[1];
  const deliveryFee = getSelectedDeliveryFee();
  const totalPriceDisplay = document.getElementById('totalPriceDisplay');
  const oldPriceDisplay = document.getElementById('oldPriceDisplay');
  const deliveryFeeDisplay = document.getElementById('deliveryFeeDisplay');
  const total = offer.price + deliveryFee;

  if (totalPriceDisplay) totalPriceDisplay.textContent = `${total.toLocaleString('fr-FR')} ${APP_CONFIG.product.currency}`;
  if (oldPriceDisplay && offer.oldPrice) {
    oldPriceDisplay.textContent = `${(offer.oldPrice + deliveryFee).toLocaleString('fr-FR')} ${APP_CONFIG.product.currency}`;
  }
  if (deliveryFeeDisplay) {
    deliveryFeeDisplay.textContent = deliveryFee > 0
      ? `رسوم التوصيل: ${deliveryFee.toLocaleString('fr-FR')} ${APP_CONFIG.product.currency}`
      : 'رسوم التوصيل: اختر الولاية';
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

  // Debounced input capture
  const debouncedCapture = () => {
    clearTimeout(leadCaptureTimer);
    leadCaptureTimer = setTimeout(triggerAutoLeadCapture, 600);
  };

  if (phoneInput) {
    phoneInput.addEventListener("input", debouncedCapture);
    phoneInput.addEventListener("blur", triggerAutoLeadCapture);
  }
  if (fullNameInput) {
    fullNameInput.addEventListener("input", debouncedCapture);
    fullNameInput.addEventListener("blur", triggerAutoLeadCapture);
  }
  if (willayaSelect) {
    willayaSelect.addEventListener("change", triggerAutoLeadCapture);
  }
  if (baladiaSelect) {
    baladiaSelect.addEventListener("change", triggerAutoLeadCapture);
  }
}

async function triggerAutoLeadCapture() {
  const phoneInput = document.getElementById("phone");
  const fullNameInput = document.getElementById("fullName");
  const willayaSelect = document.getElementById("willayaSelect");
  const baladiaSelect = document.getElementById("baladiaSelect");

  const phone = phoneInput ? phoneInput.value.trim() : "";
  const fullName = fullNameInput ? fullNameInput.value.trim() : "";
  const willayaId = willayaSelect ? parseInt(willayaSelect.value, 10) : null;
  const willayaName = willayaSelect && willayaSelect.selectedIndex >= 0 
    ? willayaSelect.options[willayaSelect.selectedIndex].text 
    : "";
  const baladia = baladiaSelect ? baladiaSelect.value.trim() : "";

  // Only capture if user has started typing phone (>= 6 digits) or full name
  if (phone.length < 6 && fullName.length < 2) {
    return;
  }

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

  try {
    await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log("📡 [Lead Saver] Client draft info captured silently.");
  } catch (err) {
    console.warn("Could not sync draft lead to DB:", err);
  }
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

    if (!phone || phone.length < 9) {
      alert("يرجى إدخال رقم هاتف صحيح (مثال: 0555123456)");
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

    const wilayaObj = WILAYAS_DATA.find(w => w.id === willayaId);
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
      deliveryFee: pricing.deliveryFee,
      productId: prodId,
      productName: prodName,
      sessionToken
    };

    // 1. Sync with PostgreSQL Backend API
    try {
      const resp = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrder)
      });
      const data = await resp.json();
      if (data && data.success && data.order) {
        newOrder.id = data.order.id;
      }
    } catch (err) {
      console.warn("API offline, fallback to local storage:", err);
    }

    // 2. Save locally in OrderManager
    const savedOrder = OrderManager.addOrder(newOrder);
    if (!newOrder.id) newOrder.id = savedOrder.id;

    // 3. Fire Facebook Pixel Purchase Event
    APP_CONFIG.pixel.track("Purchase", {
      content_name: prodName,
      currency: "DZD",
      value: pricing.total,
      num_items: selectedQty
    });

    // EcoTrack dispatch is intentionally server-side and is triggered from the admin dashboard.
    // This keeps the courier token out of the browser and lets staff verify each order first.

    // 5. Update submit button to confirmed state
    submitBtn.classList.add("confirmed");
    submitBtn.innerHTML = `<span>✓ تم استلام طلبك بنجاح!</span>`;
    submitBtn.disabled = true;

    // 6. Display Confirmation Modal
    document.getElementById("modalOrderId").textContent = newOrder.id || savedOrder.id;
    document.getElementById("modalOrderDetails").textContent = 
      `${fullName} · ${wilayaObj ? wilayaObj.name : ''} (${baladia}) · ${selectedQty} علب · ${pricing.total} ${APP_CONFIG.product.currency}`;

    modal.classList.add("active");

    // Clear session lead token for new session
    sessionStorage.removeItem("ecom_lead_session_token");
    initSessionToken();

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

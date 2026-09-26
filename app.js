// ======================================================
// KAKI SEEDS — APP INTERACTION & LOGIC
// Image Slider, Dynamic Offers, Wilaya Sync, Tracking
// ======================================================

document.addEventListener("DOMContentLoaded", () => {
  // Initialize Facebook Pixel if configured
  APP_CONFIG.pixel.init();

  // Track initial ViewContent event
  APP_CONFIG.pixel.track("ViewContent", {
    content_name: APP_CONFIG.product.name,
    currency: "DZD",
    value: APP_CONFIG.offers[1].price
  });

  initSlider();
  initWilayaSelector();
  initOfferSelector();
  initOrderForm();
  initSmoothScroll();
});

// ======================================================
// 1. TOUCH & DRAG SLIDER LOGIC
// ======================================================
function initSlider() {
  const track = document.getElementById("sliderTrack");
  const slides = document.querySelectorAll(".slide");
  const dots = document.querySelectorAll(".slider-dot");
  const prevBtn = document.getElementById("sliderPrev");
  const nextBtn = document.getElementById("sliderNext");
  const wrapper = document.querySelector(".slider-wrapper");

  if (!track || slides.length === 0) return;

  let currentIndex = 0;
  let startX = 0;
  let isDragging = false;
  // No autoplay — user drives the slides

  function updateSlider(index) {
    currentIndex = (index + slides.length) % slides.length;
    track.style.transition = "transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)";
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === currentIndex);
    });
  }

  // Button navigation
  if (prevBtn) {
    prevBtn.addEventListener("click", () => updateSlider(currentIndex - 1));
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => updateSlider(currentIndex + 1));
  }

  // Dot navigation
  dots.forEach(dot => {
    dot.addEventListener("click", (e) => {
      const target = parseInt(e.target.dataset.index, 10);
      updateSlider(target);
    });
  });

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
// 2. WILAYAS & BALADIAS DYNAMIC DROPDOWN
// ======================================================
function initWilayaSelector() {
  const willayaSelect = document.getElementById("willayaSelect");
  const baladiaSelect = document.getElementById("baladiaSelect");

  if (!willayaSelect || !baladiaSelect) return;

  // Populate 58 Wilayas
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
  });
}

// ======================================================
// 3. DYNAMIC PRICING & QUANTITY SELECTOR
// ======================================================
let selectedQty = 2; // Default to most popular offer (2 packs)

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
      priceDisplay.textContent = `${offer.price.toLocaleString("fr-FR")} ${APP_CONFIG.product.currency}`;
      
      if (offer.oldPrice && oldPriceDisplay) {
        oldPriceDisplay.textContent = `${offer.oldPrice.toLocaleString("fr-FR")} ${APP_CONFIG.product.currency}`;
        oldPriceDisplay.style.display = "inline";
      } else if (oldPriceDisplay) {
        oldPriceDisplay.style.display = "none";
      }
    }
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
// 4. ORDER FORM SUBMISSION
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
      alert("يرجى إدخال رقم هاتف صحيح");
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
    const offer = APP_CONFIG.offers[selectedQty];

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
      productName: APP_CONFIG.product.name
    };

    // 1. Sync with PostgreSQL Backend API if available
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
      content_name: APP_CONFIG.product.name,
      currency: "DZD",
      value: offer.price,
      num_items: selectedQty
    });

    // 4. Dispatch to EcoTrack API
    await APP_CONFIG.ecotrack.sendOrder(newOrder);

    // 5. Update submit button to confirmed state
    submitBtn.classList.add("confirmed");
    submitBtn.innerHTML = `<span>✓ تم تأكيد طلبك بنجاح!</span>`;
    submitBtn.disabled = true;

    // 6. Display Confirmation Modal
    document.getElementById("modalOrderId").textContent = newOrder.id || savedOrder.id;
    document.getElementById("modalOrderDetails").textContent = 
      `${fullName} · ${wilayaObj.name} (${baladia}) · ${selectedQty} علب · ${offer.price} ${APP_CONFIG.product.currency}`;

    modal.classList.add("active");

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
// 5. SMOOTH SCROLL CTA LOGIC
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

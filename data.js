// ==========================================
// CONFIGURATION & TRACKING APIS
// ==========================================
const APP_CONFIG = {
  // Product Details
  product: {
    name: "بذور الكاكي الفاخرة",
    subtitle: "أصلية 100% · إنتاجية استثنائية",
    currency: "د.ج"
  },

  // Dynamic Pricing Offers (Strictly 1, 2, or 3)
  offers: {
    1: {
      qty: 1,
      price: 2500,
      oldPrice: null,
      save: null,
      badge: "",
      isPopular: false
    },
    2: {
      qty: 2,
      price: 4200,
      oldPrice: 5000,
      save: 800,
      badge: "",
      isPopular: false
    },
    3: {
      qty: 3,
      price: 5600,
      oldPrice: 7500,
      save: 1900,
      badge: "",
      isPopular: false
    }
  },

  // One Meta Pixel for the entire storefront; products are distinguished by content_ids.
  pixel: {
    enabled: true,
    pixelId: "1808629570178310",
    initialized: false,
    scriptLoaded: false,
    scriptLoadPromise: null,
    init() {
      if (this.scriptLoadPromise) return this.scriptLoadPromise;
      if (!this.enabled || !this.pixelId || this.pixelId === "YOUR_PIXEL_ID_HERE") {
        console.log("ℹ️ [Facebook Pixel] Slot ready. Insert your Pixel ID in data.js or Admin settings.");
        this.initialized = true;
        return Promise.resolve(false);
      }

      // fbq is a queue until fbevents.js finishes loading. Do not treat the queue
      // as a successful Meta connection: report script load failures explicitly.
      if (!window.fbq) {
        const queue = function () {
          queue.callMethod ? queue.callMethod.apply(queue, arguments) : queue.queue.push(arguments);
        };
        queue.push = queue;
        queue.loaded = true;
        queue.version = '2.0';
        queue.queue = [];
        window.fbq = queue;
        window._fbq = queue;
      }

      fbq('init', this.pixelId);
      fbq('track', 'PageView');
      this.initialized = true;
      this.scriptLoadPromise = new Promise(resolve => {
        const existingScript = document.querySelector('script[data-meta-pixel-loader="true"]');
        if (existingScript) return resolve(this.scriptLoaded);

        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://connect.facebook.net/en_US/fbevents.js';
        script.dataset.metaPixelLoader = 'true';
        script.onload = () => {
          this.scriptLoaded = true;
          console.info('✓ Meta Pixel library loaded');
          resolve(true);
        };
        script.onerror = () => {
          console.error('Meta Pixel library was blocked or could not load from connect.facebook.net. Disable the ad/tracker blocker for maisonverre.vercel.app and test again.');
          resolve(false);
        };
        document.head.appendChild(script);
      });
      return this.scriptLoadPromise;
    },
    track(eventName, params = {}) {
      if (!this.enabled || !this.pixelId || this.pixelId === "YOUR_PIXEL_ID_HERE") return false;
      if (!this.scriptLoaded) {
        console.warn(`Meta Pixel ${eventName} queued while the Meta library loads.`);
      }
      if (typeof fbq === 'function') {
        fbq('track', eventName, params);
        console.log(`📡 [Pixel Event] ${eventName}:`, params);
        return true;
      } else {
        console.log(`📡 [Mock Pixel Event] ${eventName}:`, params);
        return false;
      }
    }
  },

  // EcoTrack Algeria Logistics API Slot
  ecotrack: {
    enabled: false,
    apiUrl: null,
    apiToken: null,
    storeId: null,
    async sendOrder(order) {
      return { success: true, mode: "server-side", orderId: order.id };
    }
  }
};

// ==========================================
// 58 ALGERIAN WILAYAS & BALADIAS
// ==========================================
const WILAYAS_DATA = [
  { id: 1, code: "01", name: "01 - أدرار", baladias: ["أدرار", "تيمي", "بودة", "فنوغيل", "زاوية كنتة", "رقان", "أولف"] },
  { id: 2, code: "02", name: "02 - الشلف", baladias: ["الشلف", "تنس", "وادي الفضة", "بوقادير", "أولاد فارس", "الكريمية", "الزبوجة"] },
  { id: 3, code: "03", name: "03 - الأغواط", baladias: ["الأغواط", "أفلو", "قصر الحيران", "عين ماضي", "سيدي مخلوف", "الخنق"] },
  { id: 4, code: "04", name: "04 - أم البواقي", baladias: ["أم البواقي", "عين البيضاء", "عين مليلة", "عين فكرون", "مسكيانة", "سيقوس"] },
  { id: 5, code: "05", name: "05 - باتنة", baladias: ["باتنة", "بريكة", "عين التوتة", "مروانة", "أريس", "المعذر", "تازولت"] },
  { id: 6, code: "06", name: "06 - بجاية", baladias: ["بجاية", "أقبو", "أميزور", "سوق الاثنين", "خراطة", "سيدي عيش", "القصر"] },
  { id: 7, code: "07", name: "07 - بسكرة", baladias: ["بسكرة", "طولقة", "سيدي عقبة", "الزيبان", "الوطاية", "فرفار"] },
  { id: 8, code: "08", name: "08 - بشار", baladias: ["بشار", "القنادسة", "العبادلة", "تاغيت", "بني ونيف"] },
  { id: 9, code: "09", name: "09 - البليدة", baladias: ["البليدة", "بوفاريك", "أولاد يعيش", "العفرون", "موزاية", "بوقرة", "الأربعاء"] },
  { id: 10, code: "10", name: "10 - البويرة", baladias: ["البويرة", "الأخضرية", "سور الغزلان", "عين بسام", "مشدالة", "قاديرية"] },
  { id: 11, code: "11", name: "11 - تمنراست", baladias: ["تمنراست", "عين أمقل", "أبلسة", "تاظروك"] },
  { id: 12, code: "12", name: "12 - تبسة", baladias: ["تبسة", "الشريعة", "بئر العاتر", "الونزة", "العوينات", "الكويف"] },
  { id: 13, code: "13", name: "13 - تلمسان", baladias: ["تلمسان", "مغنية", "منصورة", "شتوان", "الغزوات", "ندرومة", "سبدو"] },
  { id: 14, code: "14", name: "14 - تيارت", baladias: ["تيارت", "السوقر", "فرندة", "قصر الشلالة", "مهدية", "رحوية"] },
  { id: 15, code: "15", name: "15 - تيزي وزو", baladias: ["تيزي وزو", "عزازقة", "ذراع بن خدة", "تيزي راشد", "واضحية", "أزفون", "بوغني"] },
  { id: 16, code: "16", name: "16 - الجزائر", baladias: ["الجزائر الوسطى", "باب الوادي", "حيدرة", "بن عكنون", "بئر مراد رايس", "الحراش", "الدار البيضاء", "برج البحري", "زرالدة", "الشراقة", "الرويبة", "القبة", "درارية", "براقي"] },
  { id: 17, code: "17", name: "17 - الجلفة", baladias: ["الجلفة", "عين وسارة", "مسعد", "حاسي بحبح", "الشارف", "دار الشيوخ"] },
  { id: 18, code: "18", name: "18 - جيجل", baladias: ["جيجل", "الطاهير", "الميلية", "العوانة", "زيامة منصورية", "الشقفة"] },
  { id: 19, code: "19", name: "19 - سطيف", baladias: ["سطيف", "العلمة", "عين ولمان", "عين الكبيرة", "بوقاعة", "جميلة", "عين أرنات"] },
  { id: 20, code: "20", name: "20 - سعيدة", baladias: ["سعيدة", "عين الحجر", "يوب", "الحساسنة", "أولاد إبراهيم"] },
  { id: 21, code: "21", name: "21 - سكيكدة", baladias: ["سكيكدة", "القل", "الحروش", "عزابة", "تمالوس", "رمضان جمال"] },
  { id: 22, code: "22", name: "22 - سيدي بلعباس", baladias: ["سيدي بلعباس", "تلاغ", "سفيزف", "ابن باديس", "عين البرد"] },
  { id: 23, code: "23", name: "23 - عنابة", baladias: ["عنابة", "البوني", "سيدي عمار", "برحال", "الحجار", "شطايبي"] },
  { id: 24, code: "24", name: "24 - قالمة", baladias: ["قالمة", "وادي الزناتي", "بوشقوف", "هيليوبوليس", "حمام دباغ"] },
  { id: 25, code: "25", name: "25 - قسنطينة", baladias: ["قسنطينة", "الخروب", "علي منجلي", "حامة بوزيان", "زيغود يوسف", "ديدوش مراد"] },
  { id: 26, code: "26", name: "26 - المدية", baladias: ["المدية", "البرواقية", "قصر البخاري", "وزرة", "تابلاط", "بني سليمان"] },
  { id: 27, code: "27", name: "27 - مستغانم", baladias: ["مستغانم", "عين تدلس", "سيدي علي", "حاسي ماماش", "مزغران"] },
  { id: 28, code: "28", name: "28 - المسيلة", baladias: ["المسيلة", "بوسعادة", "سيدي عيسى", "مقرة", "عين الحجل", "أولاد دراج"] },
  { id: 29, code: "29", name: "29 - معسكر", baladias: ["معسكر", "سيق", "تيغنيف", "المحمدية", "غريس", "وادي الأبطال"] },
  { id: 30, code: "30", name: "30 - ورقلة", baladias: ["ورقلة", "حاسي مسعود", "الرويسات", "سيدي خويلد", "النزلة"] },
  { id: 31, code: "31", name: "31 - وهران", baladias: ["وهران", "السانية", "بئر الجير", "عين الترك", "أرزيو", "بطيوة", "قديل", "مرسى الكبير"] },
  { id: 32, code: "32", name: "32 - البيض", baladias: ["البيض", "الأبيض سيدي الشيخ", "بريزينة", "بوقطب", "الرقاصة"] },
  { id: 33, code: "33", name: "33 - إليزي", baladias: ["إليزي", "إن أمناس", "برج عمر دريس"] },
  { id: 34, code: "34", name: "34 - برج بوعريريج", baladias: ["برج بوعريريج", "رأس الوادي", "برج زمورة", "المنصورة", "مجانة"] },
  { id: 35, code: "35", name: "35 - بومرداس", baladias: ["بومرداس", "برج منايل", "دلس", "بودواو", "يسر", "الثنية", "خميس الخشنة"] },
  { id: 36, code: "36", name: "36 - الطارف", baladias: ["الطارف", "القالة", "بن مهيدي", "بوحجار", "الذرعان"] },
  { id: 37, code: "37", name: "37 - تندوف", baladias: ["تندوف", "أم العسل"] },
  { id: 38, code: "38", name: "38 - تسمسيلت", baladias: ["تسمسيلت", "ثنية الحد", "برج بونعامة", "لردام"] },
  { id: 39, code: "39", name: "39 - الوادي", baladias: ["الوادي", "قمار", "الدبيلة", "الرقيبة", "جامعة", "المقرن"] },
  { id: 40, code: "40", name: "40 - خنشلة", baladias: ["خنشلة", "ششار", "قايس", "بوحمامة", "الحامة"] },
  { id: 41, code: "41", name: "41 - سوق أهراس", baladias: ["سوق أهراس", "سدراتة", "مداوروش", "تاورة", "المشروحة"] },
  { id: 42, code: "42", name: "42 - تيبازة", baladias: ["تيبازة", "شرشال", "القليعة", "بواسماعيل", "حجوط", "فوكة", "الداموس"] },
  { id: 43, code: "43", name: "43 - ميلة", baladias: ["ميلة", "شلغوم العيد", "فرجيوة", "تاجنانت", "قرارم قوقة"] },
  { id: 44, code: "44", name: "44 - عين الدفلى", baladias: ["عين الدفلى", "خميس مليانة", "العطاف", "مليانة", "جليدة", "الروينة"] },
  { id: 45, code: "45", name: "45 - النعامة", baladias: ["النعامة", "مشرية", "عين الصفراء", "عسلة", "تيوت"] },
  { id: 46, code: "46", name: "46 - عين تموشنت", baladias: ["عين تموشنت", "بني صاف", "حمام بوحجر", "العامرية", "عين الكيحل"] },
  { id: 47, code: "47", name: "47 - غرداية", baladias: ["غرداية", "متليلي", "القرارة", "بريان", "العطف", "بني يزقن"] },
  { id: 48, code: "48", name: "48 - غليزان", baladias: ["غليزان", "وادي ارهيو", "مازونة", "عمي موسى", "زمورة", "يلل"] },
  { id: 49, code: "49", name: "49 - المغير", baladias: ["المغير", "جامعة", "أم الطيور", "سيدي خليل"] },
  { id: 50, code: "50", name: "50 - المنيعة", baladias: ["المنيعة", "حاسي القارة", "حاسي الفحل"] },
  { id: 51, code: "51", name: "51 - أولاد جلال", baladias: ["أولاد جلال", "سيدي خالد", "رأس الميعاد", "البسباس"] },
  { id: 52, code: "52", name: "52 - برج باجي مختار", baladias: ["برج باجي مختار", "تيمياوين"] },
  { id: 53, code: "53", name: "53 - بني عباس", baladias: ["بني عباس", "الواتة", "كرزاز", "إقلي"] },
  { id: 54, code: "54", name: "54 - تيميمون", baladias: ["تيميمون", "شروين", "أوقروت", "طلمين"] },
  { id: 55, code: "55", name: "55 - تقرت", baladias: ["تقرت", "النزلة", "تماسين", "المقارين", "الطيبات"] },
  { id: 56, code: "56", name: "56 - جانت", baladias: ["جانت", "برج الحواس"] },
  { id: 57, code: "57", name: "57 - عين صالح", baladias: ["عين صالح", "فقارة الزاوية", "إينغر"] },
  { id: 58, code: "58", name: "58 - عين قزام", baladias: ["عين قزام", "تين زواتين"] }
];

// ==========================================
// ORDER STORAGE (LOCALSTORAGE + SYNC)
// ==========================================
const ORDERS_STORAGE_KEY = "kaki_orders_v1";

const OrderManager = {
  getOrders() {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    if (!raw) {
      // Demo initial orders for Excel/EcoTrack view
      const initial = [
        {
          id: "ORD-1001",
          createdAt: "2026-09-26 14:20",
          fullName: "محمد بن علي",
          phone: "0555123456",
          willaya: "16 - الجزائر",
          willayaId: 16,
          baladia: "حيدرة",
          quantity: 2,
          price: 4200,
          status: "confirmed", // new, confirmed, cancelled, delivered
          note: "اتصل به بعد 18:00"
        },
        {
          id: "ORD-1002",
          createdAt: "2026-09-26 15:45",
          fullName: "أمينة سعدي",
          phone: "0661987654",
          willaya: "31 - وهران",
          willayaId: 31,
          baladia: "بئر الجير",
          quantity: 1,
          price: 2500,
          status: "new",
          note: ""
        },
        {
          id: "ORD-1003",
          createdAt: "2026-09-26 17:10",
          fullName: "كريم قادري",
          phone: "0770456123",
          willaya: "09 - البليدة",
          willayaId: 9,
          baladia: "بوفاريك",
          quantity: 3,
          price: 5600,
          status: "delivered",
          note: "الدفع نقداً"
        }
      ];
      localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  saveOrders(orders) {
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
  },

  addOrder(orderData) {
    const orders = this.getOrders();
    const newId = "ORD-" + Math.floor(1000 + Math.random() * 9000);
    const dateStr = new Date().toLocaleString("fr-FR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).replace(",", "");

    const newOrder = {
      id: newId,
      createdAt: dateStr,
      status: "new",
      ...orderData
    };

    orders.unshift(newOrder);
    this.saveOrders(orders);
    return newOrder;
  },

  updateStatus(orderId, newStatus) {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) {
      orders[idx].status = newStatus;
      this.saveOrders(orders);
      return orders[idx];
    }
    return null;
  },

  deleteOrder(orderId) {
    const orders = this.getOrders().filter(o => o.id !== orderId);
    this.saveOrders(orders);
    return orders;
  }
};

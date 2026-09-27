const OFFICIAL_TO_ECOTRACK = {
  49: 57, 50: 58, 51: 51, 52: 50, 53: 52, 54: 49, 55: 55, 56: 56, 57: 53, 58: 54
};

const COMMUNE_ALIASES = {
  mahelma: 'maalma', ouzellaguen: 'ouzellaguene', msirda: 'msirda fouaga',
  ouaguenoun: 'ouaguenoune', yakouren: 'yakourene',
  'ziama mansouriah': 'ziama mansouria', ziama: 'ziama mansouria',
  'oued el bar': 'oued el barad', 'el harrouch': 'el arrouch', hamma: 'hamadi krouma',
  kanouar: 'kanoua', khezaras: 'khezara', "hammam n'bails": "hammam n'bail",
  'el ksir': 'ain ouksir', 'el meed': 'el houamed', 'el menaoua': 'menaa',
  nesmoth: 'nesmot', 'el abiodh sidi cheikh': 'el biodh sidi cheikh',
  'zemmouri el bahri': 'zemmouri', grarem: 'grarem gouga',
  oulhaca: 'oulhaca el gheraba', 'el fedjoudj boughrara': 'el fedjoudj boughrara sa'
};

function clean(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[إأآا]/g, 'ا').replace(/[يى]/g, 'ي')
    .replace(/[ة]/g, 'ه').replace(/[\s_-]+/g, ' ');
}

function comparable(value) {
  const normalized = COMMUNE_ALIASES[clean(value)] || clean(value);
  return normalized.replace(/[\'’]/g, ' ').replace(/^(les|el|al|l)\s*/i, '')
    .replace(/[\s-]/g, '').replace(/(.)\1+/g, '$1');
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('213') && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  return digits;
}

function officialWilayaId(value) {
  const raw = String(value || '');
  const match = raw.match(/^\s*(\d{1,2})/);
  const id = match ? Number(match[1]) : Number(raw);
  return Number.isInteger(id) && id >= 1 && id <= 58 ? id : null;
}

function ecoWilayaId(value) {
  const official = officialWilayaId(value);
  return official ? (OFFICIAL_TO_ECOTRACK[official] || official) : null;
}

async function getSettings(pool) {
  const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('ecotrack_provider','ecotrack_token','ecotrack_url','ecotrack_key','ecotrack_store')");
  const values = Object.fromEntries(result.rows.map(row => [row.key, row.value]));
  const provider = String(values.ecotrack_provider || process.env.ECOTRACK_PROVIDER || 'navexdelivery').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const token = String(values.ecotrack_token || values.ecotrack_key || process.env.ECOTRACK_API_TOKEN || '').trim();
  return { provider, token, baseUrl: `https://${provider}.ecotrack.dz/api/v1` };
}

function headers(config) {
  return { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

function requireToken(config) {
  if (!config.token || config.token.startsWith('YOUR_')) throw new Error('توكن EcoTrack غير مضبوط. احفظه من إعدادات لوحة الإدارة أو Vercel Environment Variables.');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const detail = typeof text === 'string' ? text.slice(0, 300) : '';
    throw new Error(`EcoTrack رفض الطلب (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return data;
}

function arrayFrom(data, keys = ['data', 'items', 'results', 'orders', 'wilayas', 'communes', 'products']) {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
    if (data?.[key] && typeof data[key] === 'object') {
      const nested = arrayFrom(data[key], keys);
      if (nested.length) return nested;
    }
  }
  return [];
}

async function getCommunes(wilaya, config) {
  requireToken(config);
  const code = ecoWilayaId(wilaya);
  if (!code) throw new Error('رقم الولاية غير صالح لـ EcoTrack');
  const data = await requestJson(`${config.baseUrl}/get/communes/${code}`, { headers: headers(config) });
  return arrayFrom(data, ['data', 'communes']).map(item => ({
    name: String(item.nom || item.name || item.commune_name || '').trim(),
    codePostal: String(item.code_postal || item.codePostal || '').trim() || null,
    hasStopDesk: Number(item.has_stop_desk ?? 0) === 1
  })).filter(item => item.name);
}

async function matchCommune(wilaya, commune, config) {
  const list = await getCommunes(wilaya, config);
  const target = comparable(commune);
  const found = list.find(item => comparable(item.name) === target);
  if (!found) throw new Error(`البلدية «${commune}» غير متاحة في EcoTrack لهذه الولاية`);
  return found;
}

async function createParcel(order, config) {
  requireToken(config);
  const phone = normalizePhone(order.phone);
  if (!/^0[5-7]\d{8}$/.test(phone)) throw new Error('رقم الهاتف غير صالح لـ EcoTrack');
  const code = ecoWilayaId(order.willaya);
  if (!code || !order.baladia) throw new Error('الولاية والبلدية مطلوبتان قبل رفع الشحنة');
  const commune = await matchCommune(order.willaya, order.baladia, config);
  const body = {
    reference: String(order.id),
    nom_client: order.full_name || 'زبون متجر الكاكي',
    telephone: phone,
    adresse: `${commune.name} - ${order.willaya}`,
    commune: commune.name,
    code_wilaya: code,
    montant: Math.round(Number(order.price || 0)),
    produit: order.product_name || 'بذور الكاكي الفاخرة',
    type: 1,
    stop_desk: order.delivery_type === 'stop_desk' ? 1 : 0,
    stock: 0,
    remarque: `Ecom12 ${order.id}`,
    poids: 1
  };
  const data = await requestJson(`${config.baseUrl}/create/order`, { method: 'POST', headers: headers(config), body: JSON.stringify(body) });
  const tracking = data.tracking || data.reference || data.tracking_number || data.order_id || data.data?.reference || data.data?.tracking;
  if (!tracking) throw new Error('تم قبول الطلب لكن لم يصل رقم التتبع من EcoTrack');
  return { tracking: String(tracking), payload: body, response: data };
}

async function listOrders(config, page = 1, limit = 100) {
  requireToken(config);
  return requestJson(`${config.baseUrl}/get/orders?page=${page}&limit=${limit}`, { headers: headers(config) });
}

async function cancelParcel(tracking, config) {
  requireToken(config);
  return requestJson(`${config.baseUrl}/delete/order?tracking=${encodeURIComponent(tracking)}`, { method: 'DELETE', headers: headers(config) });
}

async function getFees(config) {
  requireToken(config);
  const data = await requestJson(`${config.baseUrl}/get/fees`, { headers: headers(config) });
  return Array.isArray(data?.livraison) ? data.livraison : arrayFrom(data, ['data', 'fees']);
}

async function getProducts(config) {
  requireToken(config);
  const data = await requestJson(`${config.baseUrl}/get/products/list`, { headers: headers(config) });
  return arrayFrom(data).map(item => ({
    id: String(item.id ?? item.product_id ?? item.code ?? item.reference ?? ''),
    name: String(item.name ?? item.nom ?? item.product_name ?? item.title ?? ''),
    reference: item.reference ?? item.ref ?? item.sku ?? null,
    quantity: Number(item.quantity ?? item.quantite ?? item.stock ?? item.available ?? 0) || 0,
    active: item.active !== false && item.is_active !== false && item.deleted !== true
  })).filter(item => item.id && item.name && item.active);
}

function normalizeStatus(value) {
  const status = clean(value);
  if (/retour|return/.test(status)) return 'returning';
  if (/cancel|annul/.test(status)) return 'cancelled';
  if (/echec|refus|absent|failed/.test(status)) return 'failed_delivery';
  if (/livr|delivered|encaiss|pay/.test(status)) return 'delivered';
  if (/cours|transit|hub|picked|ramass|transferred|vers_/.test(status)) return 'in_transit';
  if (/livraison|out_for/.test(status)) return 'out_for_delivery';
  if (/pret|ready|created|pending|recu/.test(status)) return 'ready';
  return status || 'unknown';
}

module.exports = { getSettings, normalizePhone, createParcel, listOrders, cancelParcel, getFees, getProducts, getCommunes, normalizeStatus, officialWilayaId, ecoWilayaId };

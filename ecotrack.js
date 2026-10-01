const OFFICIAL_TO_ECOTRACK = {
  49: 57, 50: 58, 51: 51, 52: 50, 53: 52, 54: 49, 55: 55, 56: 56, 57: 53, 58: 54
};
const ECOTRACK_TO_OFFICIAL = Object.fromEntries(Object.entries(OFFICIAL_TO_ECOTRACK).map(([official, eco]) => [eco, Number(official)]));
const COMMUNE_ALIASES = {
  mahelma: 'maalma', ouzellaguen: 'ouzellaguene', msirda: 'msirda fouaga', ouaguenoun: 'ouaguenoune', yakouren: 'yakourene',
  'ziama mansouriah': 'ziama mansouria', ziama: 'ziama mansouria', 'oued el bar': 'oued el barad', 'el harrouch': 'el arrouch',
  hamma: 'hamadi krouma', kanouar: 'kanoua', khezaras: 'khezara', "hammam n'bails": "hammam n'bail",
  'el ksir': 'ain ouksir', 'el meed': 'el houamed', 'el menaoua': 'menaa', nesmoth: 'nesmot',
  'el abiodh sidi cheikh': 'el biodh sidi cheikh', 'zemmouri el bahri': 'zemmouri', grarem: 'grarem gouga',
  oulhaca: 'oulhaca el gheraba', 'el fedjoudj boughrara': 'el fedjoudj boughrara sa'
};

function clean(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[إأآا]/g, 'ا').replace(/[يى]/g, 'ي')
    .replace(/[ة]/g, 'ه').replace(/[\s_-]+/g, ' ');
}
function comparable(value) {
  const normalized = COMMUNE_ALIASES[clean(value)] || clean(value);
  return normalized.replace(/[\'’]/g, ' ').replace(/^(les|el|al|l)\s*/i, '').replace(/[\s-]/g, '').replace(/(.)\1+/g, '$1');
}
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('213') && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  return digits;
}
function officialWilayaId(value) {
  const match = String(value || '').match(/^\s*(\d{1,2})/);
  const id = match ? Number(match[1]) : Number(value);
  return Number.isInteger(id) && id >= 1 && id <= 58 ? id : null;
}
function ecoWilayaId(value) {
  const official = officialWilayaId(value);
  return official ? (OFFICIAL_TO_ECOTRACK[official] || official) : null;
}
function officialFromEco(value) {
  const eco = Number(value);
  return ECOTRACK_TO_OFFICIAL[eco] || eco;
}

async function getSettings(pool) {
  const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('ecotrack_provider','ecotrack_token','ecotrack_url','ecotrack_key','ecotrack_store')");
  const values = Object.fromEntries(result.rows.map(row => [row.key, row.value]));
  const provider = String(values.ecotrack_provider || process.env.ECOTRACK_PROVIDER || 'navexdelivery').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const token = String(values.ecotrack_token || values.ecotrack_key || process.env.ECOTRACK_API_TOKEN || '').trim();
  const configuredUrl = values.ecotrack_url || process.env.ECOTRACK_API_URL || '';
  const baseUrl = String(configuredUrl || `https://${provider}.ecotrack.dz/api/v1`).replace(/\/$/, '');
  return { provider, token, baseUrl, store: values.ecotrack_store || process.env.ECOTRACK_STORE_ID || '' };
}
function requireToken(config) {
  if (!config.token || config.token.startsWith('YOUR_')) throw new Error('توكن EcoTrack غير مضبوط. احفظه من إعدادات لوحة الإدارة أو Vercel Environment Variables.');
}
function headers(config, json = false) {
  const result = { Authorization: `Bearer ${config.token}`, Accept: 'application/json' };
  if (json) result['Content-Type'] = 'application/json';
  return result;
}
function withQuery(base, params = {}) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.toString();
}
async function requestRaw(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/pdf')) {
    const binary = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      const error = new Error(`EcoTrack رفض الطلب (${response.status})`);
      error.status = response.status;
      error.retryAfter = response.headers.get('retry-after');
      throw error;
    }
    return { data: binary, headers: Object.fromEntries(response.headers.entries()), contentType };
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`EcoTrack رفض الطلب (${response.status})${text ? `: ${text.slice(0, 400)}` : ''}`);
    error.status = response.status;
    error.data = data;
    error.retryAfter = response.headers.get('retry-after');
    throw error;
  }
  return { data, headers: Object.fromEntries(response.headers.entries()), contentType };
}
async function requestJson(url, options = {}) {
  return (await requestRaw(url, options)).data;
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

async function validateToken(config) {
  requireToken(config);
  return requestJson(withQuery(`${config.baseUrl}/validate/token`, { api_token: config.token }), { headers: headers(config) });
}
async function getWilayas(config) {
  requireToken(config);
  const data = await requestJson(`${config.baseUrl}/get/wilayas`, { headers: headers(config) });
  return arrayFrom(data, ['data', 'wilayas']).map(item => ({ id: officialFromEco(item.wilaya_id ?? item.id), ecoId: Number(item.wilaya_id ?? item.id), name: String(item.wilaya_name ?? item.name ?? '').trim() })).filter(item => item.id && item.name);
}
async function getCommunes(wilaya, config) {
  requireToken(config);
  const code = ecoWilayaId(wilaya);
  if (!code) throw new Error('رقم الولاية غير صالح لـ EcoTrack');
  const data = await requestJson(withQuery(`${config.baseUrl}/get/communes`, { wilaya_id: code }), { headers: headers(config) });
  return arrayFrom(data, ['data', 'communes']).map(item => ({
    name: String(item.nom || item.name || item.commune_name || '').trim(),
    codePostal: String(item.code_postal || item.codePostal || '').trim() || null,
    wilayaId: officialFromEco(item.wilaya_id ?? item.code_wilaya ?? code),
    hasStopDesk: Number(item.has_stop_desk ?? 0) === 1
  })).filter(item => item.name && (!item.wilayaId || item.wilayaId === officialWilayaId(wilaya)));
}
async function matchCommune(wilaya, commune, config) {
  const list = await getCommunes(wilaya, config);
  const found = list.find(item => comparable(item.name) === comparable(commune));
  if (!found) throw new Error(`البلدية «${commune}» غير متاحة في EcoTrack لهذه الولاية`);
  return found;
}
function orderParams(order, commune, config, extra = {}) {
  const phone = normalizePhone(order.phone);
  if (!/^0[5-7]\d{8}$/.test(phone)) throw new Error('رقم الهاتف غير صالح لـ EcoTrack');
  const wilayaValue = order.willaya_id ?? order.willayaId ?? order.willaya;
  const official = officialWilayaId(wilayaValue);
  const code = ecoWilayaId(wilayaValue);
  if (!code || !official || !order.baladia) throw new Error('الولاية والبلدية مطلوبتان قبل رفع الشحنة');
  return {
    reference: String(order.id || ''), nom_client: order.full_name || 'زبون المتجر', telephone: phone,
    telephone_2: order.phone_2 || '', adresse: order.address || `${commune.name} - ${order.willaya}`,
    code_postal: order.postal_code || commune.codePostal || '', commune: commune.name, code_wilaya: code,
    montant: Math.round(Number(order.price || 0) + Number(order.delivery_fee || order.deliveryFee || 0)),
    remarque: order.note || `Ecom12 ${order.id}`, produit: order.product_name || 'Produit Ecom12', boutique: config.store || '',
    type: extra.type || 1, stop_desk: extra.stop_desk ?? (order.delivery_type === 'stop_desk' ? 1 : 0),
    stock: extra.stock ?? 0, quantite: extra.quantite ?? order.quantity ?? 1, produit_a_recuperer: extra.produit_a_recuperer || '',
    weight: extra.weight ?? order.weight ?? 1, fragile: extra.fragile ?? 0, gps_link: extra.gps_link || order.gps_link || ''
  };
}
async function createParcel(order, config) {
  requireToken(config);
  const commune = await matchCommune(order.willaya_id ?? order.willayaId ?? order.willaya, order.baladia, config);
  const params = orderParams(order, commune, config);
  const data = await requestJson(withQuery(`${config.baseUrl}/create/order`, params), { method: 'POST', headers: headers(config) });
  const tracking = data.tracking || data.reference || data.tracking_number || data.order_id || data.data?.reference || data.data?.tracking;
  if (!tracking) throw new Error('تم قبول الطلب لكن لم يصل رقم التتبع من EcoTrack');
  return { tracking: String(tracking), payload: params, response: data };
}
async function updateParcel(tracking, fields, config) {
  requireToken(config);
  const data = await requestJson(withQuery(`${config.baseUrl}/update/order`, { tracking, ...fields }), { method: 'POST', headers: headers(config) });
  return data;
}
async function validateParcel(tracking, pickup, config) {
  requireToken(config);
  return requestJson(withQuery(`${config.baseUrl}/valid/order`, { tracking, pickup: pickup ? 1 : 0 }), { method: 'POST', headers: headers(config) });
}
async function deleteParcel(tracking, config) {
  requireToken(config);
  return requestJson(withQuery(`${config.baseUrl}/delete/order`, { tracking }), { method: 'DELETE', headers: headers(config) });
}
async function addUpdate(tracking, content, config) {
  requireToken(config);
  return requestJson(withQuery(`${config.baseUrl}/add/maj`, { tracking, content }), { method: 'POST', headers: headers(config) });
}
async function getUpdates(tracking, config) {
  requireToken(config);
  return requestJson(withQuery(`${config.baseUrl}/get/maj`, { tracking }), { method: 'POST', headers: headers(config) });
}
async function getTrackingInfo(tracking, config) {
  requireToken(config);
  return requestJson(withQuery(`${config.baseUrl}/get/tracking/info`, { tracking }), { headers: headers(config) });
}
async function getTrackingsInfo(trackings, config) {
  requireToken(config);
  const url = new URL(`${config.baseUrl}/get/trackings/info`);
  for (const tracking of trackings) url.searchParams.append('trackings[]', tracking);
  return requestJson(url.toString(), { headers: headers(config) });
}
async function askReturn(tracking, config) {
  requireToken(config);
  return requestJson(withQuery(`${config.baseUrl}/ask/for/order/return`, { tracking }), { method: 'POST', headers: headers(config) });
}
async function validateReturns(trackings, config) {
  requireToken(config);
  return requestJson(`${config.baseUrl}/valid/returns`, { method: 'POST', headers: headers(config, true), body: JSON.stringify({ trackings }) });
}
async function getLabel(tracking, config) {
  requireToken(config);
  return requestRaw(withQuery(`${config.baseUrl}/get/order/label`, { tracking }), { headers: headers(config) });
}
async function listOrders(config, page = 1, filters = {}) {
  requireToken(config);
  return requestJson(withQuery(`${config.baseUrl}/get/orders`, { page, ...filters }), { headers: headers(config) });
}
async function listOrdersByStatus(config, filters = {}) {
  requireToken(config);
  return requestJson(withQuery(`${config.baseUrl}/get/orders/status`, filters), { headers: headers(config) });
}
async function getDesks(config) {
  requireToken(config);
  return requestJson(`${config.baseUrl}/get/desks`, { headers: headers(config) });
}
async function getFees(config) {
  requireToken(config);
  const data = await requestJson(`${config.baseUrl}/get/fees`, { headers: headers(config) });
  return Array.isArray(data?.livraison) ? data.livraison : arrayFrom(data, ['data', 'fees']);
}
function normalizeFees(rawFees) {
  return (Array.isArray(rawFees) ? rawFees : []).map(item => {
    const rawId = item?.wilaya_id ?? item?.code_wilaya ?? item?.wilaya ?? item?.code ?? item?.id;
    const match = String(rawId ?? '').match(/\d{1,2}/); const ecoId = match ? Number(match[0]) : 0;
    const number = value => { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0; };
    return { wilayaId: officialFromEco(ecoId), ecoWilayaId: ecoId, home: number(item?.tarif ?? item?.price ?? item?.home ?? item?.tarif_domicile ?? item?.tarif_home ?? item?.delivery_fee), stopDesk: number(item?.tarif_stopdesk ?? item?.stop_desk ?? item?.stopdesk ?? item?.price_stopdesk ?? item?.tarif_bureau ?? item?.price ?? item?.tarif ?? item?.home) };
  }).filter(item => item.wilayaId >= 1 && item.wilayaId <= 58 && (item.home > 0 || item.stopDesk > 0));
}
async function getProducts(config) {
  requireToken(config);
  const data = await requestJson(`${config.baseUrl}/get/products/list`, { headers: headers(config) });
  return arrayFrom(data).map(item => ({ id: String(item.id ?? item.product_id ?? item.code ?? item.reference ?? ''), name: String(item.name ?? item.nom ?? item.product_name ?? item.title ?? ''), reference: item.reference ?? item.ref ?? item.sku ?? null, quantity: Number(item.quantity ?? item.quantite ?? item.stock ?? item.available ?? 0) || 0, active: item.active !== false && item.is_active !== false && item.deleted !== true })).filter(item => item.id && item.name && item.active);
}
function normalizeStatus(value) {
  const status = clean(value);
  if (/retour|return/.test(status)) return 'returning';
  if (/cancel|annul/.test(status)) return 'cancelled';
  if (/echec|refus|absent|failed/.test(status)) return 'failed_delivery';
  if (/livr|delivered|encaiss|pay|paye/.test(status)) return 'delivered';
  if (/cours|transit|hub|picked|ramass|transferred|vers/.test(status)) return 'in_transit';
  if (/livraison|out_for/.test(status)) return 'out_for_delivery';
  if (/pret|ready|created|pending|recu/.test(status)) return 'ready';
  return status || 'unknown';
}

module.exports = { getSettings, validateToken, getWilayas, getCommunes, getDesks, getFees, normalizeFees, getProducts, createParcel, updateParcel, validateParcel, deleteParcel, addUpdate, getUpdates, getTrackingInfo, getTrackingsInfo, askReturn, validateReturns, getLabel, listOrders, listOrdersByStatus, normalizeStatus, normalizePhone, officialWilayaId, ecoWilayaId };

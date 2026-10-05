'use strict';

// Telegram is an outbound integration only. It deliberately has no database access;
// credentials and the operations chat are supplied by the runtime environment.
const TELEGRAM_API_TIMEOUT_MS = 3000;

function telegramConfiguration(env = process.env) {
  return {
    token: String(env.TELEGRAM_BOT_TOKEN || '').trim(),
    chatId: String(env.TELEGRAM_CHAT_ID || '').trim()
  };
}

async function sendTelegramMessage(text, options = {}) {
  const { token, chatId } = telegramConfiguration(options.env);
  if (!token || !chatId) return { sent: false, reason: 'not_configured' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      const error = new Error(`Telegram sendMessage failed (HTTP ${response.status})`);
      error.code = 'TELEGRAM_DELIVERY_FAILED';
      throw error;
    }
    return { sent: true, messageId: result.result?.message_id || null };
  } finally {
    clearTimeout(timeout);
  }
}

async function notifyNewOrder(order, options = {}) {
  const lines = [
    'طلب جديد في Maison Vert',
    `رقم الطلب: ${order.id}`,
    `الزبون: ${order.full_name || 'غير محدد'}`,
    `الهاتف: ${order.phone}`,
    `المنتج: ${order.product_name || 'غير محدد'}`,
    `الكمية: ${Number(order.quantity) || 1}`,
    `السعر: ${Number(order.price) || 0} دج`
  ];
  return sendTelegramMessage(lines.join('\n'), options);
}

async function notifyNewLead(lead, options = {}) {
  const lines = [
    'عميل مهتم - طلب غير مكتمل',
    `رقم العميل: ${lead.id}`,
    `الاسم: ${lead.full_name || 'غير مسجل بعد'}`,
    `الهاتف: ${lead.phone}`,
    `الولاية والبلدية: ${[lead.willaya, lead.baladia].filter(Boolean).join(' · ') || 'غير مكتمل'}`,
    `المنتج: ${lead.product_name || 'غير محدد'}`
  ];
  return sendTelegramMessage(lines.join('\n'), options);
}

module.exports = { sendTelegramMessage, notifyNewLead, notifyNewOrder };

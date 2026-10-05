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

function isTelegramConfigured(env = process.env) {
  const { token, chatId } = telegramConfiguration(env);
  return Boolean(token && chatId);
}

async function telegramRequest(method, parameters, options = {}) {
  const { token, chatId } = telegramConfiguration(options.env);
  if (!token || !chatId) return { sent: false, reason: 'not_configured', messageId: null };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, ...parameters }),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (result.ok === false && /message is not modified/i.test(result.description || '')) {
      return { sent: true, unchanged: true, messageId: parameters.message_id || null };
    }
    if (!response.ok || result.ok !== true) {
      const error = new Error(`Telegram ${method} failed (HTTP ${response.status})`);
      error.code = 'TELEGRAM_DELIVERY_FAILED';
      throw error;
    }
    return { sent: true, messageId: result.result?.message_id || parameters.message_id || null };
  } finally {
    clearTimeout(timeout);
  }
}

function orderMessage(order) {
  const lines = [
    '✅ طلب مكتمل - Maison Vert',
    `رقم الطلب: ${order.id}`,
    `الزبون: ${order.full_name || 'غير محدد'}`,
    `الهاتف: ${order.phone}`,
    `المنتج: ${order.product_name || 'غير محدد'}`,
    `الكمية: ${Number(order.quantity) || 1}`,
    `السعر: ${Number(order.price) || 0} دج`
  ];
  return lines.join('\n');
}

function leadProgressMessage(lead) {
  const lines = [
    '📝 محاولة تعبئة طلب - غير مكتمل',
    `رقم العميل: ${lead.id}`,
    `الاسم: ${lead.full_name || 'غير مسجل بعد'}`,
    `الهاتف: ${lead.phone}`,
    `الولاية والبلدية: ${[lead.willaya, lead.baladia].filter(Boolean).join(' · ') || 'غير مكتمل'}`,
    `المنتج: ${lead.product_name || 'غير محدد'}`
  ];
  return lines.join('\n');
}

async function updateOrSendMessage(text, messageId, options = {}) {
  if (messageId) {
    return telegramRequest('editMessageText', { message_id: Number(messageId), text }, options);
  }
  return telegramRequest('sendMessage', { text }, options);
}

async function notifyLeadProgress(lead, options = {}) {
  return updateOrSendMessage(leadProgressMessage(lead), lead.telegram_message_id, options);
}

async function notifyOrderComplete(order, messageId, options = {}) {
  return updateOrSendMessage(orderMessage(order), messageId, options);
}

module.exports = {
  notifyLeadProgress,
  notifyOrderComplete,
  isTelegramConfigured,
  orderMessage,
  leadProgressMessage
};

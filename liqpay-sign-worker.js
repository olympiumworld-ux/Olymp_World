/**
 * liqpay-sign-worker.js
 * ---------------------
 * Маленький безкоштовний сервер (Cloudflare Worker), який підписує платіж LiqPay,
 * не розкриваючи private_key у браузері гравця. Сайт (olymp-world.html) звертається
 * сюди, отримує {data, signature} і відкриває офіційний віджет оплати LiqPay.
 *
 * ЯК ПІДКЛЮЧИТИ (займає ~5 хвилин):
 *
 * 1. Зареєструйся на https://www.liqpay.ua — приватна особа теж може створити акаунт.
 *    В особистому кабінеті знайди "Мій магазин" → там будуть public_key і private_key.
 *
 * 2. Зареєструйся на https://workers.cloudflare.com (безкоштовно, без картки для базового тарифу).
 *
 * 3. Створи новий Worker, встав сюди весь цей файл замість шаблонного коду.
 *
 * 4. Заповни PUBLIC_KEY нижче своїм публічним ключем (він не секретний, можна прямо в коді).
 *
 * 5. private_key НЕ вставляй сюди в код. Замість цього:
 *    Worker → Settings → Variables and Secrets → Add → Type: Secret →
 *    Name: LIQPAY_PRIVATE_KEY → Value: (встав свій private_key) → Save.
 *
 * 6. Заміни ALLOWED_ORIGIN нижче на домен свого сайту (наприклад https://olympworld.fun),
 *    щоб інші сайти не могли смикати твій воркер.
 *
 * 7. Задеплой (Deploy). Скопіюй URL воркера (типу https://xxxxx.workers.dev)
 *    і встав його в LIQPAY_SIGN_ENDPOINT у olymp-world.html, поруч із LIQPAY_PUBLIC_KEY.
 *
 * Готово — кнопка "Продовжити" на сайті почне відкривати справжню оплату карткою.
 */

const PUBLIC_KEY = 'ВСТАВ_СЮДИ_PUBLIC_KEY'; // напр. 'i00000000'
const ALLOWED_ORIGIN = 'https://olympworld.fun'; // домен твого сайту

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    if (!env.LIQPAY_PRIVATE_KEY) {
      return new Response(
        JSON.stringify({ error: 'LIQPAY_PRIVATE_KEY не задан в Worker Secrets' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Некорректный JSON' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const amount = Number(body.amount);
    const nick = String(body.nick || 'player').slice(0, 64).replace(/[^\w\-]/g, '_');

    if (!amount || amount < 1 || amount > 100000) {
      return new Response(JSON.stringify({ error: 'Некорректная сумма' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = {
      version: 3,
      public_key: PUBLIC_KEY,
      action: 'pay',
      amount: amount,
      currency: 'UAH',
      description: `Донат Olymp World — ${nick}`,
      order_id: `olymp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // result_url: 'https://olympworld.fun/pay-thanks', // опційно: куди повернути гравця після оплати
      // server_url: 'https://твій-воркер/callback',      // опційно: сюди LiqPay пришле статус платежу
    };

    const dataStr = base64Encode(JSON.stringify(payload));
    const signature = await signLiqPay(dataStr, env.LIQPAY_PRIVATE_KEY);

    return new Response(JSON.stringify({ data: dataStr, signature }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};

// base64 для UTF-8 рядків (щоб коректно кодувались кириличні нікнейми в description)
function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

// Підпис за схемою LiqPay: base64( sha1( private_key + data + private_key ) )
async function signLiqPay(data, privateKey) {
  const raw = privateKey + data + privateKey;
  const bytes = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-1', bytes);
  const hashBytes = new Uint8Array(hashBuffer);
  let binary = '';
  hashBytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

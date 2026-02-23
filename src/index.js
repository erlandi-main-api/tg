const DEFAULT_LANG = "id"; // default target language
const LANGS = [
  ["🇮🇩 ID", "id"],
  ["🇬🇧 EN", "en"],
  ["🇯🇵 JA", "ja"],
  ["🇰🇷 KO", "ko"],
  ["🇨🇳 ZH", "zh-CN"],
  ["🇷🇺 RU", "ru"],
  ["🇹🇭 TH", "th"],
  ["🇻🇳 VI", "vi"],
  ["🇸🇦 AR", "ar"],
  ["🇫🇷 FR", "fr"],
  ["🇩🇪 DE", "de"],
  ["🇪🇸 ES", "es"],
];

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Translate Bot OK");

    const update = await request.json();

    // ===== handle buttons =====
    if (update.callback_query) {
      await handleCallback(env, update.callback_query);
      return new Response("ok");
    }

    if (!update.message) return new Response("ok");

    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text || "";

    // ===== commands (only /start & /help) =====
    if (text.startsWith("/start")) {
      await sendStart(env, chatId);
      return new Response("ok");
    }

    if (text.startsWith("/help")) {
      await sendMenu(env, chatId);
      return new Response("ok");
    }

    // ignore ALL other commands to keep it clean/professional
    if (text.startsWith("/")) return new Response("ok");

    // ===== auto translate normal text =====
    // Load per-chat config
    const cfg = await getChatConfig(env, chatId);

    // If auto OFF, do nothing
    if (!cfg.on) return new Response("ok");

    // Prevent loops: don't translate messages that look like our output
    if (text.startsWith("🌍 ")) return new Response("ok");

    // Translate
    const result = await gTranslate(text, cfg.lang);

    const from = (result.detectedLang || "??").toUpperCase();
    const to = (cfg.lang || "??").toUpperCase();

    const fromFlag = getFlag(result.detectedLang);
    const toFlag = getFlag(cfg.lang);

    // Professional output (short & clear)
    await sendMessage(
      env,
      chatId,
      `🌍 ${fromFlag} ${from} ➜ ${toFlag} ${to}\n\n${result.translated}`
    );

    return new Response("ok");
  },
};

// ================== CALLBACKS / BUTTON MENU ==================

async function handleCallback(env, cq) {
  const chatId = cq.message?.chat?.id;
  const data = cq.data || "";
  if (!chatId) return;

  // stop loading spinner on button
  await answerCallbackQuery(env, cq.id);

  // Get config
  let cfg = await getChatConfig(env, chatId);

  if (data === "TOGGLE_ON") {
    cfg.on = true;
    await setChatConfig(env, chatId, cfg);
    await editMenu(env, chatId, cq.message.message_id, cfg);
    return;
  }

  if (data === "TOGGLE_OFF") {
    cfg.on = false;
    await setChatConfig(env, chatId, cfg);
    await editMenu(env, chatId, cq.message.message_id, cfg);
    return;
  }

  if (data === "SHOW_MENU") {
    await editMenu(env, chatId, cq.message.message_id, cfg);
    return;
  }

  if (data.startsWith("SET_LANG:")) {
    const lang = data.split(":")[1] || DEFAULT_LANG;
    cfg.lang = lang;
    await setChatConfig(env, chatId, cfg);
    await editMenu(env, chatId, cq.message.message_id, cfg);
    return;
  }

  if (data === "HOW_GROUP") {
    await sendMessage(
      env,
      chatId,
      `📌 Info Group\n\n` +
        `Agar bot bisa membaca semua pesan di group (bukan hanya command), matikan privacy mode:\n` +
        `BotFather → /mybots → pilih bot → Bot Settings → Group Privacy → Turn off`
    );
    return;
  }
}

// ================== MENU UI ==================

async function sendStart(env, chatId) {
  const cfg = await getChatConfig(env, chatId);

  await sendMessage(
    env,
    chatId,
    `👋 Halo! Saya Bot Translate.\n\n` +
      `Cara pakai:\n` +
      `1) Ketik /help untuk buka menu.\n` +
      `2) Pilih bahasa tujuan (target).\n` +
      `3) Nyalakan Auto Translate.\n\n` +
      `Kalau Auto ON, setiap pesan teks akan otomatis saya terjemahkan.\n\n` +
      `Status saat ini:\n` +
      `• Auto: ${cfg.on ? "ON ✅" : "OFF ❌"}\n` +
      `• Target: ${cfg.lang.toUpperCase()}`
  );

  // show menu after greeting
  await sendMenu(env, chatId);
}

async function sendMenu(env, chatId) {
  const cfg = await getChatConfig(env, chatId);

  const keyboard = buildKeyboard(cfg);

  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: menuText(cfg),
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

async function editMenu(env, chatId, messageId, cfg) {
  const keyboard = buildKeyboard(cfg);

  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: menuText(cfg),
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

function menuText(cfg) {
  return (
    `⚙️ Translate Settings\n\n` +
    `• Auto: ${cfg.on ? "ON ✅" : "OFF ❌"}\n` +
    `• Target language: ${cfg.lang.toUpperCase()}\n\n` +
    `Pilih target bahasa & ON/OFF lewat tombol di bawah.`
  );
}

function buildKeyboard(cfg) {
  // Language buttons (split into rows)
  const rows = [];
  const langButtons = LANGS.map(([label, code]) => ({
    text: (code === cfg.lang ? `✅ ${label}` : label),
    callback_data: `SET_LANG:${code}`,
  }));

  for (let i = 0; i < langButtons.length; i += 3) {
    rows.push(langButtons.slice(i, i + 3));
  }

  // Toggle row
  rows.push([
    { text: cfg.on ? "✅ Auto ON" : "Auto ON", callback_data: "TOGGLE_ON" },
    { text: !cfg.on ? "✅ Auto OFF" : "Auto OFF", callback_data: "TOGGLE_OFF" },
  ]);

  // Help row
  rows.push([{ text: "📌 Info untuk Group", callback_data: "HOW_GROUP" }]);

  return rows;
}

// ================== STORAGE (KV) ==================

async function getChatConfig(env, chatId) {
  const key = `cfg:${chatId}`;
  const raw = await env.FILES.get(key);
  if (!raw) return { on: false, lang: DEFAULT_LANG };

  try {
    const cfg = JSON.parse(raw);
    return {
      on: typeof cfg.on === "boolean" ? cfg.on : false,
      lang: typeof cfg.lang === "string" ? cfg.lang : DEFAULT_LANG,
    };
  } catch {
    return { on: false, lang: DEFAULT_LANG };
  }
}

async function setChatConfig(env, chatId, cfg) {
  const key = `cfg:${chatId}`;
  await env.FILES.put(key, JSON.stringify({ on: !!cfg.on, lang: cfg.lang || DEFAULT_LANG }));
}

// ================== TRANSLATE (Google unofficial) ==================

async function gTranslate(text, targetLang) {
  try {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx` +
      `&sl=auto&tl=${encodeURIComponent(targetLang)}` +
      `&dt=t&q=${encodeURIComponent(text)}`;

    const res = await fetch(url);
    const data = await res.json();

    const translated = Array.isArray(data?.[0])
      ? data[0].map((x) => x?.[0]).filter(Boolean).join("")
      : "Gagal translate.";

    const detectedLang = (data?.[2] || "unknown").toLowerCase();

    return { translated, detectedLang };
  } catch {
    return { translated: "Gagal translate.", detectedLang: "unknown" };
  }
}

function getFlag(lang) {
  if (!lang) return "🌐";
  const l = lang.toLowerCase();

  // Some special cases
  if (l.startsWith("zh")) return "🇨🇳";
  if (l === "en") return "🇬🇧";
  if (l.length !== 2) return "🌐";

  const codePoints = [...l.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// ================== TELEGRAM HELPERS ==================

async function sendMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function answerCallbackQuery(env, id) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id }),
  });
  }

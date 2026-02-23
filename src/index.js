const DEFAULT_LANG = "id"; // default target language

// Add / remove languages here (label, code). Keep codes compatible with Google Translate.
const LANGS = [
  ["🇮🇩 ID", "id"],
  ["🇬🇧 EN", "en"],
  ["🇲🇾 MS", "ms"],
  ["🇹🇭 TH", "th"],
  ["🇻🇳 VI", "vi"],
  ["🇵🇭 TL", "tl"],
  ["🇸🇬 ZH", "zh-CN"],
  ["🇹🇼 ZH-TW", "zh-TW"],
  ["🇯🇵 JA", "ja"],
  ["🇰🇷 KO", "ko"],
  ["🇮🇳 HI", "hi"],
  ["🇧🇩 BN", "bn"],
  ["🇵🇰 UR", "ur"],
  ["🇸🇦 AR", "ar"],
  ["🇮🇷 FA", "fa"],
  ["🇮🇱 HE", "he"],
  ["🇷🇺 RU", "ru"],
  ["🇺🇦 UK", "uk"],
  ["🇹🇷 TR", "tr"],
  ["🇬🇷 EL", "el"],
  ["🇫🇷 FR", "fr"],
  ["🇩🇪 DE", "de"],
  ["🇪🇸 ES", "es"],
  ["🇮🇹 IT", "it"],
  ["🇵🇹 PT", "pt"],
  ["🇧🇷 PT-BR", "pt-BR"],
  ["🇳🇱 NL", "nl"],
  ["🇸🇪 SV", "sv"],
  ["🇳🇴 NO", "no"],
  ["🇩🇰 DA", "da"],
  ["🇫🇮 FI", "fi"],
  ["🇵🇱 PL", "pl"],
  ["🇨🇿 CS", "cs"],
  ["🇭🇺 HU", "hu"],
  ["🇷🇴 RO", "ro"],
];

const PAGE_SIZE = 12; // how many language buttons per page

// About / links
const GITHUB_USER = "erlandi-main-api";
const GITHUB_PROFILE_URL = `https://github.com/${GITHUB_USER}`;
const BOT_TECH_URL = "https://developers.cloudflare.com/workers/";
const TRANSLATE_ENDPOINT_URL = "https://translate.googleapis.com/";

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
      const name = msg.from?.first_name || "kak";
      await sendStart(env, chatId, name);
      return new Response("ok");
    }

    if (text.startsWith("/help")) {
      await sendMenu(env, chatId, 0);
      return new Response("ok");
    }

    // ignore ALL other commands to keep it clean/professional
    if (text.startsWith("/")) return new Response("ok");

    // ===== auto translate normal text =====
    const cfg = await getChatConfig(env, chatId);

    if (!cfg.on) return new Response("ok");

    // Prevent loops: don't translate messages that look like our output
    if (text.startsWith("🌍 ")) return new Response("ok");

    const result = await gTranslate(text, cfg.lang);

    const from = (result.detectedLang || "??").toUpperCase();
    const to = (cfg.lang || "??").toUpperCase();

    const fromFlag = getFlag(result.detectedLang);
    const toFlag = getFlag(cfg.lang);

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

  // page navigation
  if (data.startsWith("PAGE:")) {
    const page = parseInt(data.split(":")[1] || "0", 10);
    await editMenu(env, chatId, cq.message.message_id, cfg, clampPage(page));
    return;
  }

  if (data === "TOGGLE_ON") {
    cfg.on = true;
    await setChatConfig(env, chatId, cfg);
    await editMenu(env, chatId, cq.message.message_id, cfg, 0);
    return;
  }

  if (data === "TOGGLE_OFF") {
    cfg.on = false;
    await setChatConfig(env, chatId, cfg);
    await editMenu(env, chatId, cq.message.message_id, cfg, 0);
    return;
  }

  if (data.startsWith("SET_LANG:")) {
    const lang = data.split(":")[1] || DEFAULT_LANG;
    cfg.lang = lang;
    await setChatConfig(env, chatId, cfg);
    const page = guessLangPage(lang);
    await editMenu(env, chatId, cq.message.message_id, cfg, page);
    return;
  }

  if (data === "ABOUT_BOT") {
    await sendMessage(env, chatId, aboutText());
    return;
  }
}

// ================== MENU UI ==================

async function sendStart(env, chatId, firstName) {
  const cfg = await getChatConfig(env, chatId);

  await sendMessage(
    env,
    chatId,
    `👋✨ Haii ${escapeText(firstName)}! 🤖💬\n\n` +
      `Aku bot penerjemah otomatis 🌍⚡\n` +
      `Biar gampang, ikuti langkah ini yaa 😄👇\n\n` +
      `1️⃣ Ketik /help untuk buka menu 🧭\n` +
      `2️⃣ Pilih bahasa tujuan (target) 🏁\n` +
      `3️⃣ Nyalakan Auto Translate ✅\n\n` +
      `Kalau Auto ON, setiap pesan teks akan otomatis aku terjemahkan 🪄📝\n\n` +
      `📌 Status saat ini:\n` +
      `• Auto: ${cfg.on ? "ON ✅" : "OFF ❌"}\n` +
      `• Target: ${cfg.lang.toUpperCase()} 🎯`
  );

  await sendMenu(env, chatId, 0);
}

async function sendMenu(env, chatId, page) {
  const cfg = await getChatConfig(env, chatId);
  const keyboard = buildKeyboard(cfg, page);

  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: menuText(cfg, page),
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

async function editMenu(env, chatId, messageId, cfg, page) {
  const keyboard = buildKeyboard(cfg, page);

  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: menuText(cfg, page),
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

function menuText(cfg, page) {
  const totalPages = getTotalPages();
  const p = page + 1;
  const t = totalPages;
  return (
    `⚙️ Translate Settings\n\n` +
    `• Auto: ${cfg.on ? "ON ✅" : "OFF ❌"}\n` +
    `• Target language: ${cfg.lang.toUpperCase()}\n\n` +
    `Pilih target bahasa & ON/OFF lewat tombol.\n` +
    `Bahasa (page ${p}/${t}):`
  );
}

function buildKeyboard(cfg, page) {
  const rows = [];

  // language buttons (paged)
  const slice = getLangSlice(page);
  const langButtons = slice.map(([label, code]) => ({
    text: code === cfg.lang ? `✅ ${label}` : label,
    callback_data: `SET_LANG:${code}`,
  }));

  for (let i = 0; i < langButtons.length; i += 3) {
    rows.push(langButtons.slice(i, i + 3));
  }

  // pagination row
  const totalPages = getTotalPages();
  if (totalPages > 1) {
    const prev = clampPage(page - 1);
    const next = clampPage(page + 1);
    rows.push([
      { text: "⬅️ Prev", callback_data: `PAGE:${prev}` },
      { text: `📄 ${page + 1}/${totalPages}`, callback_data: `PAGE:${page}` },
      { text: "Next ➡️", callback_data: `PAGE:${next}` },
    ]);
  }

  // toggle row
  rows.push([
    { text: cfg.on ? "✅ Auto ON" : "Auto ON", callback_data: "TOGGLE_ON" },
    { text: !cfg.on ? "✅ Auto OFF" : "Auto OFF", callback_data: "TOGGLE_OFF" },
  ]);

  // about row (replaces group info)
  rows.push([{ text: "✨ Tentang Bot", callback_data: "ABOUT_BOT" }]);

  return rows;
}

// ================== ABOUT TEXT ==================

function aboutText() {
  return (
    `✨ Tentang Bot\n\n` +
    `🤖 Dibuat dengan:\n` +
    `• JavaScript (Cloudflare Workers) ⚡\n` +
    `• Auto-translate via Google Translate endpoint 🌍\n\n` +
    `🔗 Link referensi:\n` +
    `• Cloudflare Workers: ${BOT_TECH_URL}\n` +
    `• Translate endpoint: ${TRANSLATE_ENDPOINT_URL}\n\n` +
    `👤 GitHub saya:\n` +
    `• ${GITHUB_PROFILE_URL}\n` +
    `(@${GITHUB_USER})`
  );
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
  await env.FILES.put(
    key,
    JSON.stringify({ on: !!cfg.on, lang: cfg.lang || DEFAULT_LANG })
  );
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

  if (l.startsWith("zh")) return "🇨🇳";
  if (l === "en") return "🇬🇧";
  if (l.length !== 2) return "🌐";

  const codePoints = [...l.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// ================== PAGINATION HELPERS ==================

function getTotalPages() {
  return Math.max(1, Math.ceil(LANGS.length / PAGE_SIZE));
}

function clampPage(page) {
  const total = getTotalPages();
  if (Number.isNaN(page)) return 0;
  if (page < 0) return 0;
  if (page > total - 1) return total - 1;
  return page;
}

function getLangSlice(page) {
  const p = clampPage(page);
  const start = p * PAGE_SIZE;
  return LANGS.slice(start, start + PAGE_SIZE);
}

function guessLangPage(lang) {
  const idx = LANGS.findIndex((x) => x[1].toLowerCase() === String(lang).toLowerCase());
  if (idx < 0) return 0;
  return clampPage(Math.floor(idx / PAGE_SIZE));
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

// Keep Telegram messages safe (very light escaping)
function escapeText(s) {
  return String(s || "").replace(/[\r\n\t]/g, " ").trim();
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    const update = await request.json();

    // Optional: if you later add inline buttons, Telegram sends callback_query.
    if (update.callback_query) {
      try { await answerCallbackQuery(env, update.callback_query.id); } catch {}
      try { await sendHelp(env, update.callback_query.message.chat.id); } catch {}
      return new Response("ok");
    }

    if (!update.message) return new Response("ok");

    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || "";

    // ========= /ping =========
    if (text === "/ping") {
      await sendMessage(env, chatId, "🏓 Pong! 1 ms");
      return new Response("ok");
    }

    // ========= /help & /start =========
    if (text === "/help" || text.startsWith("/start")) {
      await sendHelp(env, chatId);
      return new Response("ok");
    }

    // ========= /stats =========
    if (text === "/stats") {
      const tg = await env.FILES.get("stats:tg") || "0";
      const tr = await env.FILES.get("stats:tr") || "0";
      const auto = await env.FILES.get("stats:auto") || "0";

      await sendMessage(
        env,
        chatId,
        `📊 Bot Statistics\n\n📝 Telegraph dibuat: ${tg}\n🌍 Translate manual: ${tr}\n⚡ Auto translate: ${auto}`
      );
      return new Response("ok");
    }

    // ========= /settr =========
    // 1) /settr id            -> set default translate user
    // 2) /settr auto id on    -> enable auto translate for this chat
    // 3) /settr auto off      -> disable auto translate for this chat
    if (text.startsWith("/settr")) {
      const args = text.replace("/settr", "").trim();
      if (!args) {
        await sendMessage(
          env,
          chatId,
          "Format:\n/settr id\n/settr auto id on\n/settr auto off"
        );
        return new Response("ok");
      }

      const parts = args.split(/\s+/);

      if (parts[0] === "auto") {
        if (parts[1] === "off") {
          await env.FILES.delete(`autotr:${chatId}`);
          await sendMessage(env, chatId, "✅ Auto translate: OFF (chat ini)");
          return new Response("ok");
        }

        const lang = (parts[1] || "").toLowerCase();
        const onoff = (parts[2] || "").toLowerCase();

        if (!lang || !onoff) {
          await sendMessage(env, chatId, "Format: /settr auto id on  atau  /settr auto off");
          return new Response("ok");
        }

        if (onoff !== "on" && onoff !== "off") {
          await sendMessage(env, chatId, "Pakai: on atau off\nContoh: /settr auto id on");
          return new Response("ok");
        }

        if (onoff === "off") {
          await env.FILES.delete(`autotr:${chatId}`);
          await sendMessage(env, chatId, "✅ Auto translate: OFF (chat ini)");
          return new Response("ok");
        }

        await env.FILES.put(`autotr:${chatId}`, JSON.stringify({ on: true, lang }));
        await sendMessage(env, chatId, `✅ Auto translate: ON (chat ini) → ${lang}\n\nSekarang semua pesan teks akan otomatis diterjemahkan.`);
        return new Response("ok");
      }

      // normal set default user language
      const lang = parts[0].toLowerCase();
      await env.FILES.put(`trlang:${userId}`, lang);
      await sendMessage(env, chatId, `✅ Default translate kamu: ${lang}`);
      return new Response("ok");
    }

    // ========= /tr (manual translate) =========
    // 1) Reply pesan + "/tr" -> pakai default (atau id)
    // 2) "/tr teks..."       -> pakai default (atau id)
    // 3) "/tr en teks..."    -> override lang
    if (text.startsWith("/tr")) {
      let targetLang = (await env.FILES.get(`trlang:${userId}`)) || "id";
      const raw = text.replace("/tr", "").trim();

      let textToTranslate = "";

      if (msg.reply_to_message?.text && !raw) {
        textToTranslate = msg.reply_to_message.text;
      } else if (raw) {
        const parts = raw.split(/\s+/);
        if (/^[a-z]{2,5}$/.test(parts[0]) && parts.length >= 2) {
          targetLang = parts[0].toLowerCase();
          textToTranslate = parts.slice(1).join(" ");
        } else {
          textToTranslate = raw;
        }
      } else {
        await sendMessage(env, chatId, "Reply pesan lalu ketik /tr\natau\n/tr id Hello world\natau\n/tr en Hello");
        return new Response("ok");
      }

      const translated = await translate(textToTranslate, targetLang);
      await increaseStat(env, "stats:tr");
      await sendMessage(env, chatId, `🌍 (${targetLang})\n\n${translated}`);
      return new Response("ok");
    }

    // ========= /tg (Telegraph) =========
    // - Reply text/caption/photo then /tg or /tg Judul
    // - Output only link (hemat)
    if (text.startsWith("/tg")) {
      const raw = text.replace("/tg", "").trim();
      const title = raw ? raw.split("\n")[0].trim() : "Telegraph Post";

      const r = msg.reply_to_message;

      let bodyText = "";
      let imagePath = "";

      if (r) {
        bodyText = (r.text || r.caption || "").trim();

        const photo = r.photo?.[r.photo.length - 1];
        if (photo) {
          try {
            imagePath = await uploadTelegramPhotoToTelegraph(env, photo.file_id);
          } catch {
            imagePath = "";
          }
        }
        // Videos are not supported by Telegraph; we only use caption/text if any.
      } else {
        // legacy mode: /tg Judul\n\nIsi...
        const lines = raw.split("\n");
        bodyText = lines.slice(1).join("\n").trim();
      }

      if (!bodyText && !imagePath) {
        await sendMessage(env, chatId, "Reply text/foto lalu /tg (atau /tg Judul).");
        return new Response("ok");
      }

      let token = await env.FILES.get("telegraph_token");
      if (!token) {
        const acc = await fetch("https://api.telegra.ph/createAccount", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ short_name: "telebot", author_name: "Tele Bot" })
        });
        const data = await acc.json();
        token = data?.result?.access_token;
        if (!token) {
          await sendMessage(env, chatId, "Gagal membuat akun Telegraph.");
          return new Response("ok");
        }
        await env.FILES.put("telegraph_token", token);
      }

      const content = [];

      if (imagePath) {
        content.push({ tag: "img", attrs: { src: `https://telegra.ph${imagePath}` } });
      }

      if (bodyText) {
        const paragraphs = bodyText
          .split("\n\n")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => ({ tag: "p", children: [p] }));
        content.push(...paragraphs);
      }

      const page = await fetch("https://api.telegra.ph/createPage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: token,
          title,
          content,
          return_content: false
        })
      });

      const result = await page.json();
      if (!result.ok) {
        await sendMessage(env, chatId, "Gagal membuat Telegraph page.");
        return new Response("ok");
      }

      await increaseStat(env, "stats:tg");
      await sendMessage(env, chatId, result.result.url); // link only
      return new Response("ok");
    }

    // ========= AUTO TRANSLATE (all text messages in chat) =========
    // Only if enabled for this chat:
    // /settr auto id on
    // /settr auto off
    if (msg.text) {
      if (msg.from?.is_bot) return new Response("ok");
      if (msg.text.startsWith("/")) return new Response("ok");
      if (msg.text.startsWith("🌍 (")) return new Response("ok"); // prevent loops

      const autoCfgStr = await env.FILES.get(`autotr:${chatId}`);
      if (autoCfgStr) {
        let cfg = null;
        try { cfg = JSON.parse(autoCfgStr); } catch {}
        if (cfg?.on && cfg?.lang) {
          const translated = await translate(msg.text, cfg.lang);
          await increaseStat(env, "stats:auto");
          await sendMessage(env, chatId, `🌍 (${cfg.lang})\n\n${translated}`);
        }
      }
    }

    return new Response("ok");
  }
};

// ===== Helpers =====

async function translate(text, lang) {
  const res = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${encodeURIComponent(lang)}`
  );
  const data = await res.json();
  return data?.responseData?.translatedText || "Gagal translate.";
}

async function increaseStat(env, key) {
  const cur = parseInt((await env.FILES.get(key)) || "0", 10);
  await env.FILES.put(key, String(cur + 1));
}

async function sendHelp(env, chatId) {
  await sendMessage(
    env,
    chatId,
`🤖 BOT HELP & TUTORIAL

✅ Commands:
• /ping
  cek bot aktif

• /help
  tampilkan bantuan

• /stats
  statistik penggunaan

📝 Telegraph:
• Reply text/foto lalu:
  /tg
  atau
  /tg Judul
  (bot output link saja)

🌍 Translate:
• /settr id
  set default bahasa translate (untuk /tr)

• Reply pesan + /tr
  translate cepat

• /tr en Hello
  translate manual (override bahasa)

⚡ Auto Translate (chat / group):
• /settr auto id on
  nyalakan auto translate semua pesan ke id

• /settr auto off
  matikan auto translate chat ini

Catatan group:
Jika auto translate di group tidak jalan, matikan Group Privacy:
BotFather → /mybots → Bot Settings → Group Privacy → Turn off
`
  );
}

async function sendMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

async function answerCallbackQuery(env, id) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id })
  });
}

async function uploadTelegramPhotoToTelegraph(env, fileId) {
  // 1) getFilePath from Telegram
  const fileRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const fileJson = await fileRes.json();
  const filePath = fileJson?.result?.file_path;
  if (!filePath) throw new Error("no file_path");

  // 2) download file bytes from Telegram CDN
  const tgFileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;
  const binRes = await fetch(tgFileUrl);
  if (!binRes.ok) throw new Error("download fail");
  const blob = await binRes.blob();

  // 3) upload to telegra.ph/upload
  const form = new FormData();
  form.append("file", blob, "image.jpg");

  const upRes = await fetch("https://telegra.ph/upload", { method: "POST", body: form });
  const upJson = await upRes.json();
  const src = upJson?.[0]?.src;
  if (!src) throw new Error("upload fail");
  return src; // like "/file/xxxx.jpg"
}

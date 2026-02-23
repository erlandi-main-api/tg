# cf-telegraph-bot (Cloudflare Worker)

Features:
- /tg (Telegraph): reply text/photo then /tg or /tg Title → outputs ONLY the Telegraph URL
- /tr (Translate): reply text then /tr, or /tr <lang> <text>
- /settr <lang>: set default translate language for yourself
- /settr auto <lang> on|off: enable/disable auto translate for a chat/group
- /ping, /help, /stats

## Setup
1) Create a Telegram bot with @BotFather, get BOT_TOKEN.
2) Create a Cloudflare KV namespace and copy its Namespace ID.
3) Put the KV Namespace ID into `wrangler.toml` (kv_namespaces.id).
4) GitHub Secrets (repo settings → Actions secrets):
   - CF_API_TOKEN: Cloudflare API Token (Workers edit)
   - BOT_TOKEN: Telegram bot token
5) Push to `main` to deploy.

## Webhook
After first deploy, set webhook:
https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>

## Group note
If auto translate should translate all messages in group:
BotFather → /mybots → Bot Settings → Group Privacy → Turn off

declare const process: { env: Record<string, string | undefined> };

type TelegramUser = { id: number; username?: string; first_name?: string };
type TelegramMessage = { message_id: number; chat: { id: number; type: string }; from?: TelegramUser; text?: string };
type TelegramUpdate = { message?: TelegramMessage; callback_query?: { id: string; from: TelegramUser; data?: string; message?: TelegramMessage } };
type MediaItem = { title?: string; name?: string; type?: string; url?: string; poster?: string; playback?: { url?: string }; date?: string; year?: string };

const DONATION_URL = process.env.PAYPAL_DONATION_URL || "https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=xhose.mj%40icloud.com&item_name=Support%20Vibble%20TV&currency_code=USD";
const ADMIN_ID = Number(process.env.TELEGRAM_ADMIN_ID || "8336433496");
const WHATSAPP_URL = process.env.WHATSAPP_COMMUNITY_URL || "https://chat.whatsapp.com/EU8WVY6ET0ME00Kon4gpPH";
const TELEGRAM_URL = process.env.TELEGRAM_COMMUNITY_URL || "https://t.me/vibbletv";
const GROUP_URL = process.env.TELEGRAM_GROUP_URL || "https://t.me/vibbletv_chat";
const CHANNEL_URL = process.env.TELEGRAM_CHANNEL_URL || "https://t.me/vibbletv_chnl";
const INSTAGRAM_URL = process.env.INSTAGRAM_URL || "https://instagram.com/vibble.tv";
const DONATION_AMOUNT = process.env.REQUEST_DONATION_AMOUNT || "USD 1";

async function telegram(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { ok: boolean; description?: string; result?: unknown };
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed`);
  return result.result;
}

async function redis(command: Array<string | number>) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Upstash Redis environment variables are not configured");
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(command) });
  const result = await response.json() as { result?: unknown; error?: string };
  if (!response.ok || result.error) throw new Error(result.error || "Redis request failed");
  return result.result;
}

async function getState(chatId: number) { const value = await redis(["GET", `vibble:state:${chatId}`]); return typeof value === "string" ? value : ""; }
async function setState(chatId: number, value: string) { await redis(["SET", `vibble:state:${chatId}`, value, "EX", 900]); }
async function clearState(chatId: number) { await redis(["DEL", `vibble:state:${chatId}`]); }
async function send(chatId: number, text: string, reply_markup?: Record<string, unknown>) { return telegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) }); }
async function answerCallback(id: string, text = "") { return telegram("answerCallbackQuery", { callback_query_id: id, text }); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char); }
function menu() { return { inline_keyboard: [[{ text: "🔎 Find Media", callback_data: "menu:find" }, { text: "🎬 Request Media", callback_data: "menu:request" }], [{ text: "☕ Donate", callback_data: "menu:donate" }, { text: "🛟 Support", callback_data: "menu:support" }], [{ text: "💬 Contact", callback_data: "menu:contact" }], [{ text: "📱 WhatsApp Community", url: WHATSAPP_URL }], [{ text: "✈️ Telegram Group", url: GROUP_URL }, { text: "📢 Channel", url: CHANNEL_URL }], [{ text: "📸 Follow on Instagram", url: INSTAGRAM_URL }]] }; }
function categoryKeyboard() { return { inline_keyboard: [[{ text: "🍥 Anime", callback_data: "category:anime" }, { text: "🎬 Movies", callback_data: "category:movies" }, { text: "📺 TV Shows", callback_data: "category:tv" }], [{ text: "✖ Cancel", callback_data: "menu:cancel" }]] }; }
function parseInput(input: string) { const match = input.trim().match(/^-(a|m|t)\s*(.*)$/is); if (!match) return { type: "", title: input.trim() }; return { type: ({ a: "anime", m: "movies", t: "tv" } as Record<string, string>)[match[1].toLowerCase()], title: match[2].trim() }; }
function itemUrl(item: MediaItem) { return item.playback?.url || item.url || ""; }
function mediaMessage(item: MediaItem, type: string) { const title = escapeHtml(item.title || item.name || "Untitled"); const url = itemUrl(item); return `🎉 <b>${title}</b>${item.year || item.date ? ` (${escapeHtml(item.year || item.date || "")})` : ""}\n\n${type === "anime" ? "🍥 Open title on Vibble TV:" : "▶️ Watch on Vibble TV:"}\n${url ? `<a href="${escapeHtml(url)}">Open ${type === "anime" ? "title" : "media"}</a>` : "A direct link is not available for this result."}`; }
async function searchMedia(base: string, type: string, query: string) { const url = new URL("/api/search", base); url.searchParams.set("type", type); url.searchParams.set("query", query); const response = await fetch(url); if (!response.ok) throw new Error("Media search is temporarily unavailable"); const data = await response.json() as { items?: MediaItem[] }; return data.items || []; }
async function latestMedia(base: string, type: string) { const url = new URL("/api/catalog", base); url.searchParams.set("type", type); url.searchParams.set("limit", "6"); const response = await fetch(url); if (!response.ok) throw new Error("Latest titles are temporarily unavailable"); const data = await response.json() as { items?: MediaItem[] }; return data.items || []; }
async function handleFind(chatId: number, base: string, raw: string) { const parsed = parseInput(raw); if (!parsed.type) { await send(chatId, "🔎 <b>What would you like to find?</b>\n\nChoose a category, then send a title.\n\nYou can also use:\n<code>-a Tougen Anki</code>\n<code>-m Inception</code>\n<code>-t Breaking Bad</code>", categoryKeyboard()); await setState(chatId, "find:choose"); return; } if (!parsed.title) { const items = await latestMedia(base, parsed.type); if (!items.length) { await send(chatId, "I couldn't find any recent titles right now. Please try again later."); return; } await send(chatId, `✨ <b>Latest ${parsed.type === "anime" ? "Anime" : parsed.type === "movies" ? "Movies" : "TV Shows"}</b>\n\n${items.map((item, index) => `${index + 1}. ${escapeHtml(item.title || item.name || "Untitled")}\n${itemUrl(item) ? `<a href="${escapeHtml(itemUrl(item))}">Open title</a>` : "Link unavailable"}`).join("\n\n")}`); return; } const items = await searchMedia(base, parsed.type, parsed.title); if (!items.length) { await send(chatId, `😕 I couldn't find <b>${escapeHtml(parsed.title)}</b>. You can submit it using /request.`); return; } const selected = items[0]; await send(chatId, mediaMessage(selected, parsed.type)); }
async function handleRequest(chatId: number, user: TelegramUser | undefined, base: string, raw: string) { const parsed = parseInput(raw); if (!parsed.type || !parsed.title) { await send(chatId, "🎬 <b>What would you like us to add?</b>\n\nSend a category and title:\n<code>-a Prince of Stride</code>\n<code>-m Inception</code>\n<code>-t Breaking Bad</code>", categoryKeyboard()); await setState(chatId, "request:choose"); return; } const items = await searchMedia(base, parsed.type, parsed.title); const exact = items.find((item) => (item.title || item.name || "").trim().toLocaleLowerCase() === parsed.title.toLocaleLowerCase()); if (exact) { await send(chatId, `✅ <b>${escapeHtml(exact.title || exact.name || parsed.title)}</b> is already available!\n\n${itemUrl(exact) ? `<a href="${escapeHtml(itemUrl(exact))}">Open title</a>` : "The title is listed, but its direct link is unavailable."}`); return; } const requestId = `${Date.now()}-${chatId}`; const record = { id: requestId, chatId, userId: user?.id || chatId, username: user?.username || "", name: user?.first_name || "Vibble user", type: parsed.type, title: parsed.title, status: "pending", createdAt: new Date().toISOString() }; await redis(["SET", `vibble:request:${requestId}`, JSON.stringify(record)]); await send(chatId, `📩 <b>Request received!</b>\n\nWe couldn't find <b>${escapeHtml(parsed.title)}</b> in our catalogue yet. A small ${escapeHtml(DONATION_AMOUNT)} Nyana donation is requested to support sourcing.\n\nOnce the title is available, we'll send its link directly here. 💜\n\n☕ <a href="${escapeHtml(DONATION_URL)}">Support Vibble TV</a>`); await send(ADMIN_ID, `📥 <b>New media request</b>\n\nTitle: ${escapeHtml(parsed.title)}\nCategory: ${escapeHtml(parsed.type)}\nUser: ${escapeHtml(user?.first_name || "Unknown")}\nUsername: ${user?.username ? `@${escapeHtml(user.username)}` : "Not set"}\nTelegram ID: <code>${chatId}</code>\nRequest ID: <code>${requestId}</code>`, { inline_keyboard: [[{ text: "✅ Mark available & deliver", callback_data: `fulfill:${requestId}` }]] }); }
async function startCommand(chatId: number, user: TelegramUser | undefined) { await clearState(chatId); await telegram("setMyCommands", { commands: [{ command: "start", description: "👋 Welcome to Vibble TV" }, { command: "donate", description: "☕ Support Vibble TV" }, { command: "find", description: "🔎 Find anime, movies and TV shows" }, { command: "request", description: "🎬 Request a title" }, { command: "support", description: "🛟 Get help from our team" }, { command: "contact", description: "💬 Contact Vibble TV" }] }); await send(chatId, `💜 <b>Welcome to Vibble TV${user?.first_name ? `, ${escapeHtml(user.first_name)}` : ""}!</b>\n\nYour entertainment, one click away. Discover anime, movies and TV shows, request titles, or get help from our team.\n\n👇 <b>What would you like to do today?</b>`, menu()); }
async function handleCommand(message: TelegramMessage, command: string, args: string, base: string) { const chatId = message.chat.id; const user = message.from; await clearState(chatId); if (command === "start") return startCommand(chatId, user); if (command === "donate") return send(chatId, `☕ <b>Enjoying Vibble TV?</b>\n\nSupport the good vibes with a coffee-sized donation. Every contribution helps keep Vibble TV going. 💛\n\n<a href="${escapeHtml(DONATION_URL)}">Donate with PayPal</a>`); if (command === "find") return args.trim() ? handleFind(chatId, base, args) : (await setState(chatId, "find:input"), send(chatId, "🔎 <b>What title are you looking for?</b>\n\nSend a flag and title:\n<code>-a Tougen Anki</code>\n<code>-m Inception</code>\n<code>-t Breaking Bad</code>\n\nSend just a category flag to see the latest six titles.")); if (command === "request") return args.trim() ? handleRequest(chatId, user, base, args) : (await setState(chatId, "request:input"), send(chatId, "🎬 <b>Which title would you like to request?</b>\n\nUse one of these formats:\n<code>-a Prince of Stride</code>\n<code>-m Inception</code>\n<code>-t Breaking Bad</code>")); if (command === "support") return (await setState(chatId, "support:input"), send(chatId, "🛟 <b>How can we help?</b>\n\nDescribe the issue and our team will get back to you here.")); if (command === "contact") return send(chatId, `💬 <b>Connect with Vibble TV</b>\n\n📱 <a href="${escapeHtml(WHATSAPP_URL)}">WhatsApp Community</a>\n✈️ <a href="${escapeHtml(TELEGRAM_URL)}">Telegram</a>\n👥 <a href="${escapeHtml(GROUP_URL)}">Telegram Group Chat</a>\n📢 <a href="${escapeHtml(CHANNEL_URL)}">Telegram Channel</a>\n📸 <a href="${escapeHtml(INSTAGRAM_URL)}">Instagram @vibble.tv</a>\n\nWhatsApp: +254784537633`); }

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) return res.status(401).json({ error: "Unauthorized" });
  try {
    const update = req.body as TelegramUpdate;
    const message = update.message;
    const callback = update.callback_query;
    const origin = process.env.VIBBLE_API_BASE || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
    if (callback?.message) {
      const chatId = callback.message.chat.id;
      const data = callback.data || "";
      await answerCallback(callback.id);
      if (data === "menu:cancel") { await clearState(chatId); await send(chatId, "Cancelled. What would you like to do next?", menu()); }
      else if (data === "menu:find") { await setState(chatId, "find:input"); await send(chatId, "🔎 Send a title using -a (anime), -m (movies), or -t (TV shows).", categoryKeyboard()); }
      else if (data === "menu:request") { await setState(chatId, "request:input"); await send(chatId, "🎬 Send the title you'd like to request using -a, -m, or -t.", categoryKeyboard()); }
      else if (data === "menu:support") { await setState(chatId, "support:input"); await send(chatId, "🛟 Tell us what you need help with."); }
      else if (data === "menu:donate") await send(chatId, `☕ <a href="${escapeHtml(DONATION_URL)}">Support Vibble TV with PayPal</a>`);
      else if (data === "menu:contact") await send(chatId, `💬 <b>Contact Vibble TV</b>\n\n📱 <a href="${escapeHtml(WHATSAPP_URL)}">WhatsApp Community</a>\n✈️ <a href="${escapeHtml(TELEGRAM_URL)}">Telegram</a>\n👥 <a href="${escapeHtml(GROUP_URL)}">Group Chat</a>\n📢 <a href="${escapeHtml(CHANNEL_URL)}">Channel</a>\n📸 <a href="${escapeHtml(INSTAGRAM_URL)}">Instagram</a>`);
      else if (data.startsWith("category:")) { const type = data.split(":")[1]; const state = await getState(chatId); if (state.startsWith("find:") || state.startsWith("request:")) { await setState(chatId, `${state.split(":")[0]}:${type}`); await send(chatId, `Send the ${type} title now. You can send /cancel at any time.`); } }
      else if (data.startsWith("fulfill:") && callback.from.id === ADMIN_ID) { const requestId = data.slice(8); const raw = await redis(["GET", `vibble:request:${requestId}`]); if (typeof raw !== "string") await send(chatId, "That request could not be found."); else { await setState(chatId, `fulfill:${requestId}`); await send(chatId, "Send the direct media URL to deliver to the requester."); } }
    }
    if (message?.text) {
      const chatId = message.chat.id;
      const text = message.text.trim();
      const commandMatch = text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
      if (commandMatch) {
        const command = commandMatch[1].toLowerCase();
        if (command === "cancel") { await clearState(chatId); await send(chatId, "Cancelled. Use the menu whenever you're ready.", menu()); }
        else if (["start", "donate", "find", "request", "support", "contact"].includes(command)) await handleCommand(message, command, commandMatch[2] || "", origin);
      } else {
        const state = await getState(chatId);
        if (state.startsWith("fulfill:") && chatId === ADMIN_ID) {
          const requestId = state.slice(8); const raw = await redis(["GET", `vibble:request:${requestId}`]);
          if (typeof raw === "string") { const record = JSON.parse(raw) as { chatId: number; title: string; type: string; status: string }; await send(record.chatId, `🎉 <b>${escapeHtml(record.title)}</b> is now available!\n\n<a href="${escapeHtml(text)}">Open your requested title</a>\n\nEnjoy Vibble TV! 💜`); await redis(["SET", `vibble:request:${requestId}`, JSON.stringify({ ...record, status: "fulfilled", fulfilledAt: new Date().toISOString(), url: text })]); await send(chatId, "✅ The media link has been delivered to the requester."); }
          await clearState(chatId);
        } else if (state === "support:input") { await send(ADMIN_ID, `🛟 <b>New support message</b>\n\n${escapeHtml(text)}\n\nFrom: ${escapeHtml(message.from?.first_name || "Unknown")}\nUsername: ${message.from?.username ? `@${escapeHtml(message.from.username)}` : "Not set"}\nTelegram ID: <code>${chatId}</code>`); await send(chatId, "✅ Your message has been sent to the Vibble TV team. Expect a response here through your Telegram account."); await clearState(chatId); }
        else if (state === "find:input") await handleFind(chatId, origin, text);
        else if (state.startsWith("find:")) await handleFind(chatId, origin, `-${state.endsWith("anime") ? "a" : state.endsWith("movies") ? "m" : "t"} ${text}`);
        else if (state === "request:input") await handleRequest(chatId, message.from, origin, text);
        else if (state.startsWith("request:")) await handleRequest(chatId, message.from, origin, `-${state.endsWith("anime") ? "a" : state.endsWith("movies") ? "m" : "t"} ${text}`);
      }
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook failed:", error);
    return res.status(200).json({ ok: true, handled: false });
  }
}

declare const process: { env: Record<string, string | undefined> };

type TelegramUser = { id: number; username?: string; first_name?: string };
type TelegramMessage = { message_id: number; chat: { id: number; type: string }; from?: TelegramUser; text?: string; new_chat_members?: TelegramUser[] };
type TelegramUpdate = { message?: TelegramMessage; callback_query?: { id: string; from: TelegramUser; data?: string; message?: TelegramMessage } };
type MediaItem = { title?: string; name?: string; type?: string; url?: string; poster?: string; playback?: { url?: string }; date?: string; year?: string };

const DONATION_URL = process.env.PAYPAL_DONATION_URL || "https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=xhose.mj%40icloud.com&item_name=Support%20Vibble%20TV&currency_code=USD";
const ADMIN_ID = Number(process.env.TELEGRAM_ADMIN_ID || "8336433496");
const WHATSAPP_URL = process.env.WHATSAPP_COMMUNITY_URL || "https://chat.whatsapp.com/EU8WVY6ET0ME00Kon4gpPH";
const WHATSAPP_CHAT_URL = process.env.WHATSAPP_CHAT_URL || "https://wa.me/254784537633";
const TELEGRAM_URL = process.env.TELEGRAM_COMMUNITY_URL || "https://t.me/vibbletv";
const GROUP_URL = process.env.TELEGRAM_GROUP_URL || "https://t.me/vibbletv_chat";
const CHANNEL_URL = process.env.TELEGRAM_CHANNEL_URL || "https://t.me/vibbletv_chnl";
const INSTAGRAM_URL = process.env.INSTAGRAM_URL || "https://instagram.com/vibble.tv";
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || "@vibbletv_chnl";
const GROUP_ID = process.env.TELEGRAM_GROUP_ID || "@vibbletv_chat";
const DONATION_AMOUNT = process.env.REQUEST_DONATION_AMOUNT || "USD 1";
const BLOG_URL = process.env.VIBBLE_BLOG_URL || "https://vibbletv.blogspot.com";

async function telegram(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { ok: boolean; description?: string; result?: any };
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

async function setChatCommands(chatId: number, active: boolean) { await telegram("setMyCommands", { commands: active ? [{ command: "start", description: "Open Vibble TV menu" }] : [], scope: { type: "chat", chat_id: chatId } }); }
async function getState(chatId: number) { const value = await redis(["GET", `vibble:state:${chatId}`]); return typeof value === "string" ? value : ""; }
async function setState(chatId: number, value: string) { await redis(["SET", `vibble:state:${chatId}`, value, "EX", 900]); await setChatCommands(chatId, false); }
async function clearState(chatId: number) { await redis(["DEL", `vibble:state:${chatId}`]); }
async function deleteMessage(chatId: number, messageId: number) { try { await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {} }
async function deleteUserMessage(message?: TelegramMessage) { if (message) await deleteMessage(message.chat.id, message.message_id); }
async function send(chatId: number, text: string, reply_markup?: Record<string, unknown>) {
  const previous = await redis(["GET", `vibble:lastbot:${chatId}`]);
  if (typeof previous === "string" && previous) await deleteMessage(chatId, Number(previous));
  const sent = await telegram("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(reply_markup ? { reply_markup } : {}) }) as { message_id: number };
  await redis(["SET", `vibble:lastbot:${chatId}`, String(sent.message_id), "EX", 86400]);
  return sent;
}
async function answerCallback(id: string, text = "") { return telegram("answerCallbackQuery", { callback_query_id: id, text }); }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char); }
function blogSearchUrl(title: string, type: string) { const url = new URL("/", BLOG_URL); url.searchParams.set("vibbleSearch", title); url.searchParams.set("vibbleType", type); return url.toString(); }
function menu() { return { inline_keyboard: [[{ text: "🔎 Find Media", callback_data: "menu:find" }, { text: "🎬 Request Media", callback_data: "menu:request" }], [{ text: "☕ Donate", callback_data: "menu:donate" }, { text: "🛟 Support", callback_data: "menu:support" }], [{ text: "💬 Contact", callback_data: "menu:contact" }], [{ text: "📱 WhatsApp Community", url: WHATSAPP_URL }], [{ text: "✈️ Telegram Group", url: GROUP_URL }, { text: "📢 Channel", url: CHANNEL_URL }], [{ text: "📸 Follow on Instagram", url: INSTAGRAM_URL }]] }; }
async function isMember(chatId: string, userId: number) { try { const member = await telegram("getChatMember", { chat_id: chatId, user_id: userId }) as { status?: string; is_member?: boolean }; return member.status === "creator" || member.status === "administrator" || member.status === "member" || (member.status === "restricted" && member.is_member === true); } catch (error) { console.error(`Telegram getChatMember failed for ${chatId} and user ${userId}:`, error); return false; } }
async function hasInstagramConfirmed(userId: number) { return (await redis(["GET", `vibble:instagram:${userId}`])) === "1"; }
async function hasAccess(userId: number) { return (await hasInstagramConfirmed(userId)) && await isMember(CHANNEL_ID, userId) && await isMember(GROUP_ID, userId); }
async function showAccessGate(chatId: number, userId: number) { const instagramDone = await hasInstagramConfirmed(userId); const channelJoined = await isMember(CHANNEL_ID, userId); const groupJoined = await isMember(GROUP_ID, userId); const rows: any[] = [[{ text: "📢 Join Vibble TV Channel", url: CHANNEL_URL }], [{ text: "👥 Join Vibble TV Group", url: GROUP_URL }], [{ text: "📸 Follow @vibble.tv", url: INSTAGRAM_URL }], [{ text: instagramDone ? "✅ Instagram confirmed" : "I've Followed – Done", callback_data: "access:instagram_done" }], [{ text: "🔄 I've joined – Check again", callback_data: "access:check" }]]; const status = `Channel: ${channelJoined ? "✅ Joined" : "❌ Not joined"}\nGroup: ${groupJoined ? "✅ Joined" : "❌ Not joined"}\nInstagram: ${instagramDone ? "✅ Confirmed" : "⏳ Awaiting confirmation"}`; await send(chatId, `🔐 <b>Join the Vibble TV community to continue</b>\n\nPlease complete these steps:\n1. Join our Telegram channel.\n2. Join our Telegram group.\n3. Follow us on Instagram, then tap <b>I've Followed – Done</b>.\n\n${status}\n\nOnce you've completed the steps, tap <b>I've joined – Check again</b>.`, { inline_keyboard: rows }); }
async function unlockAccess(chatId: number, userId: number, user: TelegramUser | undefined) { const instagramDone = await hasInstagramConfirmed(userId); const channelJoined = await isMember(CHANNEL_ID, userId); const groupJoined = await isMember(GROUP_ID, userId); if (!instagramDone || !channelJoined || !groupJoined) { await showAccessGate(chatId, userId); return false; } await redis(["SET", `vibble:access:${userId}`, "1"]); await startCommand(chatId, user); return true; }
function categoryKeyboard() { return { inline_keyboard: [[{ text: "🍥 Anime", callback_data: "category:anime" }, { text: "🎬 Movies", callback_data: "category:movies" }, { text: "📺 TV Shows", callback_data: "category:tv" }], [{ text: "✖ Cancel", callback_data: "menu:cancel" }]] }; }
function parseInput(input: string) { const match = input.trim().match(/^-(a|m|t)\s*(.*)$/is); if (!match) return { type: "", title: input.trim() }; return { type: ({ a: "anime", m: "movies", t: "tv" } as Record<string, string>)[match[1].toLowerCase()], title: match[2].trim() }; }
function mediaMessage(item: MediaItem, type: string) { const title = item.title || item.name || "Untitled"; const url = blogSearchUrl(title, type); return `🎉 <b>${escapeHtml(title)}</b>${item.year || item.date ? ` (${escapeHtml(item.year || item.date || "")})` : ""}\n\n${type === "anime" ? "🍥 Find this title on Vibble TV:" : "▶️ Find this title on Vibble TV:"}\n<a href="${escapeHtml(url)}">Search Vibble TV</a>`; }
async function searchMedia(base: string, type: string, query: string) { const url = new URL("/api/search", base); url.searchParams.set("type", type); url.searchParams.set("query", query); const response = await fetch(url); if (!response.ok) throw new Error("Media search is temporarily unavailable"); const data = await response.json() as { items?: MediaItem[] }; return data.items || []; }
async function latestMedia(base: string, type: string) { const url = new URL("/api/catalog", base); url.searchParams.set("type", type); url.searchParams.set("limit", "6"); const response = await fetch(url); if (!response.ok) throw new Error("Latest titles are temporarily unavailable"); const data = await response.json() as { items?: MediaItem[] }; return data.items || []; }
async function handleFind(chatId: number, base: string, raw: string) {
  const parsed = parseInput(raw);
  if (!parsed.type) { await send(chatId, "🔎 <b>What would you like to find?</b>\n\nChoose a category, then send a title.", categoryKeyboard()); await setState(chatId, "find:choose"); return; }
  if (!parsed.title) {
    const items = await latestMedia(base, parsed.type);
    if (!items.length) { await clearState(chatId); await send(chatId, "I couldn't find any recent titles right now. Please try again later.", menu()); return; }
    await clearState(chatId);
    await send(chatId, `✨ <b>Latest ${parsed.type === "anime" ? "Anime" : parsed.type === "movies" ? "Movies" : "TV Shows"}</b>\n\n${items.map((item, index) => `${index + 1}. ${escapeHtml(item.title || item.name || "Untitled")}\n<a href="${escapeHtml(blogSearchUrl(item.title || item.name || "", parsed.type))}">Find on Vibble TV</a>`).join("\n\n")}`, menu());
    return;
  }
  const items = await searchMedia(base, parsed.type, parsed.title);
  await clearState(chatId);
  if (!items.length) { await send(chatId, `😕 I couldn't find <b>${escapeHtml(parsed.title)}</b>. You can submit it using /request.`, menu()); return; }
  await send(chatId, mediaMessage(items[0], parsed.type), menu());
}
async function handleRequest(chatId: number, user: TelegramUser | undefined, base: string, raw: string) {
  const parsed = parseInput(raw);
  if (!parsed.type || !parsed.title) { await send(chatId, "🎬 <b>What would you like us to add?</b>\n\nChoose a category, then send a title.", categoryKeyboard()); await setState(chatId, "request:choose"); return; }
  const items = await searchMedia(base, parsed.type, parsed.title);
  const exact = items.find((item) => (item.title || item.name || "").trim().toLocaleLowerCase() === parsed.title.toLocaleLowerCase());
  await clearState(chatId);
  if (exact) { await send(chatId, `✅ <b>${escapeHtml(exact.title || exact.name || parsed.title)}</b> is already available!\n\n<a href="${escapeHtml(blogSearchUrl(exact.title || exact.name || parsed.title, parsed.type))}">Find it on Vibble TV</a>`, menu()); return; }
  const requestId = `${Date.now()}-${chatId}`;
  const record = { id: requestId, chatId, userId: user?.id || chatId, username: user?.username || "", name: user?.first_name || "Vibble user", type: parsed.type, title: parsed.title, status: "pending", createdAt: new Date().toISOString() };
  await redis(["SET", `vibble:request:${requestId}`, JSON.stringify(record)]);
  await send(chatId, `📩 <b>Request received!</b>\n\nWe couldn't find <b>${escapeHtml(parsed.title)}</b> in our catalogue yet. A small ${escapeHtml(DONATION_AMOUNT)} donation is requested to support sourcing.\n\nOnce the title is available, we'll send its Vibble TV search link here. 💜\n\n☕ <a href="${escapeHtml(DONATION_URL)}">Support Vibble TV</a>`, menu());
  await send(ADMIN_ID, `📥 <b>New media request</b>\n\nTitle: ${escapeHtml(parsed.title)}\nCategory: ${escapeHtml(parsed.type)}\nUser: ${escapeHtml(user?.first_name || "Unknown")}\nUsername: ${user?.username ? `@${escapeHtml(user.username)}` : "Not set"}\nTelegram ID: <code>${chatId}</code>\nRequest ID: <code>${requestId}</code>`, { inline_keyboard: [[{ text: "✅ Mark available & deliver", callback_data: `fulfill:${requestId}` }]] });
}
async function startCommand(chatId: number, user: TelegramUser | undefined) {
  await clearState(chatId);
  await setChatCommands(chatId, true);
  await send(chatId, `💜 <b>Welcome to Vibble TV${user?.first_name ? `, ${escapeHtml(user.first_name)}` : ""}!</b>\n\nYour entertainment, one click away. Discover anime, movies and TV shows, request titles, or get help from our team.\n\n👇 <b>What would you like to do today?</b>`, menu());
}
async function handleCommand(message: TelegramMessage, command: string, args: string, base: string) {
  const chatId = message.chat.id;
  const user = message.from;
  if (command === "start") return startCommand(chatId, user);
  await clearState(chatId);
  if (command === "donate") return send(chatId, `☕ <b>Enjoying Vibble TV?</b>\n\nSupport the good vibes with a coffee-sized donation. Every contribution helps keep Vibble TV going. 💛\n\n<a href="${escapeHtml(DONATION_URL)}">Donate with PayPal</a>`, menu());
  if (command === "find") { if (args.trim()) return handleFind(chatId, base, args); await setState(chatId, "find:input"); return send(chatId, "🔎 <b>What title are you looking for?</b>\n\nChoose a category below or send -a, -m, or -t with a title.", categoryKeyboard()); }
  if (command === "request") { if (args.trim()) return handleRequest(chatId, user, base, args); await setState(chatId, "request:input"); return send(chatId, "🎬 <b>Which title would you like to request?</b>\n\nChoose a category below or send -a, -m, or -t with a title.", categoryKeyboard()); }
  if (command === "support") { await setState(chatId, "support:input"); return send(chatId, "🛟 <b>How can we help?</b>\n\nDescribe the issue and our team will get back to you here. Send /cancel to stop."); }
  if (command === "contact") return send(chatId, `💬 <b>Connect with Vibble TV</b>\n\n💬 <a href="${escapeHtml(WHATSAPP_CHAT_URL)}">Message us on WhatsApp</a>\n📱 <a href="${escapeHtml(WHATSAPP_URL)}">WhatsApp Community</a>\n✈️ <a href="${escapeHtml(TELEGRAM_URL)}">Telegram</a>\n👥 <a href="${escapeHtml(GROUP_URL)}">Telegram Group Chat</a>\n📢 <a href="${escapeHtml(CHANNEL_URL)}">Telegram Channel</a>\n📸 <a href="${escapeHtml(INSTAGRAM_URL)}">Instagram @vibble.tv</a>`, menu());
}
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) return res.status(401).json({ error: "Unauthorized" });
  try {
    const update = req.body as TelegramUpdate;
    const message = update.message;
    const callback = update.callback_query;
    const origin = process.env.VIBBLE_API_BASE || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
    if (message?.new_chat_members?.length) {
      const joinedUsers = message.new_chat_members.filter((member) => member.id !== Number(process.env.TELEGRAM_BOT_ID || "0"));
      if (joinedUsers.length) {
        const names = joinedUsers.map((member) => member.first_name || "there").map(escapeHtml);
        const welcome = await telegram("sendMessage", { chat_id: message.chat.id, text: `👋 Welcome ${names.join(", ")} to the Vibble TV community! 💜`, disable_web_page_preview: true }) as { message_id: number };
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await deleteMessage(message.chat.id, welcome.message_id);
      }
      return res.status(200).json({ ok: true });
    }
    const actor = callback?.from || message?.from;
    const actorChatId = callback?.message?.chat.id || message?.chat.id;
    if (callback && actor && actorChatId && (callback.data === "access:instagram_done" || callback.data === "access:check")) {
      if (callback.data === "access:instagram_done") await redis(["SET", `vibble:instagram:${actor.id}`, "1"]);
      await answerCallback(callback.id, callback.data === "access:check" ? "Checking your membership..." : "Instagram follow confirmed");
      await unlockAccess(actorChatId, actor.id, actor);
      return res.status(200).json({ ok: true });
    }
    if (actor && actorChatId && actor.id !== ADMIN_ID && !(await hasAccess(actor.id))) {
      if (callback) await answerCallback(callback.id, "Please complete the community steps first");
      if (message) await deleteUserMessage(message);
      await showAccessGate(actorChatId, actor.id);
      return res.status(200).json({ ok: true });
    }
    if (callback?.message) {
      const chatId = callback.message.chat.id;
      const data = callback.data || "";
      await answerCallback(callback.id);
      if (data === "menu:cancel") { await clearState(chatId); await send(chatId, "Cancelled. Use the menu whenever you're ready.", menu()); }
      else if (data === "menu:find") { await setState(chatId, "find:input"); await send(chatId, "🔎 Choose a category, then send the title.", categoryKeyboard()); }
      else if (data === "menu:request") { await setState(chatId, "request:input"); await send(chatId, "🎬 Choose a category, then send the title you'd like to request.", categoryKeyboard()); }
      else if (data === "menu:support") { await setState(chatId, "support:input"); await send(chatId, "🛟 Tell us what you need help with. Send /cancel to stop."); }
      else if (data === "menu:donate") await send(chatId, `☕ <b>Enjoying Vibble TV?</b>\n\n<a href="${escapeHtml(DONATION_URL)}">Support Vibble TV with PayPal</a>`, menu());
      else if (data === "menu:contact") await send(chatId, `💬 <b>Contact Vibble TV</b>\n\n💬 <a href="${escapeHtml(WHATSAPP_CHAT_URL)}">Message us on WhatsApp</a>\n📱 <a href="${escapeHtml(WHATSAPP_URL)}">WhatsApp Community</a>\n✈️ <a href="${escapeHtml(TELEGRAM_URL)}">Telegram</a>\n👥 <a href="${escapeHtml(GROUP_URL)}">Group Chat</a>\n📢 <a href="${escapeHtml(CHANNEL_URL)}">Channel</a>\n📸 <a href="${escapeHtml(INSTAGRAM_URL)}">Instagram</a>`, menu());
      else if (data.startsWith("category:")) {
        const type = data.split(":")[1];
        const state = await getState(chatId);
        if ((state.startsWith("find:") || state.startsWith("request:")) && ["anime", "movies", "tv"].includes(type)) {
          await setState(chatId, `${state.split(":")[0]}:${type}`);
          await send(chatId, `Send the ${type === "tv" ? "TV show" : type} title now. You can send /cancel at any time.`);
        }
      } else if (data.startsWith("fulfill:") && callback.from.id === ADMIN_ID) {
        const requestId = data.slice(8);
        const raw = await redis(["GET", `vibble:request:${requestId}`]);
        if (typeof raw !== "string") await send(chatId, "That request could not be found.");
        else { await setState(chatId, `fulfill:${requestId}`); await send(chatId, "Send the title's name to create its Vibble TV search link."); }
      }
    }
    if (message?.text) {
      const chatId = message.chat.id;
      const text = message.text.trim();
      const commandMatch = text.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
      const state = await getState(chatId);
      if (commandMatch) {
        await deleteUserMessage(message);
        const command = commandMatch[1].toLowerCase();
        if (command === "cancel") { await clearState(chatId); await send(chatId, "Cancelled. Use the menu whenever you're ready.", menu()); }
        else if (["start", "donate", "find", "request", "support", "contact"].includes(command)) await handleCommand(message, command, commandMatch[2] || "", origin);
      } else if (state && (state.startsWith("find:") || state.startsWith("request:") || state === "support:input" || (state.startsWith("fulfill:") && chatId === ADMIN_ID))) {
        await deleteUserMessage(message);
        if (state.startsWith("fulfill:") && chatId === ADMIN_ID) {
          const requestId = state.slice(8);
          const raw = await redis(["GET", `vibble:request:${requestId}`]);
          if (typeof raw === "string") {
            const record = JSON.parse(raw) as { chatId: number; title: string; type: string; status: string };
            const deliveredUrl = blogSearchUrl(text, record.type);
            await send(record.chatId, `🎉 <b>${escapeHtml(record.title)}</b> is now available!\n\n<a href="${escapeHtml(deliveredUrl)}">Find it on Vibble TV</a>\n\nEnjoy Vibble TV! 💜`, menu());
            await redis(["SET", `vibble:request:${requestId}`, JSON.stringify({ ...record, status: "fulfilled", fulfilledAt: new Date().toISOString(), url: deliveredUrl })]);
            await send(chatId, "✅ The Vibble TV search link has been delivered to the requester.");
          }
          await clearState(chatId);
        } else if (state === "support:input") {
          await send(ADMIN_ID, `🛟 <b>New support message</b>\n\n${escapeHtml(text)}\n\nFrom: ${escapeHtml(message.from?.first_name || "Unknown")}\nUsername: ${message.from?.username ? `@${escapeHtml(message.from.username)}` : "Not set"}\nTelegram ID: <code>${chatId}</code>`);
          await clearState(chatId);
          await send(chatId, "✅ Your message has been sent to the Vibble TV team. Expect a response here through your Telegram account.", menu());
        } else if (state.startsWith("find:")) {
          const type = state.endsWith("anime") ? "a" : state.endsWith("movies") ? "m" : state.endsWith("tv") ? "t" : "";
          await handleFind(chatId, origin, type ? `-${type} ${text}` : text);
        } else if (state.startsWith("request:")) {
          const type = state.endsWith("anime") ? "a" : state.endsWith("movies") ? "m" : state.endsWith("tv") ? "t" : "";
          await handleRequest(chatId, message.from, origin, type ? `-${type} ${text}` : text);
        }
      } else {
        await deleteUserMessage(message);
      }
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook failed:", error);
    return res.status(200).json({ ok: true, handled: false });
  }
}

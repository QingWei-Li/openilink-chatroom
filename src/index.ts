import { Hono } from "hono";
import { Env } from "./types";
import { verifySignature } from "./crypto";
import { getEventType, getCommandArgs, getTraceId } from "./protocol";
import { handleOAuthSetup, handleOAuthCallback } from "./oauth";
import {
  handleJoin,
  handleLeave,
  handleWho,
  handleRooms,
  handleNick,
  handleTopic,
  handleMessage,
} from "./handlers";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", "*");
});
app.options("/api/*", (_c) => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization",
    },
  });
});

// ── health ──────────────────────────────────────────────────────

app.get("/", (c) => c.json({ ok: true }));

// ── OAuth PKCE installation ────────────────────────────────────

app.get("/oauth/setup", handleOAuthSetup);
app.get("/oauth/callback", handleOAuthCallback);

// ── webhook ─────────────────────────────────────────────────────

app.post("/webhook", async (c) => {
  const rawBody = await c.req.text();
  const envelope = JSON.parse(rawBody);

  // URL verification (no signature required)
  if (envelope.type === "url_verification") {
    return c.json({ challenge: envelope.challenge });
  }

  // Verify signature
  const instId: string = envelope.installation_id;
  const inst = await c.env.DB.prepare("SELECT * FROM installations WHERE installation_id = ?")
    .bind(instId)
    .first<{
      installation_id: string;
      app_token: string;
      signing_secret: string;
      bot_id: string;
      hub_url: string;
    }>();

  if (!inst) return c.json({ error: "unknown installation" }, 401);

  const timestamp = c.req.header("X-Timestamp") ?? "";
  const signature = c.req.header("X-Signature") ?? "";
  if (!(await verifySignature(inst.signing_secret, timestamp, rawBody, signature))) {
    return c.json({ error: "invalid signature" }, 401);
  }

  const traceId = getTraceId(envelope);
  const sender: { id: string; name: string } = envelope.event?.data?.sender ?? { id: "", name: "" };
  const instCtx = {
    installation_id: inst.installation_id,
    app_token: inst.app_token,
    hub_url: inst.hub_url,
  };

  let reply: string | null = null;

  const eventType = getEventType(envelope);

  if (eventType === "command") {
    const cmd: string = envelope.event?.data?.command ?? "";
    const args = getCommandArgs(envelope);

    switch (cmd) {
      case "join":
        reply = await handleJoin(c.env.DB, instCtx, sender, args, traceId);
        break;
      case "leave":
        reply = await handleLeave(c.env.DB, instCtx, sender, traceId);
        break;
      case "who":
        reply = await handleWho(c.env.DB, instCtx, sender);
        break;
      case "rooms":
        reply = await handleRooms(c.env.DB, instCtx);
        break;
      case "nick":
        reply = await handleNick(c.env.DB, instCtx, sender, args, traceId);
        break;
      case "topic":
        reply = await handleTopic(c.env.DB, instCtx, sender, args, traceId);
        break;
      default:
        reply = "未知命令。可用：/join /leave /who /rooms /nick /topic";
    }
  } else if (eventType === "message.text") {
    const text: string = envelope.event?.data?.content?.text ?? envelope.event?.data?.content ?? "";
    reply = await handleMessage(c.env.DB, instCtx, sender, text, traceId);
  }

  return c.json(reply ? { reply, reply_type: "text" } : { ok: true });
});

// ── admin API ───────────────────────────────────────────────────

app.get("/api/rooms", async (c) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (token !== c.env.ADMIN_TOKEN) return c.json({ error: "unauthorized" }, 401);

  const { results: rooms } = await c.env.DB.prepare(
    `
    SELECT r.name, r.topic, r.installation_id,
           COUNT(m.user_id) as member_count
    FROM rooms r
    LEFT JOIN members m ON m.room_id = r.id
    GROUP BY r.id
    ORDER BY member_count DESC
  `,
  ).all();

  const { results: stats } = await c.env.DB.prepare(
    `
    SELECT
      (SELECT COUNT(*) FROM rooms) as total_rooms,
      (SELECT COUNT(*) FROM members) as total_members,
      (SELECT COUNT(*) FROM installations) as total_installations
  `,
  ).all<{ total_rooms: number; total_members: number; total_installations: number }>();

  return c.json({ stats: stats[0], rooms });
});

export default app;

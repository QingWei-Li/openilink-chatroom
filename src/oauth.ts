import { Context } from "hono";
import { Env } from "./types";
import { syncTools } from "./tools";

function generateRandomString(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  // base64url encode, then truncate to n chars
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64.slice(0, n);
}

async function sha256Base64Url(plain: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function handleOAuthSetup(c: Context<{ Bindings: Env }>): Promise<Response> {
  const q = c.req.query();
  const hubUrl = (q.hub || c.env.HUB_URL || "https://hub.openilink.com").replace(/\/+$/, "");
  const appId = q.app_id || c.env.APP_ID || "";
  if (!appId) return c.text("app_id not provided", 400);

  const botId = q.bot_id || "";
  const hubState = q.state || "";
  const returnUrl = q.return_url || "";

  const verifier = generateRandomString(64);
  const challenge = await sha256Base64Url(verifier);
  const localState = generateRandomString(32);

  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  // Clean expired entries and insert new state
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM pkce_states WHERE expires_at < ?").bind(
      Math.floor(Date.now() / 1000),
    ),
    c.env.DB.prepare(
      "INSERT INTO pkce_states (state, code_verifier, hub_url, app_id, return_url, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(localState, verifier, hubUrl, appId, returnUrl, expiresAt),
  ]);

  const params = new URLSearchParams();
  params.set("bot_id", botId);
  params.set("state", localState);
  params.set("code_challenge", challenge);
  if (hubState) params.set("hub_state", hubState);

  const redirectUrl = `${hubUrl}/api/apps/${appId}/oauth/authorize?${params.toString()}`;
  return c.redirect(redirectUrl);
}

export async function handleOAuthCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
  const code = c.req.query("code") || "";
  const state = c.req.query("state") || "";
  if (!code || !state) return c.text("missing code or state", 400);

  const entry = await c.env.DB.prepare(
    "SELECT code_verifier, hub_url, app_id, return_url, expires_at FROM pkce_states WHERE state = ?",
  )
    .bind(state)
    .first<{
      code_verifier: string;
      hub_url: string;
      app_id: string;
      return_url: string;
      expires_at: number;
    }>();

  // Delete used state
  await c.env.DB.prepare("DELETE FROM pkce_states WHERE state = ?").bind(state).run();

  if (!entry || entry.expires_at < Math.floor(Date.now() / 1000)) {
    return c.text("invalid or expired state", 400);
  }

  const hubUrl = entry.hub_url || c.env.HUB_URL || "https://hub.openilink.com";
  const appId = entry.app_id || c.env.APP_ID || "";

  const exchangeUrl = `${hubUrl}/api/apps/${appId}/oauth/exchange`;
  const resp = await fetch(exchangeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: entry.code_verifier }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return c.text(`exchange failed: ${body}`, resp.status as 400);
  }

  const result = await resp.json<{
    installation_id: string;
    app_token: string;
    webhook_secret: string;
    bot_id: string;
  }>();

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO installations (installation_id, app_token, signing_secret, bot_id, hub_url)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(result.installation_id, result.app_token, result.webhook_secret, result.bot_id, hubUrl)
    .run();

  // Sync tools after installation
  c.executionCtx.waitUntil(syncTools(hubUrl, result.app_token));

  const returnUrl = entry.return_url || c.req.query("return_url") || `${hubUrl}/oauth/complete`;
  return c.redirect(returnUrl);
}

import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./index";
import { botSend } from "./botapi";
import { getEventType, getCommandArgs, getTraceId, parseInstallPayload } from "./protocol";
import { syncTools } from "./tools";

// ── inline the pure functions under test ──────────────────────

function header(text: string) {
  return `══ ${text} ══`;
}

function buildJoinReply(
  roomName: string,
  topic: string,
  members: string[],
  _isNew: boolean,
): string {
  const lines = [header(`#${roomName}`)];
  if (topic) lines.push(`话题：${topic}`);
  lines.push(`在线：${members.join("、")}`);
  lines.push(`＊ 你加入了房间`);
  return lines.join("\n");
}

function buildWhoReply(
  roomName: string,
  members: { user_id: string; nick: string }[],
  selfId: string,
): string {
  const lines = [header(`#${roomName} 成员`)];
  for (const m of members) lines.push(`· ${m.nick}${m.user_id === selfId ? "（你）" : ""}`);
  lines.push(`共 ${members.length} 人在线`);
  return lines.join("\n");
}

function buildRoomsReply(rooms: { name: string; cnt: number }[]): string {
  if (!rooms.length) return "暂无房间\n发送 /join <名称> 创建第一个房间";
  const lines = [header("聊天室列表")];
  for (const r of rooms) lines.push(`#${r.name}  ${r.cnt}人`);
  lines.push("发送 /join <名称> 加入");
  return lines.join("\n");
}

async function verifySignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): Promise<boolean> {
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}:${body}`),
  );
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return expected === signature;
}

async function makeSignature(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}:${body}`),
  );
  return (
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

// ── tests ─────────────────────────────────────────────────────

describe("reply formatting", () => {
  it("join reply without topic", () => {
    const reply = buildJoinReply("general", "", ["Alice", "Bob"], false);
    expect(reply).toBe("══ #general ══\n在线：Alice、Bob\n＊ 你加入了房间");
  });

  it("join reply with topic", () => {
    const reply = buildJoinReply("general", "今天聊什么？", ["Alice"], false);
    expect(reply).toContain("话题：今天聊什么？");
    expect(reply).toContain("在线：Alice");
  });

  it("who reply marks self", () => {
    const members = [
      { user_id: "wxid_alice", nick: "Alice" },
      { user_id: "wxid_bob", nick: "Bob" },
    ];
    const reply = buildWhoReply("general", members, "wxid_alice");
    expect(reply).toContain("· Alice（你）");
    expect(reply).toContain("· Bob");
    expect(reply).toContain("共 2 人在线");
  });

  it("rooms reply lists rooms", () => {
    const reply = buildRoomsReply([
      { name: "general", cnt: 3 },
      { name: "tech", cnt: 1 },
    ]);
    expect(reply).toContain("#general  3人");
    expect(reply).toContain("#tech  1人");
    expect(reply).toContain("发送 /join <名称> 加入");
  });

  it("rooms reply when empty", () => {
    const reply = buildRoomsReply([]);
    expect(reply).toContain("暂无房间");
  });
});

describe("signature verification", () => {
  it("accepts valid signature", async () => {
    const secret = "testsecret";
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"command"}';
    const sig = await makeSignature(secret, ts, body);
    expect(await verifySignature(secret, ts, body, sig)).toBe(true);
  });

  it("rejects wrong secret", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"command"}';
    const sig = await makeSignature("correct", ts, body);
    expect(await verifySignature("wrong", ts, body, sig)).toBe(false);
  });

  it("rejects tampered body", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await makeSignature("secret", ts, '{"type":"command"}');
    expect(await verifySignature("secret", ts, '{"type":"tampered"}', sig)).toBe(false);
  });

  it("rejects expired timestamp", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 400); // 400s ago
    const body = "{}";
    const sig = await makeSignature("secret", ts, body);
    expect(await verifySignature("secret", ts, body, sig)).toBe(false);
  });
});

describe("hub protocol compatibility", () => {
  it("accepts latest install payload", () => {
    expect(
      parseInstallPayload({
        installation_id: "inst_123",
        app_token: "tok_123",
        webhook_secret: "sec_123",
        bot_id: "bot_123",
        hub_url: "https://hub.openilink.com",
      }),
    ).toEqual({
      installationId: "inst_123",
      appToken: "tok_123",
      webhookSecret: "sec_123",
      botId: "bot_123",
      hubUrl: "https://hub.openilink.com",
    });
  });

  it("keeps backward compatibility with signing_secret", () => {
    const install = parseInstallPayload({
      installation_id: "inst_123",
      app_token: "tok_123",
      webhook_secret: "sec_new",
      signing_secret: "sec_123",
      bot_id: "bot_123",
      hub_url: "https://hub.openilink.com",
    });

    expect(install?.webhookSecret).toBe("sec_new");
  });

  it("reads event type from event envelope", () => {
    expect(
      getEventType({
        type: "event",
        event: { type: "message.text" },
      }),
    ).toBe("message.text");
  });

  it("rejects incomplete install payload", () => {
    expect(
      parseInstallPayload({
        installation_id: "inst_123",
        app_token: "tok_123",
        webhook_secret: "sec_123",
        bot_id: "bot_123",
      }),
    ).toBeNull();
  });

  it("returns empty event type when event is missing", () => {
    expect(getEventType({ type: "event" })).toBe("");
  });
});

describe("command args extraction", () => {
  it("reads plain text from event data", () => {
    expect(
      getCommandArgs({
        event: { data: { command: "join", text: "general" } },
      }),
    ).toBe("general");
  });

  it("prefers structured args.text over plain text", () => {
    expect(
      getCommandArgs({
        event: {
          data: {
            command: "join",
            text: "fallback",
            args: { text: "structured" },
          },
        },
      }),
    ).toBe("structured");
  });

  it("falls back to text when args.text is empty", () => {
    expect(
      getCommandArgs({
        event: {
          data: {
            command: "join",
            text: "fallback",
            args: { text: "" },
          },
        },
      }),
    ).toBe("fallback");
  });

  it("returns empty string when no data", () => {
    expect(getCommandArgs({})).toBe("");
    expect(getCommandArgs({ event: {} })).toBe("");
    expect(getCommandArgs({ event: { data: {} } })).toBe("");
  });
});

describe("trace id extraction", () => {
  it("reads trace_id from envelope", () => {
    expect(getTraceId({ trace_id: "tr_abc123" })).toBe("tr_abc123");
  });

  it("returns empty string when missing", () => {
    expect(getTraceId({})).toBe("");
  });

  it("returns empty string for non-string values", () => {
    expect(getTraceId({ trace_id: 123 })).toBe("");
    expect(getTraceId({ trace_id: null })).toBe("");
  });
});

describe("bot api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends text messages to the latest bot api endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await botSend("https://hub.openilink.com", "tok_123", "wxid_alice", "hello");

    expect(fetchMock).toHaveBeenCalledWith("https://hub.openilink.com/bot/v1/message/send", {
      method: "POST",
      headers: {
        Authorization: "Bearer tok_123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: "wxid_alice",
        type: "text",
        content: "hello",
      }),
    });
  });

  it("includes X-Trace-Id header when traceId is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await botSend("https://hub.openilink.com", "tok_123", "wxid_alice", "hello", "tr_abc");

    expect(fetchMock).toHaveBeenCalledWith("https://hub.openilink.com/bot/v1/message/send", {
      method: "POST",
      headers: {
        Authorization: "Bearer tok_123",
        "Content-Type": "application/json",
        "X-Trace-Id": "tr_abc",
      },
      body: JSON.stringify({
        to: "wxid_alice",
        type: "text",
        content: "hello",
      }),
    });
  });
});

describe("tool sync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("registers chatroom commands via PUT /bot/v1/app/tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await syncTools("https://hub.openilink.com", "tok_123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hub.openilink.com/bot/v1/app/tools");
    expect(init.method).toBe("PUT");
    expect(init.headers["Authorization"]).toBe("Bearer tok_123");

    const body = JSON.parse(init.body);
    expect(body.tools).toHaveLength(6);

    const names = body.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["join", "leave", "who", "rooms", "nick", "topic"]);

    // Tools with parameters should have text parameter
    const join = body.tools.find((t: { name: string }) => t.name === "join");
    expect(join.parameters.properties.text).toBeDefined();
    expect(join.parameters.required).toEqual(["text"]);

    // Tools without parameters should not have parameters
    const leave = body.tools.find((t: { name: string }) => t.name === "leave");
    expect(leave.parameters).toBeUndefined();
  });
});

// ── mock D1 helper ───────────────────────────────────────────

function createMockD1(queryHandler: (sql: string, binds: unknown[]) => unknown) {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => {
        binds = args;
        return stmt;
      },
      first: () => Promise.resolve(queryHandler(sql, binds)),
      run: () => Promise.resolve({ success: true }),
      all: () => {
        const result = queryHandler(sql, binds);
        return Promise.resolve({ results: Array.isArray(result) ? result : [] });
      },
    };
    return stmt;
  };
  return {
    prepare,
    batch: (stmts: ReturnType<typeof prepare>[]) =>
      Promise.resolve(stmts.map(() => ({ success: true }))),
  };
}

const DEFAULT_ENV = {
  WORKER_URL: "https://chatroom.test",
  ADMIN_TOKEN: "test-admin",
  APP_ID: "app_test",
  HUB_URL: "https://hub.openilink.com",
};

const MOCK_EXEC_CTX = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

// ── webhook endpoint tests ───────────────────────────────────

describe("webhook endpoint", () => {
  it("handles url_verification challenge", async () => {
    const db = createMockD1(() => null);
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "url_verification", challenge: "test_challenge_123" }),
    }, { ...DEFAULT_ENV, DB: db });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ challenge: "test_challenge_123" });
  });

  it("rejects unknown installation", async () => {
    const db = createMockD1(() => null); // no installation found
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "event",
        installation_id: "unknown",
        event: { type: "command" },
      }),
    }, { ...DEFAULT_ENV, DB: db });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("unknown installation");
  });

  it("rejects invalid signature", async () => {
    const db = createMockD1((sql) => {
      if (sql.includes("installations")) {
        return {
          installation_id: "inst_1",
          app_token: "tok_1",
          signing_secret: "secret_1",
          bot_id: "bot_1",
          hub_url: "https://hub.openilink.com",
        };
      }
      return null;
    });

    const res = await app.request("/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": String(Math.floor(Date.now() / 1000)),
        "X-Signature": "sha256=invalid",
      },
      body: JSON.stringify({
        type: "event",
        installation_id: "inst_1",
        event: { type: "command", data: { command: "rooms" } },
      }),
    }, { ...DEFAULT_ENV, DB: db });

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid signature");
  });

  it("returns reply with reply_type for command events", async () => {
    const secret = "test_secret";
    const body = JSON.stringify({
      type: "event",
      installation_id: "inst_1",
      trace_id: "tr_999",
      event: {
        type: "command",
        data: { command: "rooms", sender: { id: "u1", name: "Test" } },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await makeSignature(secret, ts, body);

    const db = createMockD1((sql) => {
      if (sql.includes("installations")) {
        return {
          installation_id: "inst_1",
          app_token: "tok_1",
          signing_secret: secret,
          bot_id: "bot_1",
          hub_url: "https://hub.openilink.com",
        };
      }
      // rooms query returns empty
      return [];
    });

    const res = await app.request("/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": ts,
        "X-Signature": sig,
      },
      body,
    }, { ...DEFAULT_ENV, DB: db });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { reply: string; reply_type: string };
    expect(json.reply_type).toBe("text");
    expect(json.reply).toBeDefined();
  });

  it("returns ok for non-reply events", async () => {
    const secret = "test_secret";
    const body = JSON.stringify({
      type: "event",
      installation_id: "inst_1",
      event: {
        type: "some.other.event",
        data: { sender: { id: "u1", name: "Test" } },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await makeSignature(secret, ts, body);

    const db = createMockD1((sql) => {
      if (sql.includes("installations")) {
        return {
          installation_id: "inst_1",
          app_token: "tok_1",
          signing_secret: secret,
          bot_id: "bot_1",
          hub_url: "https://hub.openilink.com",
        };
      }
      return null;
    });

    const res = await app.request("/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": ts,
        "X-Signature": sig,
      },
      body,
    }, { ...DEFAULT_ENV, DB: db });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json).toEqual({ ok: true });
  });

  it("returns unknown command reply for unregistered commands", async () => {
    const secret = "test_secret";
    const body = JSON.stringify({
      type: "event",
      installation_id: "inst_1",
      event: {
        type: "command",
        data: { command: "unknown_cmd", sender: { id: "u1", name: "Test" } },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await makeSignature(secret, ts, body);

    const db = createMockD1((sql) => {
      if (sql.includes("installations")) {
        return {
          installation_id: "inst_1",
          app_token: "tok_1",
          signing_secret: secret,
          bot_id: "bot_1",
          hub_url: "https://hub.openilink.com",
        };
      }
      return null;
    });

    const res = await app.request("/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": ts,
        "X-Signature": sig,
      },
      body,
    }, { ...DEFAULT_ENV, DB: db });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { reply: string; reply_type: string };
    expect(json.reply).toContain("未知命令");
    expect(json.reply_type).toBe("text");
  });
});

// ── OAuth endpoint tests ─────────────────────────────────────

describe("oauth setup", () => {
  it("redirects to hub authorize with PKCE challenge", async () => {
    const db = createMockD1(() => null);
    const res = await app.request(
      "/oauth/setup?app_id=app_123&bot_id=bot_456&state=hub_state_1&return_url=https://example.com/done",
      { method: "GET" },
      { ...DEFAULT_ENV, DB: db },
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("https://hub.openilink.com/api/apps/app_123/oauth/authorize");
    expect(location).toContain("bot_id=bot_456");
    expect(location).toContain("code_challenge=");
    expect(location).toContain("state=");
    expect(location).toContain("hub_state=hub_state_1");
  });

  it("uses custom hub URL when provided", async () => {
    const db = createMockD1(() => null);
    const res = await app.request(
      "/oauth/setup?hub=https://custom-hub.example.com&app_id=app_123",
      { method: "GET" },
      { ...DEFAULT_ENV, DB: db },
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("https://custom-hub.example.com/api/apps/app_123/oauth/authorize");
  });

  it("falls back to env APP_ID", async () => {
    const db = createMockD1(() => null);
    const res = await app.request(
      "/oauth/setup?bot_id=bot_1",
      { method: "GET" },
      { ...DEFAULT_ENV, APP_ID: "env_app_id", DB: db },
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("/api/apps/env_app_id/");
  });

  it("returns 400 when app_id is missing", async () => {
    const db = createMockD1(() => null);
    const res = await app.request(
      "/oauth/setup?bot_id=bot_1",
      { method: "GET" },
      { ...DEFAULT_ENV, APP_ID: "", DB: db },
    );

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("app_id not provided");
  });
});

describe("oauth callback", () => {
  it("returns 400 when code is missing", async () => {
    const db = createMockD1(() => null);
    const res = await app.request(
      "/oauth/callback?state=some_state",
      { method: "GET" },
      { ...DEFAULT_ENV, DB: db },
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("missing code or state");
  });

  it("returns 400 when state is missing", async () => {
    const db = createMockD1(() => null);
    const res = await app.request(
      "/oauth/callback?code=some_code",
      { method: "GET" },
      { ...DEFAULT_ENV, DB: db },
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("missing code or state");
  });

  it("returns 400 for unknown state", async () => {
    const db = createMockD1(() => null); // no pkce_states found
    const res = await app.request(
      "/oauth/callback?code=auth_code&state=unknown_state",
      { method: "GET" },
      { ...DEFAULT_ENV, DB: db },
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("invalid or expired state");
  });

  it("returns 400 for expired state", async () => {
    const db = createMockD1((sql) => {
      if (sql.includes("pkce_states")) {
        return {
          code_verifier: "verifier_123",
          hub_url: "https://hub.openilink.com",
          app_id: "app_123",
          return_url: "",
          expires_at: Math.floor(Date.now() / 1000) - 100, // expired
        };
      }
      return null;
    });

    const res = await app.request(
      "/oauth/callback?code=auth_code&state=expired_state",
      { method: "GET" },
      { ...DEFAULT_ENV, DB: db },
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("invalid or expired state");
  });

  it("exchanges code and redirects on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          installation_id: "inst_new",
          app_token: "tok_new",
          webhook_secret: "sec_new",
          bot_id: "bot_new",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const db = createMockD1((sql) => {
      if (sql.includes("pkce_states")) {
        return {
          code_verifier: "verifier_123",
          hub_url: "https://hub.openilink.com",
          app_id: "app_123",
          return_url: "https://example.com/done",
          expires_at: Math.floor(Date.now() / 1000) + 600,
        };
      }
      return null;
    });

    const res = await app.request(
      "/oauth/callback?code=auth_code_123&state=valid_state",
      { method: "GET", redirect: "manual" },
      { ...DEFAULT_ENV, DB: db },
      MOCK_EXEC_CTX,
    );

    // Verify exchange was called
    expect(fetchMock).toHaveBeenCalled();
    const [exchangeUrl, exchangeInit] = fetchMock.mock.calls[0];
    expect(exchangeUrl).toBe("https://hub.openilink.com/api/apps/app_123/oauth/exchange");
    expect(JSON.parse(exchangeInit.body)).toEqual({
      code: "auth_code_123",
      code_verifier: "verifier_123",
    });

    // Verify redirect
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/done");

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("falls back to hub/oauth/complete when no return_url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          installation_id: "inst_new",
          app_token: "tok_new",
          webhook_secret: "sec_new",
          bot_id: "bot_new",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const db = createMockD1((sql) => {
      if (sql.includes("pkce_states")) {
        return {
          code_verifier: "v",
          hub_url: "https://hub.openilink.com",
          app_id: "app_1",
          return_url: "",
          expires_at: Math.floor(Date.now() / 1000) + 600,
        };
      }
      return null;
    });

    const res = await app.request(
      "/oauth/callback?code=c&state=s",
      { method: "GET", redirect: "manual" },
      { ...DEFAULT_ENV, DB: db },
      MOCK_EXEC_CTX,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://hub.openilink.com/oauth/complete");

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});

// ── health endpoint ──────────────────────────────────────────

describe("health", () => {
  it("returns ok", async () => {
    const res = await app.request("/", { method: "GET" }, { ...DEFAULT_ENV, DB: createMockD1(() => null) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

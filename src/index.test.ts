import { describe, it, expect } from "vitest";

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

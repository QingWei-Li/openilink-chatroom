import { D1Database } from "@cloudflare/workers-types";
import { broadcast, getUserRoom, getNick } from "./db";

interface Sender {
  id: string;
  name: string;
}
interface Installation {
  installation_id: string;
  app_token: string;
  hub_url: string;
}

// ── format helpers ──────────────────────────────────────────────

function header(text: string) {
  return `══ ${text} ══`;
}

// ── command handlers ────────────────────────────────────────────

export async function handleJoin(
  db: D1Database,
  inst: Installation,
  sender: Sender,
  args: string,
  traceId?: string,
): Promise<string> {
  const roomName = args.trim().toLowerCase().replace(/^#/, "");
  if (!roomName) return "用法：/join <房间名>";

  // Leave current room first
  const current = await getUserRoom(db, sender.id, inst.installation_id);
  if (current) {
    await db
      .prepare("DELETE FROM members WHERE room_id = ? AND user_id = ?")
      .bind(current.room_id, sender.id)
      .run();
    await broadcast(
      db,
      current.room_id,
      sender.id,
      `＊ ${sender.name} 离开了 #${current.name}`,
      inst.hub_url,
      inst.app_token,
      traceId,
    );
  }

  // Upsert room
  const roomId = `${inst.installation_id}:${roomName}`;
  await db
    .prepare("INSERT OR IGNORE INTO rooms (id, name, installation_id) VALUES (?, ?, ?)")
    .bind(roomId, roomName, inst.installation_id)
    .run();

  const room = await db
    .prepare("SELECT topic FROM rooms WHERE id = ?")
    .bind(roomId)
    .first<{ topic: string }>();

  // Insert member with default nick
  const nick = sender.name || sender.id.slice(-6);
  await db
    .prepare("INSERT OR REPLACE INTO members (room_id, user_id, nick) VALUES (?, ?, ?)")
    .bind(roomId, sender.id, nick)
    .run();

  // Broadcast join notice to others
  await broadcast(
    db,
    roomId,
    sender.id,
    `＊ ${nick} 加入了 #${roomName}`,
    inst.hub_url,
    inst.app_token,
    traceId,
  );

  // Build member list for reply
  const { results } = await db
    .prepare("SELECT nick FROM members WHERE room_id = ?")
    .bind(roomId)
    .all<{ nick: string }>();
  const memberList = results.map((r) => r.nick).join("、");

  const lines = [header(`#${roomName}`)];
  if (room?.topic) lines.push(`话题：${room.topic}`);
  lines.push(`在线：${memberList}`);
  lines.push(`＊ 你加入了房间`);
  return lines.join("\n");
}

export async function handleLeave(
  db: D1Database,
  inst: Installation,
  sender: Sender,
  traceId?: string,
): Promise<string> {
  const current = await getUserRoom(db, sender.id, inst.installation_id);
  if (!current) return "你还没有加入任何房间";

  const nick = await getNick(db, sender.id, current.room_id);
  await db
    .prepare("DELETE FROM members WHERE room_id = ? AND user_id = ?")
    .bind(current.room_id, sender.id)
    .run();
  await broadcast(
    db,
    current.room_id,
    sender.id,
    `＊ ${nick} 离开了 #${current.name}`,
    inst.hub_url,
    inst.app_token,
    traceId,
  );

  return `＊ 你离开了 #${current.name}`;
}

export async function handleWho(
  db: D1Database,
  inst: Installation,
  sender: Sender,
): Promise<string> {
  const current = await getUserRoom(db, sender.id, inst.installation_id);
  if (!current) return "你还没有加入任何房间\n发送 /rooms 查看房间列表";

  const { results } = await db
    .prepare("SELECT user_id, nick FROM members WHERE room_id = ?")
    .bind(current.room_id)
    .all<{ user_id: string; nick: string }>();

  const lines = [header(`#${current.name} 成员`)];
  for (const m of results) {
    lines.push(`· ${m.nick}${m.user_id === sender.id ? "（你）" : ""}`);
  }
  lines.push(`共 ${results.length} 人在线`);
  return lines.join("\n");
}

export async function handleRooms(db: D1Database, inst: Installation): Promise<string> {
  const { results } = await db
    .prepare(
      `
    SELECT r.name, COUNT(m.user_id) as cnt
    FROM rooms r
    LEFT JOIN members m ON m.room_id = r.id
    WHERE r.installation_id = ?
    GROUP BY r.id
    ORDER BY cnt DESC
  `,
    )
    .bind(inst.installation_id)
    .all<{ name: string; cnt: number }>();

  if (!results.length) return "暂无房间\n发送 /join <名称> 创建第一个房间";

  const lines = [header("聊天室列表")];
  for (const r of results) lines.push(`#${r.name}  ${r.cnt}人`);
  lines.push("发送 /join <名称> 加入");
  return lines.join("\n");
}

export async function handleNick(
  db: D1Database,
  inst: Installation,
  sender: Sender,
  args: string,
  traceId?: string,
): Promise<string> {
  const newNick = args.trim();
  if (!newNick) return "用法：/nick <昵称>";

  const current = await getUserRoom(db, sender.id, inst.installation_id);
  if (!current) return "请先 /join 加入一个房间";

  const oldNick = await getNick(db, sender.id, current.room_id);
  await db
    .prepare("UPDATE members SET nick = ? WHERE room_id = ? AND user_id = ?")
    .bind(newNick, current.room_id, sender.id)
    .run();
  await broadcast(
    db,
    current.room_id,
    sender.id,
    `＊ ${oldNick} 改名为 ${newNick}`,
    inst.hub_url,
    inst.app_token,
    traceId,
  );

  return `＊ 你的昵称已改为 ${newNick}`;
}

export async function handleTopic(
  db: D1Database,
  inst: Installation,
  sender: Sender,
  args: string,
  traceId?: string,
): Promise<string> {
  const topic = args.trim();
  if (!topic) return "用法：/topic <话题内容>";

  const current = await getUserRoom(db, sender.id, inst.installation_id);
  if (!current) return "请先 /join 加入一个房间";

  const nick = await getNick(db, sender.id, current.room_id);
  await db.prepare("UPDATE rooms SET topic = ? WHERE id = ?").bind(topic, current.room_id).run();
  await broadcast(
    db,
    current.room_id,
    sender.id,
    `＊ ${nick} 将话题设为：${topic}`,
    inst.hub_url,
    inst.app_token,
    traceId,
  );

  return `＊ 话题已更新：${topic}`;
}

// ── message broadcast ───────────────────────────────────────────

export async function handleMessage(
  db: D1Database,
  inst: Installation,
  sender: Sender,
  text: string,
  traceId?: string,
): Promise<string | null> {
  const current = await getUserRoom(db, sender.id, inst.installation_id);
  if (!current) return "发送 /join <房间名> 加入聊天室";

  const nick = await getNick(db, sender.id, current.room_id);
  await broadcast(
    db,
    current.room_id,
    sender.id,
    `<${nick}> ${text}`,
    inst.hub_url,
    inst.app_token,
    traceId,
  );

  return null; // no reply to sender needed
}

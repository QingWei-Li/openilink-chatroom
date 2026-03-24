import { D1Database } from "@cloudflare/workers-types";
import { botSend } from "./botapi";

// Broadcast a message to all room members except the sender
export async function broadcast(
  db: D1Database,
  roomId: string,
  excludeUserId: string,
  text: string,
  hubUrl: string,
  appToken: string,
): Promise<void> {
  const { results } = await db
    .prepare("SELECT user_id FROM members WHERE room_id = ? AND user_id != ?")
    .bind(roomId, excludeUserId)
    .all<{ user_id: string }>();

  await Promise.all(results.map((r) => botSend(hubUrl, appToken, r.user_id, text)));
}

// Get the room a user is currently in (for this installation)
export async function getUserRoom(
  db: D1Database,
  userId: string,
  installationId: string,
): Promise<{ room_id: string; name: string; topic: string } | null> {
  return db
    .prepare(
      `
      SELECT m.room_id, r.name, r.topic
      FROM members m
      JOIN rooms r ON r.id = m.room_id
      WHERE m.user_id = ? AND r.installation_id = ?
    `,
    )
    .bind(userId, installationId)
    .first<{ room_id: string; name: string; topic: string }>();
}

// Get or create a nick for a user (defaults to shortened user_id)
export async function getNick(db: D1Database, userId: string, roomId: string): Promise<string> {
  const row = await db
    .prepare("SELECT nick FROM members WHERE room_id = ? AND user_id = ?")
    .bind(roomId, userId)
    .first<{ nick: string }>();
  return row?.nick ?? userId.slice(-6);
}

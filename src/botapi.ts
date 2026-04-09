// Send a message via Hub Bot API
export async function botSend(
  hubUrl: string,
  appToken: string,
  to: string,
  content: string,
  traceId?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${appToken}`,
    "Content-Type": "application/json",
  };
  if (traceId) headers["X-Trace-Id"] = traceId;

  await fetch(`${hubUrl}/bot/v1/message/send`, {
    method: "POST",
    headers,
    body: JSON.stringify({ to, type: "text", content }),
  });
}

// Send a message via Hub Bot API
export async function botSend(
  hubUrl: string,
  appToken: string,
  to: string,
  content: string,
): Promise<void> {
  await fetch(`${hubUrl}/bot/v1/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, content }),
  });
}

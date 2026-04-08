export interface InstallCredentials {
  installationId: string;
  appToken: string;
  webhookSecret: string;
  botId: string;
  hubUrl: string;
}

export function parseInstallPayload(
  body: Record<string, string | undefined>,
): InstallCredentials | null {
  const installationId = body.installation_id;
  const appToken = body.app_token;
  const webhookSecret = body.webhook_secret ?? body.signing_secret;
  const botId = body.bot_id;
  const hubUrl = body.hub_url;

  if (!installationId || !appToken || !webhookSecret || !botId || !hubUrl) {
    return null;
  }

  return {
    installationId,
    appToken,
    webhookSecret,
    botId,
    hubUrl,
  };
}

export function getEventType(envelope: { type?: string; event?: { type?: string } }): string {
  return envelope.event?.type ?? "";
}

// Extract command args: prefer structured args.text (AI Agent), fallback to text
export function getCommandArgs(envelope: {
  event?: { data?: { args?: { text?: string }; text?: string; [k: string]: unknown } };
}): string {
  const data = envelope.event?.data;
  if (!data) return "";
  const argsText = data.args?.text;
  if (typeof argsText === "string" && argsText) return argsText;
  return typeof data.text === "string" ? data.text : "";
}

export function getTraceId(envelope: { trace_id?: unknown }): string {
  return typeof envelope.trace_id === "string" ? envelope.trace_id : "";
}

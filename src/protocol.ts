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

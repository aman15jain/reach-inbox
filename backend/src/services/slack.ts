import axios from "axios";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";

const SLACK_SCOPES = "chat:write,incoming-webhook";

export function buildSlackAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.slackClientId,
    scope: SLACK_SCOPES,
    redirect_uri: `${env.backendUrl}/api/slack/callback`,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

interface SlackOAuthResponse {
  ok: boolean;
  access_token: string;
  team: { id: string; name: string };
  incoming_webhook?: { url: string; channel: string };
  error?: string;
}

export async function exchangeSlackCode(code: string) {
  const { data } = await axios.post<SlackOAuthResponse>(
    "https://slack.com/api/oauth.v2.access",
    new URLSearchParams({
      client_id: env.slackClientId,
      client_secret: env.slackClientSecret,
      code,
      redirect_uri: `${env.backendUrl}/api/slack/callback`,
    })
  );
  if (!data.ok) {
    throw new Error(`Slack OAuth failed: ${data.error}`);
  }
  return data;
}

/**
 * Posts a message to the user's connected Slack. Silently no-ops if the
 * user never connected Slack (per spec: "no crash" when disconnected), and
 * never throws into the worker's send path — a Slack outage must not block
 * or fail an otherwise-successful rate-limit reschedule.
 */
export async function notifySlackRateLimitHit(userId: string, message: string): Promise<void> {
  const integration = await prisma.slackIntegration.findUnique({ where: { userId } });
  if (!integration) return;

  try {
    if (integration.webhookUrl) {
      await axios.post(integration.webhookUrl, { text: message });
      return;
    }
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      { channel: integration.channel ?? "#general", text: message },
      { headers: { Authorization: `Bearer ${integration.accessToken}` } }
    );
  } catch (err) {
    console.error("[slack] notification failed", (err as Error).message);
  }
}

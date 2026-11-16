/**
 * The webhook receiver: where 4Shadow sends an alert's notifications (its webhook_url), through a
 * tunnel when you run the lab locally. This is the only route the internet can reach.
 *
 * It does what your own receiver should: verify the signature on the raw body with verifyWebhook()
 * before trusting anything in it, answer 2xx quickly, and treat a repeated webhook-id as a retry.
 */
import { verifyWebhook, WebhookVerificationError } from "@similie/4shadow";
import type { RequestHandler } from "@sveltejs/kit";
import { record, secretFor } from "#lib/server/rig.ts";

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();
  const webhookId = request.headers.get("webhook-id") ?? "";

  // One secret per alert, so look up which alert this claims to be for. Nothing else in the body is
  // trusted until the signature checks out.
  let alertId: string | null = null;
  try {
    alertId = JSON.parse(body)?.data?.alert?.id ?? null;
  } catch {
    // verifyWebhook reports it
  }
  const secret = alertId ? secretFor(alertId) : undefined;
  if (!secret) {
    const error = alertId
      ? `No secret for alert ${alertId} here. Rotate its secret in the lab, which keeps the new one.`
      : "Not a 4Shadow alert notification";
    record({ webhookId, verified: false, alertId, error });
    return new Response(error, { status: 400 });
  }

  try {
    const webhook = await verifyWebhook(secret, request.headers, body);
    const entry = record({ webhookId, verified: true, alertId, webhook });
    console.log(`[hooks] ${webhook.type} for "${webhook.data.alert.name}"${entry.duplicate ? " (retry)" : ""}`);
    return new Response(null, { status: 204 });
  } catch (e) {
    if (!(e instanceof WebhookVerificationError)) throw e;
    record({ webhookId, verified: false, alertId, error: e.message });
    return new Response(e.message, { status: 400 });
  }
};

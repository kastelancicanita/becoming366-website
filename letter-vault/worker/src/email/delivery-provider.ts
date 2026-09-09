import type { DeliveryProviderId } from "../lib/surprise-delivery-policy";
import type { Env } from "../env";
import { sendViaMailerSend } from "./mailersend-client";
import { sendViaResend } from "./resend-client";

export interface FutureDeliveryPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  letterId: string;
}

export interface DeliveryProviderSendResult {
  ok: boolean;
  providerId: DeliveryProviderId;
  providerMessageId: string | null;
  errorSummary: string | null;
}

export interface DeliveryProvider {
  readonly id: DeliveryProviderId;
  sendFutureDelivery(
    env: Env,
    payload: FutureDeliveryPayload,
  ): Promise<DeliveryProviderSendResult>;
}

class ResendDeliveryProvider implements DeliveryProvider {
  readonly id = "resend" as const;

  async sendFutureDelivery(
    env: Env,
    payload: FutureDeliveryPayload,
  ): Promise<DeliveryProviderSendResult> {
    const result = await sendViaResend(env, {
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
    return {
      ok: result.ok,
      providerId: this.id,
      providerMessageId: result.providerMessageId,
      errorSummary: result.errorSummary,
    };
  }
}

class MailerSendDeliveryProvider implements DeliveryProvider {
  readonly id = "mailersend" as const;

  async sendFutureDelivery(
    env: Env,
    payload: FutureDeliveryPayload,
  ): Promise<DeliveryProviderSendResult> {
    const result = await sendViaMailerSend(env, {
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
    return {
      ok: result.ok,
      providerId: this.id,
      providerMessageId: result.providerMessageId,
      errorSummary: result.errorSummary,
    };
  }
}

const resendDeliveryProvider = new ResendDeliveryProvider();
const mailerSendDeliveryProvider = new MailerSendDeliveryProvider();

const DELIVERY_PROVIDERS: Record<DeliveryProviderId, DeliveryProvider> = {
  resend: resendDeliveryProvider,
  mailersend: mailerSendDeliveryProvider,
};

export function getDeliveryProvider(id: DeliveryProviderId): DeliveryProvider {
  return DELIVERY_PROVIDERS[id];
}

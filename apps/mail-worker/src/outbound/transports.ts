import nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { AppConfig } from '@catchbox/config';

export interface OutboundPayload {
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string;
  htmlBody: string | null;
  messageIdHeader: string;
  inReplyTo: string | null;
  signedRaw: string | null;
  attachments: { filename: string; contentType: string; content: Buffer }[];
}

export interface SendResult {
  ok: boolean;
  response: string;
  permanentFailure?: boolean;
}

async function sendSelfHosted(cfg: AppConfig, p: OutboundPayload): Promise<SendResult> {
  if (!p.signedRaw) return { ok: false, response: 'DKIM key not configured', permanentFailure: true };
  const transport = nodemailer.createTransport({
    host: cfg.SELF_HOSTED_SMTP_HOST,
    port: cfg.SELF_HOSTED_SMTP_PORT,
    secure: false,
    ignoreTLS: true,
  });
  try {
    const info = await transport.sendMail({
      envelope: {
        from: p.fromAddress,
        to: [...p.to, ...p.cc, ...p.bcc],
      },
      raw: p.signedRaw,
    });
    return { ok: true, response: info.response ?? 'queued' };
  } catch (err) {
    const e = err as { code?: string; responseCode?: number; message: string };
    const permanent = (e.responseCode ?? 0) >= 500 || /^5\d\d/.test(e.message);
    return { ok: false, response: e.message, permanentFailure: permanent };
  } finally {
    transport.close();
  }
}

async function sendSes(cfg: AppConfig, p: OutboundPayload): Promise<SendResult> {
  if (!cfg.SES_ACCESS_KEY || !cfg.SES_SECRET_KEY || !cfg.SES_REGION) {
    return { ok: false, response: 'SES credentials not configured', permanentFailure: true };
  }
  const client = new SESv2Client({
    region: cfg.SES_REGION,
    credentials: { accessKeyId: cfg.SES_ACCESS_KEY, secretAccessKey: cfg.SES_SECRET_KEY },
  });
  try {
    const res = await client.send(
      new SendEmailCommand({
        FromEmailAddress: p.fromName ? `${p.fromName} <${p.fromAddress}>` : p.fromAddress,
        Destination: {
          ToAddresses: p.to,
          CcAddresses: p.cc.length ? p.cc : undefined,
          BccAddresses: p.bcc.length ? p.bcc : undefined,
        },
        Content: {
          Simple: {
            Subject: { Data: p.subject || '(no subject)', Charset: 'utf-8' },
            Body: {
              Text: { Data: p.textBody, Charset: 'utf-8' },
              ...(p.htmlBody ? { Html: { Data: p.htmlBody, Charset: 'utf-8' } } : {}),
            },
          },
        },
      }),
    );
    return { ok: true, response: res.MessageId ?? 'sent' };
  } catch (err) {
    return { ok: false, response: (err as Error).message, permanentFailure: false };
  }
}

async function sendPostmark(cfg: AppConfig, p: OutboundPayload): Promise<SendResult> {
  if (!cfg.POSTMARK_TOKEN) return { ok: false, response: 'POSTMARK_TOKEN not configured', permanentFailure: true };
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-postmark-server-token': cfg.POSTMARK_TOKEN,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        From: p.fromName ? `${p.fromName} <${p.fromAddress}>` : p.fromAddress,
        To: p.to.join(','),
        Cc: p.cc.join(',') || undefined,
        Bcc: p.bcc.join(',') || undefined,
        Subject: p.subject,
        TextBody: p.textBody,
        HtmlBody: p.htmlBody ?? undefined,
        MessageID: p.messageIdHeader,
        Headers: p.inReplyTo ? [{ Name: 'In-Reply-To', Value: p.inReplyTo }] : undefined,
        Attachments: p.attachments.map((a) => ({
          Name: a.filename,
          Content: a.content.toString('base64'),
          ContentType: a.contentType,
        })),
      }),
    });
    const data = (await res.json()) as { MessageID?: string; Message?: string; ErrorCode?: number };
    if (res.ok) return { ok: true, response: data.MessageID ?? 'sent' };
    return { ok: false, response: data.Message ?? `HTTP ${res.status}`, permanentFailure: res.status >= 400 && res.status < 500 };
  } catch (err) {
    return { ok: false, response: (err as Error).message };
  }
}

async function sendResend(cfg: AppConfig, p: OutboundPayload): Promise<SendResult> {
  if (!cfg.RESEND_API_KEY) return { ok: false, response: 'RESEND_API_KEY not configured', permanentFailure: true };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        from: p.fromName ? `${p.fromName} <${p.fromAddress}>` : p.fromAddress,
        to: p.to,
        cc: p.cc.length ? p.cc : undefined,
        bcc: p.bcc.length ? p.bcc : undefined,
        subject: p.subject || '(no subject)',
        text: p.textBody,
        html: p.htmlBody ?? undefined,
        headers: {
          'Message-ID': p.messageIdHeader,
          ...(p.inReplyTo ? { 'In-Reply-To': p.inReplyTo } : {}),
        },
        attachments: p.attachments.map((a) => ({
          filename: a.filename,
          content: Array.from(a.content),
          content_type: a.contentType,
        })),
      }),
    });
    const data = (await res.json()) as { id?: string; message?: string };
    if (res.ok) return { ok: true, response: data.id ?? 'sent' };
    return { ok: false, response: data.message ?? `HTTP ${res.status}`, permanentFailure: res.status >= 400 && res.status < 500 };
  } catch (err) {
    return { ok: false, response: (err as Error).message };
  }
}

export async function dispatch(cfg: AppConfig, p: OutboundPayload): Promise<SendResult> {
  switch (cfg.MAIL_TRANSPORT) {
    case 'ses':
      return sendSes(cfg, p);
    case 'postmark':
      return sendPostmark(cfg, p);
    case 'resend':
      return sendResend(cfg, p);
    case 'self_hosted':
    default:
      return sendSelfHosted(cfg, p);
  }
}

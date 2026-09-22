/**
 * Outbound alerts (guide Phase 5 step 2).
 *
 * The rule that matters here: a failed alert must never crash the worker or
 * abort a cycle. A monitoring system that stops monitoring because Discord is
 * down is worse than one with no alerting at all, because it looks healthy.
 * Every send is wrapped, every failure is logged, and the worker moves on.
 */
import nodemailer from 'nodemailer';
import { prisma } from './db.js';
import { env } from './env.js';

export type AlertKind = 'opened' | 'recovered';

export interface AlertContext {
  kind: AlertKind;
  incidentId: number;
  serviceName: string;
  monitorUrl: string;
  severity: string;
  message: string;
  /** How many times this exact error has been seen before, if known. */
  seenBefore?: number;
}

const COLOURS: Record<AlertKind, number> = {
  opened: 0xdc2626, // red
  recovered: 0x059669, // green
};

function title(ctx: AlertContext): string {
  return ctx.kind === 'opened'
    ? `${ctx.severity} · ${ctx.serviceName} is DOWN`
    : `${ctx.serviceName} has recovered`;
}

function body(ctx: AlertContext): string {
  const lines = [
    ctx.kind === 'opened' ? `**${ctx.message}**` : 'Checks are passing again.',
    `Monitor: ${ctx.monitorUrl}`,
    `Incident: INC-${ctx.incidentId}`,
  ];
  if (ctx.kind === 'opened' && ctx.seenBefore && ctx.seenBefore > 1) {
    lines.push(`This error has been seen ${ctx.seenBefore} times before.`);
  }
  return lines.join('\n');
}

async function sendDiscord(ctx: AlertContext): Promise<boolean> {
  if (!env.DISCORD_WEBHOOK_URL) return false;

  // Discord will hang a request rather than refuse it under load, so bound it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        username: 'PulseWatch',
        embeds: [
          {
            title: title(ctx),
            description: body(ctx),
            color: COLOURS[ctx.kind],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    if (!response.ok) {
      console.error(`[alerts] discord responded ${response.status}`);
      return false;
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmail(ctx: AlertContext): Promise<boolean> {
  if (!env.SMTP_URL || !env.ALERT_EMAIL_TO) return false;

  const transport = nodemailer.createTransport(env.SMTP_URL);
  await transport.sendMail({
    from: env.ALERT_EMAIL_FROM,
    to: env.ALERT_EMAIL_TO,
    subject: title(ctx),
    text: body(ctx).replace(/\*\*/g, ''),
  });
  return true;
}

/**
 * Fires every configured channel, records what happened on the incident
 * timeline, and swallows anything that goes wrong.
 */
export async function sendAlert(ctx: AlertContext): Promise<void> {
  const delivered: string[] = [];
  const failed: string[] = [];

  for (const [name, send] of [
    ['Discord', sendDiscord],
    ['email', sendEmail],
  ] as const) {
    try {
      if (await send(ctx)) delivered.push(name);
    } catch (err) {
      failed.push(name);
      console.error(`[alerts] ${name} failed:`, err instanceof Error ? err.message : err);
    }
  }

  if (delivered.length === 0 && failed.length === 0) {
    // Nothing configured. Not an error, just a quiet install.
    return;
  }

  try {
    await prisma.incidentEvent.create({
      data: {
        incidentId: ctx.incidentId,
        userId: null,
        type: 'alert_sent',
        message:
          (delivered.length ? `Sent to ${delivered.join(', ')}` : 'No alert delivered') +
          (failed.length ? ` — failed: ${failed.join(', ')}` : ''),
      },
    });
  } catch (err) {
    // Even the bookkeeping is best-effort.
    console.error('[alerts] could not record alert_sent event:', err);
  }
}

// Pluggable email delivery for identity flows (verification + password reset).
//
// Phase 1 ships a dev/console transport that logs the actionable link so the
// full flow is testable with no external dependency. A real provider (Resend /
// SendGrid / SMTP) drops in behind the same EmailProvider interface — select it
// via IDENTITY_EMAIL_PROVIDER once keys are supplied.

import { getIdentityConfig } from '../../../shared/identity/config';
import { writeStructuredLog } from '../../../shared/logging/safeLogging';

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

// Dev transport: never sends a real email. Logs the message (including the
// action link) so developers/tests can complete the flow. The link is emitted
// at `info` so it is visible in normal dev logs.
class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  async send(message: EmailMessage): Promise<void> {
    writeStructuredLog({
      component: 'server',
      module: 'identity',
      event: 'EMAIL_DEV_DELIVERY',
      severity: 'info',
      context: { to: message.to, subject: message.subject, body: message.text },
    });
    // Also print prominently for local dev ergonomics.
    // eslint-disable-next-line no-console
    console.log(`\n[IDENTITY EMAIL → ${message.to}] ${message.subject}\n${message.text}\n`);
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;
  const configured = (process.env.IDENTITY_EMAIL_PROVIDER || 'console').toLowerCase();
  switch (configured) {
    // Future adapters implement EmailProvider and are constructed here once
    // their keys are present. Until then we fall back to the console transport
    // so the flow always works.
    case 'console':
    default:
      provider = new ConsoleEmailProvider();
      break;
  }
  return provider;
}

/** Test helper. */
export function setEmailProvider(next: EmailProvider | null): void {
  provider = next;
}

function appUrl(path: string): string {
  return `${getIdentityConfig().appBaseUrl}${path}`;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = appUrl(`/auth/verify?token=${encodeURIComponent(token)}`);
  const text = `Welcome to AI-Trader. Confirm your email to activate your workspace:\n\n${link}\n\nThis link expires soon. If you didn't create an account, ignore this email.`;
  await getEmailProvider().send({
    to,
    subject: 'Verify your AI-Trader account',
    text,
    html: renderButtonEmail('Verify your email', 'Confirm your email to activate your workspace.', 'Verify email', link),
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = appUrl(`/auth/reset?token=${encodeURIComponent(token)}`);
  const text = `A password reset was requested for your AI-Trader account. Reset it here:\n\n${link}\n\nThis link expires soon. If you didn't request this, you can safely ignore it.`;
  await getEmailProvider().send({
    to,
    subject: 'Reset your AI-Trader password',
    text,
    html: renderButtonEmail('Reset your password', 'A password reset was requested for your account.', 'Reset password', link),
  });
}

function renderButtonEmail(heading: string, body: string, cta: string, link: string): string {
  // Minimal, self-contained dark HTML matching the enterprise aesthetic.
  return `<!doctype html><html><body style="margin:0;background:#04070e;font-family:Arial,Helvetica,sans-serif;color:#eef2fa;padding:32px">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#0a111c;border-radius:8px;padding:32px">
    <tr><td>
      <h1 style="font-size:18px;margin:0 0 12px;color:#eef2fa">${heading}</h1>
      <p style="font-size:14px;line-height:1.6;color:#93a3ba;margin:0 0 24px">${body}</p>
      <a href="${link}" style="display:inline-block;background:#f5a623;color:#04070e;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:6px;font-size:14px">${cta}</a>
      <p style="font-size:12px;color:#5c6b81;margin:24px 0 0;word-break:break-all">${link}</p>
    </td></tr>
  </table></body></html>`;
}

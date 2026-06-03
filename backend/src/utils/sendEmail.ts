import { randomInt } from 'crypto';
import { Resend } from 'resend';

export function generateResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Chewabl <noreply@chewabl.app>';

  if (!apiKey) {
    // Dev/test fallback — code readable in console
    console.log(`[sendEmail] to=${to} | subject=${subject}\n${html}`);
    return;
  }

  const resend = new Resend(apiKey);
  try {
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) {
      console.error('[sendEmail] Resend error:', error);
    }
  } catch (err) {
    console.error('[sendEmail] unexpected error:', err);
    // Never rethrow — email failure must not 500 the endpoint
  }
}

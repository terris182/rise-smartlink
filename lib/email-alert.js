/**
 * Minimal SendGrid email sender for curator failsafe alerts.
 * Sends from a verified Rise sender to the alert recipient. No-ops (returns a
 * reason) if env isn't configured, so a missing key never crashes the cron.
 *
 * Env:
 * - SENDGRID_API_KEY
 * - CURATOR_ALERT_FROM (default notifications@rise.la — verified sender)
 * - CURATOR_ALERT_TO   (default terris@rise.la)
 */
export async function sendAlert(subject, text) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return { sent: false, reason: 'SENDGRID_API_KEY not set' };
  const from = process.env.CURATOR_ALERT_FROM || 'notifications@rise.la';
  const to = process.env.CURATOR_ALERT_TO || 'terris@rise.la';

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: 'GudMuzik Curator' },
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
  });
  if (res.status === 202) return { sent: true, to };
  const body = await res.text();
  return { sent: false, reason: `SendGrid ${res.status}: ${body.slice(0, 200)}` };
}

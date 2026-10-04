import type { OutgoingMail } from '../../infrastructure/mail/mail.types.js';

interface LinkEmail {
  to: string;
  name: string;
  link: string;
}

export function verificationEmail({ to, name, link }: LinkEmail): OutgoingMail {
  const first = firstName(name);
  return {
    to,
    subject: 'Confirm your email for TaskNest',
    text: [
      `Hi ${first},`,
      '',
      'Confirm this is your email address so we can send you conversation alerts and account notices:',
      link,
      '',
      'The link works for 48 hours. If you did not create a TaskNest account, you can ignore this email.',
    ].join('\n'),
    html: layout(`
      <p>Hi ${escape(first)},</p>
      <p>Confirm this is your email address so we can send you conversation alerts and account notices.</p>
      ${button(link, 'Confirm email')}
      <p class="muted">The link works for 48 hours. If you did not create a TaskNest account, you can ignore this email.</p>
    `),
  };
}

export function passwordResetEmail({ to, name, link }: LinkEmail): OutgoingMail {
  const first = firstName(name);
  return {
    to,
    subject: 'Reset your TaskNest password',
    text: [
      `Hi ${first},`,
      '',
      'Someone asked to reset the password for this account. If that was you, choose a new one here:',
      link,
      '',
      'The link works for one hour and signs you out everywhere else once used.',
      'If you did not ask for this, ignore this email. Your password has not changed.',
    ].join('\n'),
    html: layout(`
      <p>Hi ${escape(first)},</p>
      <p>Someone asked to reset the password for this account. If that was you, choose a new one below.</p>
      ${button(link, 'Choose a new password')}
      <p class="muted">The link works for one hour and signs you out everywhere else once used.
      If you did not ask for this, ignore this email. Your password has not changed.</p>
    `),
  };
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there';
}

function button(href: string, label: string): string {
  return `<p><a href="${escape(href)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#1467fb;color:#fff;text-decoration:none;font-weight:500">${escape(label)}</a></p>
  <p class="muted">Or paste this link into your browser:<br><span style="word-break:break-all">${escape(href)}</span></p>`;
}

function layout(body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;font-size:14px;line-height:1.55">
  <style>.muted{color:#64748b;font-size:13px}</style>
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px">
  <p style="font-weight:600;margin-top:0">TaskNest</p>${body}</div></body></html>`;
}

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

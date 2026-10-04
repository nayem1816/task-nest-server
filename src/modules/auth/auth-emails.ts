import {
  emailButton,
  emailLayout,
  emailMuted,
  escapeHtml,
  firstName,
} from '../../infrastructure/mail/email-layout.js';
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
    html: emailLayout(`
      <p>Hi ${escapeHtml(first)},</p>
      <p>Confirm this is your email address so we can send you conversation alerts and account notices.</p>
      ${emailButton(link, 'Confirm email')}
      ${emailMuted('The link works for 48 hours. If you did not create a TaskNest account, you can ignore this email.')}
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
    html: emailLayout(`
      <p>Hi ${escapeHtml(first)},</p>
      <p>Someone asked to reset the password for this account. If that was you, choose a new one below.</p>
      ${emailButton(link, 'Choose a new password')}
      ${emailMuted('The link works for one hour and signs you out everywhere else once used. If you did not ask for this, ignore this email. Your password has not changed.')}
    `),
  };
}

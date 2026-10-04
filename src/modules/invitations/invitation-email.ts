import {
  emailButton,
  emailLayout,
  emailMuted,
  escapeHtml,
} from '../../infrastructure/mail/email-layout.js';
import type { OutgoingMail } from '../../infrastructure/mail/mail.types.js';

interface InvitationEmail {
  to: string;
  inviterName: string;
  organizationName: string;
  roleName: string;
  link: string;
}

export function invitationEmail(params: InvitationEmail): OutgoingMail {
  const { to, inviterName, organizationName, roleName, link } = params;
  const role = roleName.toLowerCase();
  return {
    to,
    subject: `${inviterName} invited you to ${organizationName} on TaskNest`,
    text: [
      `${inviterName} invited you to join ${organizationName} on TaskNest as ${article(role)} ${role}.`,
      '',
      'Accept the invitation here:',
      link,
      '',
      `The link works for 7 days. Sign in or create an account with ${to} to accept it.`,
    ].join('\n'),
    html: emailLayout(`
      <p><strong>${escapeHtml(inviterName)}</strong> invited you to join
      <strong>${escapeHtml(organizationName)}</strong> on TaskNest as ${article(role)} ${escapeHtml(role)}.</p>
      ${emailButton(link, 'Accept invitation')}
      ${emailMuted(`The link works for 7 days. Sign in or create an account with ${escapeHtml(to)} to accept it.`)}
    `),
  };
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}

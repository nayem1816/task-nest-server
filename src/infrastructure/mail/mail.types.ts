export const MAIL_QUEUE = 'mail';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendMailJob extends OutgoingMail {
  /** What triggered the email, for logs and queue inspection. Never the content. */
  kind: string;
}

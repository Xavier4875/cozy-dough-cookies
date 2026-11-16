import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Env vars that hold email addresses (STAFF_NOTIFICATION_EMAIL,
// SES_REPLY_TO_EMAIL) accept one address or several, separated by commas,
// semicolons or spaces. Blanks and repeats are dropped.
export function parseAddressList(value) {
  return [...new Set(String(value ?? '').split(/[\s,;]+/).filter(Boolean))];
}

// Everyone who should get new-order notifications and payment alerts.
export function staffRecipients() {
  return parseAddressList(process.env.STAFF_NOTIFICATION_EMAIL);
}

// Shown in the inbox as the sender's name, so customers see "Cozy Dough
// Cookies" rather than a bare address. SES_SENDER_EMAIL may already carry its
// own name ("Name <addr>"), which is then used untouched.
const SENDER_NAME = 'Cozy Dough Cookies';
export function fromHeader(sender) {
  return sender.includes('<') ? sender : `"${SENDER_NAME}" <${sender}>`;
}

// `toEmail` is one address or an array of them (one message, several
// recipients — used for staff emails). While the SES account is in sandbox
// mode it can only send to addresses that are themselves verified identities;
// production access lifts that.
// `html` is optional — when provided, SES sends a multipart message and
// mail clients that render HTML show that instead of `text`, which stays as
// the fallback for text-only clients either way.
// SES_REPLY_TO_EMAIL (optional) is where a customer's reply goes when they
// answer one of these emails — the sender address itself usually has no inbox.
export async function sendEmail(toEmail, subject, text, html) {
  const sender = process.env.SES_SENDER_EMAIL;
  if (!sender) {
    throw new Error('SES_SENDER_EMAIL is not configured.');
  }
  const replyTo = parseAddressList(process.env.SES_REPLY_TO_EMAIL);
  await sesClient.send(
    new SendEmailCommand({
      Source: fromHeader(sender),
      Destination: { ToAddresses: Array.isArray(toEmail) ? toEmail : [toEmail] },
      ...(replyTo.length > 0 && { ReplyToAddresses: replyTo }),
      Message: {
        Subject: { Data: subject },
        Body: {
          Text: { Data: text },
          ...(html && { Html: { Data: html } }),
        },
      },
    })
  );
}

export async function sendVerificationCodeEmail(toEmail, code) {
  await sendEmail(
    toEmail,
    'Your Cozy Dough Cookies verification code',
    `Your verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`
  );
}

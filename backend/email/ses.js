import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

// SES is in sandbox mode until production access is requested — until then
// it can only send to addresses that are themselves verified identities.
// `html` is optional — when provided, SES sends a multipart message and
// mail clients that render HTML show that instead of `text`, which stays as
// the fallback for text-only clients either way.
export async function sendEmail(toEmail, subject, text, html) {
  const sender = process.env.SES_SENDER_EMAIL;
  if (!sender) {
    throw new Error('SES_SENDER_EMAIL is not configured.');
  }
  await sesClient.send(
    new SendEmailCommand({
      Source: sender,
      Destination: { ToAddresses: [toEmail] },
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

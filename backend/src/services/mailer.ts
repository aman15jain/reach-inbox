import nodemailer, { Transporter } from "nodemailer";

export interface SenderSmtpConfig {
  id: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

// One transporter per sender, reused across sends instead of recreated per
// email (SMTP connection setup is the expensive part of every send).
const transporterCache = new Map<string, Transporter>();

function getTransporter(sender: SenderSmtpConfig): Transporter {
  let transporter = transporterCache.get(sender.id);
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: false,
      auth: { user: sender.smtpUser, pass: sender.smtpPass },
    });
    transporterCache.set(sender.id, transporter);
  }
  return transporter;
}

export async function createEtherealAccount() {
  const account = await nodemailer.createTestAccount();
  return {
    smtpHost: account.smtp.host,
    smtpPort: account.smtp.port,
    smtpUser: account.user,
    smtpPass: account.pass,
  };
}

export interface SendEmailInput {
  from: { email: string; name: string };
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(sender: SenderSmtpConfig, input: SendEmailInput) {
  const transporter = getTransporter(sender);
  const info = await transporter.sendMail({
    from: `"${input.from.name}" <${input.from.email}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info) || undefined,
  };
}

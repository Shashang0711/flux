import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../config/env';

export interface OutgoingEmail {
  to: { email: string; name: string | null };
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
}

/**
 * Sends email over SMTP (SMTP_HOST, …). Without SMTP_HOST, messages are written to the log
 * instead and count as sent, so development works without a mail server.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly logOnly: boolean;

  constructor(config: ConfigService<Env, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true });
    this.logOnly = !host;
    this.transport = host
      ? createTransport({
          host,
          port: config.get('SMTP_PORT', { infer: true }),
          secure: config.get('SMTP_SECURE', { infer: true }) === 'true',
          auth: user
            ? { user, pass: config.get('SMTP_PASSWORD', { infer: true }) ?? '' }
            : undefined,
        })
      : createTransport({ jsonTransport: true });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email.to.name ? { name: email.to.name, address: email.to.email } : email.to.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments: email.attachments,
    });
    if (this.logOnly) {
      this.logger.log(`Email (not sent: SMTP_HOST unset) to ${email.to.email}: ${email.subject}`);
    }
  }
}

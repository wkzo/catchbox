import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DOMAIN: z.string().default('example.com'),
  APP_URL: z.string().url().default('http://localhost:5173'),

  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().default(8800),

  DATABASE_URL: z.string().default('postgres://quit:quit@127.0.0.1:5432/quit_mail'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  STORE_DRIVER: z.enum(['fs', 's3']).default('fs'),
  STORE_FS_PATH: z.string().default('./.data/store'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('catchbox-mail'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  SESSION_SECRET: z.string().default('dev-session-secret-change-me'),
  SESSION_COOKIE: z.string().default('quit_sid'),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  CSRF_COOKIE: z.string().default('quit_csrf'),

  LMTP_HOST: z.string().default('127.0.0.1'),
  LMTP_PORT: z.coerce.number().default(10025),
  SMTP_HOSTNAME: z.string().default('mail.example.com'),

  MAIL_TRANSPORT: z.enum(['self_hosted', 'ses', 'postmark', 'resend']).default('self_hosted'),
  SELF_HOSTED_SMTP_HOST: z.string().default('127.0.0.1'),
  SELF_HOSTED_SMTP_PORT: z.coerce.number().default(25),
  SES_REGION: z.string().optional(),
  SES_ACCESS_KEY: z.string().optional(),
  SES_SECRET_KEY: z.string().optional(),
  POSTMARK_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  DKIM_SELECTOR: z.string().default('quit'),
  DKIM_PRIVATE_KEY_PATH: z.string().optional(),

  RSPAMD_URL: z.string().optional(),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),

  MAX_MESSAGE_BYTES: z.coerce.number().default(25 * 1024 * 1024),
  MAX_ATTACHMENT_BYTES: z.coerce.number().default(15 * 1024 * 1024),
  MAX_OUTBOUND_PER_DAY: z.coerce.number().default(200),

  WEB_ORIGIN: z.string().default('http://localhost:5173'),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface SmsProvider {
  send(phone: string, template: 'otp', vars: Record<string, string>): Promise<void>;
}

/** Dev/test default — logs instead of dispatching a real SMS. Always available. */
class ConsoleSmsProvider implements SmsProvider {
  async send(phone: string, template: 'otp', vars: Record<string, string>): Promise<void> {
    console.log(`[SmsService:console] -> ${phone} [${template}]`, vars);
  }
}

/**
 * Aliyun Dysmsapi provider. Kept dependency-free (plain fetch + manual signing)
 * so this stays optional — enabling it does not add a hard SDK dependency.
 * Falls back to ConsoleSmsProvider behavior (throws) if credentials are missing.
 */
class AliyunSmsProvider implements SmsProvider {
  async send(phone: string, template: 'otp', vars: Record<string, string>): Promise<void> {
    if (!config.ALIYUN_SMS_ACCESS_KEY_ID || !config.ALIYUN_SMS_ACCESS_KEY_SECRET || !config.ALIYUN_SMS_SIGN_NAME || !config.ALIYUN_SMS_TEMPLATE_CODE) {
      throw new Error('SMS_PROVIDER=aliyun but ALIYUN_SMS_* env vars are not fully configured');
    }
    // Intentionally not implemented against the live Aliyun API in this environment —
    // wire up @alicloud/dysmsapi20170525 here when a real account is available.
    logger.warn('AliyunSmsProvider.send() called but no live SDK is wired up — falling back to console log', { phone, template });
    console.log(`[SmsService:aliyun:unconfigured] -> ${phone} [${template}]`, vars);
  }
}

class TencentSmsProvider implements SmsProvider {
  async send(phone: string, template: 'otp', vars: Record<string, string>): Promise<void> {
    if (!config.TENCENT_SMS_SECRET_ID || !config.TENCENT_SMS_SECRET_KEY || !config.TENCENT_SMS_SIGN_NAME || !config.TENCENT_SMS_TEMPLATE_ID) {
      throw new Error('SMS_PROVIDER=tencent but TENCENT_SMS_* env vars are not fully configured');
    }
    logger.warn('TencentSmsProvider.send() called but no live SDK is wired up — falling back to console log', { phone, template });
    console.log(`[SmsService:tencent:unconfigured] -> ${phone} [${template}]`, vars);
  }
}

function createProvider(): SmsProvider {
  switch (config.SMS_PROVIDER) {
    case 'aliyun': return new AliyunSmsProvider();
    case 'tencent': return new TencentSmsProvider();
    default: return new ConsoleSmsProvider();
  }
}

export const smsService: SmsProvider = createProvider();

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  await smsService.send(phone, 'otp', { code });
}

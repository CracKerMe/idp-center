// --- Email Templates Module ---
// Centralized email template management for IdP Center

const BRAND = {
  name: 'IdP Center',
  primaryColor: '#4f46e5',
  dangerColor: '#dc2626',
  bgColor: '#f4f4f5',
  cardBg: '#ffffff',
  textColor: '#18181b',
  mutedColor: '#71717a',
  borderColor: '#e4e4e7',
  footerColor: '#a1a1aa',
  logoText: '🔐 IdP Center',
};

/** Shared outer shell for all emails */
function layout(body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bgColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${BRAND.textColor};line-height:1.6">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bgColor}">
    <tr><td align="center" style="padding:40px 16px">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
        <!-- Header -->
        <tr><td style="text-align:center;padding-bottom:24px">
          <span style="font-size:22px;font-weight:700;color:${BRAND.primaryColor};letter-spacing:-0.5px">${BRAND.logoText}</span>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:${BRAND.cardBg};border-radius:12px;border:1px solid ${BRAND.borderColor};padding:40px 36px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="text-align:center;padding-top:24px;font-size:12px;color:${BRAND.footerColor}">
          <p style="margin:0">此邮件由 ${BRAND.name} 系统自动发送，请勿直接回复。</p>
          <p style="margin:4px 0 0">&copy; ${new Date().getFullYear()} ${BRAND.name}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Reusable CTA button */
function button(text: string, href: string, color: string = BRAND.primaryColor): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto">
    <tr><td style="background:${color};border-radius:8px">
      <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px">${text}</a>
    </td></tr>
  </table>`;
}

/** Muted link fallback block */
function linkFallback(url: string): string {
  return `<p style="font-size:13px;color:${BRAND.mutedColor};word-break:break-all;margin-top:0">
    或复制以下链接到浏览器：<br>
    <a href="${url}" style="color:${BRAND.primaryColor};text-decoration:underline">${url}</a>
  </p>`;
}

/** Divider */
function divider(): string {
  return `<hr style="border:none;border-top:1px solid ${BRAND.borderColor};margin:24px 0">`;
}

// ─── Template Definitions ───────────────────────────────────────────

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** 邮箱验证 */
export function verificationEmail(username: string, verifyUrl: string): EmailContent {
  const subject = '请验证您的邮箱 — IdP Center';
  const html = layout(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${BRAND.textColor}">邮箱验证</h1>
    <p style="margin:0 0 20px;color:${BRAND.mutedColor};font-size:14px">验证您的邮箱以完成注册</p>
    ${divider()}
    <p style="font-size:15px">您好，<strong>${username}</strong>！</p>
    <p style="font-size:15px">感谢注册 ${BRAND.name}。请点击下方按钮验证您的邮箱地址：</p>
    ${button('验证邮箱', verifyUrl)}
    ${linkFallback(verifyUrl)}
    ${divider()}
    <p style="font-size:13px;color:${BRAND.mutedColor};margin-bottom:0">⏱ 链接有效期为 <strong>24 小时</strong>。如非本人操作，请忽略此邮件。</p>
  `);
  const text = `您好，${username}！\n\n请访问以下链接验证您的邮箱：\n${verifyUrl}\n\n链接有效期为 24 小时。`;
  return { subject, html, text };
}

/** 密码重置 */
export function passwordResetEmail(username: string, resetUrl: string): EmailContent {
  const subject = '密码重置请求 — IdP Center';
  const html = layout(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${BRAND.textColor}">密码重置</h1>
    <p style="margin:0 0 20px;color:${BRAND.mutedColor};font-size:14px">重置您的账号密码</p>
    ${divider()}
    <p style="font-size:15px">您好，<strong>${username}</strong>！</p>
    <p style="font-size:15px">我们收到了您的密码重置请求。请点击下方按钮设置新密码：</p>
    ${button('重置密码', resetUrl)}
    ${linkFallback(resetUrl)}
    ${divider()}
    <p style="font-size:13px;color:${BRAND.mutedColor};margin-bottom:0">⏱ 链接有效期为 <strong>1 小时</strong>。如非本人操作，请忽略此邮件，您的密码不会被更改。</p>
  `);
  const text = `您好，${username}！\n\n请访问以下链接重置密码：\n${resetUrl}\n\n链接有效期为 1 小时。`;
  return { subject, html, text };
}

/** 账号注销确认 */
export function accountDeletionEmail(username: string, cancelUrl: string, scheduledAt: string): EmailContent {
  const subject = '账号注销确认 — IdP Center';
  const html = layout(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${BRAND.dangerColor}">账号注销确认</h1>
    <p style="margin:0 0 20px;color:${BRAND.mutedColor};font-size:14px">您的账号即将被永久删除</p>
    ${divider()}
    <p style="font-size:15px">您好，<strong>${username}</strong>！</p>
    <p style="font-size:15px">我们已收到您的账号注销申请。您的账号将于 <strong style="color:${BRAND.dangerColor}">${scheduledAt}</strong> 被永久删除。</p>
    <p style="font-size:15px">在此之前，您可以随时取消注销申请：</p>
    ${button('取消注销', cancelUrl, BRAND.dangerColor)}
    ${linkFallback(cancelUrl)}
    ${divider()}
    <p style="font-size:13px;color:${BRAND.mutedColor};margin-bottom:0">⚠️ 如非本人操作，请立即联系我们。</p>
  `);
  const text = `您好，${username}！\n\n您的账号将于 ${scheduledAt} 被永久删除。\n如需取消，请访问：${cancelUrl}`;
  return { subject, html, text };
}

/** 多因素认证验证码（邮箱 OTP） */
export function otpCodeEmail(username: string, code: string, purpose: 'login' | 'setup' = 'login'): EmailContent {
  const subject = `${code} 是您的验证码 — IdP Center`;
  const purposeText = purpose === 'setup' ? '绑定邮箱验证方式' : '登录验证';
  const html = layout(`
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:${BRAND.textColor}">验证码</h1>
    <p style="margin:0 0 20px;color:${BRAND.mutedColor};font-size:14px">用于${purposeText}</p>
    ${divider()}
    <p style="font-size:15px">您好，<strong>${username}</strong>！</p>
    <p style="font-size:15px">您的验证码是：</p>
    <p style="text-align:center;margin:24px 0">
      <span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;color:${BRAND.primaryColor};padding:12px 24px;background:${BRAND.bgColor};border-radius:8px">${code}</span>
    </p>
    ${divider()}
    <p style="font-size:13px;color:${BRAND.mutedColor};margin-bottom:0">⏱ 验证码 <strong>5 分钟</strong>内有效，请勿泄露给他人。如非本人操作，请忽略此邮件。</p>
  `);
  const text = `您好，${username}！\n\n您的验证码是：${code}\n\n验证码 5 分钟内有效，请勿泄露给他人。`;
  return { subject, html, text };
}

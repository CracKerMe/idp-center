<script setup lang="ts">
const features = [
  {
    icon: '🔐',
    title: '统一身份认证',
    description: '提供集中式的用户身份管理和认证服务，支持多种认证方式，包括用户名密码、OAuth2、OIDC 等。',
    highlights: ['JWT Token 认证', 'Session 管理', '多设备登录支持']
  },
  {
    icon: '🔑',
    title: 'OAuth2 授权码流程',
    description: '完整实现 OAuth 2.0 Authorization Code Flow，支持第三方应用安全接入，实现单点登录 (SSO)。',
    highlights: ['Authorization Code', 'Access Token', 'Refresh Token']
  },
  {
    icon: '🛡️',
    title: '两步验证 (2FA)',
    description: '支持基于 TOTP 的两步验证，使用 Google Authenticator 等应用增强账户安全性。',
    highlights: ['TOTP 标准', '二维码绑定', '动态验证码']
  },
  {
    icon: '🏢',
    title: '多租户架构',
    description: '支持多租户隔离，每个租户可以有独立的用户体系、配置和权限管理。',
    highlights: ['数据隔离', '独立配置', '租户管理']
  },
  {
    icon: '📊',
    title: '审计日志',
    description: '完整的操作审计追踪，记录所有用户行为和系统事件，支持日志查询和分析。',
    highlights: ['登录追踪', '操作记录', '安全审计']
  },
  {
    icon: '⚡',
    title: '高性能架构',
    description: '基于现代技术栈构建，响应迅速，支持高并发访问，易于扩展和部署。',
    highlights: ['SQLite 数据库', 'Express 后端', 'RESTful API']
  }
]

const useCases = [
  {
    title: '企业内部系统',
    description: '为企业内部的多个应用提供统一的登录入口，用户只需一次登录即可访问所有授权系统。',
    icon: '🏢'
  },
  {
    title: 'SaaS 平台',
    description: '作为 SaaS 产品的身份中心，支持多租户隔离和独立的用户管理体系。',
    icon: '☁️'
  },
  {
    title: '第三方应用接入',
    description: '通过 OAuth2 协议，允许第三方应用安全接入，用户可授权访问其数据。',
    icon: '🔌'
  },
  {
    title: 'API 服务认证',
    description: '为微服务架构提供统一的认证中心，保护 API 端点安全。',
    icon: '🔧'
  }
]

const techStack = [
  { name: 'Node.js', description: '后端运行环境' },
  { name: 'Express', description: 'Web 应用框架' },
  { name: 'SQLite', description: '轻量级数据库' },
  { name: 'JWT', description: 'JSON Web Token' },
  { name: 'bcrypt', description: '密码加密' },
  { name: 'otplib', description: 'TOTP 生成验证' }
]
</script>

<template>
  <div class="about-page">
    <!-- Hero Section -->
    <section class="hero-container">
      <div class="hero-mesh"></div>
      <div class="hero-content">
        <div class="hero-badge mb-6">
          <span class="badge-dot"></span>
          Next-Gen Identity Hub
        </div>
        <h1 class="hero-title mb-6">Unifying Identity <br/><span class="text-gradient">Without Compromise</span></h1>
        <p class="hero-subtitle mb-8">
          A secure, modular, and developer-first identity provider architecture designed to protect your digital ecosystem with military-grade precision.
        </p>
        <div class="hero-actions">
          <router-link to="/register" class="btn btn-primary btn-glow-hero">
            Start Securing Today
          </router-link>
          <router-link to="/" class="btn glass-btn-hero">
            View Live Demo
          </router-link>
        </div>
      </div>
    </section>

    <!-- Core Features -->
    <section class="features-section">
      <div class="text-center mb-12">
        <div class="section-badge mb-4">Core Capabilities</div>
        <h2 style="font-size: 2.5rem; color: var(--slate-900);">Engineered for Impact</h2>
      </div>
      
      <div class="grid grid-3">
        <div 
          v-for="feature in features" 
          :key="feature.title"
          class="premium-card feature-tile"
        >
          <div class="tile-icon mb-6">{{ feature.icon }}</div>
          <h4 class="mb-3" style="font-size: 1.25rem;">{{ feature.title }}</h4>
          <p class="text-sm text-muted mb-6" style="line-height: 1.7; color: var(--slate-500);">
            {{ feature.description }}
          </p>
          <div class="tile-tags">
            <span 
              v-for="highlight in feature.highlights" 
              :key="highlight"
              class="tag-pill"
            >
              {{ highlight }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- Use Cases & Tech Stack -->
    <section class="grid grid-2" style="gap: var(--space-8); align-items: stretch;">
      <div class="premium-card glass-v2">
        <div class="card-header-icon mb-6">🚀</div>
        <h3 class="mb-8" style="font-size: 1.75rem;">Application Scenarios</h3>
        <div class="use-case-list">
          <div 
            v-for="useCase in useCases" 
            :key="useCase.title"
            class="use-case-item"
          >
            <div class="use-case-icon">{{ useCase.icon }}</div>
            <div class="use-case-text">
              <h4 class="mb-1" style="font-size: 1rem; font-weight: 700;">{{ useCase.title }}</h4>
              <p class="text-xs text-muted" style="margin-bottom: 0; color: var(--slate-500);">{{ useCase.description }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="premium-card glass-v2 tech-stack-container">
        <div class="card-header-icon mb-6">🛠️</div>
        <h3 class="mb-8" style="font-size: 1.75rem;">Technology Stack</h3>
        <div class="tech-grid">
          <div 
            v-for="tech in techStack" 
            :key="tech.name"
            class="tech-item"
          >
            <div class="tech-name">{{ tech.name }}</div>
            <div class="tech-desc">{{ tech.description }}</div>
          </div>
        </div>

        <div class="security-banner mt-12">
          <div class="banner-glow"></div>
          <h4 style="color: white; font-size: 1.125rem;" class="mb-2">Security-First</h4>
          <p class="text-xs" style="color: var(--primary-100); opacity: 0.8; margin-bottom: 0; line-height: 1.5;">
            Built with defense-in-depth principles: zero-trust verification and PKCE-secured flows.
          </p>
        </div>
      </div>
    </section>

    <!-- Final Call to Action -->
    <section class="footer-cta-container">
      <div class="cta-mesh"></div>
      <div class="cta-content">
        <h2 class="cta-title mb-4">Ready to Secure Your Future?</h2>
        <p class="cta-subtitle mb-8">
          Join a global community of developers. IDP Center is enterprise-ready.
        </p>
        <div class="cta-btns">
          <router-link to="/register" class="btn btn-primary btn-glow-active">
            Get Started Now &rarr;
          </router-link>
          <router-link to="/login" class="btn glass-btn-dark">
            Member Access
          </router-link>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.about-page {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 80px; 
  padding: 0 var(--space-6) 80px; /* Added horizontal padding */
}

/* --- Hero Section --- */
.hero-container {
  position: relative;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  padding: var(--space-12) var(--space-8); /* Adjusted hero padding */
  min-height: 540px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  background-color: #020617;
  box-shadow: var(--shadow-2xl);
}

.hero-mesh {
  position: absolute;
  inset: 0;
  background-image: 
    radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), 
    radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), 
    radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%), 
    radial-gradient(at 0% 100%, hsla(339,49%,30%,1) 0, transparent 50%), 
    radial-gradient(at 50% 100%, hsla(225,39%,30%,1) 0, transparent 50%), 
    radial-gradient(at 100% 100%, hsla(253,16%,7%,1) 0, transparent 50%);
  filter: blur(80px);
  opacity: 0.6;
  animation: mesh-float 30s ease-in-out infinite alternate;
}

@keyframes mesh-float {
  0% { transform: scale(1) translate(0, 0); }
  100% { transform: scale(1.2) translate(5%, 5%); }
}

.hero-content { position: relative; z-index: 10; max-width: 850px; }

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.6rem 1.5rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: var(--primary-200);
  font-size: 0.875rem;
  font-weight: 600;
  backdrop-filter: blur(12px);
  box-shadow: inset 0 0 20px rgba(255, 255, 255, 0.05);
}

.badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--primary-500);
  box-shadow: 0 0 15px var(--primary-500);
  animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse-ring {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.2); }
}

.hero-title {
  font-size: clamp(3rem, 10vw, 4.5rem);
  line-height: 1;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: white;
}

.text-gradient {
  background: linear-gradient(135deg, #a5b4fc 0%, #fbcfe8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-subtitle {
  font-size: 1.25rem;
  color: var(--slate-400);
  max-width: 650px;
  margin: 0 auto var(--space-10);
  line-height: 1.6;
}

.hero-actions { display: flex; gap: var(--space-4); justify-content: center; }

.btn-glow-hero {
  background-color: var(--primary-600);
  color: white;
  box-shadow: 0 0 30px rgba(79, 70, 229, 0.3);
}

.glass-btn-hero {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  backdrop-filter: blur(10px);
}

/* --- Premium Cards & Features --- */
.premium-card {
  background: white;
  border: 1px solid var(--slate-100);
  border-radius: var(--radius-2xl);
  padding: var(--space-8); /* Use a valid token */
  box-shadow: var(--shadow-xl);
  transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
  position: relative;
  overflow: hidden;
}

.glass-v2 {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
}

.section-badge {
  display: inline-block;
  padding: 0.4rem 1rem;
  background: var(--primary-50);
  color: var(--primary-700);
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.feature-tile:hover {
  transform: translateY(-12px);
  border-color: var(--primary-200);
  box-shadow: 0 30px 60px -12px rgba(15, 23, 42, 0.12);
}

.tile-icon {
  font-size: 3rem;
  background: var(--slate-50);
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xl);
}

.tile-tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.tag-pill {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.3rem 0.8rem;
  background: var(--slate-50);
  color: var(--slate-600);
  border-radius: 999px;
  border: 1px solid var(--slate-100);
}

/* --- Use Cases & Tech --- */
.card-header-icon {
  font-size: 2.5rem;
  opacity: 0.9;
}

.use-case-list { display: grid; gap: var(--space-4); }
.use-case-item {
  padding: var(--space-5);
  background: white;
  border: 1px solid var(--slate-100);
  border-radius: var(--radius-xl);
  display: flex;
  gap: var(--space-5);
  align-items: center;
  transition: all 0.3s ease;
}

.use-case-item:hover {
  background: var(--slate-50);
  transform: translateX(8px);
}

.use-case-icon { font-size: 1.75rem; flex-shrink: 0; }

.tech-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); }
.tech-item {
  padding: var(--space-4);
  background: white;
  border: 1px solid var(--slate-200);
  border-radius: var(--radius-xl);
  text-align: center;
}

.tech-name { font-weight: 800; color: var(--slate-900); font-size: 0.9rem; }
.tech-desc { font-size: 0.75rem; color: var(--slate-500); margin-top: 0.2rem; }

.security-banner {
  padding: var(--space-8);
  background: #0f172a;
  border-radius: var(--radius-xl);
  color: white;
  position: relative;
  overflow: hidden;
}

.banner-glow {
  position: absolute;
  top: -50%;
  right: -20%;
  width: 150px;
  height: 150px;
  background: var(--primary-500);
  filter: blur(60px);
  opacity: 0.3;
}

/* --- Footer CTA --- */
.footer-cta-container {
  position: relative;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  padding: var(--space-20) var(--space-8);
  text-align: center;
  background: #0f172a;
  color: white;
}

.cta-mesh {
  position: absolute;
  inset: 0;
  background: 
    radial-gradient(circle at 0% 0%, #4338ca 0%, transparent 40%),
    radial-gradient(circle at 100% 100%, #be185d 0%, transparent 40%);
  opacity: 0.4;
}

.cta-title { font-size: 3rem; font-weight: 900; color: white; position: relative; z-index: 10; }
.cta-subtitle { font-size: 1.25rem; opacity: 0.7; position: relative; z-index: 10; }
.cta-btns { display: flex; gap: var(--space-4); justify-content: center; position: relative; z-index: 10; }

.btn-glow-active {
  background: white;
  color: #0f172a;
  box-shadow: 0 0 40px rgba(255, 255, 255, 0.2);
}

.btn-glow-active:hover {
  transform: translateY(-4px);
  box-shadow: 0 0 60px rgba(255, 255, 255, 0.3);
}

.glass-btn-dark {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  backdrop-filter: blur(10px);
}

@media (max-width: 768px) {
  .hero-container { padding: var(--space-16) var(--space-6); min-height: auto; }
  .hero-title { font-size: 2.75rem; }
  .tech-grid { grid-template-columns: 1fr; }
  .cta-btns { flex-direction: column; }
  .cta-title { font-size: 2.25rem; }
}
</style>

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
  <div>
    <!-- Hero Section -->
    <div class="card" style="text-align: center; margin-bottom: 2rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
      <h1 style="font-size: 2.5rem; font-weight: 700; margin-bottom: 1rem;">
        IDP Center
      </h1>
      <p style="font-size: 1.25rem; opacity: 0.95; margin-bottom: 1.5rem;">
        企业级身份认证与授权中心
      </p>
      <p style="font-size: 1rem; opacity: 0.9; max-width: 600px; margin: 0 auto;">
        一个现代化的身份提供商 (IdP) 解决方案，为您的应用提供安全、可靠、易用的认证服务
      </p>
    </div>

    <!-- Core Features -->
    <div class="card" style="margin-bottom: 2rem;">
      <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 2rem; text-align: center;">
        核心功能
      </h2>
      
      <div class="grid grid-3">
        <div 
          v-for="feature in features" 
          :key="feature.title"
          style="padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.75rem; transition: all 0.2s;"
          class="feature-card"
        >
          <div style="font-size: 2.5rem; margin-bottom: 1rem;">{{ feature.icon }}</div>
          <h3 style="font-size: 1.125rem; font-weight: 600; color: #1f2937; margin-bottom: 0.75rem;">
            {{ feature.title }}
          </h3>
          <p style="color: #6b7280; font-size: 0.875rem; line-height: 1.6; margin-bottom: 1rem;">
            {{ feature.description }}
          </p>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            <span 
              v-for="highlight in feature.highlights" 
              :key="highlight"
              style="font-size: 0.75rem; padding: 0.25rem 0.75rem; background: #eff6ff; color: #1e40af; border-radius: 1rem;"
            >
              {{ highlight }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Use Cases -->
    <div class="card" style="margin-bottom: 2rem;">
      <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 2rem; text-align: center;">
        应用场景
      </h2>
      
      <div class="grid grid-2">
        <div 
          v-for="useCase in useCases" 
          :key="useCase.title"
          style="padding: 1.5rem; background: #f9fafb; border-radius: 0.75rem;"
        >
          <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
            <span style="font-size: 2rem;">{{ useCase.icon }}</span>
            <h3 style="font-size: 1.25rem; font-weight: 600; color: #1f2937;">
              {{ useCase.title }}
            </h3>
          </div>
          <p style="color: #6b7280; font-size: 0.9rem; line-height: 1.6;">
            {{ useCase.description }}
          </p>
        </div>
      </div>
    </div>

    <!-- Security Features -->
    <div class="card" style="margin-bottom: 2rem;">
      <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 2rem; text-align: center;">
        安全特性
      </h2>
      
      <div style="display: grid; gap: 1rem;">
        <div style="padding: 1.25rem; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0.5rem;">
          <h4 style="font-weight: 600; color: #92400e; margin-bottom: 0.5rem;">密码安全</h4>
          <ul style="color: #78350f; font-size: 0.875rem; margin-left: 1.5rem; line-height: 1.8;">
            <li>使用 bcrypt 进行密码哈希存储</li>
            <li>密码强度验证（最少8位，包含大小写字母、数字、特殊字符）</li>
            <li>密码重置功能支持</li>
            <li>密码过期提醒</li>
          </ul>
        </div>
        
        <div style="padding: 1.25rem; background: #dbeafe; border-left: 4px solid #3b82f6; border-radius: 0.5rem;">
          <h4 style="font-weight: 600; color: #1e40af; margin-bottom: 0.5rem;">会话管理</h4>
          <ul style="color: #1e3a8a; font-size: 0.875rem; margin-left: 1.5rem; line-height: 1.8;">
            <li>JWT Token 有效期控制（默认24小时）</li>
            <li>Refresh Token 机制（7天有效期）</li>
            <li>多设备会话管理</li>
            <li>远程会话撤销</li>
          </ul>
        </div>
        
        <div style="padding: 1.25rem; background: #dcfce7; border-left: 4px solid #22c55e; border-radius: 0.5rem;">
          <h4 style="font-weight: 600; color: #166534; margin-bottom: 0.5rem;">访问控制</h4>
          <ul style="color: #14532d; font-size: 0.875rem; margin-left: 1.5rem; line-height: 1.8;">
            <li>基于角色的访问控制 (RBAC)</li>
            <li>管理员和普通用户权限分离</li>
            <li>租户级别数据隔离</li>
            <li>OAuth2 授权范围控制</li>
          </ul>
        </div>
        
        <div style="padding: 1.25rem; background: #fce7f3; border-left: 4px solid #ec4899; border-radius: 0.5rem;">
          <h4 style="font-weight: 600; color: #9d174d; margin-bottom: 0.5rem;">审计追踪</h4>
          <ul style="color: #831843; font-size: 0.875rem; margin-left: 1.5rem; line-height: 1.8;">
            <li>完整的登录日志记录</li>
            <li>用户操作行为追踪</li>
            <li>IP 地址和设备信息记录</li>
            <li>异常登录检测</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Technology Stack -->
    <div class="card" style="margin-bottom: 2rem;">
      <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 2rem; text-align: center;">
        技术栈
      </h2>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
        <div 
          v-for="tech in techStack" 
          :key="tech.name"
          style="text-align: center; padding: 1rem; background: #f9fafb; border-radius: 0.5rem;"
        >
          <h4 style="font-weight: 600; color: #1f2937; margin-bottom: 0.25rem;">{{ tech.name }}</h4>
          <p style="font-size: 0.75rem; color: #6b7280;">{{ tech.description }}</p>
        </div>
      </div>
    </div>

    <!-- Getting Started -->
    <div class="card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white;">
      <h2 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 1rem;">
        快速开始
      </h2>
      <p style="margin-bottom: 1.5rem; opacity: 0.95;">
        只需几分钟即可将 IDP Center 集成到您的应用中：
      </p>
      <div style="display: grid; gap: 1rem;">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <span style="width: 32px; height: 32px; background: white; color: #f5576c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600;">1</span>
          <span>注册 OAuth 客户端应用</span>
        </div>
        <div style="display: flex; align-items: center; gap: 1rem;">
          <span style="width: 32px; height: 32px; background: white; color: #f5576c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600;">2</span>
          <span>配置回调 URL</span>
        </div>
        <div style="display: flex; align-items: center; gap: 1rem;">
          <span style="width: 32px; height: 32px; background: white; color: #f5576c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600;">3</span>
          <span>在您的应用中集成认证流程</span>
        </div>
        <div style="display: flex; align-items: center; gap: 1rem;">
          <span style="width: 32px; height: 32px; background: white; color: #f5576c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600;">4</span>
          <span>用户即可享受安全的单点登录体验</span>
        </div>
      </div>
      <div style="margin-top: 2rem;">
        <router-link 
          to="/" 
          class="btn" 
          style="background: white; color: #f5576c; text-decoration: none; display: inline-block;"
        >
          立即体验 →
        </router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px -8px rgba(0, 0, 0, 0.15);
}
</style>

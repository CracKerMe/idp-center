import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: () => import("../views/Home.vue"),
    },
    {
      path: "/about",
      name: "about",
      component: () => import("../views/About.vue"),
    },
    {
      path: "/login",
      name: "login",
      component: () => import("../views/Login.vue"),
      meta: { guestOnly: true },
    },
    {
      path: "/register",
      name: "register",
      component: () => import("../views/Register.vue"),
      meta: { guestOnly: true },
    },
    {
      path: "/callback",
      name: "callback",
      component: () => import("../views/Callback.vue"),
    },
    {
      path: "/logout-frontchannel",
      name: "logout-frontchannel",
      component: () => import("../views/LogoutFrontchannel.vue"),
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: () => import("../views/Dashboard.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/profile",
      name: "profile",
      component: () => import("../views/Profile.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/sessions",
      name: "sessions",
      component: () => import("../views/Sessions.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/setup-otp",
      name: "setup-otp",
      component: () => import("../views/SetupOTP.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/mfa-factors",
      name: "mfa-factors",
      component: () => import("../views/MfaFactors.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/device-flow",
      name: "device-flow",
      component: () => import("../views/DeviceLogin.vue"),
    },
    {
      path: "/device",
      name: "device-approve",
      component: () => import("../views/DeviceApprove.vue"),
      meta: { requiresAuth: true },
    },
    {
      path: "/forgot-password",
      name: "forgot-password",
      component: () => import("../views/ForgotPassword.vue"),
      meta: { guestOnly: true },
    },
    {
      path: "/reset-password",
      name: "reset-password",
      component: () => import("../views/ResetPassword.vue"),
      meta: { guestOnly: true },
    },
    {
      path: "/verify-email",
      name: "verify-email",
      component: () => import("../views/VerifyEmail.vue"),
    },
  ],
});

// Navigation guard
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();

  // 等待 auth store 初始化完成
  if (!authStore.isInitialized) {
    await new Promise<void>((resolve) => {
      const unwatch = authStore.$subscribe(() => {
        if (authStore.isInitialized) {
          unwatch();
          resolve();
        }
      });
      // 如果已经有 token，立即 resolve
      if (authStore.isInitialized) {
        unwatch();
        resolve();
      }
    });
  }

  const isAuthenticated = !!authStore.token;

  if (to.meta.requiresAuth && !isAuthenticated) {
    next({ name: "login", query: { redirect: to.fullPath } });
  } else if (to.meta.guestOnly && isAuthenticated) {
    next({ name: "dashboard" });
  } else {
    next();
  }
});

export default router;

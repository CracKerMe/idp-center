import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

// 创建 axios 实例
const http = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Token 刷新相关状态
let isRefreshing = false
let failedQueue: Array<{
  resolve: (value?: any) => void
  reject: (reason?: any) => void
}> = []

// 处理队列中的请求
const processQueue = (error: AxiosError | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

// 请求拦截器 - 添加 token
http.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    
    const sessionId = localStorage.getItem('session_id')
    if (sessionId) {
      config.headers['X-Session-Id'] = sessionId
    }
    
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器 - 处理 token 过期和自动刷新
http.interceptors.response.use(
  (response) => {
    return response
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    
    // 如果是 401 错误且不是刷新 token 的请求
    if (error.response?.status === 401 && !originalRequest._retry && originalRequest.url !== '/auth/refresh') {
      // 如果正在刷新 token，将请求加入队列
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`
            return http(originalRequest)
          })
          .catch((err) => {
            return Promise.reject(err)
          })
      }
      
      originalRequest._retry = true
      isRefreshing = true
      
      const refreshToken = localStorage.getItem('refresh_token')
      
      if (!refreshToken) {
        // 没有 refresh token，清除登录状态并跳转到登录页
        localStorage.removeItem('token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('session_id')
        window.location.href = '/login'
        return Promise.reject(error)
      }
      
      try {
        // 尝试刷新 token
        const response = await axios.post('/api/auth/refresh', {
          refresh_token: refreshToken
        })
        
        const { access_token, refresh_token } = response.data
        
        // 更新存储的 tokens
        localStorage.setItem('token', access_token)
        localStorage.setItem('refresh_token', refresh_token)
        
        // 更新请求头
        originalRequest.headers.Authorization = `Bearer ${access_token}`
        
        // 处理队列中的请求
        processQueue(null, access_token)
        
        // 重试原始请求
        return http(originalRequest)
      } catch (refreshError) {
        // 刷新失败，清除登录状态
        processQueue(refreshError as AxiosError, null)
        localStorage.removeItem('token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('session_id')
        window.location.href = '/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }
    
    return Promise.reject(error)
  }
)

export default http

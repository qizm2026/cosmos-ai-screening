/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 移除无用的 X-Powered-By 响应头（减小响应体积，略降开销）
  poweredByHeader: false,
  experimental: {
    // 将 openai SDK 标记为外部依赖，避免被 webpack 重复打包进每个 API Route
    // 原问题：chat / score / report 三个 Route 都依赖 deepseek.ts -> openai，
    // 默认会被分别打包 3 份，构建/首编时内存与 CPU 开销巨大（本机实测构建 10+ 分钟）。
    // 改为运行时从 node_modules 直接 require，构建更快、服务端 bundle 更小。
    serverComponentsExternalPackages: ['openai'],
  },
}

export default nextConfig

import type { Metadata } from 'next'
import { Urbanist } from 'next/font/google'
import './globals.css'

// 自托管字体：构建时下载并内联，运行时不再发起阻塞性的 Google Fonts 请求，
// 消除 FCP 前的渲染阻塞与布局抖动（原 globals.css 使用 @import 远程字体，会阻塞首屏 CSS）。
const urbanist = Urbanist({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
  variable: '--font-urbanist',
})

export const metadata: Metadata = {
  title: 'COSMO',
  description: '学生心理状态动态复核对话',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" className={urbanist.variable}>
      <body className="bg-bg text-text-primary antialiased">{children}</body>
    </html>
  )
}

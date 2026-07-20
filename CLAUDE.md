# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言

始终使用中文回复。

## 项目概述

COSMO — 学生心理状态动态复核对话系统。AI 驱动的 PHQ-9 心理筛查，以自然对话（而非问卷）方式探索 9 个维度，对话结束后自动生成评分和个性化报告。

## 技术栈

- Next.js 14 App Router（纯客户端页面 + API Routes）
- React 18 + Tailwind CSS 3.4
- DeepSeek API（通过 OpenAI SDK 兼容接入）
- 会话存储：内存 Map（`globalThis.__cosmo_sessions`），无数据库，服务重启丢失

## 常用命令

```bash
npm run dev      # 开发服务器（默认 3000）
npm run build    # 生产构建
npm run start    # 生产启动
npm run lint     # ESLint
```

## 环境变量（`.env.local`）

```
DEEPSEEK_API_KEY=        # 必填
DEEPSEEK_CHAT_MODEL=     # 对话模型，默认 deepseek-v4-pro
DEEPSEEK_EVAL_MODEL=     # 评分/报告模型，默认同上
```

## 架构与数据流

```
浏览器 (CSR)
  ├── /                  首页 → 创建会话 → 跳转 /chat
  ├── /chat              对话页 → 流式接收 AI 回复
  └── /report            报告页 → 依次调用评分 API、报告 API
                              ↑
POST /api/session  ─── 创建会话，返回 session_id
POST /api/chat     ─── 核心对话逻辑
POST /api/score    ─── PHQ-9 语义评分（JSON 模式）
POST /api/report   ─── 生成个性化报告（JSON 模式）
```

所有 API Routes 定义为 `app/api/<name>/route.ts`。所有页面为 `'use client'` 组件。

## 对话生命周期

```
icebreak（破冰，2 轮）
  → interview（逐一覆盖 Q1→Q9）
    → 每个条目：AI 提问 → 用户回答 → AI 追问 → 用户再回答
    → AI 在回复末尾输出 SYS 分析 JSON（item_score_guess / info_sufficient / risk_confirmed）
    → 代码层解析 SYS 块，统一决策：信息充分→推进 / 不足+已追问→硬兜底 / 不足+首轮→追问
    → SYS 解析失败时，代码层 detectAnswerVagueness 作为 fallback
  → 全部 9 个条目 covered（answered 或 fallback）
  → phase: 'done'，meta.is_done: true
  → 前端显示【查看报告】按钮（右上角始终可见，不依赖 is_done）
```

## 会话结束的判定（唯一条件）

**前端仅依赖 `meta.is_done`（服务端返回）。** 服务端判定逻辑（`app/api/chat/route.ts`）：

```typescript
const allCovered = Object.values(updatedCoverage).every(
  (s) => s === 'answered' || s === 'fallback'
)
```

只有当 Q1~Q9 全部覆盖后，`is_done` 才为 `true`。`handleFallbackScore` 和 `handleRiskContinue` 的 `allCovered` 路径使用 JSON 响应（非流式）确保可靠送达。

## 兜底机制

### AI 分析 + 代码层统一决策
- AI 在每次回复末尾输出 `<!--SYS\n{"item_score_guess": 2, "info_sufficient": true, "risk_confirmed": false}\nSYS-->` 分析块
- 代码层 `parseSysBlock()` 解析后统一决策：
  - `info_sufficient=true` → 正常推进下一条目
  - `info_sufficient=false` + 首轮 → 给 AI 一次追问机会
  - `info_sufficient=false` + 已追问 → 触发硬兜底（四选一）
  - `risk_confirmed=true` → 触发 Q9 兜底 + 3 轮缓和
- SYS 解析失败时，`detectAnswerVagueness()`（极短回答/模糊模式检测）作为 fallback

### 兜底选项统一标准
- Q1-Q9 全部使用 PHQ-9 官方选项：「完全没有 / 有几天 / 一半以上天数 / 几乎每天」
- 定义在 `src/lib/scales/phq9.ts` 的 `fallback_options_original` 和 `fallback_prompt`

## SessionState 字段

```typescript
item_answer_quality: Partial<Record<ItemId, AnswerQuality>>  // 每条目信息充分度
current_confidence_score: number    // 当前条目把握度 0-5（代码层计算）
```

## 风险处理流程

```
用户消息 → detectRisk（正则+关键词）→ 命中：
  1. risk_status.confirming = true → AI 通过提示词自然确认（不弹窗）
  2. 用户重复高风险内容 → 自动确认 → Q9 兜底触发
  2b. AI SYS 中 risk_confirmed=true → Q9 兜底触发
  3. soothing_rounds（3 轮缓和）→ 恢复正常 interview
```

所有风险处理通过自然对话完成，无弹窗。`risk-detector.ts` 检测三类：`suicide_ideation`、`self_harm`、`extreme_despair`。

## AI 分析格式（SYS 块，回复末尾）

```
<!--SYS
{"item_score_guess": 2, "info_sufficient": true, "risk_confirmed": false}
SYS-->
```

| 字段 | 类型 | 含义 |
|------|------|------|
| `item_score_guess` | 0-3 / -1 | AI 对当前条目得分的推测，-1=无法判断 |
| `info_sufficient` | boolean | 信息是否足够支撑评分 |
| `risk_confirmed` | boolean | AI 是否确认高风险意图 |

前端和后端都会剥离 SYS 块，不展示给用户。

## 后处理过滤器

`src/lib/post-processor.ts` — 5 条硬底线规则（病理化词汇）。只保留 Prompt 无法完全约束的底线，避免规则膨胀和白熊效应。高风险确认阶段跳过过滤。

## 关键类型

所有类型定义在 `src/types/session.ts`：`SessionState`、`ItemCoverage`、`ScoreResult`、`ReportResult`、`RiskStatus`、`UserContext` 等。

## DeepSeek 客户端（`src/lib/deepseek.ts`）

通过 OpenAI SDK 调用 DeepSeek，提供三个核心函数：
- `textCompletion` — 普通文本对话（开启 thinking）
- `jsonCompletion` — 结构化 JSON 输出（自动提示 + 多层 JSON 解析容错）
- `createRealStreamResponse` — 流式响应，接收 `onComplete` 回调处理 SYS 解析、覆盖推进等业务逻辑

## 对话角色 Prompt（`src/lib/prompts/chat-prompt.ts`）

COSMO 角色设定为学校心理老师（第四年），以叙事性自画像而非指令清单塑造人物底色——空间感（二楼拐角办公室）、职业记忆和具体信念，让 LLM 在对话中自然流露特质。进度感知按 `pendingLabels.length` 三分支（0/1/>1），最后一条目时明确告知收尾。

## 报告页缓存

`app/report/page.tsx` — 模块级 `reportCache`（Map），同一 session 二次进入直接从缓存读取，不重复调评分/报告 API。

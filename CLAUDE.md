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
    → 每个条目：AI 提问 → 用户回答 → AI 追问（最多 MAX_ITEM_ROUNDS=2 轮）
    → AI 在回复末尾输出 SYS 分析 JSON（info_sufficiency / item_score_guess / risk_confirmed / missing_dimensions / item_summary）
    → 代码层解析 SYS 块，统一决策（四分支，见下）
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

### AI 分析（SYS 块）+ 代码层统一决策

AI 在每次回复末尾输出分析块：
```
<!--SYS
{"item_score_guess": 2, "info_sufficiency": 2, "risk_confirmed": false}
SYS-->
```

代码层 `parseSysBlock()` 解析后根据 `info_sufficiency`（0/1/2 三级）和 `item_rounds` 走分支部决策：

| 条件 | 动作 |
|------|------|
| `info_sufficiency >= SUFFICIENCY_THRESHOLD(2)`（信息充分） | 正常推进下一条目，收集 `item_summary`，存储 `item_score_guess` 入 `session.item_scores_initial` |
| `info_sufficiency <= 1` + 有追问额度（`item_rounds < MAX_ITEM_ROUNDS`） | 追问，注入 `missing_dimensions` 作为追问方向 |
| `info_sufficiency === 1` + 额度用尽 | **forced-choice**（LLM 生成二选一，不兜底） |
| `info_sufficiency === 0` + 额度用尽 | **硬兜底**（直接展示原题 + 四个频率选项） |
| `risk_confirmed === true` | 触发 Q9 兜底 + 3 轮缓和 |

Forced-choice 后再失败（用户仍模糊）→ 也触发硬兜底。

SYS 解析失败时，`detectAnswerVagueness()`（极短回答/模糊模式检测）作为 fallback。

### 对话节奏常量
```typescript
const MAX_ITEM_ROUNDS = 2      // 每条目最大追问轮次（对标 AgentMental d 参数）
const SUFFICIENCY_THRESHOLD = 2 // info_sufficiency >= 2 才推进（对标 AgentMental θ 参数）
```

## SYS 分析块格式（当前版本）

| 字段 | 类型 | 含义 |
|------|------|------|
| `item_score_guess` | 0-3 / -1 | AI 对当前条目得分的推测，-1=无法判断。推进时写入 `session.item_scores_initial` |
| `info_sufficiency` | 0 / 1 / 2 | **三级**信息充分度：0=严重不足 / 1=部分线索 / 2=信息充分 |
| `risk_confirmed` | boolean | AI 是否确认高风险意图 |
| `missing_dimensions` | string[] | （可选）信息缺失维度，仅 `info_sufficiency <= 1` 时填写 |
| `item_summary` | object | （可选）条目完成时的结构化摘要，含 summary / emotion / frequency / duration / symptom / impact，仅推进时填写 |

### 向后兼容
`parseSysBlock()` 自动兼容旧格式 `info_sufficient: boolean` → 映射为 `info_sufficiency: 0 | 2`。

## Phase 3：条目摘要与上下文感知

当条目通过 SYS 推进时，AI 可附 `item_summary`。代码层 `collectItemSummary()` 收集入 `session.item_summaries[]`。后续轮次的 prompt 通过 `buildItemSummariesBlock()` 注入已了解的内容，AI 以此避免重复提问——但不显式复述（如"你之前提到过..."），只在心里有数。

此机制让多轮对话保持上下文连贯，同时每条目独立评分互不污染。

## 风险处理流程

```
用户消息 → detectRisk（正则+关键词）→ 命中：
  1. risk_status.confirming = true → AI 通过提示词自然确认（不弹窗）
  2. 用户重复高风险内容 → 自动确认 → Q9 兜底触发
  2b. AI SYS 中 risk_confirmed=true → Q9 兜底触发
  3. soothing_rounds（3 轮缓和）→ 恢复正常 interview
```

所有风险处理通过自然对话完成，无弹窗。`risk-detector.ts` 检测三类：`suicide_ideation`、`self_harm`、`extreme_despair`。

## SessionState 字段

```typescript
item_answer_quality: Partial<Record<ItemId, AnswerQuality>>  // 每条目信息充分度
current_confidence_score: number    // 当前条目把握度 0-5（代码层计算）
missing_dimensions: string[]        // 当前条目信息缺失维度（SYS 解析注入，追问方向提示）
item_summaries: ItemSummary[]       // Phase 3：已完成的条目摘要（五维：emotion/frequency/duration/symptom/impact）
item_scores_initial: Partial<Record<ItemId, number>>  // Phase 1：对话中逐项初评分（SYS item_score_guess），供全局校准交叉校验
```

## 评分引擎（`app/api/score/route.ts`）

### 两阶段评分架构（对标 AgentMental AGs → AGu）

```
第一阶段 — 对话中逐项初评（AGs 角色）
SYS 块 item_score_guess → session.item_scores_initial

第二阶段 — 对话后全局校准（AGu 角色）
/api/score PsyCoT 三步推理 + 跨条目交叉校验 → session.score_result（可覆盖初评）
```

**为什么两阶段？** 逐项初评时 LLM 只能看到当前条目对话，随后条目可能暗示对前条目的不同判断。全局校准阶段 LLM 看到全部 9 条目完整对话，可修正初评偏差。

### PsyCoT 三步推理
- **Step 1 — 症状锚定**：从对话中提取具体事实，引用学生原话
- **Step 2 — 严重度判断**：综合频率、强度、影响范围
- **Step 3 — 锚点匹配**：匹配到最接近的评分锚点（0/1/2/3）

### 全局校准（第二阶段）
- 交叉校验：检查初评分是否与后续条目信息矛盾
- 修正输出：`calibration_note` 说明修正原因，`calibration_summary` 汇总修正情况
- 初评分仅在 prompt 中作为参考输入，不作为最终输出

### 关键规则
- **`matched_anchor_index` 优先于 `score`**：锚点索引作为最终得分（对标 HopeBot/BDI-FS-GPT 评分解耦）
- **`answer_quality` 硬钳位**：`insufficient` 条目强制置 0（与 prompt 层双重保险）；`partial` 条目标记但不强制钳位
- **Q9 特殊规则**：任何非零得分 → `risk_level` 强制 `severe`
- **兜底得分直接使用**：`fallback_scores` 不参与语义判断，直接写入
- **评分结果缓存**：`session.score_result` 存在时直接返回，避免重复调用

## 后处理过滤器

`src/lib/post-processor.ts` — 5 条硬底线规则（病理化词汇）。只保留 Prompt 无法完全约束的底线，避免规则膨胀和白熊效应。高风险确认阶段跳过过滤。

## 关键类型

所有类型定义在 `src/types/session.ts`：`SessionState`、`ItemCoverage`、`ScoreResult`、`ReportResult`、`RiskStatus`、`UserContext`、`ItemSummary`、`ItemScore` 等。

### ItemScore（单条目评分）
```typescript
{ item_id, score, justification, is_fallback, answer_insufficient?, initial_score?, calibration_note? }
```
- `initial_score`：对话中 SYS 逐项初评分（0-3），undefined 表示无初评
- `calibration_note`：全局校准说明（仅修正初评分时填写），如 "全局校准：初评 Q1=2，但 Q2-Q8 显示正常，下调至 1"

### ScoreResult
```typescript
{ item_scores[], total_score, risk_level, q9_nonzero, insufficient_items?, calibration_summary? }
```
- `calibration_summary`：全局校准摘要（仅 LLM 输出中有该字段时写入），如 "1个条目初评分被调整：Q1 2→1"

## DeepSeek 客户端（`src/lib/deepseek.ts`）

通过 OpenAI SDK 调用 DeepSeek，提供三个核心函数：
- `textCompletion` — 普通文本对话（开启 thinking）
- `jsonCompletion` — 结构化 JSON 输出（自动提示 + 多层 JSON 解析容错）
- `createRealStreamResponse` — 流式响应，接收 `onComplete` 回调处理 SYS 解析、覆盖推进等业务逻辑

## 对话角色 Prompt（`src/lib/prompts/chat-prompt.ts`）

COSMO 角色设定为学校心理老师（第四年），以叙事性自画像而非指令清单塑造人物底色——空间感（二楼拐角办公室）、职业记忆和具体信念，让 LLM 在对话中自然流露特质。进度感知按 `pendingLabels.length` 三分支（0/1/>1），最后一条目时明确告知收尾。

Prompt 的动态段包括：
- `buildItemSummariesBlock()` — Phase 3 已了解内容注入（"你已经了解的"段落，禁止显式复述如"你之前提到过..."）
- `confidenceHint` — 代码层模糊检测结果反馈
- `forcedChoiceHint` — 追问两轮后的二选一提示（item_rounds >= 2 时注入）
- `missingDimsHint` — 从上一轮 SYS 解析的缺失维度注入（"追问方向"段落）
- `icebreakRules` — 破冰阶段的对话节奏引导
- 深度约束（"对话节奏"段落）— 每条目最多追问 2 次、每次只搞清楚一个维度、筛查非诊断

## 报告页缓存

`app/report/page.tsx` — 模块级 `reportCache`（Map），同一 session 二次进入直接从缓存读取，不重复调评分/报告 API。

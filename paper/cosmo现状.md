
# COSMO vs AgentMental — 架构对比

> 决策树不在纸上，在代码逻辑里。对话引擎（`app/api/chat/route.ts`）中有一个四分支的判断流程——每次 AI 回复后，系统解析 AI 的"内部小纸条"（SYS 块），然后走不同的路。

---

## 一、COSMO 的决策树

### 核心参数

| 参数 | 值 | 对标 AgentMental | 含义 |
|------|-----|------------------|------|
| `MAX_ITEM_ROUNDS` | 2 | d 参数 | 每个话题最多追问 2 次 |
| `SUFFICIENCY_THRESHOLD` | 2 | θ 参数 | `info_sufficiency >= 2` 才推进 |

### 决策流程

```
学生回复了一条消息
  │
  ├─ 先检测：有没有风险信号？
  │   ├─ 第一次命中 → AI 用自然对话确认，不弹窗
  │   ├─ 第二次命中 → 自动确认高风险 → 触发 Q9 兜底
  │   └─ 没有 → 继续
  │
  └─ AI 的回复里有没有 SYS 块？
      │
      ├─ 有 SYS 块
      │   ├─ info_sufficiency >= 2 → 推进到下一个话题 + 存入初评分
      │   ├─ info_sufficiency <= 1 + 追问次数没用完 → 追问（注入 missing_dimensions）
      │   ├─ info_sufficiency = 1 + 追问用完了 → forced-choice（二选一）
      │   │   └─ 二选一后还是说不清 → 硬兜底
      │   └─ info_sufficiency = 0 + 追问用完了 → 硬兜底（原题 + 四个选项）
      │
      └─ 没有 SYS 块（AI 忘了写）
          ├─ 第一轮 → 不干预，等 AI 追问
          └─ 已经追问过 → 代码自己判断
              ├─ 够清楚 → 推进
              └─ 不够清楚 → 硬兜底
```

### 四分支速览

| 条件 | 动作 |
|------|------|
| `info_sufficiency >= 2` | 正常推进，收集 `item_summary`，存储 `item_score_guess` |
| `info_sufficiency <= 1` + 有追问额度 | 追问，注入 `missing_dimensions` |
| `info_sufficiency = 1` + 额度用尽 | **forced-choice**（二选一）→ 失败则硬兜底 |
| `info_sufficiency = 0` + 额度用尽 | **硬兜底**（展示原题 + 四个频率选项） |
| `risk_confirmed = true` | 触发 Q9 兜底 + 3 轮缓和 |

---

## 二、AgentMental 的决策树

AgentMental 用了 **4 个独立 AI 智能体**，各司其职：

| Agent | 职责 | COSMO 对应 |
|-------|------|------------|
| **AGq**（提问者） | 专门生成问题 | 同一个 AI 在回复里直接提问 |
| **AGev**（评估者） | 判断"学生说清楚了吗"（0-2 分） | SYS 块 `info_sufficiency: 0/1/2` |
| **AGs**（评分者） | 给当前话题打分 | SYS 块 `item_score_guess` |
| **AGu**（更新者） | 维护记忆 + 跨话题修正分数 | 评分引擎 PsyCoT 全局校准 |

**决策逻辑**（数学公式驱动）：

```
AGev 给信息充分性打分（0/1/2）
  → 分数 > θ（阈值=1）且 追问次数 < d（上限=3）
      → AGq 生成针对性追问
  → 否则
      → 推进到下一个话题
```

### 关键差异

| 维度 | AgentMental | COSMO |
|------|-------------|-------|
| 谁做判断 | 独立 AGev 智能体 | 同一个 AI 在 SYS 块中自评 |
| 判断精度 | 0/1/2 三级 | 0/1/2 三级 |
| 追问上限 | d=3 | MAX_ITEM_ROUNDS=2 |
| 追问方向 | AGq 按五维度定向追问 | AI 自由发挥 + missing_dimensions 提示 |
| 兜底 | forced-choice（二选一） | forced-choice + 硬兜底（四选一） |
| 架构 | 4 个独立 Agent | 单 AI + 代码层决策 |

---

## 三、记忆结构对比

### COSMO：平面结构

对话中维护 10 个独立字段，`item_summaries` 和 `item_scores_initial` 按 `item_id` 建立轻量索引：

| # | 字段 | 说明 |
|----|------|------|
| 1 | `messages` | 完整对话历史 |
| 2 | `asked_questions` | 已提过的问题，防重复 |
| 3 | `user_context` | 从对话中正则抓取：职业、年龄、爱好、症状 |
| 4 | `item_summaries` | 每个话题的 2-3 句小结（五维：情绪/频率/持续时间/症状/影响） |
| 5 | `item_scores_initial` | AI 在 SYS 块中逐项初评分（0-3） |
| 6 | `item_answer_quality` | 每条目信息充分度：sufficient / partial / insufficient / fallback |
| 7 | `fallback_scores` | 学生直接选频率选项的结果，跳过 LLM 评分 |
| 8 | `current_confidence_score` | 代码层把握度（0-5），0=完全模糊，3+=充分 |
| 9 | `missing_dimensions` | SYS 解析的信息缺口，引导追问方向 |
| 10 | `stall_rounds` | 对话停滞计数器，防道别循环 |

### AgentMental：三层树形结构

```
根节点：用户基本信息（职业、性别、年龄）
  │
  ├── 话题节点 1：兴趣减退
  │   ├── 分数：1
  │   ├── 行为摘要："学生偶尔对活动失去兴趣..."
  │   └── 陈述节点（每轮追问一个）：
  │       ├── 情绪：挫败感
  │       ├── 频率：每周 2-3 次
  │       ├── 持续时间：约两个月
  │       ├── 症状：不想画画，不追剧
  │       └── 影响：社交减少
  │
  ├── 话题节点 2：情绪低落
  │   └── ...
  └── ...（其余 7 个话题）
```

每次聊完一个话题，**AGu（更新者）**做两件事：
1. 把当前话题的五维信息挂到对应节点下
2. 回头检查之前所有话题 — 新信息是否暗示需要补充修正

---

## 四、引擎拆分逻辑对比

> COSMO 的三个引擎 ≠ AgentMental 的四个 Agent。这是两种完全不同的拆分思路。

### COSMO：按时间阶段串行

```
对话引擎 ────────────→ 评分引擎 ────────────→ 报告引擎
（聊天中运行）         （聊天后运行）           （评分后运行）
```

| 引擎 | 职责 | 关键能力 |
|------|------|----------|
| 对话引擎 | 怎么聊天 | 提问、追问、SYS 逐项初评，存入 `item_scores_initial` |
| 评分引擎 | 怎么打分 | PsyCoT 三步推理 + 跨条目全局校准，偏差 ≥ 2 分输出 `calibration_note` |
| 报告引擎 | 怎么呈现 | 把评分结果变成学生能看懂的文字 |

引擎之间通过 session 数据**单向传递**：对话引擎的初评分 → 评分引擎交叉校验 → 报告引擎直接使用。

### AgentMental：按功能角色并行

```
AGq（提问）↔ AGev（评估）↔ AGs（评分）↔ AGu（记忆+校准）
    ↑            ↑            ↑            ↑
   每轮都在      每轮都在      每轮都在      每轮都在
```

**AgentMental 的评分和校准嵌在对话过程中**——每聊完一个话题就当场打分、当场校准。COSMO 的评分在所有对话结束后才做一次。

---

## 五、为什么 COSMO 不拆成多个 Agent？

**技术原因**：AgentMental 跑在 AutoGen 上，4 Agent × 9 话题 × 每话题最多 3 轮追问 = 上百次 LLM 调用。COSMO 用 DeepSeek API 按 token 计费，成本不可接受。

**务实原因**：COSMO 把多个 Agent 的职责交给了**同一个 LLM 的内部推理**。比如 AGev 的"评估信息充分性"，COSMO 让 AI 在 SYS 块写 `info_sufficiency: 0/1/2`——LLM 生成回复的同时在"脑子"里做了评估，比额外调用一个评估 Agent 快得多也便宜得多。

---

## 六、COSMO 如何弥补"没有实时校准"？

AgentMental 的 AGu 每聊完一个话题就回头校准全部历史分数。COSMO 做不到实时校准，但 V4.0 用三件套弥补：

### 6.1 两阶段评分

```
Phase 1（对话中）              Phase 2（对话后）
SYS item_score_guess      →    /api/score PsyCoT 全局校准
存入 item_scores_initial      偏差 ≥ 2 分 → calibration_note
```

### 6.2 PsyCoT 三步推理

| 步骤 | 内容 | 产出 |
|------|------|------|
| Step 1 — 症状锚定 | 从对话中提取具体事实，引用学生原话 | `symptom_evidence` |
| Step 2 — 严重度判断 | 综合频率、强度、影响范围 | `severity_judgment` |
| Step 3 — 锚点匹配 | 匹配最接近的评分锚点（0-3） | `matched_anchor_index` |

> `matched_anchor_index` 优先于 `score` 字段——对标 HopeBot/BDI-FS-GPT 的评分解耦设计。

### 6.3 answer_quality 硬钳位

| 质量标记 | 处理 |
|----------|------|
| `insufficient` | 代码层强制置 0 分 |
| `partial` | 标记但不钳位，交由 LLM 判断 |
| `fallback` | 跳过语义评分，直接使用学生选择 |

---

## 七、一张表总结

| 维度 | COSMO | AgentMental |
|------|-------|-------------|
| 模块数量 | 3 个引擎 | 4 个 Agent |
| 运行方式 | 串行（对话→评分→报告） | 并行（每轮都在协作） |
| 评分时机 | 对话中逐项初评 + 对话后全局校准 | 每完成一个话题当场评分 |
| 校准时机 | 评分时一次性交叉校验 | 每完成一个话题就回头校准 |
| 通信方式 | 初评分→评分引擎单向传递 | Agent 之间直接通信 |
| LLM 调用 | 最少（对话 N 次 + 评分 1 次） | 多（每个 Agent 每轮独立调用） |
| 架构哲学 | 代码层决策替代额外 Agent | 每个功能拆分给专门 Agent |

**本质差异**：COSMO 是把一件事分成三个阶段串行做（流水线），AgentMental 是同一件事分给四个专长的人同时做（手术室）。COSMO 用 SYS 块让一个 LLM 同时承担提问、评估、评分的角色，换来了更低的延迟和成本；通过 PsyCoT 三步推理 + 全局校准 + 硬钳位，在单次评分调用中尽量逼近多 Agent 的精度。

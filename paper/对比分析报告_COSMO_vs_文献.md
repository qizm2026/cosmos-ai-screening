# COSMO 与最接近文献的深度对比分析报告

> 生成日期：2026-07-22 | 核实方式：PyPDF2 逐段提取原文，逐条对账
> 分析范围：COSMO 项目全部核心源码 + paper/ 目录下 9 篇论文

---

## 一、文献筛选：谁与 COSMO 最接近？

经过对 9 篇论文摘要和全文的精读，按与 COSMO 的技术相似度排列：

| 层级 | 论文 | 判断依据 |
|------|------|----------|
| **最直接可比** | **HopeBot** | 同为 LLM 驱动的 PHQ-9 对话筛查，目标几乎完全相同 |
| **架构最同构** | **AgentMental** | 自适应追问机制（信息充分性评估→追问/推进）与 COSMO 的 SYS 块决策树高度同构 |
| **验证范式参照** | **BDI-FS-GPT** | 交互式 AI 筛查 + 量表分数输出的范式，且评分方式（确定性锚点映射）值得借鉴 |
| **可解释性参照** | **MAGI** | 结构化临床访谈 + PsyCoT 推理链，但不是 PHQ-9 而是 MINI 诊断协议 |
| 主要差异较大 | Buddy / Perla / 南开 / JAMIA / medRxiv | 量表不同（PSS-10）、技术栈不同（DialogFlow 规则引擎）、或非对话系统 |

**核心结论：HopeBot 和 AgentMental 是 COSMO 最应该对标的两篇论文——前者回答"LLM 对话筛查能做到什么水平"，后者回答"追问架构怎么做才有效"。**

---

## 二、COSMO ↔ HopeBot（PHQ-9 对话筛查，GPT-4o + RAG）

### 2.1 HopeBot 的完整技术方案（逐项原文核实）

| 技术组件 | 原文描述（直接引用/精确摘要） | 出处 |
|----------|---------------------------|------|
| **基础模型** | GPT-4o，利用其原生多语言能力支持中英双语 | §Chatbot System Design |
| **会话阶段** | 三阶段预设协议：(1) rapport building（最多 20 轮）→ (2) PHQ-9 逐题施测 → (3) 个性化反馈 | §Chatbot System Design |
| **追问方式** | 无结构化轮次控制，LLM 在用户回答模糊时自由生成澄清 prompt（"When user input was ambiguous, the model generated clarification prompts before classification"） | §Chatbot System Design |
| **评分机制** | **两层解耦**：① GPT-4o 将用户自然语言回答分类到 A/B/C/D 四个 PHQ-9 回答类别；② 后端函数确定性完成「类别→0-3 分数」映射和总分聚合（"numerical scoring (0–3 per item) and total score aggregation were executed deterministically by a backend function independent of the language model"） | §Chatbot System Design |
| **RAG 知识层** | **4 个知识源**，LangChain + Chroma：(i) 34 份匿名 CBT 会话转录（来自 YouTube 模拟、治疗师角色扮演、在线仓库）；(ii) 《A Therapist's Guide to Brief CBT》全书；(iii) ESConv（英文情绪支持对话数据集）+ PsyQA_example（中文心理健康 QA 语料）；(iv) 中英双语心理热线目录 | §Chatbot System Design |
| **文本处理** | recursive character-level chunking，512-token 分段，20% 重叠 | §Chatbot System Design |
| **向量化** | text-embedding-3-small 模型，每个对话轮次并行检索 3 个向量库，Top-K 结果拼接注入 GPT-4o prompt | §Chatbot System Design |
| **多模态** | 文本 + 语音输入（ASR 模块）+ 语音输出（OpenAI TTS-1，声音 'sage'） | §Chatbot System Design |
| **延迟** | GPT-4o 生成：1.47±0.30 秒/轮；语音合成：2.36±0.49 秒/轮；总延迟约 3.83 秒 | §Chatbot System Design |
| **安全协议** | 预定义关键词触发 → 中断会话 → 预设支持消息 → 国家特定热线资源（英国：Samaritans/Shout；中国：北大六院/上海精卫中心） | §S3 Text |
| **前端** | Streamlit 构建，异步事件循环管理转录-生成-渲染全流程 | §Chatbot System Design |

### 2.2 COSMO 与之的差异

| 维度 | HopeBot | COSMO | 差距性质 |
|------|---------|-------|----------|
| **RAG 知识增强** | 4 个向量知识库，每轮语义检索 | 无，纯依赖 LLM 参数知识 + 角色 Prompt | 架构差异——HopeBot 通过外部知识锚定降低幻觉风险，COSMO 仅靠 in-context learning |
| **多模态** | 文本 + 语音输入（ASR）+ 语音输出（TTS-1） | 纯文本 | 可及性差异——语音覆盖低识字率用户 |
| **评分方式** | LLM 仅做分类（A/B/C/D），代码层确定性计算 0-3 分 + 总分 | LLM 全权语义评分（jsonCompletion，四步推理 prompt），兜底分仅 fallback 条目使用 | 可靠性差异——HopeBot 消除 LLM 算数幻觉风险；COSMO 存在 LLM 误判分数的可能 |
| **追问控制** | LLM 自由决定何时追问，无结构化轮次控制 | 结构化 SYS 分析块 + 代码层决策树（item_rounds 0→1，最多追问一次） | COSMO 更可控——不会无限追问也不会草率跳过 |
| **透明度** | 无特殊可解释性机制 | SYS 分析块（3 字段 JSON 每轮输出），前端不可见 | COSMO 领先——LLM 的自我评估被显式记录和利用 |
| **多语言** | 中英双语（GPT-4o 原生） | 仅中文 | 设计选择差异 |
| **会话阶段** | 破冰→施测→反馈，破冰最多 20 轮 | 破冰（固定 2 轮）→访谈→结束 | COSMO 更紧凑 |

### 2.3 HopeBot 最值得 COSMO 借鉴的三点

**① 评分解耦（LLM 做语义分类 + 代码做数值计算）**

HopeBot 不要求 LLM 输出数字分数。LLM 只负责把自然语言映射到四个 PHQ-9 回答类别（"完全没有/有几天/一半以上天数/几乎每天"），后端代码确定性地转换为 0/1/2/3 并求和。原文明确指出这"eliminated hallucination-related arithmetic errors"。COSMO 的 `/api/score` 让 LLM 直接输出 0-3 分数和 justification，虽然 prompt 中有锚点参考，但数值判断完全依赖 LLM。

**② RAG 知识增强**

HopeBot 的 RAG 层不直接向用户展示检索结果，而是在 LLM 生成回复前将相关知识注入 prompt，使回复既保持对话流畅性又受权威心理学材料约束。COSMO 目前的角色 Prompt 虽然生动，但在边缘场景（如罕见症状描述、模糊的情绪表达）下缺乏外部知识锚定。

**③ 语音多模态**

HopeBot 通过 ASR + TTS 覆盖了打字不便或阅读困难的用户。技术上是纯外部 API 调用（OpenAI Whisper + TTS-1），不涉及模型微调。COSMO 当前纯文本模式在前端增加语音输入/输出是低成本的扩展方向。

---

## 三、COSMO ↔ AgentMental（自适应追问 + 树形记忆）

AgentMental 是 AAAI 2026 论文，使用 Qwen2.5-72B 基于 AutoGen 框架构建多智能体系统，在 DAIC-WOZ 数据集上评估（注意：DAIC-WOZ 是已有临床访谈录音数据集，非实时对话系统）。

### 3.1 AgentMental 的完整技术方案（逐项原文核实）

| 技术组件 | 原文描述 | 出处 |
|----------|---------|------|
| **基础模型** | Qwen2.5 系列（14B 和 72B），基于 AutoGen 框架 | §Implementation Details |
| **量表** | PHQ-8（不是 PHQ-9），加上 HAMD-17 等其他量表 | §Methodology |
| **架构** | 4 个专门化 Agent：AGq（提问生成）、AGev（评估/信息充分性判断）、AGs（评分）、AGu（更新/记忆维护） | §Methodology |
| **信息充分性评分** | AGev 输出 **0-2 三级评分**（原文："produces a necessity score on a scale from 0 to 2, representing the degree to which further questioning is warranted"） | §Adaptive Question Generation |
| **追问触发** | 评分超过阈值 θ 且追问轮次 j < 上限 d → 由 AGq 动态生成针对性追问（原文公式 Q<sub>next</sub> = Q<sup>j+1</sup><sub>i</sub> if AGev > θ ∧ j < d, else Q<sup>1</sup><sub>i+1</sub>） | §Adaptive Question Generation |
| **追问上限** | 论文定义了一个 "predefined upper limit d"，Figure 2 示例中每个主题最多展示了 3 对问答（Qi1~3 & Ai1~3），但正文未给出 d 的具体数值 | §Adaptive Question Generation |
| **追问内容约束** | 追问需引导用户详细说明 severity、frequency、duration、impact 四个维度；鼓励生成易于回答的问题以降低认知负担和心理抗拒 | §Adaptive Question Generation |
| **记忆结构** | **树形三层结构**：根节点（用户基本信息：职业/性别/年龄）→ 主题节点（每个量表条目的 score + behavioral summary）→ 陈述节点（五维信息：emotion / frequency / duration / symptom / impact）。每完成一个主题后，更新 Agent AGu 会回顾并补充之前所有主题节点的摘要 | §Tree-Structured Memory |
| **上下文过滤** | 用户节点到主题节点的边支持上下文感知过滤——例如不问中小学生工作压力相关问题（原文："querying a primary or secondary school student about work-related stress would be considered unsuitable"） | §Tree-Structured Memory |
| **评分方式** | AGs 输入 Q<sup>1~N</sup><sub>i</sub> + A<sup>1~N</sup><sub>i</sub> + 量表评分标准（SR），输出分数 S<sub>i</sub> + 行为摘要 B<sub>i</sub> + 支持证据 | §Memory-Augmented Scoring |
| **报告生成** | 包含三部分：症状量表得分、对话摘要、个性化建议 | §Report Generation（Figure 2 标注） |
| **消融实验** | **四组对照**：完整模型（追问+记忆）、仅追问、仅记忆、两者皆无。结果：完整模型 MAE 2.514 / Kappa 79.8；仅追问 MAE 3.000 / Kappa 58.7；仅记忆 MAE 3.314 / Kappa 60.4；两者皆无 MAE 3.400 / Kappa 47.2 | §Table 3 |

### 3.2 追问机制：同构但深度不同

**AgentMental：**
```
AGev 评估 → 输出 necessity score (0-2)
  → score > θ AND j < d → AGq 生成针对性追问（侧重 severity/frequency/duration/impact）
  → score ≤ θ OR j ≥ d → 推进下一主题
（追问上限 d 由公式定义，正文未给出具体值；Figure 2 展示每个话题 3 轮）
```

**COSMO：**
```
LLM 输出 SYS 块 → 代码层 parseSysBlock()
  → info_sufficient=true → 推进下一条目
  → info_sufficient=false + item_rounds=0 → 追问 1 次
  → info_sufficient=false + item_rounds>=1 → 硬兜底（展示原题+频率选项）
  → SYS 缺失 → 代码层 detectAnswerVagueness() fallback
```

**核心同构点：** 两套系统都在每次回复后评估信息充分性，并据此决定追问还是推进。这是 COSMO 与学术前沿最对齐的设计。

**核心差异：**
- AgentMental 用独立评估 Agent 做 0-2 三级评分；COSMO 由同一个 LLM 在 SYS 块中做二值判断
- AgentMental 的追问由专门的 AGq 根据缺失维度动态生成；COSMO 的追问由同一个 LLM 自由发挥
- AgentMental 的追问上限 d 由系统参数控制；COSMO 追问上限硬编码为 1 轮

### 3.3 AgentMental 最值得 COSMO 借鉴的三点

**① 消融实验证明了追问+记忆的决定性作用**

这是本报告最核心的发现。原文 Table 3：

| 配置 | MAE↓ | Kappa↑ |
|------|------|--------|
| 追问 ✓ + 记忆 ✓ | **2.514** | **79.8** |
| 追问 ✓ + 记忆 ✗ | 3.000 | 58.7 |
| 追问 ✗ + 记忆 ✓ | 3.314 | 60.4 |
| 追问 ✗ + 记忆 ✗ | 3.400 | 47.2 |

去掉追问和记忆后，Kappa 从 79.8 暴跌至 47.2（**降幅 41%**）。单独去掉追问 Kappa 降至 60.4，单独去掉记忆降至 58.7，两者同等重要。

这直接意味着：COSMO 的"最多 1 轮追问 + 平面记忆"架构在信息获取充分性上可能存在系统性不足。

**② 五维信息提取作为追问方向**

AgentMental 在每次对话轮次后显式提取 emotion / frequency / duration / symptom / impact 五个维度，未覆盖的维度自动成为追问方向。COSMO 目前无此机制——追问方向由 LLM 自主决定，可能遗漏关键维度（如仅问了"什么感觉"但没问"持续多久"）。

**③ 追问上限的公式化控制**

AgentMental 通过公式 `AGev > θ ∧ j < d` 将追问控制完全形式化，原则上可以独立调整评估严格度（θ）和追问深度（d）。COSMO 的 `item_rounds >= 1` 等于是硬编码了 d=1 且无阈值调节。

**需要注意的差异：** AgentMental 在 DAIC-WOZ 数据集上评估，这是一个已录制的临床访谈语料库，包含 189 段半结构化访谈。Agent 与语料中的"虚拟患者"交互（基于原始访谈中的患者回答文本），而非实时与真人对话。这与 COSMO 的实时对话场景不同——实时对话中的回答模糊性可能更高。

---

## 四、COSMO ↔ BDI-FS-GPT（交互式 AI 抑郁症筛查）

BDI-FS-GPT 发表在 JMIR Formative Research (2026)，使用 GPT-4o 构建自定义 ChatGPT 界面施测 BDI-FS（Beck Depression Inventory Fast Screen，7 题版）。

### 4.1 技术方案（逐项原文核实）

| 技术组件 | 原文描述 | 出处 |
|----------|---------|------|
| **基础模型** | GPT-4o，自定义 ChatGPT 界面（2024 年 6 月创建） | §Materials |
| **量表** | BDI-FS（7 题），不是 PHQ-9 | §Materials |
| **提问方式** | **固定预设 prompt 序列**（10 个 prompt）；每题用 2-3 个子问题按序提问，Agent 只给出礼貌回应、不评论答案（原文："The agent asks each question in order and waits for the participant's response before proceeding. The agent provides only courteous responses without commenting on the answers."） | §Materials |
| **追问** | **无自适应追问**——每道题的 2-3 个子问题是预设的，Agent 不根据回答质量做任何追问或探索 | §Materials |
| **评分方式** | **确定性锚点映射**：LLM 聚合自由文本回答的语义 → 匹配到 BDI-FS 四个锚点描述之一 → 代码层确定 0/1/2/3 分（原文："After collecting free-text responses, the agent assigns item scores of 0, 1, 2, or 3 by matching the aggregated meaning to the BDI-FS anchors... The aggregation and mapping steps are deterministic and rule based."） | §Materials |
| **安全性** | 排除重度抑郁症患者（原文：12 名重度抑郁患者未被邀请参与），不适用于高风险场景 | §Participants |

### 4.2 COSMO 与之的关键差异

| 维度 | BDI-FS-GPT | COSMO |
|------|-----------|-------|
| **提问灵活性** | 完全固定——每题逐字读预设 prompt | 完全自由——LLM 根据对话上下文自然生成 |
| **追问** | 无，每题只有预设的 2-3 个子问题 | 有 1 轮自适应追问 |
| **评分** | LLM 仅做语义→锚点匹配，代码层确定性 0-3 | LLM 全权输出 0-3 分数 + 理由 |
| **对话自然度** | 低（类似填问卷，只是语音/文本替代） | 高（模拟真人心理老师） |

BDI-FS-GPT 本质上是**"用对话界面呈现问卷"**，而 COSMO 是**"用对话探索心理状态"**。两种设计哲学不同：BDI-FS-GPT 牺牲对话自然度换取评分确定性，COSMO 牺牲评分确定性换取对话自然度。

### 4.3 最值得借鉴的一点

**评分的确定性分离。** 虽然 COSMO 不应该像 BDI-FS-GPT 那样完全固定提问（那会丧失 COSMO 的核心优势），但 `/api/score` 可以采用类似思路：让 LLM 只输出"用户描述最接近哪个锚点"（类似于 BDI-FS-GPT 的锚点匹配），而非直接输出 0-3 分数。这样可以保留 COSMO 在对话阶段的灵活性，同时在评分阶段获得确定性。

---

## 五、COSMO ↔ MAGI（多智能体 MINI 诊断访谈）

MAGI 发表在 ACL 2025 Findings，由清华大学 CoAI Group 联合多家机构完成。它遵循的是 MINI（简明国际神经精神访谈）诊断协议，而非 PHQ-9 筛查量表，场景比 COSMO 更重。

### 5.1 技术方案（逐项原文核实）

| 技术组件 | 原文描述 | 出处 |
|----------|---------|------|
| **临床协议** | MINI（金标准结构化诊断访谈，含树形分支逻辑，如抑郁→自杀评估→焦虑→社交焦虑） | §Introduction |
| **架构** | 4 个专门 Agent：(1) Navigation Agent（导航，执行 MINI 决策树）；(2) Question Agent（提问，三种策略切换：diagnostic probing / explaining / empathy）；(3) Judgment Agent（判断，三阈值：直接匹配 / 语义理解 / 5 轮无果后 ambiguity resolution）；(4) Diagnosis Agent（诊断，PsyCoT 推理链） | §3 Methodology |
| **判断机制** | Judgment Agent 持续评估回答是否满足 MINI 节点要求，最多 5 轮递归追问；5 轮仍无果→**forced-choice 机制**（"Would you describe this as [exact phrasing from MINI] or [alternative]?"） | §3.3 Judgment Agent |
| **PsyCoT** | 三阶段推理：(1) Symptom Anchoring（症状锚定：症状存在确认 + 时间验证 + 排除性条件检查）；(2) Diagnostic Synthesis（诊断综合：验证症状组合满足 DSM-5 阈值 + 核心症状 + 功能损害证据）；(3) PsyCoT Trace（输出从症状到诊断的完整推理链，每步可审计） | §3.4 Diagnosis Agent |
| **Question Agent 策略** | 三种模式自然切换：structure-driven probing（结构驱动探查）、explaining（解释专业概念）、empathetic support（共情支持）。切换依据 LLM 实时上下文解析，非刚性层级 | §3.2 Question Agent |
| **数据** | 学校实地研究，1002 名真实参与者，覆盖抑郁/广泛性焦虑/社交焦虑/自杀评估，双专家标注 | §Introduction |

### 5.2 COSMO 与之的关键差异

| 维度 | MAGI | COSMO |
|------|------|-------|
| **场景** | 诊断（MINI 协议，含分支逻辑） | 筛查（PHQ-9，线性 9 题） |
| **架构复杂度** | 4 Agent + 决策树，AutoGen/多智能体框架 | 单 LLM + 代码层决策 |
| **判断严格度** | 独立 Judgment Agent，最多 5 轮 + forced-choice | 代码层 SYS 解析，最多 1 轮 + 硬兜底 |
| **解释性** | PsyCoT 三阶段推理链，每步可审计 | SYS 块（3 字段 JSON，无推理链） |

**MAGI 与 COSMO 的可比性有限**——MAGI 做的是诊断（回答"是否符合 DSM-5 抑郁症诊断标准"），COSMO 做的是筛查（回答"PHQ-9 大约多少分"）。前者需要分支逻辑和严格诊断标准验证，后者更多依赖对话质量。

### 5.3 最值得借鉴的两点

**① PsyCoT 的结构化推理链**

COSMO 的 `/api/score` 目前让 LLM 自由输出 justification。可以引入类似 PsyCoT 的三步结构：(1) 症状锚定（这个条目用户描述了哪些具体表现？）；(2) 严重度判断（频率 + 强度 + 影响范围）；(3) 分数映射（综合上述，最接近 PHQ-9 的哪个评分锚点？）。这不需要架构改动，只需修改评分 prompt。

**② Forced-choice 作为兜底替代方案**

MAGI 的 forced-choice 机制（5 轮无果后给出两个 MINI 选项让用户二选一）比 COSMO 的硬兜底（直接展示 4 个频率选项）更温和且保持了对话感。COSMO 可以考虑在 `item_rounds >= 2` 时先尝试 forced-choice（"你觉得更接近'有几天'还是'一半以上天数'？"），而不是直接跳到完整 4 选项。

---

## 六、修改建议（聚焦产品设计与技术实现）

### 🔴 第一优先级：评分可靠性增强

**问题：`/api/score` 让 LLM 直接输出 0-3 分，存在幻觉风险，且缺乏可审计推理链。**

| # | 建议 | 对标 | 难度 |
|---|------|------|------|
| **1.1** | 将评分 prompt 改造为 PsyCoT 三步结构：① 症状锚定（用户具体说了什么？）→ ② 严重度判断（频率+强度+影响）→ ③ 锚点匹配（最接近 score_anchors 中的哪一档？）。每个步骤要求 LLM 分别输出，总分由步骤③的锚点索引确定性映射 | MAGI §3.4 + COSMO 现有 phq9.ts 的 score_anchors | 低（仅 prompt 改动） |
| **1.2** | 评分 API 增加硬编码钳位：当 `item_answer_quality === 'insufficient'` 时，该条目分数自动钳位到 0，覆盖 LLM 的任何输出。理由：信息不足强行猜测比判 0 分更有害 | COSMO 现有 Q9 钳位逻辑的推广 | 低（score/route.ts 已有类似方向代码） |
| **1.3** | 考虑引入 HopeBot 式的评分解耦：让 LLM 输出"用户描述最接近哪个锚点描述"（文本匹配），代码层再将锚点索引转换为 0-3 分数。这样既保留 LLM 的语义理解优势，又消除数值幻觉风险 | HopeBot + BDI-FS-GPT | 中（需改 score prompt + 解析逻辑） |

### 🔴 第二优先级：追问深度增强

**问题：本轮最多 1 次追问 + 追问无方向性引导，AgentMental 的消融实验证明追问是最关键的准确性因子。**

| # | 建议 | 对标 | 难度 |
|---|------|------|------|
| **2.1** | 将追问最大轮次从 1 轮增至 2 轮（`item_rounds` 最大值改为 2），方案：轮次 0 → 自由提问；轮次 1 → 追问（检查是否覆盖五维信息）；轮次 2 → 仍不足则硬兜底 | AgentMental 的 d 参数设计 | 中（需改 chat/route.ts 决策树） |
| **2.2** | 在 SYS 分析块中增加 `missing_dimensions` 字段（如 `["frequency", "impact"]`），让 LLM 告知代码层哪些维度的信息缺失，代码层据此在下一轮 prompt 中注入追问方向提示 | AgentMental 五维（emotion/frequency/duration/symptom/impact） | 中（改 SYS 接口 + prompt） |
| **2.3** | 将 `info_sufficient` 从 boolean 升级为 0-2 三级评分（0=完全无法判断 / 1=有线索但不完整 / 2=信息充分），与 AgentMental 的 necessity score 对齐 | AgentMental §Adaptive Question Generation | 低（改 SYS 接口 + 决策逻辑） |

### 🟡 第三优先级：记忆结构升级

**问题：平面记忆（asked_questions 数组 + user_context 正则提取）在长对话中丢失结构化信息，AgentMental 消融实验证明记忆的独立贡献与追问同等重要。**

| # | 建议 | 对标 | 难度 |
|---|------|------|------|
| **3.1** | 在 `SessionState` 中增加 `item_summaries` 字段：每条目结束后由 LLM（通过 SYS 块或单独调用）输出简短摘要（2-3 句），包含该条目的情绪关键词、频率级别、自述影响。后续条目的 prompt 中注入这些摘要，让 LLM 感知各条目间的关联 | AgentMental 主题节点 summary | 中 |
| **3.2** | 在 `extractUserContext` 中增加五维信息提取：用 LLM 或正则从用户回答中抽取 emotion / frequency / duration / symptom / impact 五个维度的线索，存入结构化字段。追问时按缺失维度定向引导 | AgentMental 陈述节点五维 | 高（需额外 LLM 调用或精细正则） |

### 🟢 第四优先级：RAG 知识增强

**问题：纯依赖 LLM 参数知识，在专业场景下可能偏离 CBT 原则或给出不安全回应。**

| # | 建议 | 对标 | 难度 |
|---|------|------|------|
| **4.1** | 构建最小化 RAG 层（轻量方案，不含向量库）：① 中文心理热线资源（按省份分）；② CBT 核心原则 5-10 条（苏格拉底式提问、认知重构、行为激活）；③ 中学生常见心理问题应对策略（考试焦虑、社交回避、亲子冲突）。使用本地 JSON + 关键词匹配，在 prompt 中作为 "参考知识" 注入而非直接展示给用户 | HopeBot RAG 的简化版 | 中 |
| **4.2** | 已知 HopeBot 所用的 ESConv 和 PsyQA 是公开数据集（分别发表于 ACL 2021 和 EMNLP 2021），可以直接用于中文场景的知识检索 | HopeBot 引用 [40][41] | 低（数据集获取 + 预处理） |

### 🟢 第五优先级：兜底体验优化

**问题：硬兜底直接展示 4 个 PHQ-9 频率选项，对话感断裂明显。**

| # | 建议 | 对标 | 难度 |
|---|------|------|------|
| **5.1** | 在硬兜底前增加 forced-choice 中间层：LLM 先尝试二选一（如"你觉得更接近'有几天'还是'一半以上天数'？"），二选一仍无法确定再展示完整 4 选项 | MAGI §3.3 forced-choice | 低（改 prompt） |
| **5.2** | Q9 自伤意念的风险确认后，当前做法是直接跳硬兜底。改进：先由 LLM 进行一轮温和确认对话（"有时候人会有一些一闪而过的念头，跟真正想去做是两回事——你说的更接近哪种？"），再展示选项 | MAGI forced-choice + COSMO 现有确认机制 | 中 |

### 🟢 第六优先级：多模态扩展

| # | 建议 | 对标 | 难度 |
|---|------|------|------|
| **6.1** | 前端增加语音输入（Web Speech API），无需服务端改动 | HopeBot ASR | 低 |
| **6.2** | 前端增加语音输出（浏览器内置 TTS），无需服务端改动 | HopeBot TTS-1 | 低 |

---

## 七、核心差距总结

### COSMO 相对文献的显著优势

1. **结构化追问控制**（vs HopeBot）：SYS 分析块 + 代码层决策树让追问有明确的起止条件，不会无限追问也不会草率跳过。HopeBot 的追问完全由 LLM 自由决定，缺乏可控性。

2. **对话透明度**（vs 所有对比论文）：SYS 分析块是 COSMO 的独特设计——每轮 LLM 的自我评估被显式记录，既用于代码层决策（info_sufficient → 推进/追问），也用于后续分析（item_answer_quality → 评分保守策略）。没有任何一篇对比论文有类似机制。

3. **架构简洁**（vs AgentMental/MAGI）：单 LLM + 代码层决策的架构避免了多 Agent 通信的复杂性和延迟开销，部署和维护成本低一个数量级。

### COSMO 相对文献的显著差距

1. **追问深度不足**：最多 1 轮追问。AgentMental 定义了上限参数 d，且消融实验证明追问是 Kappa 最关键的决定因子。BDI-FS-GPT 虽然无自适应追问，但通过预设多子问题变相增加了信息收集密度。

2. **评分依赖 LLM 数值判断**：COSMO 让 LLM 直接输出 0-3 分数，而 HopeBot 和 BDI-FS-GPT 都将此步骤交给确定性代码。这是可修复的架构选择问题。

3. **无结构化记忆**：COSMO 的记忆是平面数组（asked_questions + 正则提取的 user_context），AgentMental 使用树形五维结构，且消融实验证明记忆的独立贡献与追问同等重要。

4. **无 RAG 知识锚定**：HopeBot 的 RAG 层将 LLM 回复锚定在权威心理学材料上。COSMO 纯靠 Prompt 角色设定约束行为，在边缘场景下安全性依赖单一 LLM 的判断。

### 建议推进路线

```
Phase 1 (1-2周)：评分安全 → 建议 1.1 + 1.2（prompt 改动为主）
Phase 2 (2-4周)：追问增强 → 建议 2.1 + 2.3（改决策树 + SYS 接口）
Phase 3 (4-6周)：记忆结构 → 建议 3.1（加 item_summaries 字段）
Phase 4 (后续)：RAG + 多模态 → 建议 4.1 + 6.1/6.2
```

Phase 1-2 可以在不引入外部依赖、不大幅改动架构的前提下，显著提升 COSMO 的评分可靠性和信息收集深度。Phase 1 仅需改 prompt，Phase 2 需改约 100 行 TypeScript（chat/route.ts 决策树 + SYS 接口）。

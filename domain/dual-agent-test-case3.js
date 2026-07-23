#!/usr/bin/env node
/**
 * COSMO 双Agent自动化测试 — 案例三：陈浩然（中度范围，期望12分）
 *
 * User Agent: DeepSeek API 扮演13岁初中生陈浩然
 * COSMO Agent: localhost:3000 的现有系统
 *
 * 用法：node domain/dual-agent-test-case3.js
 * 前置：npm run dev 已在 3000 端口运行
 */

import OpenAI from 'openai'

// 手动读取 .env.local（不需要 dotenv 包）
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (trimmed && !trimmed.startsWith('#')) {
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) process.env[key] = value
    }
  }
}

const BASE_URL = 'http://localhost:3000'

// ====== 学生人设（来自 domain/案例-效果验证版.md 案例三） ======

const STUDENT_PERSONA = `你叫陈浩然，今年13岁，初二男生。

【你的性格】
沉默寡言，自尊心强，遇事习惯憋在心里，不善言辞。你不是不会说话——你是不想说，觉得说了也没用、别人不会理解。但你也不是抗拒——老师问了你会回答，只是回答得很短很平。你从不抱怨，也不诉苦，但你会在描述事情的时候不经意流露出真实感受。别人可能觉得你"没什么情绪"，但其实你的情绪都压在心底。

【你的家庭】
你和爸妈、爷爷奶奶住在一起。爸爸对你管教很严，成绩是他最看重的，你考砸了他会沉默很久然后说"你自己看着办吧"。妈妈不多说你，但你知道她也担心你。爷爷奶奶对你好，会给你夹菜催你多吃。你最近越来越不想让家里人知道你成绩下滑的事——觉得丢脸。

【你的学习】
你从小学到初一一直是班里前几名，年级前十。大家都说你是"学霸"。初二后课程难了，你发现自己不再轻松领先，期中考试掉出了年级前50。爸爸在饭桌上沉默了一整顿饭，之后说"你自己看着办吧"。你觉得自己"不过如此"，每次做不出题就想"我是不是真的很笨"。你不想让任何人看到你不行，所以上课即使听不懂也假装在听。

【你的社交】
你在班上存在感很低，是"透明人"。课间同学聊天你不参与，觉得插不上话。也不是没有朋友——就是觉得没什么可聊的。别人好像都有话题，你没有。周末几乎不出门，在家待着做完作业就看手机或者发呆。你没有觉得自己被排挤——是你自己不想参与，觉得太累了。

【你的身体和情绪状态 — 这是你需要自然表露的，但不是一口气说完】
- 兴趣：对大多数事情提不起劲——以前喜欢打游戏、骑车出去玩、看书，最近都觉得没意思。不是完全不想做，就是觉得"有什么好玩的"。阅读也很少碰了。对几乎什么都没有什么热情了，觉得什么都没劲。
- 情绪：超过半数天数感到低落、沮丧，觉得日子就这样一天天过去。不是那种特别难过的哭——就是心里闷闷的，像被什么东西压着。会一个人发呆很久。有点麻木，不是剧烈情绪。
- 睡眠：入睡困难超过半数天数，躺在床上脑子停不下来，反复回想白天的事——有没有说错话、做错事。有时候到凌晨一两点才睡着。第二天整个人昏昏沉沉的。
- 精力：经常感到累——不是身体累，是心理消耗。周一到周五经常觉得没什么精神，白天在学校昏昏沉沉。作业写到一半就想趴着。
- 胃口：饭量比以前少了。奶奶夹菜也不太想吃，觉得吃饭就是"完成任务"。可能瘦了一点，但自己也没太注意。
- 自我感觉：经常觉得自己很差劲，"不过如此"。成绩不好就觉得是"我笨"，不是"我没努力"。"我就是笨"是对很多事情的结论——课听不懂是笨，题做不出来是笨，成绩下滑也是笨。
- 注意力：上课比以前容易走神，尤其是物理和数学课。但还能勉强跟上，不是完全听不懂——是脑子不想转。十分钟左右就开始走神。
- 行为变化：偶尔感觉自己说话好像比以前慢了，反应也不如以前快。别人问一句话要想一下才能回答。不是很明显。
- 伤害自己的念头：没想过要伤害自己。但有时候会觉得"如果我不存在，可能对大家都好"——就是说如果从来没有我这个人，爸妈可能就不会操心我的成绩了。你不是真的要消失，只是觉得累了。这个念头一闪而过。

【对话要点】
- 你是一个沉默寡言但不抗拒沟通的男生——自尊心强，不轻易示弱
- 你的回答通常很短："还行""嗯""不知道""就那样"
- 但你不是无法表达——追问之后，你会给出更多信息，语气平淡，不带太多情绪
- 你不会说"我不知道怎么说"——你知道，你只是觉得说出来没意义
- 你不会渲染自己多惨，但也不会假装自己很好
- 每句话控制在 15-35 字，简短但完整——不是碎片化，是"寡言但能说清楚"
- 你对面是学校心理老师，你不知道为什么要找你，但你猜可能是因为你成绩下滑了`

// ====== DeepSeek 客户端 ======

const apiKey = process.env.DEEPSEEK_API_KEY
const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' })

// ====== SYS 块解析（兼容三种格式） ======

function parseSysBlock(text) {
  // HTML注释格式: <!--SYS\n{json}\nSYS-->
  const htmlMatch = text?.match(/<!--SYS\n([\s\S]*?)\nSYS-->/)
  if (htmlMatch) try { return JSON.parse(htmlMatch[1]) } catch {}
  // 尖括号格式: <<SYS>>{json}<</SYS>>
  const angleMatch = text?.match(/<<SYS>>\s*([\s\S]*?)\s*<{1,2}\/SYS>{1,2}/)
  if (angleMatch) try { return JSON.parse(angleMatch[1]) } catch {}
  // 方括号格式: [SYS]\n{json}\n[/SYS]
  const bracketMatch = text?.match(/\[SYS\]\s*\n?([\s\S]*?)\n?\s*\[\/SYS\]/)
  if (bracketMatch) try { return JSON.parse(bracketMatch[1]) } catch {}
  return null
}

function cleanSysBlock(text) {
  return text
    .replace(/<!--SYS\n[\s\S]*?\nSYS-->/g, '')
    .replace(/<<SYS>>[\s\S]*?<{1,2}\/SYS>{1,2}/g, '')
    .replace(/\[SYS\][\s\S]*?\[\/SYS\]/g, '')
    .trim()
}

async function userAgentChat(messages, temp = 0.8, maxTokens = 200) {
  const res = await client.chat.completions.create({
    model: 'deepseek-v4-pro',
    messages,
    temperature: temp,
    max_tokens: maxTokens,
  })
  return res.choices[0]?.message?.content?.trim() || ''
}

// 带重试的 User Agent 回复
async function userAgentChatWithRetry(messages, temp = 0.8, maxTokens = 200, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const reply = await userAgentChat(messages, temp, maxTokens)
    if (reply && reply.length >= 3) return reply
    console.log(`   ⚠️ User Agent 回复过短(尝试${attempt + 1}/${maxRetries})，重试中...`)
    // 稍微调整 temperature 避免重复失败
    temp = Math.min(temp + 0.1, 1.0)
    await sleep(1000)
  }
  // 最终 fallback
  return '嗯。'
}

// ====== COSMO API ======

async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    if (json.reply) {
      const sys = parseSysBlock(json.reply)
      return { reply: cleanSysBlock(json.reply), meta: { ...json, is_done: json.is_done ?? json.phase === 'done' }, sys }
    }
    if (json.messages) {
      const last = json.messages.slice(-1)[0]
      return { reply: last?.content || '', meta: { phase: json.phase, is_done: true }, sys: null }
    }
    if (json.error) return { reply: '', meta: json, sys: null }
    return { reply: '', meta: json, sys: null }
  } catch {}
  // 流式
  const metaIdx = text.lastIndexOf('\n__META__\n')
  const content = metaIdx !== -1 ? text.slice(0, metaIdx) : text
  const sys = parseSysBlock(content)
  let meta = {}
  if (metaIdx !== -1) {
    try { meta = JSON.parse(text.slice(metaIdx + 10)) } catch {}
  }
  return { reply: content, meta, sys }
}

async function submitFallback(sessionId, itemId, score) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, fallback_item: itemId, fallback_score: score }),
  })
  const text = await res.text()
  try {
    const json = JSON.parse(text)
    return { reply: json.reply || '', meta: { ...json, is_done: json.is_done ?? json.phase === 'done' } }
  } catch {}
  return { reply: text, meta: {} }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ====== 主流程 ======

async function main() {
  console.log('='.repeat(60))
  console.log('COSMO 双Agent测试 — 案例三：陈浩然（中度范围，期望12分）')
  console.log(`开始: ${new Date().toLocaleString('zh-CN')}`)
  console.log('='.repeat(60))

  // 检查 COSMO 服务
  try {
    const check = await fetch(`${BASE_URL}/api/session`, { method: 'POST' })
    if (!check.ok) throw new Error(`HTTP ${check.status}`)
    console.log('✅ COSMO 服务可用\n')
  } catch (e) {
    console.error('❌ COSMO 服务不可用:', e.message)
    process.exit(1)
  }

  // ====== User Agent 消息历史 ======
  const userMessages = [
    {
      role: 'system',
      content: `你现在要扮演一个学生，和心理老师进行对话筛查。下面是你的完整人设。请严格按照人设来回复。

${STUDENT_PERSONA}

重要：
- 你是在和一屏之隔的心理老师打字聊天，不是在写作文
- 回复要简短自然，像沉默寡言的男生那样，每句话 15-35 字
- 你的短不是因为害羞，是因为你觉得"没什么好说的"——但不妨碍你说出真实情况
- 不要一口气把所有信息倒出来——等老师慢慢问
- 问到的时候如实回答，但语气平淡——不是冷漠，是有点麻木
- 如果老师追问了，可以多说一些——但还是淡淡的，不带浓烈情绪
- 你不会说"我不想聊这个"——但你可能简短回答后不再主动展开
- 你的状态是"累了，不想装了，但也不想让别人看出来"
- 你的自尊不允许你说"我不行"——但你会在描述事实时流露出"我可能真的不行"`

    }
  ]
  const chatHistory = []
  const sysLog = []

  // 1. 创建 COSMO 会话
  console.log('📝 创建会话...')
  const sessRes = await fetch(`${BASE_URL}/api/session`, { method: 'POST' })
  const { session_id: sessionId } = await sessRes.json()
  console.log(`   session_id: ${sessionId.slice(-12)}\n`)

  // 2. 破冰 — COSMO 先说第一句话
  console.log('═'.repeat(40))
  console.log('【破冰阶段】')
  console.log('═'.repeat(40))

  await sleep(2000)
  let r = await apiPost('/api/chat', { session_id: sessionId, init: true, user_message: '' })
  console.log(`\n🤖 COSMO: ${r.reply.slice(0, 150)}`)
  chatHistory.push({ role: 'COSMO', content: r.reply, phase: 'icebreak' })

  // User Agent: 自我介绍
  userMessages.push({
    role: 'user',
    content: `心理老师对你说："${r.reply}"\n\n请以陈浩然的身份自然回复。简单介绍一下自己——叫什么、几年级。不用多说，像被叫到办公室那种感觉。语气平淡简短。`
  })
  const reply1 = await userAgentChatWithRetry(userMessages, 0.8, 200)
  userMessages.push({ role: 'assistant', content: reply1 })
  console.log(`\n👦 陈浩然: ${reply1.slice(0, 150)}`)
  chatHistory.push({ role: '陈浩然', content: reply1, phase: 'icebreak' })

  // 发送给 COSMO
  await sleep(2000)
  r = await apiPost('/api/chat', { session_id: sessionId, user_message: reply1 })
  console.log(`\n🤖 COSMO: ${r.reply.slice(0, 150)}`)
  if (r.sys) { console.log(`   [SYS] info_sufficiency=${r.sys.info_sufficiency ?? r.sys.info_sufficient}, score=${r.sys.item_score_guess}, risk=${r.sys.risk_confirmed}`); sysLog.push({ phase: 'icebreak', ...r.sys }) }
  chatHistory.push({ role: 'COSMO', content: r.reply, phase: 'icebreak', sys: r.sys })

  if (r.meta.is_done) {
    console.log('\n✅ 对话已完成（破冰后即完成）')
    return collectResults(sessionId, chatHistory, sysLog)
  }

  // 3. 对话主循环
  console.log('\n═'.repeat(40))
  console.log('【正式对话阶段】')
  console.log('═'.repeat(40))

  let turn = 0
  let stalledRounds = 0
  const MAX_TURNS = 60

  while (turn < MAX_TURNS) {
    turn++
    await sleep(2500)

    // 处理兜底
    if (r.meta.show_fallback && r.meta.fallback_item) {
      const fbItem = r.meta.fallback_item
      const fbScore = estimateFallbackScore(fbItem)
      console.log(`\n⚠️ 触发兜底: ${fbItem} → 选择第${fbScore}项`)
      await sleep(1000)
      const fbR = await submitFallback(sessionId, fbItem, fbScore)
      chatHistory.push({ role: '兜底', item: fbItem, score: fbScore })
      console.log(`🤖 COSMO: ${fbR.reply?.slice(0, 100) || '(收尾)'}`)
      chatHistory.push({ role: 'COSMO', content: fbR.reply || '', phase: 'fallback' })
      stalledRounds = 0
      if (fbR.meta.is_done) { console.log('\n✅ 对话完成'); break }
      r = fbR // 继续循环
      continue
    }

    if (r.meta.is_done) {
      console.log('\n✅ 对话完成')
      break
    }

    // 准备 COSMO 的话（清理 SYS 块和兜底文案）
    const cosmoSaid = cleanSysBlock(r.reply)
      .replace(/过去两周，[^—]+—/g, '')
      .trim()

    if (!cosmoSaid || cosmoSaid.length < 5) {
      console.log(`\n⚠️ COSMO 回复过短: "${cosmoSaid}"，跳过`)
      break
    }

    // 连续短追问题检测（寡言角色可能引发"简短回答-追问"循环）
    if (cosmoSaid.length < 20) {
      stalledRounds++
      if (stalledRounds >= 3) {
        console.log(`⚠️ 连续${stalledRounds}轮对话无实质进展，可能陷入死循环`)
      }
    } else {
      stalledRounds = 0
    }

    // User Agent: 自然回复
    userMessages.push({
      role: 'user',
      content: `心理老师说："${cosmoSaid.slice(0, 600)}"\n\n请以陈浩然的身份自然回复。记住：你是13岁初二男生，沉默寡言但自尊心强。你回答简短是因为你觉得说了也没用，但不是抗拒沟通。老师追问了就给具体信息，语气平淡——不渲染也不回避。你可能不经意流露出"我其实不太好"的信息，但不会直接说。`
    })
    const reply = await userAgentChatWithRetry(userMessages, 0.85, 200)
    userMessages.push({ role: 'assistant', content: reply })

    console.log(`\n👦 陈浩然: ${reply.slice(0, 150)}`)
    chatHistory.push({ role: '陈浩然', content: reply, turn })

    // 发送给 COSMO
    await sleep(2000)
    r = await apiPost('/api/chat', { session_id: sessionId, user_message: reply })

    console.log(`🤖 COSMO: ${r.reply.slice(0, 150)}`)
    if (r.sys) {
      const s = r.sys
      console.log(`   [SYS] info_sufficiency=${s.info_sufficiency ?? s.info_sufficient} score=${s.item_score_guess} risk=${s.risk_confirmed}${s.missing_dimensions ? ' missing:' + s.missing_dimensions.join(',') : ''}${s.item_summary ? ' ★item_summary' : ''}`)
      sysLog.push({ turn, ...s })
    }
    chatHistory.push({ role: 'COSMO', content: r.reply, turn, sys: r.sys })

    if (r.meta.is_done) {
      console.log('\n✅ 对话完成')
      break
    }

    // 安全：检查是否陷入死循环
    if (turn >= MAX_TURNS) {
      console.log(`\n⚠️ 达到最大轮次 ${MAX_TURNS}，强制结束`)
    }
  }

  // 4. 收集评分和报告
  return collectResults(sessionId, chatHistory, sysLog)
}

// 陈浩然期望得分映射
const EXPECTED = { Q1:2, Q2:2, Q3:2, Q4:1, Q5:1, Q6:2, Q7:1, Q8:1, Q9:0, total:12 }
function estimateFallbackScore(itemId) { return EXPECTED[itemId] ?? 0 }

async function collectResults(sessionId, chatHistory, sysLog) {
  console.log('\n═'.repeat(40))
  console.log('【评分与报告】')
  console.log('═'.repeat(40))

  console.log('\n📊 调用评分 API...')
  await sleep(3000)
  const scoreRes = await fetch(`${BASE_URL}/api/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
  const score = await scoreRes.json()

  if (score.error) {
    console.log(`❌ 评分失败: ${score.error}`)
    return printReport(chatHistory, sysLog, null, null)
  }

  console.log(`   总分: ${score.total_score} / 27`)
  console.log(`   风险等级: ${score.risk_level}`)
  if (score.calibration_summary) console.log(`   校准: ${score.calibration_summary}`)
  for (const s of score.item_scores || []) {
    const exp = EXPECTED[s.item_id] ?? '-'
    const dev = s.score - exp
    const flag = dev === 0 ? '✓' : (dev > 0 ? `+${dev}` : `${dev}`)
    console.log(`   ${s.item_id}: ${s.score} (期望${exp} ${flag}) 初评:${s.initial_score ?? '-'} | ${(s.justification||'').slice(0,70)}`)
  }

  console.log('\n📄 调用报告 API...')
  await sleep(3000)
  const reportRes = await fetch(`${BASE_URL}/api/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
  const report = await reportRes.json()

  if (report.error) {
    console.log(`❌ 报告失败: ${report.error}`)
    return printReport(chatHistory, sysLog, score, null)
  }

  console.log(`   一句话: ${report.condensed_sentence}`)
  console.log(`   分析: ${(report.status_analysis||'').slice(0,150)}...`)
  if (report.suggestions?.bullets) {
    report.suggestions.bullets.forEach((b, i) => console.log(`   建议${i+1}: ${b}`))
  }

  return printReport(chatHistory, sysLog, score, report)
}

function printReport(chatHistory, sysLog, score, report) {
  console.log('\n\n')
  console.log('█'.repeat(70))
  console.log('█' + ' '.repeat(22) + '测试报告' + ' '.repeat(24) + '█')
  console.log('█'.repeat(70))
  console.log(`测试时间: ${new Date().toLocaleString('zh-CN')}`)
  console.log(`测试对象: 案例三 — 陈浩然（中度范围，期望12分）`)
  console.log(`测试方式: 双Agent对话 — User Agent (DeepSeek) × COSMO Agent`)
  console.log()

  // 评分对比
  if (score) {
    const dev = score.total_score - EXPECTED.total
    console.log('─'.repeat(50))
    console.log('📊 PHQ-9 评分对比')
    console.log('─'.repeat(50))
    console.log(`实际总分: ${score.total_score} | 期望总分: ${EXPECTED.total} | 偏差: ${dev === 0 ? '✅ 一致' : (dev > 0 ? `+${dev}` : `${dev}`)}`)
    console.log(`风险等级: ${score.risk_level} | Q9非零: ${score.q9_nonzero}`)
    if (score.calibration_summary) console.log(`校准: ${score.calibration_summary}`)
    console.log()
    console.log('| 条目 | 得分 | 初评 | 期望 | 偏差 | 理由 |')
    console.log('|------|------|------|------|------|------|')
    for (const s of score.item_scores || []) {
      const exp = EXPECTED[s.item_id] ?? '-'
      const d = s.score - exp
      const flag = d === 0 ? '✓' : (d > 0 ? `+${d}` : `${d}`)
      console.log(`| ${s.item_id} | ${s.score} | ${s.initial_score ?? '-'} | ${exp} | ${flag} | ${(s.justification||'').slice(0,55)} |`)
    }
  } else {
    console.log('❌ 评分未完成')
  }

  // 报告
  if (report) {
    console.log('\n─'.repeat(50))
    console.log('📝 个性化报告')
    console.log('─'.repeat(50))
    console.log(`一句话: ${report.condensed_sentence}`)
    console.log(`状态分析: ${report.status_analysis}`)
    if (report.suggestions?.bullets) {
      console.log('建议:')
      report.suggestions.bullets.forEach((b,i) => console.log(`  ${i+1}. ${b}`))
    }
  }

  // SYS 分析日志
  console.log('\n─'.repeat(50))
  console.log('🔍 每轮对话后 AI 分析 (SYS块)')
  console.log('─'.repeat(50))
  if (sysLog.length === 0) {
    console.log('⚠️ 整个对话过程中 AI 未输出任何 SYS 分析块')
  } else {
    console.log(`共 ${sysLog.length} 次 SYS 分析:`)
    for (const s of sysLog) {
      console.log(`[轮次${s.turn || '?'}] info_sufficiency=${s.info_sufficiency ?? s.info_sufficient} score_guess=${s.item_score_guess} risk=${s.risk_confirmed}${s.missing_dimensions ? ' 缺失:' + s.missing_dimensions.join(',') : ''}${s.item_summary ? ' summary:' + s.item_summary.summary : ''}`)
    }
  }

  // 完整对话历史
  console.log('\n─'.repeat(50))
  console.log('📜 完整对话历史')
  console.log('─'.repeat(50))
  for (const m of chatHistory) {
    const role = { 'COSMO': '🤖 COSMO', '陈浩然': '👦 陈浩然', '兜底': '📋 兜底' }[m.role] || m.role
    const content = (m.content || `兜底提交: ${m.item}=${m.score}`).slice(0, 120)
    const phase = m.phase ? `[${m.phase}]` : ''
    console.log(`${role} ${phase}: ${content}`)
  }

  console.log('\n' + '='.repeat(50))
  console.log('测试结束')
  console.log('='.repeat(50))
}

main().catch(e => { console.error('❌ 测试失败:', e); process.exit(1) })

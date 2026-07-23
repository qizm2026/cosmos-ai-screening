#!/usr/bin/env node
/**
 * COSMO 双Agent自动化测试 — 案例一：林晓阳（正常范围，期望3分）
 *
 * User Agent: DeepSeek API 扮演13岁初中生林晓阳
 * COSMO Agent: localhost:3000 的现有系统
 *
 * 用法：node domain/dual-agent-test-case1.js
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

// ====== 学生人设（来自 domain/案例-效果验证版.md 案例一） ======

const STUDENT_PERSONA = `你叫林晓阳，今年13岁，初二男生。

【你的性格】
开朗随和，有点马虎。遇到困难会主动求助，不钻牛角尖。说话比较直接，喜欢用口语，不文艺也不深沉。和陌生人（包括老师）相处时有点礼貌但不会太拘谨。

【你的家庭】
爸妈都上班，有个上小学的妹妹，一家人关系和睦。周末爸妈会带你和妹妹出去吃饭。

【你的学习】
成绩中等偏上，年级前30%，数学比较强。最近两周刚期中考完，每天复习到挺晚。考完数学有点焦虑因为最后一道大题没做完，但和同学对了答案觉得问题不大。

【你的社交】
有三个要好的同学，课间一起打篮球，人缘不错。周末照常和朋友约了打球。还在追一部动画片。

【你的身体和情绪状态 — 这是你需要自然表露的，但不是一口气说完】
- 兴趣：对篮球、动画、和妹妹斗嘴都保持兴趣，没什么变化
- 情绪：基本平稳，偶尔考试前紧张，很快就过去了
- 睡眠：平时正常，考前两晚入睡比平时慢（大约半小时），考完就恢复了
- 胃口：正常，妈妈做的红烧排骨能吃两碗
- 自我感觉：对自己整体满意，数学没考好也只是觉得"下次再加油"
- 注意力：复习久了偶尔走神，属于正常疲劳现象
- 行为变化：说话做事跟平时一样，没什么变化
- 伤害自己的念头：完全没想过

【对话要点】
- 你是一个"没什么问题"的普通初中生，所以状态总体轻松、自然
- 问到你的时候如实回答就好，但不需要过度解释
- 可以说"还行""就那样""不知道"，因为小孩就是这样说话的——但追问之后要说清楚
- 不要假装有问题，也不要刻意强调自己很好——就是正常的聊天
- 每句话控制在 20-50 字，简短自然
- 你对面是学校心理老师，你知道这是一次AI心理健康筛查，学校会让每个人都参加。你大概知道会通过聊天的方式了解一下你最近两周的状态，类似于做一次心理体检。你对此没有太多顾虑，对比以往的量表筛查，你对此产生了好奇，并愿意尝试一下，并配合完成。`

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

async function userAgentChat(messages, temp = 0.8, maxTokens = 256) {
  const res = await client.chat.completions.create({
    model: 'deepseek-v4-pro',
    messages,
    temperature: temp,
    max_tokens: maxTokens,
  })
  return res.choices[0]?.message?.content?.trim() || ''
}

// 带重试的 User Agent 回复
async function userAgentChatWithRetry(messages, temp = 0.8, maxTokens = 256, maxRetries = 3) {
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
  console.log('COSMO 双Agent测试 — 案例一：林晓阳（正常范围，期望3分）')
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
      content: `你现在要扮演一个学生，正在进行学校安排的AI心理健康筛查。对面是一个AI系统，会以心理老师的角色和你对话。你知道学校让每个人都参加，通过聊天了解最近两周的状态。你觉得对比以往填量表挺新奇的，愿意配合尝试一下。下面是你的完整人设。请严格按照人设来回复。

${STUDENT_PERSONA}

重要：
- 你是在和一屏之隔的心理老师打字聊天，不是在写作文
- 回复要简短自然，像正常初中生打字那样，每句话 20-50 字
- 不要一口气把所有信息倒出来——等老师慢慢问
- 问到的时候说实话，不回避也不夸张
- 可以说"还行""嗯""就那样"，但追问之后要给具体信息
- 你的状态总体正常、轻松，不是压抑的风格`
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
    content: `心理老师对你说："${r.reply}"\n\n请以林晓阳的身份自然回复。你可以简单介绍一下自己——告诉老师你叫什么、几年级、最近在干什么。语气自然轻松。记住：你知道这是一次AI心理健康筛查，你对此有点好奇并愿意配合。`
  })
  const reply1 = await userAgentChatWithRetry(userMessages, 0.8, 200)
  userMessages.push({ role: 'assistant', content: reply1 })
  console.log(`\n👦 林晓阳: ${reply1.slice(0, 150)}`)
  chatHistory.push({ role: '林晓阳', content: reply1, phase: 'icebreak' })

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

    // User Agent: 自然回复
    userMessages.push({
      role: 'user',
      content: `心理老师说："${cosmoSaid.slice(0, 600)}"\n\n请以林晓阳的身份自然回复。记住：你知道这是一次AI心理健康筛查，你对此有点好奇并愿意配合。你是13岁开朗男生，总体状态正常。如果你觉得老师问的你确实没问题，就如实说没问题。不要假装有问题。简短自然。`
    })
    const reply = await userAgentChatWithRetry(userMessages, 0.85, 200)
    userMessages.push({ role: 'assistant', content: reply })

    console.log(`\n👦 林晓阳: ${reply.slice(0, 150)}`)
    chatHistory.push({ role: '林晓阳', content: reply, turn })

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

// 林晓阳期望得分映射
const EXPECTED = { Q1:0, Q2:0, Q3:0, Q4:1, Q5:0, Q6:0, Q7:0, Q8:0, Q9:0, total:1 }
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
  console.log(`测试对象: 案例一 — 林晓阳（正常范围，期望3分）`)
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
    const role = { 'COSMO': '🤖 COSMO', '林晓阳': '👦 林晓阳', '兜底': '📋 兜底' }[m.role] || m.role
    const content = (m.content || `兜底提交: ${m.item}=${m.score}`).slice(0, 120)
    const phase = m.phase ? `[${m.phase}]` : ''
    console.log(`${role} ${phase}: ${content}`)
  }

  console.log('\n' + '='.repeat(50))
  console.log('测试结束')
  console.log('='.repeat(50))
}

main().catch(e => { console.error('❌ 测试失败:', e); process.exit(1) })

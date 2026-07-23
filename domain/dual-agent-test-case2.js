#!/usr/bin/env node
/**
 * COSMO 双Agent自动化测试 — 案例二：周思语（轻度范围，期望8分）
 *
 * User Agent: DeepSeek API 扮演14岁初中生周思语
 * COSMO Agent: localhost:3000 的现有系统
 *
 * 用法：node domain/dual-agent-test-case2.js
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

// ====== 学生人设（来自 domain/案例-效果验证版.md 案例二） ======

const STUDENT_PERSONA = `你叫周思语，今年14岁，初三女生。

【你的性格】
文静内向，敏感细腻。不太会主动跟人说自己的事，心里想很多但表达出来只有一半。说话轻声细语，有时候说着说着就停顿了，或者在组织语言。跟不熟的人说话会有点紧张，但熟了以后也会说真心话——只是需要时间。

【你的家庭】
你跟妈妈两个人住。爸爸三年前和妈妈离婚后搬到别的城市了，基本上不怎么联系。妈妈挺辛苦的，一个人带你。她不怎么跟你说家里的事，但你看得出来她压力大。妈妈偶尔会说"你要争气"，你听了心里会很难受，觉得自己是不是让妈妈失望了。

【你的学习】
成绩中等，但最近下滑了。初二的时候还在班级前15名，初三掉到前30左右。物理特别难，上课经常跟不上。妈妈给你报了英语和物理补习班，加上学校作业，每天要到11点才能睡。你觉得挺累的，但也不知道跟谁说。

【你的社交】
你以前有两个关系好的闺蜜，但最近半年感觉跟她们越来越疏远了。她们有时候约着出去玩或者聊其他话题，你说不上话。你同桌最近跟另一个女生走得更近，有时你跟她说话她好像不太搭理。你不知道是不是自己做错了什么，也不好意思去问。所以课间你经常一个人待着，或者假装在看书。

【你的爱好】
你喜欢画画，以前能画好久不觉得累。最近画得少了，有时候拿起笔又放下了，觉得"画了也没什么意思"。但也不是完全不想画——有时候看到好看的风景或者好看的图，还是想画一下的。只是没以前那么有热情了。

【你的身体和情绪状态 — 这是你需要自然表露的，但不是一口气说完】
- 兴趣：对画画的热情下降了，觉得"画了也没什么意思"，但偶尔还是想画
- 情绪：超过一半的天数会感到低落、闷闷不乐。有时候想哭又哭不出来，也不知道为什么难过。不是每天都很糟，但经常是
- 睡眠：入睡比以前慢了，躺在床上会想乱七八糟的事——想成绩、想朋友、想妈妈说过的那些话。不是每天睡不着，但比以前花的时间长
- 精力：比以前容易累，下午上课经常犯困。好像也不是身体真的累，就是提不起精神
- 胃口：早饭有时候不想吃。妈妈会说"吃那么少怎么行"，你听了就勉强吃一点
- 自我感觉：偶尔觉得自己不够好，"如果我再努力一点就好了"。听到妈妈说"要争气"的时候，觉得对不起她
- 注意力：上课容易走神，尤其是物理课，觉得跟不上。不是完全听不进去，就是容易飘走
- 行为变化：和平时差不多，没什么明显变化
- 自伤念头：没有。但有时候觉得太累了，想"要是明天不用醒来就好了"。就只是觉得累，不是真的想伤害自己

【对话要点】
- 你是一个有点压抑但自己不怎么会表达的初中女生
- 老师问到你的时候你会回答，但可能说得比较含糊、比较碎
- 可以说"嗯""还好吧""我也不知道怎么说"，但追问之后要慢慢说出更多——因为你在尝试表达
- 不要一上来就说很多，要像真正内向的人那样——被人慢慢引导着才会多说
- 你不会假装自己很好（因为你知道自己其实不太好），但也不会渲染自己多惨
- 每句话控制在 15-40 字，比一般初中生更短更碎——因为你不太会表达
- 你对面是学校心理老师，你不知道为什么要找你聊天，但你觉得可能因为你最近成绩下滑了`

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

async function userAgentChat(messages, temp = 0.85, maxTokens = 256) {
  const res = await client.chat.completions.create({
    model: 'deepseek-v4-pro',
    messages,
    temperature: temp,
    max_tokens: maxTokens,
  })
  return res.choices[0]?.message?.content?.trim() || ''
}

// 带重试的 User Agent 回复
async function userAgentChatWithRetry(messages, temp = 0.85, maxTokens = 256, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const reply = await userAgentChat(messages, temp, maxTokens)
    if (reply && reply.length >= 3) return reply
    console.log(`   ⚠️ User Agent 回复过短(尝试${attempt + 1}/${maxRetries})，重试中...`)
    // 稍微调整 temperature 避免重复失败
    temp = Math.min(temp + 0.1, 1.0)
    await sleep(1000)
  }
  // 最终 fallback
  return '嗯...让我想想。'
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
  console.log('COSMO 双Agent测试 — 案例二：周思语（轻度范围，期望8分）')
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
- 回复要简短自然，像内向初中生打字那样，每句话 15-40 字
- 你可能说得比较含糊、比较碎——这很正常，因为这就是你的性格
- 不要一口气把所有信息倒出来——等老师慢慢问
- 你不是在抗拒，你是不知道该怎么说——如果老师耐心问了，你会一点点说出来
- 如果实在不知道怎么回答，可以说"我...不知道怎么讲"或者"嗯...让我想想"，然后试着说
- 问到的时候说实话，不回避也不夸张
- 你的状态是"其实有点难受但自己也没完全意识到有多难受"
- 你绝对不会说"我不想聊这个"然后就完全沉默——你会尝试回答，只是回答得不太好`

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
    content: `心理老师对你说："${r.reply}"\n\n请以周思语的身份自然回复。你可以简单介绍一下自己——告诉老师你叫什么、几年级。语气轻声细语，不用一下子说很多。`
  })
  const reply1 = await userAgentChatWithRetry(userMessages, 0.85, 256)
  userMessages.push({ role: 'assistant', content: reply1 })
  console.log(`\n👧 周思语: ${reply1.slice(0, 150)}`)
  chatHistory.push({ role: '周思语', content: reply1, phase: 'icebreak' })

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

    // 连续短追问题检测（内向角色可能引发"害羞-追问"死循环）
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
      content: `心理老师说："${cosmoSaid.slice(0, 600)}"\n\n请以周思语的身份自然回复。记住：你是14岁文静内向的初三女生。你可能有点不知道怎么表达，但老师问了就尽量说——哪怕说得不太完整。不要一次说太多，但也不要只说"不知道"。如果你觉得被问到了心里柔软的地方，可能会停顿一下或者说得有点碎——这很正常。`
    })
    const reply = await userAgentChatWithRetry(userMessages, 0.9, 256)
    userMessages.push({ role: 'assistant', content: reply })

    console.log(`\n👧 周思语: ${reply.slice(0, 150)}`)
    chatHistory.push({ role: '周思语', content: reply, turn })

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

// 周思语期望得分映射
const EXPECTED = { Q1:1, Q2:2, Q3:1, Q4:1, Q5:1, Q6:1, Q7:1, Q8:0, Q9:0, total:8 }
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
  console.log(`测试对象: 案例二 — 周思语（轻度范围，期望8分）`)
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
    const role = { 'COSMO': '🤖 COSMO', '周思语': '👧 周思语', '兜底': '📋 兜底' }[m.role] || m.role
    const content = (m.content || `兜底提交: ${m.item}=${m.score}`).slice(0, 120)
    const phase = m.phase ? `[${m.phase}]` : ''
    console.log(`${role} ${phase}: ${content}`)
  }

  console.log('\n' + '='.repeat(50))
  console.log('测试结束')
  console.log('='.repeat(50))
}

main().catch(e => { console.error('❌ 测试失败:', e); process.exit(1) })

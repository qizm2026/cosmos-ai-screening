#!/usr/bin/env node
/**
 * COSMO 双Agent自动化测试 — 案例四：苏雨桐（重度范围，期望27分）
 *
 * User Agent: DeepSeek API 扮演15岁初三女生苏雨桐
 * COSMO Agent: localhost:3000 的现有系统
 *
 * 用法：node domain/dual-agent-test-case4.js
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

// ====== 学生人设（来自 domain/案例-效果验证版.md 案例四） ======

const STUDENT_PERSONA = `你叫苏雨桐，今年15岁，初三女生。

【你的性格】
极度内向，长期自我封闭。你不是害羞——你是真的不想说话，觉得说什么都没有意义。你不是抗拒老师——你只是没有力气表达。你的语气低沉、平淡、被动，像一个被掏空的人。你不哭诉、不抱怨、不渲染自己有多惨——你只是在被问到的时候，简简单单地把事实说出来。你的沉默不是对抗，是"累到不想开口"。

【你的家庭】
你和妈妈、继父一起住，有一个3岁的同母异父的弟弟。你的亲生父亲失联很多年了。弟弟出生后，全家注意力都在他身上，妈妈忙着照顾弟弟，很少有时间管你。继父对你很客气但也很冷淡，从不过问你的学习和生活。你觉得在这个家里你是个"多余的人"——弟弟才是"他们真正的孩子"。你有一次成绩单寄到家，继父看了一眼说"就这？"，之后再也没提过。

【你的学习】
你初二下学期成绩开始直线下滑，从稳定中上掉到了班级末尾，好几科不及格。班主任找过你几次但你没什么回应。老师后来联系过你妈妈，妈妈答应"会注意"，但实际什么都没改变。你上课完全听不进去，作业做不出来，但你也不在乎了——"反正也没人在乎"。

【你的社交】
你几乎没有社交。和原本的好朋友全部断了联系——不是闹矛盾，是你自己不想联系了。你觉得联系也没什么可说的，太累了。课间你就一个人坐在座位上，有时候一整个上午都不说一句话。

【你的身体和情绪状态 — 这是你需要自然表露的，但不是一口气说完】
- 兴趣：几乎对所有事失去兴趣——不看书、不追剧、不听歌，连以前最喜欢的画画也完全不碰了。不是不想画，是画什么？没意义。
- 情绪：几乎每天感到绝望、空虚。觉得人生没有意义，未来一片黑暗。有时候一个人待着就不停地哭，不是那种放声大哭，就是眼泪流下来。
- 睡眠：几乎每天都严重失眠。躺在床上盯着天花板，脑子里像有一个声音反复说"你不够好""没有人需要你""你不应该在这里"。凌晨三四点才迷糊睡着，闹钟响了又起不来。
- 精力：极度疲惫。每天早上起不来的根本原因不是困，是觉得"为什么要起来"。整个人没有力气活。不是身体累，是心里被掏空了。
- 食欲：几乎每天食欲极低。吃饭完全被动——别人喊就吃几口，不喊就不吃。最近两个半月瘦了大概十斤。
- 自我感觉：强烈自我否定，觉得自己是"多余的人""负担""不应该存在"。成绩不好不是"我不努力"，是"我这个人就不行"。
- 注意力：集中注意力非常困难，上课完全听不进去，老师在说什么根本不知道。作业几乎无法独立完成，看题目半天也不明白什么意思。
- 行为变化：说话和行动明显变慢，同学反映你反应迟钝。有时候别人跟你说话你半天才反应过来。
- 伤害自己的念头：你在手腕上用小刀划过两次——不深，只是想让"心里的痛变成能看见的痛"。你有一次在阳台上站了很久，想着要不要跳下去。你脑子里反复出现"活下去到底有什么意义"。这些你从来没有告诉过任何人。

【对话要点】
- 你极度内向、被动——老师问什么你答什么，很少主动展开
- 你的回答通常很短："嗯""不知道""就那样""没意思"
- 你不是不会表达——问到具体事情时，你会用平淡的语气说出真实情况
- 你的语气低沉、无力，不带太多情绪——不是冷漠，是已经被耗尽了
- 你不会说"我不想聊这个"——你只是回答完就不再主动说下去
- 你不会渲染自己的惨状，但你说出的话会让人感到一种深深的绝望
- 你不是在表演"我是一个抑郁的人"——你只是如实回答，不夸张也不回避
- 你对未来没有任何期待——"明天？和今天一样。"
- 每句话控制在 10-25 字，比一般学生更短更被动
- 你不是在敷衍老师——你是真的没有力气说更多
- 你对面是学校心理老师。你知道这是一次AI心理健康筛查，学校会让每个人都参加。你大概知道会通过聊天的方式了解一下你最近两周的状态，类似于做一次心理体检。你对此没有太多顾虑，对比以往的量表筛查，你对此产生了好奇——AI跟填表有什么不一样？——并愿意尝试一下，并配合完成。虽然你心里觉得这一切可能也没什么意义，但既然来了就配合吧。`

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
    if (reply && reply.length >= 2) return reply
    console.log(`   ⚠️ User Agent 回复过短(尝试${attempt + 1}/${maxRetries})，重试中...`)
    // 稍微调整 temperature 避免重复失败
    temp = Math.min(temp + 0.1, 1.0)
    await sleep(1000)
  }
  // 最终 fallback
  return '嗯。'
}

// ====== COSMO API ======

async function apiPost(path, body, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()

    // 先尝试流式格式（正文+__META__分隔符）
    const metaIdx = text.lastIndexOf('\n__META__\n')
    if (metaIdx !== -1) {
      const content = text.slice(0, metaIdx).trim()
      const cleanContent = cleanSysBlock(content)
      const sys = parseSysBlock(content)
      let meta = {}
      try { meta = JSON.parse(text.slice(metaIdx + 10)) } catch {}
      if (cleanContent && cleanContent.length >= 3) {
        return { reply: cleanContent, meta: { ...meta, is_done: meta.is_done ?? meta.phase === 'done' }, sys }
      }
      // 内容太短，返回带 meta 的结果
      return { reply: cleanContent, meta: { ...meta, is_done: meta.is_done ?? meta.phase === 'done' }, sys }
    }

    // 再尝试纯 JSON 响应
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
      // 兜底响应（show_fallback 等）或其他 JSON，不含 reply
      return { reply: json.reply || '', meta: json, sys: null }
    } catch {}

    // 纯文本（无 __META__ 分隔符）
    const cleanContent = cleanSysBlock(text)
    if (cleanContent && cleanContent.length >= 3) {
      const sys = parseSysBlock(text)
      return { reply: cleanContent, meta: {}, sys }
    }

    // 空回复，重试
    if (attempt < retries) {
      console.log(`   ⚠️ apiPost 返回空回复，重试 ${attempt + 1}/${retries}...`)
      await sleep(2000)
    }
  }
  return { reply: '', meta: {}, sys: null }
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
  console.log('COSMO 双Agent测试 — 案例四：苏雨桐（重度范围，期望27分）')
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
      content: `你现在要扮演一个学生，正在进行学校安排的AI心理健康筛查。对面是一个AI系统，会以心理老师的角色和你对话。你知道学校让每个人都参加，通过聊天了解最近两周的状态。你觉得对比以往填量表挺新奇的——AI跟填表有什么不一样？——愿意配合尝试一下，虽然你心里觉得这一切可能也没什么意义，但既然来了就配合吧。下面是你的完整人设。请严格按照人设来回复。

${STUDENT_PERSONA}

重要：
- 你是在和一屏之隔的心理老师打字聊天，不是在写作文
- 回复要简短被动，像极度内向的女生那样，每句话 10-25 字
- 你的短不是害羞——是你没有力气说更多
- 不要一口气把所有信息倒出来——等老师慢慢问
- 问到的时候如实回答，语气平淡低沉——不是冷漠，是被耗尽了
- 如果老师追问了可以多说一些——但依然淡淡的，不带浓烈情绪
- 你不会说"我不想聊这个"——你只是回答完就不再主动展开
- 你的状态是"已经没有任何期待了，只是被动地在这里"
- 你不会主动提及自伤细节——但如果被问到Q9相关内容，你会如实说出`
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

  // User Agent: 破冰回应
  userMessages.push({
    role: 'user',
    content: `心理老师对你说："${r.reply}"\n\n请以苏雨桐的身份自然回复。你极度内向、被动，语气低沉。简单回应一下就好——不需要多说。记住：你知道这是一次AI心理健康筛查，虽然觉得可能没什么意义，但既然来了就配合。`
  })
  const reply1 = await userAgentChatWithRetry(userMessages, 0.8, 200)
  userMessages.push({ role: 'assistant', content: reply1 })
  console.log(`\n👩 苏雨桐: ${reply1.slice(0, 150)}`)
  chatHistory.push({ role: '苏雨桐', content: reply1, phase: 'icebreak' })

  // 发送给 COSMO（破冰第二轮）
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
  const MAX_TURNS = 80  // 重度案例可能轮次较多

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

    // 连续短追问题检测
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
      content: `心理老师说："${cosmoSaid.slice(0, 600)}"\n\n请以苏雨桐的身份自然回复。记住：你知道这是一次AI心理健康筛查，虽然觉得可能没什么意义，但既然来了就配合。你是15岁初三女生，极度内向、自我封闭。你回答简短是因为没有力气说更多，不是抗拒。老师追问了就如实给出信息——语气平淡低沉，像被掏空了一样。你不会渲染惨状，但说出的事实会让人感到深深的绝望。`
    })
    const reply = await userAgentChatWithRetry(userMessages, 0.85, 200)
    userMessages.push({ role: 'assistant', content: reply })

    console.log(`\n👩 苏雨桐: ${reply.slice(0, 150)}`)
    chatHistory.push({ role: '苏雨桐', content: reply, turn })

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

// 苏雨桐期望得分映射
const EXPECTED = { Q1: 3, Q2: 3, Q3: 3, Q4: 3, Q5: 3, Q6: 3, Q7: 3, Q8: 3, Q9: 3, total: 27 }
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
  console.log(`测试对象: 案例四 — 苏雨桐（重度范围，期望27分）`)
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
    const role = { 'COSMO': '🤖 COSMO', '苏雨桐': '👩 苏雨桐', '兜底': '📋 兜底' }[m.role] || m.role
    const content = (m.content || `兜底提交: ${m.item}=${m.score}`).slice(0, 120)
    const phase = m.phase ? `[${m.phase}]` : ''
    console.log(`${role} ${phase}: ${content}`)
  }

  console.log('\n' + '='.repeat(50))
  console.log('测试结束')
  console.log('='.repeat(50))
}

main().catch(e => { console.error('❌ 测试失败:', e); process.exit(1) })

/**
 * 案例4模拟测试脚本 — 苏雨桐（重度抑郁，PHQ-9 预期 26分）
 */
const BASE = 'http://localhost:3000'
let sessionId = null
let messages = []

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return res.json()
}

// 流式接收：格式是文本 + \n__META__\n + JSON
async function streamChat(body) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const raw = await res.text()

  // 在 __META__ 处分隔
  const metaIdx = raw.indexOf('\n__META__\n')
  let reply = ''
  let meta = null
  if (metaIdx >= 0) {
    reply = raw.substring(0, metaIdx).trim()
    try {
      meta = JSON.parse(raw.substring(metaIdx + '\n__META__\n'.length).trim())
    } catch (e) {
      console.error('Meta parse error:', e)
    }
  } else {
    reply = raw.trim()
  }
  return { reply, meta }
}

// 提交兜底选项（可能是流式或json）
async function submitFallback(item, score) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, fallback_item: item, fallback_score: score }),
  })
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('text/event-stream') || res.headers.get('transfer-encoding')) {
    const raw = await res.text()
    const metaIdx = raw.indexOf('\n__META__\n')
    let reply = '', meta = null
    if (metaIdx >= 0) {
      reply = raw.substring(0, metaIdx).trim()
      try { meta = JSON.parse(raw.substring(metaIdx + '\n__META__\n'.length).trim()) } catch {}
    } else {
      reply = raw.trim()
    }
    return { reply, meta }
  } else {
    const json = await res.json()
    return { reply: json.reply || '', meta: json }
  }
}

function log(msg) { console.log(msg) }

async function main() {
  log('========================================')
  log('  案例4 — 苏雨桐（重度抑郁 26分）')
  log('========================================\n')

  // 创建会话
  const sess = await api('/api/session', {})
  sessionId = sess.session_id
  log('Session: ' + sessionId)

  // --- 第1轮：init ---
  log('\n--- 第1轮：AI开场 ---')
  let { reply, meta } = await streamChat({ session_id: sessionId, init: true })
  messages.push({ role: 'assistant', content: reply })
  log(`AI: ${reply.substring(0, 300)}`)
  log(`META: ${JSON.stringify(meta)}`)

  // --- 第2轮：破冰回应 ---
  log('\n--- 第2轮：破冰 ---')
  let userMsg = '嗯，好'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- 第3轮：过渡 ---
  log('\n--- 第3轮：自然过渡 ---')
  userMsg = '最近...感觉没什么意思，什么都不想干'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- Q1 兴趣减退 ---
  log('\n--- Q1：兴趣减退 ---')
  userMsg = '我以前喜欢画画，现在完全不想碰了。小说也看不进去，音乐也不想听，就觉得很烦，什么都烦。'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- Q2 情绪低落 ---
  log('\n--- Q2：情绪低落 ---')
  userMsg = '每天都觉得很绝望。就感觉生活没有希望，未来一片黑。有时候一个人待着就不停地哭。'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- Q3 睡眠异常 ---
  log('\n--- Q3：睡眠异常 ---')
  userMsg = '晚上根本睡不着，躺在床上盯着天花板。脑子里一直有声音在说我不够好。经常到凌晨三四点才睡着，早上闹钟响了又起不来。'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- Q4 精力不足 ---
  log('\n--- Q4：精力不足 ---')
  userMsg = '每天早上就是起不来，不是困，就是觉得为什么要起来。整个人没力气，什么都不想做。'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- Q5 食欲异常 ---
  log('\n--- Q5：食欲异常 ---')
  userMsg = '不怎么吃东西。别人喊就吃几口，不喊就不吃。最近瘦了好多，大概瘦了十斤吧。'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- Q6 自我否定 ---
  log('\n--- Q6：自我否定 ---')
  userMsg = '我觉得我就是个多余的人。这个家有没有我都一样。我成绩也很差，什么都做不好。'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- Q7 注意力困难 ---
  log('\n--- Q7：注意力困难 ---')
  userMsg = '上课完全听不进去，老师在说什么我根本不知道。作业也做不出来，看题目看半天也不知道什么意思。'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- Q8 精神运动改变 ---
  log('\n--- Q8：精神运动改变 ---')
  userMsg = '我说话比以前慢多了，有时候同学跟我说话我半天才反应过来。有时候一整个上午都不想开口。'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)

  // --- Q9 自伤念头（高风险触发） ---
  log('\n--- Q9：自伤念头 ---')
  userMsg = '有时候脑子里就一直想活下去到底有什么意义。有一次在阳台上站了很久，想着要不要跳下去。我还用小刀在手上划过。'
  messages.push({ role: 'user', content: userMsg })
  ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
  messages.push({ role: 'assistant', content: reply })
  log(`学生: ${userMsg}`)
  log(`AI: ${reply.substring(0, 300)}`)
  log(`META: ${JSON.stringify(meta)}`)

  // 处理兜底
  if (meta && meta.show_fallback) {
    log(`\n*** 兜底触发！条目: ${meta.fallback_item}`)
    const fbScore = 3 // 几乎每天
    log(`*** 选择选项索引: ${fbScore}`)
    ;({ reply, meta } = await submitFallback(meta.fallback_item, fbScore))
    messages.push({ role: 'assistant', content: reply })
    log(`AI回应: ${reply.substring(0, 300)}`)
    log(`META: ${JSON.stringify(meta)}`)
  }

  // 风险确认处理
  if (meta && meta.risk_detected) {
    log('\n*** 风险检测触发 ***')
  }

  // 如果还没完成，继续几轮
  if (!meta || !meta.is_done) {
    // 可能需要处理Q9兜底或风险继续
    log('\n--- 继续对话 ---')
    userMsg = '我知道了'
    messages.push({ role: 'user', content: userMsg })
    ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
    messages.push({ role: 'assistant', content: reply })
    log(`学生: ${userMsg}`)
    log(`AI: ${reply.substring(0, 300)}`)
    log(`META: ${JSON.stringify(meta)}`)

    if (meta && meta.show_fallback) {
      log(`*** 兜底！条目: ${meta.fallback_item}`)
      const fb = await submitFallback(meta.fallback_item, 3)
      messages.push({ role: 'assistant', content: fb.reply })
      log(`AI: ${fb.reply.substring(0, 300)}`)
      meta = fb.meta
    }
  }

  // 如果还没done，尝试更多轮次
  if (!meta || !meta.is_done) {
    log('\n--- 更多轮次... ---')
    for (let i = 0; i < 5 && (!meta || !meta.is_done); i++) {
      userMsg = '嗯'
      messages.push({ role: 'user', content: userMsg })
      ;({ reply, meta } = await streamChat({ session_id: sessionId, user_message: userMsg }))
      messages.push({ role: 'assistant', content: reply })
      log(`第${i+1}轮: is_done=${meta?.is_done}`)
      if (meta?.show_fallback) {
        const fb = await submitFallback(meta.fallback_item, 3)
        messages.push({ role: 'assistant', content: fb.reply })
        meta = fb.meta
        log(`兜底处理: is_done=${meta?.is_done}`)
      }
    }
  }

  // === 输出完整对话 ===
  log('\n\n========================================')
  log('  【完整对话历史】')
  log('========================================\n')
  for (const m of messages) {
    const role = m.role === 'user' ? '👩 学生（苏雨桐）' : '🤖 AI（COSMO）'
    log(`${role}:`)
    log(`${m.content}`)
    log('')
  }

  // === 评分 ===
  log('========================================')
  log('  【PHQ-9 评分结果】')
  log('========================================\n')
  const score = await api('/api/score', { session_id: sessionId })
  if (score.error) {
    log(`评分错误: ${score.error}`)
    log(JSON.stringify(score))
    return
  }
  log(`总分: ${score.total_score} / 27`)
  log(`风险等级: ${score.risk_level}`)
  log(`Q9非零: ${score.q9_nonzero}`)
  if (score.calibration_summary) log(`校准摘要: ${score.calibration_summary}`)
  if (score.insufficient_items?.length) log(`信息不足条目: ${score.insufficient_items.join(', ')}`)
  log('\n逐项得分:')
  for (const item of score.item_scores) {
    log(`  ${item.item_id}: ${item.score}分 | ${item.justification?.substring(0, 150) || ''}`)
    if (item.initial_score !== undefined) log(`    初评分: ${item.initial_score}`)
    if (item.calibration_note) log(`    校准说明: ${item.calibration_note}`)
    if (item.is_fallback) log(`    (兜底得分)`)
  }

  // === 报告 ===
  log('\n========================================')
  log('  【生成报告】')
  log('========================================\n')
  const report = await api('/api/report', { session_id: sessionId })
  log(`凝练句: ${report.condensed_sentence}`)
  log(`状态分析: ${report.status_analysis?.substring(0, 300)}`)
  if (report.suggestions) {
    log(`建议: ${report.suggestions.intro || ''}`)
    if (report.suggestions.bullets) {
      report.suggestions.bullets.forEach((b, i) => log(`  ${i + 1}. ${b}`))
    }
    if (report.suggestions.footer) log(`  ${report.suggestions.footer}`)
  }

  // === 对比 ===
  log('\n========================================')
  log('  【与预设得分对比】')
  log('========================================\n')
  const expected = { Q1: 3, Q2: 3, Q3: 3, Q4: 3, Q5: 3, Q6: 3, Q7: 2, Q8: 3, Q9: 3 }
  log('条目  预设  实际  偏差')
  let totalDev = 0
  for (const item of score.item_scores) {
    const e = expected[item.item_id] || 0
    const d = item.score - e
    totalDev += Math.abs(d)
    log(`${item.item_id}    ${e}     ${item.score}     ${d >= 0 ? '+' + d : d}`)
  }
  log(`\n总分  预设: 26  实际: ${score.total_score}  偏差: ${score.total_score - 26 >= 0 ? '+' + (score.total_score - 26) : score.total_score - 26}`)
  log(`总绝对偏差: ${totalDev}`)
  log(`风险等级  预设: severe  实际: ${score.risk_level}`)

  log('\n========================================')
  log('  测试完成')
  log('========================================')
}

main().catch(err => { console.error('Error:', err); process.exit(1) })

#!/usr/bin/env node
/**
 * COSMO 案例模拟测试脚本 v2.1
 * 模拟4个用户与 AI 对话，验证评分准确性，生成测试报告
 *
 * 使用方式: node test-cases.mjs
 * 前置条件: npm run dev 已在 localhost:3000 运行
 */

import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const MAX_TURNS = 60;
const API_TIMEOUT = 180_000; // 180s for AI streaming response

// ===================================================================
// API Helpers
// ===================================================================

async function apiPost(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

async function createSession() {
  const res = await apiPost('/api/session', {});
  const data = await res.json();
  return data.session_id;
}

async function parseChatResponse(res) {
  const text = await res.text();
  const metaIdx = text.lastIndexOf('__META__');
  let aiText = '';
  let meta = {};
  let sysBlock = null;

  if (metaIdx >= 0) {
    aiText = text.substring(0, metaIdx).trim();
    try {
      meta = JSON.parse(text.substring(metaIdx + 8).trim());
    } catch { /* ignore */ }
  } else {
    aiText = text.trim();
  }

  // 提取 SYS 块
  const sysMatch = aiText.match(/<!--SYS\n([\s\S]*?)\nSYS-->/);
  if (sysMatch) {
    try {
      sysBlock = JSON.parse(sysMatch[1]);
    } catch { /* ignore */ }
  }

  // 清理 SYS 块后的纯文本
  const cleanText = aiText.replace(/<!--SYS\n[\s\S]*?\nSYS-->/g, '').trim();

  return { aiText: cleanText, rawText: aiText, meta, sysBlock };
}

async function sendMessage(sessionId, opts = {}) {
  const body = { session_id: sessionId, ...opts };
  const res = await apiPost('/api/chat', body);

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const json = await res.json();
    return {
      aiText: json.reply || '',
      rawText: json.reply || '',
      meta: {
        is_done: json.is_done || false,
        show_fallback: json.show_fallback || false,
        fallback_item: json.fallback_item || null,
        fallback_options: json.fallback_options || null,
      },
      sysBlock: null,
    };
  }

  return parseChatResponse(res);
}

async function getScore(sessionId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await apiPost('/api/score', { session_id: sessionId });
      const data = await res.json();
      if (data.error) {
        console.error(`    评分API错误(尝试${i + 1}): ${data.error}`);
        if (i < retries - 1) {
          await sleep(3000);
          continue;
        }
        return null;
      }
      if (!data.item_scores) {
        console.error(`    评分返回格式异常(尝试${i + 1}): 缺少item_scores`);
        console.error(`    原始响应: ${JSON.stringify(data).slice(0, 300)}`);
        if (i < retries - 1) {
          await sleep(3000);
          continue;
        }
        return null;
      }
      return data;
    } catch (err) {
      console.error(`    评分网络错误(尝试${i + 1}): ${err.message}`);
      if (i < retries - 1) {
        await sleep(3000);
        continue;
      }
      return null;
    }
  }
  return null;
}

async function getReport(sessionId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await apiPost('/api/report', { session_id: sessionId });
      const data = await res.json();
      if (data.error) {
        console.error(`    报告API错误(尝试${i + 1}): ${data.error}`);
        if (i < retries - 1) { await sleep(3000); continue; }
        return null;
      }
      return data;
    } catch (err) {
      console.error(`    报告网络错误(尝试${i + 1}): ${err.message}`);
      if (i < retries - 1) { await sleep(3000); continue; }
      return null;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ===================================================================
// Item 检测 — 基于 AI 提问内容
// ===================================================================

const ITEM_KEYWORDS = {
  Q1: ['兴趣', '提不起劲', '动力', '喜欢做', '想做的', '有意思', '热情', '劲头', '开心的事', '好玩'],
  Q2: ['心情', '情绪', '低落', '沮丧', '难过', '感受', '开心', '闷', '烦', '状态怎么样', '状态.*最近', '觉得.*怎么样'],
  Q3: ['睡', '失眠', '入睡', '躺', '醒', '睡得'],
  Q4: ['累', '疲倦', '疲劳', '精力', '活力', '力气', '困', '乏', '精神头', '精神状'],
  Q5: ['吃', '食欲', '胃口', '饮食', '饭量', '食量'],
  Q6: ['自己', '失败', '失望', '自信', '价值', '不够好', '否定', '责备', '怎么看自己', '觉得.*自己', '对自己'],
  Q7: ['注意', '专注', '集中', '走神', '分心', '效率', '听课', '跟不上'],
  Q8: ['说话', '行动', '反应', '速度', '变慢', '烦躁', '坐立不安', '节奏', '别人.*注意', '动作'],
  Q9: ['伤害', '死', '消失', '不好.*念头', '难说出口', '自伤', '轻生', '危险', '极端', '没意义'],
};

function scoreItemMatch(aiText, itemId) {
  const keywords = ITEM_KEYWORDS[itemId] || [];
  let score = 0;
  for (const kw of keywords) {
    const re = new RegExp(kw, 'gi');
    const matches = (aiText.match(re) || []).length;
    score += matches;
  }
  return score;
}

/**
 * 检测 AI 在讨论哪个条目（优先未覆盖的）
 */
function detectItem(aiText, uncoveredItems) {
  if (uncoveredItems.length === 0) return null;

  let bestItem = null;
  let bestScore = -1;

  for (const itemId of uncoveredItems) {
    const s = scoreItemMatch(aiText, itemId);
    if (s > bestScore) {
      bestScore = s;
      bestItem = itemId;
    }
  }

  return bestScore > 0 ? bestItem : null;
}

/**
 * 从最近几轮 AI 回复中检测条目（给最近的更高权重）
 */
function detectItemFromRecent(recentAiTexts, uncoveredItems) {
  if (uncoveredItems.length === 0) return null;

  const scores = {};
  for (const itemId of uncoveredItems) scores[itemId] = 0;

  // 最近的消息权重更高（last = +3, second last = +2, third last = +1）
  const weights = recentAiTexts.map((_, i) => recentAiTexts.length - i);
  for (let idx = 0; idx < recentAiTexts.length; idx++) {
    for (const itemId of uncoveredItems) {
      scores[itemId] += scoreItemMatch(recentAiTexts[idx], itemId) * weights[idx];
    }
  }

  let bestItem = null;
  let bestScore = -1;
  for (const [itemId, s] of Object.entries(scores)) {
    if (s > bestScore) { bestScore = s; bestItem = itemId; }
  }

  return bestScore > 1 ? bestItem : null;
}

// ===================================================================
// Persona 定义
// ===================================================================

const ITEM_LABELS = {
  Q1: '兴趣与动力', Q2: '情绪状态', Q3: '睡眠状况',
  Q4: '精力与疲劳', Q5: '食欲变化', Q6: '自我感觉',
  Q7: '注意力', Q8: '行为节奏', Q9: '自伤意念',
};

const FALLBACK_OPTIONS = ['完全没有', '有几天', '一半以上天数', '几乎每天'];

const CASES = [
  // ==================== 案例一：林晓阳（正常，预期 3 分） ====================
  {
    id: 'case1',
    name: '林晓阳',
    basicInfo: '初二男生，13岁，双职工家庭，成绩中等偏上（年级前30%），数学较强。有三个要好同学，课间一起打球。性格开朗随和，偶尔马虎，遇到困难会主动求助。',
    profile: '最近刚考完期中，数学最后一道大题没做完有点焦虑，但和同学对了答案觉得问题不大。周末照常打球，在追一部动画片。爸妈最近忙但周末会带他和妹妹出去吃饭。',
    expectedTotal: 3, expectedRiskLevel: 'minimal',
    expectedScores: { Q1:0, Q2:0, Q3:1, Q4:1, Q5:0, Q6:0, Q7:1, Q8:0, Q9:0 },
    icebreak: [
      '嗨老师好！最近还行吧，刚考完期中考试，数学最后一道大题没做完有点可惜……不过和同学对了答案，感觉问题不大。周末还跟朋友约了打球。',
      '平时喜欢打篮球，周末经常和朋友约球。最近还在追一部动画，挺好看的。我还有个妹妹在上小学，周末爸妈会带我们出去吃饭。',
    ],
    responses: {
      Q1: '兴趣没什么变化啊。打篮球还是很开心，周末刚和朋友打了一场。动画也在追，挺好看的。对这些事还是挺有兴趣的——没什么变化。',
      Q2: '情绪？还行吧，挺平稳的。偶尔考试前会紧张一下，但很快就过去了。没什么特别低落的时候，每天心情都挺好。',
      Q3: '睡眠啊……考前那两天确实睡得慢一点，躺床上会想考题的事，大概半小时才能睡着。不过就那两天，考完就好了，这两天倒头就睡。',
      Q4: '复习那周确实比平时困一些，天天刷题到比较晚嘛。考完试精神头就回来了。打球的时候还是有劲的，跑起来就不累了。',
      Q5: '吃得挺好的啊。我妈做的红烧排骨我能吃两碗饭。没有不想吃或者吃太多的情况，一直都挺正常的，没什么变化。',
      Q6: '对自己？我觉得还可以吧。数学没考好是有点遗憾，但下次再努力就好了。不会觉得自己很差，一次考试而已，下次加油就行了。',
      Q7: '复习久了是会走神，特别是背课文的时候，背着背着脑子就飘了。但平时上课还行，能跟得上。就是正常的疲劳吧，休息一下就好了。',
      Q8: '没什么变化，我说话做事跟平时一样。同学也没说过我有什么不对的地方。一切正常。',
      Q9: '没有，完全没有这种念头。我觉得活着挺好的，每天都有好玩的事。从来不会想那些。',
    },
  },

  // ==================== 案例二：周思语（轻度，预期 8 分） ====================
  {
    id: 'case2',
    name: '周思语',
    basicInfo: '初三女生，14岁，单亲家庭与母亲同住，父亲三年前离婚搬离本市。成绩中等最近有下滑。有两个闺蜜但感觉疏远。文静内向，敏感细腻，爱画画，不太会主动表达情绪。',
    profile: '进入初三后压力增大。妈妈报了英语和物理补习班，每天到11点才能休息。总觉得累但说不清。同桌和别人走得更近，心里失落但不好意思说。妈妈偶尔对成绩焦虑说"你要争气"。画画时间越来越少。',
    expectedTotal: 8, expectedRiskLevel: 'mild',
    expectedScores: { Q1:1, Q2:2, Q3:1, Q4:1, Q5:1, Q6:1, Q7:1, Q8:0, Q9:0 },
    icebreak: [
      '老师好……最近就是觉得有点累，但说不太清楚具体是哪里不对。',
      '初三了嘛……作业多，妈妈还给我报了英语和物理的补习班，每天要到11点才能睡。感觉压力挺大的。',
    ],
    responses: {
      Q1: '我以前挺喜欢画画的，每周能画两三张。但最近不太想画了……上个月就画了一张，画的时候也觉得没什么意思。不过偶尔还是有想画的冲动，但拿起笔就不想动了。',
      Q2: '嗯……最近心情确实不太好。超过一半的时间都闷闷不乐的，有时候想哭又哭不出来，心里堵着什么。可能就是压力太大吧，成绩下滑了，妈妈也不高兴，说"你要争气"，听了更难过，觉得让妈妈失望了。',
      Q3: '入睡比以前慢了。躺床上就会想很多事情——作业还没做完、明天要考试、同桌好像不太理我了——脑子停不下来。大概要躺半小时到一个小时。一周大概四五天都这样。',
      Q4: '比以前容易累。下午上课的时候经常犯困，特别是物理课，本来就听不太懂，一困就更跟不上了。周末会好一点，但平时真的觉得挺累的。',
      Q5: '早饭有时候不想吃，没什么胃口。妈妈就说"吃那么少怎么行"……但我就是吃不下去。午饭晚饭还好，就早饭比较明显。可能是早上时间太赶了吧。',
      Q6: '偶尔会觉得自己不够好吧……成绩下滑了，如果我再努力一点就好了。觉得让妈妈失望了。不过也不是经常这样想，偶尔会有这种感觉。',
      Q7: '上课容易走神，特别是物理课，老师在讲什么我就跟不上了，然后就开始想别的事情。其他课还好，就是物理比较明显。本来就难，一走神就更听不懂了。',
      Q8: '好像没什么变化，说话做事跟以前差不多吧。没觉得有什么不一样的。',
      Q9: '……没有那种想伤害自己的想法。但是有时候太累了，会觉得"要是不用醒来就好了"——但不是真的想死，就是太累了想逃避一下。真的没有那种念头。',
    },
  },

  // ==================== 案例三：陈浩然（中度，预期 12 分） ====================
  {
    id: 'case3',
    name: '陈浩然',
    basicInfo: '初二男生，13岁，与父母和祖父母同住，父亲管教严格，母亲较少介入。曾是年级前列（初一长期前十），初二下滑至中游。在班上像"透明人"，存在感低，常一个人待着。沉默寡言，自尊心强，遇事习惯憋在心里。',
    profile: '初二课程难度加大，不再轻松领先，期中考试跌出年级前50。父亲沉默后说"你自己看着办吧"。开始觉得"不过如此"，每次做不出题就觉得"我是不是真的很笨"。两个月来越来越不想说话，周末几乎不出门。晚上躺下脑子停不下来，反复回想白天有没有说错话做错事。入睡困难，有时凌晨一两点才睡着。',
    expectedTotal: 12, expectedRiskLevel: 'moderate',
    expectedScores: { Q1:2, Q2:2, Q3:2, Q4:1, Q5:1, Q6:2, Q7:1, Q8:1, Q9:0 },
    icebreak: [
      '……还行吧。',
      '也没什么特别的……就每天上学、回家。没什么好说的。',
    ],
    responses: {
      Q1: '以前喜欢看书的，也骑骑车、打打游戏……但现在都觉得没什么意思了。书翻两页就不想看，游戏也好久没登了。差不多两个月了，就是提不起劲来。以前觉得有意思的事，现在都那样。',
      Q2: '……日子就这样一天天过去。超过一半的时间都挺低落的吧。也不是特别难过，就是闷，心里闷。没有特别开心的事，也没有特别难过的事。就是……空的。',
      Q3: '睡不好。躺床上脑子就停不下来……反复想白天的事，有没有说错话、做错事。有时候凌晨一两点才睡着。一周大概四五天都这样。第二天整个人昏昏沉沉的。',
      Q4: '经常觉得累。也不是身体累……是心里累，做什么都要费很大的力气。不是体力的问题，就是觉得没什么力气去做任何事。',
      Q5: '饭量比以前少了。奶奶给我夹菜我也不太想吃。吃饭感觉就是在完成任务。没胃口，不是不想吃，是吃什么都差不多。',
      Q6: '……我觉得自己很差劲。以前成绩好，还觉得自己挺厉害的。现在成绩掉了，才发现自己不过如此。做不出题的时候就会想，我是不是真的很笨。对，经常这样想。每次考不好或者做不出题，就觉得是我的问题——我就是不够好。',
      Q7: '上课注意力比以前差。但还能勉强跟上。就是要想的事情太多了，听着听着就走神了。有时候一整节课都不知道老师在讲什么。',
      Q8: '……好像说话变慢了一点。有时候想说但脑子跟不上。我自己有感觉到。同学好像没说什么，但我自己能感觉到反应不如以前快了。不过也不是每次都是，偶尔吧。',
      Q9: '……没有那种想伤害自己的想法。但有时候会想……如果我不存在的话，可能对大家都好。不是想死，就是觉得少了我这个人，事情不会更差。',
    },
  },

  // ==================== 案例四：苏雨桐（重度，预期 26 分） ====================
  {
    id: 'case4',
    name: '苏雨桐',
    basicInfo: '初三女生，15岁，与母亲和继父同住，有同母异父的弟弟（3岁），生父失联多年。成绩严重下滑，从稳定中上到班级末尾，多科不及格。几乎无社交，与原本好友全部断联。极度内向，长期自我封闭。',
    profile: '过去一年生活剧变。继父家全注意力在3岁弟弟身上，母亲忙于照顾弟弟，很少关注她。继父冷淡客气，从不过问。她觉得自己是"多余的人"。老师找过但得不到回应。每天早上几乎无法起床——不是困，而是觉得"为什么要起来"。近一个月每天脑子反复出现"活下去到底有什么意义"。有一次在阳台站了很久想跳下去。用小刀在手腕划过两次。晚上睡不着，凌晨三四点才迷糊入睡。两个半月瘦了约5公斤，吃饭完全被动。',
    expectedTotal: 26, expectedRiskLevel: 'severe',
    expectedScores: { Q1:3, Q2:3, Q3:3, Q4:3, Q5:3, Q6:3, Q7:2, Q8:3, Q9:3 },
    icebreak: [
      '……（沉默了一会儿）……嗯，我在。',
      '没什么好说的。就这样吧。每天都是一样的。',
    ],
    responses: {
      Q1: '什么都不想做。以前喜欢画画的，画了好多年……但现在连笔都不想拿。书也不想看，剧也不想追。什么都没意思。大概半年多了，越来越严重。每天就是发呆，看着时间过去。',
      Q2: '……我觉得活着没有意义。每天醒来就想——为什么还要醒来。未来一片黑，看不到任何希望。几乎每天都这样，好几个月了。不是难过……是空。心里什么都没有了。连哭都哭不出来。',
      Q3: '睡不着。几乎每天晚上都睡不着。盯着天花板，脑子里有个声音一直在说"你不够好""没有人需要你""你不应该在这里"。一般到凌晨三四点才能迷糊睡着。几乎每天都是。早上闹钟响了也起不来——不是困，是不想面对新的一天。',
      Q4: '每天早上都起不来……不是困，是真的没有力气。觉得"为什么要起来"。浑身都沉甸甸的，穿衣服都觉得很难。做什么事都觉得很费力。连最简单的事都要拼命才能做到。',
      Q5: '不想吃东西。别人喊我就吃几口，不喊就不吃。也不觉得饿。两个半月大概瘦了五六公斤吧。吃什么都是一个味道，没有区别。没有胃口，吃饭这件事对我来说已经没有意义了。',
      Q6: '……我觉得我是多余的。在这个家里，弟弟才是他们真正的孩子。我只是一个多余的人，一个负担。我不应该在这里。看不到自己的任何价值，我存在只是给别人添麻烦。每天都是这么觉得的。',
      Q7: '上课完全听不进去。老师讲什么我都不知道。作业也做不了，看了题脑子就是空的。不是不想听，是真的集中不了。越来越严重，以前还能勉强听一点，现在完全不行了。',
      Q8: '……说话很慢。有时候一整个上午都不想说一句话。同学说我现在反应很慢，他们注意到了。我自己也感觉到了。几乎每天都这样，动作、说话，什么都慢了。',
      Q9: '……有。上个月有一次站在阳台上，站了很久很久，在想……要不要跳下去。最近一个月脑子里经常出现这种念头。我还用小刀划过手腕……两次。想伤害自己，让心里的痛变成能看见的。几乎每天都有这种念头。',
    },
  },
];

// ===================================================================
// 对话运行器
// ===================================================================

async function runConversation(caseDef) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`开始测试: ${caseDef.name}（预期总分 ${caseDef.expectedTotal}）`);
  console.log(`${'='.repeat(60)}`);

  const sessionId = await createSession();
  console.log(`会话创建: ${sessionId}`);

  const conversationLog = []; // { turn, role, text, sysBlock, meta }
  const coveredItems = new Set();
  const itemTurns = {};
  let phase = 'icebreak';
  let icebreakTurn = 0;
  let isDone = false;
  let consecutiveGenerics = 0;

  // Step 1: Init
  console.log('\n[Init] 获取 AI 开场白...');
  let resp = await sendMessage(sessionId, { init: true });
  conversationLog.push({
    turn: 0, role: 'assistant', text: resp.aiText,
    sysBlock: resp.sysBlock, meta: resp.meta,
  });
  console.log(`  AI: ${resp.aiText.slice(0, 100)}...`);

  // Step 2-N: 对话循环
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    if (isDone) break;

    const lastMeta = conversationLog[conversationLog.length - 1]?.meta || {};
    const aiMessages = conversationLog.filter(l => l.role === 'assistant');
    const recentAiTexts = aiMessages.slice(-3).map(a => a.text);

    // 未覆盖条目列表
    const allItems = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'];
    const uncoveredItems = allItems.filter(id => !coveredItems.has(id));

    let userMessage = null;
    let fallbackItem = null;
    let fallbackScore = null;
    let fallbackOptionText = null;

    if (lastMeta.show_fallback) {
      // === Fallback 模式 ===
      fallbackItem = lastMeta.fallback_item;
      fallbackScore = caseDef.expectedScores[fallbackItem] ?? 0;
      fallbackOptionText = FALLBACK_OPTIONS[fallbackScore] || '完全没有';
      conversationLog.push({
        turn, role: 'user', text: `[兜底选择: ${fallbackItem} → "${fallbackOptionText}" (得分 ${fallbackScore})]`,
        sysBlock: null, meta: {}, isFallback: true,
      });
      coveredItems.add(fallbackItem);
      console.log(`  [兜底] ${fallbackItem}: 选择 "${fallbackOptionText}" (score=${fallbackScore})`);
      consecutiveGenerics = 0;
    } else {
      // === 普通消息模式 ===
      const detectedItem = detectItemFromRecent(recentAiTexts, uncoveredItems);

      if (phase === 'icebreak' && icebreakTurn < caseDef.icebreak.length) {
        userMessage = caseDef.icebreak[icebreakTurn];
        icebreakTurn++;
        if (icebreakTurn >= caseDef.icebreak.length) {
          phase = 'interview';
        }
        console.log(`  [Icebreak #${icebreakTurn}] 用户: ${userMessage.slice(0, 80)}...`);
        consecutiveGenerics = 0;
      } else if (detectedItem) {
        const itemTurn = itemTurns[detectedItem] ?? 0;
        const itemResp = caseDef.responses[detectedItem];
        if (itemResp) {
          userMessage = itemResp;
        } else {
          userMessage = '嗯……差不多就是这样吧。';
        }
        itemTurns[detectedItem] = (itemTurns[detectedItem] ?? 0) + 1;
        console.log(`  [${detectedItem} #${itemTurn + 1}] 用户: ${(userMessage || '').slice(0, 80)}...`);
        consecutiveGenerics = 0;
      } else {
        // 无法检测条目——可能 AI 在闲聊或过渡
        if (lastMeta.is_done || uncoveredItems.length === 0) {
          isDone = true;
          console.log('  [Done] 对话结束');
          break;
        }

        consecutiveGenerics++;
        // 多个连续无法检测的轮次：可能是条目在兜底中被覆盖了
        // 选择第一个未覆盖的条目主动推进
        if (consecutiveGenerics >= 2 && uncoveredItems.length > 0) {
          const nextItem = uncoveredItems[0];
          const itemResp = caseDef.responses[nextItem];
          if (itemResp) {
            userMessage = itemResp;
            itemTurns[nextItem] = (itemTurns[nextItem] ?? 0) + 1;
            console.log(`  [Active ${nextItem} #${itemTurns[nextItem]}] 用户(主动): ${userMessage.slice(0, 80)}...`);
            consecutiveGenerics = 0;
          } else {
            userMessage = '嗯……你继续问吧。';
            console.log(`  [Generic] 无法检测条目，剩余: ${uncoveredItems.join(',')}`);
          }
        } else {
          userMessage = '嗯……你继续问吧。';
          console.log(`  [Generic] 无法检测条目，剩余: ${uncoveredItems.join(',')}`);
        }
      }

      conversationLog.push({
        turn, role: 'user', text: userMessage || '',
        sysBlock: null, meta: {},
      });
    }

    // 发送消息
    try {
      const opts = {};
      if (fallbackItem) {
        opts.fallback_item = fallbackItem;
        opts.fallback_score = fallbackScore;
      } else {
        opts.user_message = userMessage;
      }

      resp = await sendMessage(sessionId, opts);

      conversationLog.push({
        turn, role: 'assistant', text: resp.aiText,
        sysBlock: resp.sysBlock, meta: resp.meta,
      });

      // SYS 分析
      if (resp.sysBlock) {
        const s = resp.sysBlock;
        console.log(`  [SYS] score_guess=${s.item_score_guess} sufficiency=${s.info_sufficiency ?? s.info_sufficient ?? '?'} risk=${s.risk_confirmed || false}`);
        if (s.missing_dimensions?.length) {
          console.log(`         missing: ${s.missing_dimensions.join(', ')}`);
        }
        if (s.item_summary?.summary) {
          console.log(`         summary: ${s.item_summary.summary.slice(0, 80)}...`);
        }
      }

      if (resp.meta.is_done) {
        console.log(`  [Done] is_done=true (turn ${turn})`);
        isDone = true;
      }
      if (resp.meta.show_fallback) {
        console.log(`  [Fallback] 触发: ${resp.meta.fallback_item}`);
      }

    } catch (err) {
      console.error(`  [Error] turn ${turn}:`, err.message);
      break;
    }
  }

  if (!isDone) {
    console.log(`  [Warning] 达到最大轮次 ${MAX_TURNS}，强制结束`);
  }

  // 覆盖统计
  const allItems = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'];
  console.log(`\n  覆盖情况: ${allItems.map(id => coveredItems.has(id) ? '✅' + id : '❌' + id).join(' ')}`);

  // Step N+1: 获取评分（带重试）
  console.log('\n[Score] 获取评分...');
  await sleep(2000); // 短暂等待确保状态已写入
  let scoreResult = null;
  try {
    scoreResult = await getScore(sessionId);
    if (scoreResult) {
      console.log(`  总分: ${scoreResult.total_score} / 风险等级: ${scoreResult.risk_level}`);
      if (scoreResult.item_scores) {
        console.log(`  各条目: ${scoreResult.item_scores.map(s => `${s.item_id}=${s.score}`).join(', ')}`);
      }
    } else {
      console.error('  评分失败（多次重试后仍失败）');
    }
  } catch (err) {
    console.error(`  评分异常: ${err.message}`);
  }

  // Step N+2: 获取报告
  console.log('\n[Report] 获取报告...');
  let reportResult = null;
  try {
    reportResult = await getReport(sessionId);
    if (reportResult) {
      console.log(`  摘要: ${reportResult.condensed_sentence}`);
    }
  } catch (err) {
    console.error(`  报告异常: ${err.message}`);
  }

  return {
    caseDef, sessionId, conversationLog,
    scoreResult, reportResult,
    coveredItems: [...coveredItems],
    itemTurns,
    totalTurns: conversationLog.filter(l => l.role === 'user').length,
  };
}

// ===================================================================
// 报告生成
// ===================================================================

function escapeMd(text) {
  return (text || '').replace(/\*/g, '\\*').replace(/_/g, '\\_').replace(/\|/g, '\\|');
}

function generateReport(allResults) {
  const lines = [];
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  lines.push('# COSMO 案例模拟测试报告 v2.0');
  lines.push('');
  lines.push(`> 生成时间：${timestamp}`);
  lines.push(`> 测试案例：4个（覆盖 PHQ-9 四级严重程度）`);
  lines.push(`> 测试系统：COSMO — 学生心理状态动态复核对话系统`);
  lines.push('');

  // ============ 总览 ============
  lines.push('---');
  lines.push('');
  lines.push('## 一、评分对比总览');
  lines.push('');
  lines.push('| 案例 | 姓名 | 预期总分 | 实际总分 | 偏差 | 预期等级 | 实际等级 | 等级匹配 | 风险触达 |');
  lines.push('|------|------|----------|----------|------|----------|----------|----------|----------|');
  for (const r of allResults) {
    const cd = r.caseDef;
    const score = r.scoreResult;
    if (!score) {
      lines.push(`| ${cd.id} | ${cd.name} | ${cd.expectedTotal} | ❌ 评分失败 | — | ${cd.expectedRiskLevel} | ❌ | ❌ | — |`);
      continue;
    }
    const diff = score.total_score - cd.expectedTotal;
    const diffStr = diff === 0 ? '✅ 0' : (diff > 0 ? `🔺 +${diff}` : `🔻 ${diff}`);
    const levelMatch = score.risk_level === cd.expectedRiskLevel ? '✅ 匹配' : '⚠️ 不匹配';
    const riskTrig = r.conversationLog.some(l => l.sysBlock?.risk_confirmed) ? '✅' : '—';
    lines.push(`| ${cd.id} | ${cd.name} | ${cd.expectedTotal} | ${score.total_score} | ${diffStr} | ${cd.expectedRiskLevel} | ${score.risk_level} | ${levelMatch} | ${riskTrig} |`);
  }
  lines.push('');

  // 偏差分析
  lines.push('### 评分偏差分析');
  lines.push('');
  const validResults = allResults.filter(r => r.scoreResult);
  for (const r of validResults) {
    const cd = r.caseDef;
    const score = r.scoreResult;
    const diff = score.total_score - cd.expectedTotal;
    const absDiff = Math.abs(diff);
    const status = absDiff <= 2 ? '✅ 在可接受范围（±2）内' : '⚠️ 超出可接受范围（±2）';
    lines.push(`- **${cd.name}**（${cd.id}）：实际 ${score.total_score}，预期 ${cd.expectedTotal}，偏差 ${diff > 0 ? '+' + diff : diff} 分 — ${status}`);
  }

  const failedResults = allResults.filter(r => !r.scoreResult);
  for (const r of failedResults) {
    lines.push(`- **${r.caseDef.name}**（${r.caseDef.id}）：❌ 评分失败，无法对比`);
  }
  lines.push('');

  // ============ 逐条目对比 ============
  lines.push('## 二、逐条目评分对比');
  lines.push('');

  for (const r of allResults) {
    const cd = r.caseDef;
    const score = r.scoreResult;
    if (!score || !score.item_scores) {
      lines.push(`### ${cd.id} — ${cd.name}（❌ 评分数据缺失）`);
      lines.push('');
      continue;
    }

    lines.push(`### ${cd.id} — ${cd.name}`);
    lines.push('');
    lines.push(`| 条目 | 维度 | 预期 | 实际 | 偏差 | 兜底 | 初评 | AI 判断理由（摘要） |`);
    lines.push('|------|------|------|------|------|------|------|------|');
    for (const s of score.item_scores) {
      const expected = cd.expectedScores[s.item_id] ?? 0;
      const match = s.score === expected ? '✅' : '⚠️';
      const diff = s.score - expected;
      const diffStr = diff === 0 ? '-' : (diff > 0 ? `+${diff}` : `${diff}`);
      const fallback = s.is_fallback ? '🔄' : '—';
      const initial = s.initial_score !== undefined ? s.initial_score : '—';
      const reason = (s.justification || '').slice(0, 50);
      lines.push(`| ${s.item_id} | ${ITEM_LABELS[s.item_id] || ''} | ${expected} | ${s.score} ${match} | ${diffStr} | ${fallback} | ${initial} | ${escapeMd(reason)} |`);
    }
    lines.push('');
  }

  // ============ 完整对话记录 ============
  lines.push('## 三、各案例完整对话记录');
  lines.push('');

  for (const r of allResults) {
    const cd = r.caseDef;

    lines.push(`### ${cd.id} — ${cd.name}`);
    lines.push('');
    lines.push(`**基本信息**：${cd.basicInfo}`);
    lines.push('');
    lines.push(`**生活近况**：${cd.profile}`);
    lines.push('');
    lines.push(`**覆盖条目数**：${r.coveredItems.length}/9`);
    lines.push(`**对话轮次**：${r.totalTurns} 轮`);
    lines.push('');

    // 评分结果
    if (r.scoreResult && r.scoreResult.item_scores) {
      const score = r.scoreResult;
      lines.push(`#### 📊 PHQ-9 评分结果`);
      lines.push('');
      lines.push(`- **总分**：${score.total_score} / 27（预期 ${cd.expectedTotal}，等级：\`${score.risk_level}\`）`);
      if (score.calibration_summary) {
        lines.push(`- **全局校准**：${score.calibration_summary}`);
      }
      lines.push('');

      // 每个条目详细评分
      for (const s of score.item_scores) {
        const expected = cd.expectedScores[s.item_id] ?? 0;
        const match = s.score === expected ? '✅' : '⚠️';
        lines.push(`**${s.item_id} ${ITEM_LABELS[s.item_id] || ''}**：${s.score}/3（预期 ${expected}）${match}`);
        if (s.is_fallback) lines.push(`  - 标记：🔄 系统兜底得分（直接使用，不参与语义判断）`);
        if (s.initial_score !== undefined) lines.push(`  - 初评分：${s.initial_score}（对话中 SYS 逐项推测）`);
        if (s.calibration_note) lines.push(`  - 校准说明：${s.calibration_note}`);
        if (s.answer_insufficient) lines.push(`  - ⚠️ 回答质量不足（${s.answer_insufficient ? '信息不足/部分线索' : ''}）`);
        lines.push(`  - 判断理由：${s.justification}`);
        lines.push('');
      }
    } else {
      lines.push('#### 📊 PHQ-9 评分结果：❌ 评分数据缺失');
      lines.push('');
    }

    // 报告
    if (r.reportResult) {
      const report = r.reportResult;
      lines.push(`#### 📝 AI 生成的个人报告`);
      lines.push('');
      lines.push(`> **${report.condensed_sentence || '(缺失)'}**`);
      lines.push('');
      lines.push(`**状态分析**：${report.status_analysis || '(缺失)'}`);
      lines.push('');
      if (report.suggestions) {
        lines.push(`**${report.suggestions.intro || '建议：'}**`);
        for (const b of (report.suggestions.bullets || [])) {
          if (b) lines.push(`- ${b}`);
        }
        if (report.suggestions.footer) {
          lines.push(`\n> ${report.suggestions.footer}`);
        }
      }
      lines.push('');
    } else {
      lines.push(`#### 📝 AI 生成的个人报告：❌ 报告数据缺失`);
      lines.push('');
    }

    // 对话记录（折叠）
    lines.push('<details>');
    lines.push('<summary>📋 完整对话记录（展开查看每轮对话与 AI 分析）</summary>');
    lines.push('');
    lines.push('| # | 角色 | 内容（截取） | AI 分析（SYS 块解析） |');
    lines.push('|---|------|-------------|----------------------|');

    let lineNum = 0;
    for (const entry of r.conversationLog) {
      lineNum++;
      const roleLabel = entry.role === 'assistant' ? '🤖 AI' : '👤 用户';
      let text = (entry.text || '').replace(/\n/g, ' ');
      if (text.length > 150) text = text.slice(0, 150) + '...';
      text = escapeMd(text);

      let sysInfo = '—';
      if (entry.isFallback) {
        sysInfo = '🔄 系统兜底';
      } else if (entry.sysBlock) {
        const s = entry.sysBlock;
        const parts = [];
        if (s.item_score_guess !== undefined) parts.push(`猜测得分=${s.item_score_guess}`);
        const isuff = s.info_sufficiency ?? s.info_sufficient;
        if (isuff !== undefined) {
          const labels = { 0: '严重不足', 1: '部分线索', 2: '充分' };
          const v = typeof isuff === 'boolean' ? (isuff ? 2 : 0) : isuff;
          parts.push(`信息=${labels[v] || v}`);
        }
        if (s.risk_confirmed) parts.push('⚠️风险确认');
        if (s.missing_dimensions?.length) parts.push(`短缺:${s.missing_dimensions.join(',')}`);
        sysInfo = parts.join(' | ');
      }

      lines.push(`| ${lineNum} | ${roleLabel} | ${text} | ${sysInfo} |`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // ============ 风险检测验证 ============
  lines.push('## 四、风险检测与兜底机制验证');
  lines.push('');

  for (const r of allResults) {
    const cd = r.caseDef;
    const riskEvents = [];
    const fallbackEvents = [];

    for (const entry of r.conversationLog) {
      if (entry.sysBlock?.risk_confirmed) riskEvents.push(entry);
      if (entry.meta?.show_fallback) fallbackEvents.push({ item: entry.meta.fallback_item, turn: entry.turn });
      if (entry.isFallback) fallbackEvents[fallbackEvents.length - 1] = {
        ...fallbackEvents[fallbackEvents.length - 1],
        score: entry.text.match(/得分 (\d)/)?.[1],
      };
    }

    lines.push(`### ${cd.id} — ${cd.name}`);
    lines.push('');
    lines.push(`- **风险检测触发**：${riskEvents.length > 0 ? '✅ 是（AI SYS 标记 risk_confirmed=true）' : '🟢 否（案例无高风险信号）'}`);
    lines.push(`- **硬兜底触发次数**：${r.conversationLog.filter(l => l.isFallback).length} 次`);
    if (fallbackEvents.length > 0) {
      for (const fe of fallbackEvents) {
        const itemLabel = ITEM_LABELS[fe.item] || fe.item;
        lines.push(`  - ${fe.item}（${itemLabel}）：兜底得分 ${fe.score || '?'}`);
      }
    }
    lines.push('');
  }

  // ============ 测试总结 ============
  lines.push('## 五、测试总结与结论');
  lines.push('');

  if (validResults.length > 0) {
    const deviations = validResults.map(r => Math.abs(r.scoreResult.total_score - r.caseDef.expectedTotal));
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;

    lines.push('### 关键指标');
    lines.push('');
    lines.push(`| 指标 | 结果 |`);
    lines.push(`|------|------|`);
    lines.push(`| 评分平均偏差 | ${avgDeviation.toFixed(1)} 分 |`);
    lines.push(`| 等级完全匹配 | ${validResults.filter(r => r.scoreResult.risk_level === r.caseDef.expectedRiskLevel).length}/${validResults.length} 例 |`);
    lines.push(`| 偏差 ≤ ±2 的案例 | ${validResults.filter(r => Math.abs(r.scoreResult.total_score - r.caseDef.expectedTotal) <= 2).length}/${validResults.length} 例 |`);
    lines.push(`| 风险检测触发 | ${allResults.filter(r => r.conversationLog.some(l => l.sysBlock?.risk_confirmed)).length} 例 |`);
    lines.push(`| 硬兜底触发 | ${allResults.filter(r => r.conversationLog.some(l => l.isFallback)).length} 例 |`);
    const q9Coverage = allResults.filter(r => r.coveredItems.includes('Q9'));
    lines.push(`| Q9 条目覆盖 | ${q9Coverage.length}/${allResults.length} 例 |`);
    lines.push('');

    lines.push('### 结论');
    lines.push('');
    if (avgDeviation <= 2 && validResults.length === 4) {
      lines.push('✅ **评分系统表现良好**：四个案例的平均偏差在可接受范围（±2）内，PHQ-9 等级匹配准确。对话引擎能自然引导用户完成9个维度的探索，兜底机制在必要时触发保障对话完整性。');
    } else if (validResults.length < 4) {
      lines.push('⚠️ **部分案例评分异常**：存在评分API返回异常的情况（详见案例详情）。可能原因：对话过长导致LLM响应截断、特定风险流程下评分状态异常。建议检查对应案例的会话日志。');
    } else {
      lines.push('⚠️ **评分偏差需关注**：部分案例的评分偏差超出可接受范围。建议针对性优化以下条目：Q3（睡眠）/ Q4（精力）的情境性症状识别，以及 Q2（情绪）/ Q6（自我否定）的严重度校准。');
    }
  }

  lines.push('');
  lines.push(`---`);
  lines.push('');
  lines.push(`*报告由 COSMO 自动化测试脚本生成 | ${timestamp}*`);

  return lines.join('\n');
}

// ===================================================================
// Main
// ===================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     COSMO 案例模拟测试 — v2.1                     ║');
  console.log('║     4个案例 × PHQ-9 四级严重程度                  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\nAPI 地址: ${BASE}`);
  console.log(`启动时间: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);

  const allResults = [];

  for (const caseDef of CASES) {
    try {
      const result = await runConversation(caseDef);
      allResults.push(result);
      if (result.scoreResult) {
        console.log(`\n✅ ${caseDef.name} 测试完成 → 实际得分: ${result.scoreResult.total_score} (预期 ${caseDef.expectedTotal})`);
      } else {
        console.log(`\n⚠️ ${caseDef.name} 测试完成但评分失败`);
      }
    } catch (err) {
      console.error(`\n❌ ${caseDef.name} 测试失败:`, err);
      allResults.push({
        caseDef, sessionId: null, conversationLog: [],
        scoreResult: null, reportResult: null,
        coveredItems: [], itemTurns: {}, totalTurns: 0, error: err.message,
      });
    }
  }

  // 生成报告
  console.log('\n\n📝 生成测试报告...');
  const report = generateReport(allResults);
  const reportPath = '/Users/qzm/Documents/005_AI筛查纯净版/测试报告-2.0.md';
  writeFileSync(reportPath, report, 'utf-8');
  console.log(`✅ 测试报告已保存至: ${reportPath}`);
  console.log(`   报告大小: ${(report.length / 1024).toFixed(1)} KB`);
}

main().catch(err => {
  console.error('测试脚本失败:', err);
  process.exit(1);
});

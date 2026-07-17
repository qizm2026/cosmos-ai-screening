export type CoverageStatus = 'pending' | 'answered' | 'fallback'
export type RiskLevel = 'minimal' | 'mild' | 'moderate' | 'severe'

export interface ScaleItem {
  id: string
  original_item: string
  core_intent: string
  probe_direction: string
  is_high_risk: boolean
  fallback_question: string
  fallback_options: [string, string, string, string]
  /** 兜底时的提问文案：直接使用 PHQ-9 原题（original_item） */
  fallback_prompt: string
  /** 兜底时的选项：PHQ-9 标准频率选项（Q9 使用独立锚点） */
  fallback_options_original: [string, string, string, string]
  score_anchors: [string, string, string, string]
}

export interface Scale {
  id: string
  name: string
  description: string
  risk_thresholds: {
    minimal: [number, number]
    mild: [number, number]
    moderate: [number, number]
    severe: [number, number]
  }
  items: ScaleItem[]
}

export const PHQ9: Scale = {
  id: 'phq9',
  name: 'PHQ-9',
  description: '一次关于你近期状态的对话探索',
  risk_thresholds: {
    minimal:  [0,  4],
    mild:     [5,  9],
    moderate: [10, 14],
    severe:   [15, 27],
  },
  items: [
    {
      id: 'Q1',
      original_item: '做事提不起劲或没有兴趣',
      core_intent: '过去两周，对平时感兴趣的事物的兴趣或愉悦感是否下降',
      probe_direction: '是什么事 / 兴趣减退的范围有多广',
      is_high_risk: false,
      fallback_question: '最近两周，做事的兴趣和动力怎么样？',
      fallback_prompt: '过去两周，做事时提不起劲或没有兴趣——',
      fallback_options: [
        '和平时差不多，没什么变化',
        '偶尔会提不起劲，但不明显',
        '明显比以前少了，挺影响我的',
        '几乎对什么都提不起劲了',
      ],
      fallback_options_original: [
        '完全没有',
        '有几天',
        '一半以上天数',
        '几乎每天',
      ],
      score_anchors: [
        '兴趣正常，有事情想做',
        '偶尔对某些事提不起劲，轻微且局限',
        '超过半数时间对多数事物失去兴趣，明显影响',
        '几乎对所有事物失去兴趣，极度空洞感',
      ],
    },
    {
      id: 'Q2',
      original_item: '感到心情低落、沮丧或绝望',
      core_intent: '过去两周，是否持续存在情绪低落、沮丧或对未来感到绝望',
      probe_direction: '低落的深度 / 有没有绝望感',
      is_high_risk: false,
      fallback_question: '最近两周，心情和情绪状态怎么样？',
      fallback_prompt: '过去两周，感到心情低落、沮丧或绝望——',
      fallback_options: [
        '基本稳定，没有特别低落',
        '偶尔会低落，但能自己调节',
        '低落的时候挺多的，不太好调节',
        '几乎每天都很低落，感觉很难改变',
      ],
      fallback_options_original: [
        '完全没有',
        '有几天',
        '一半以上天数',
        '几乎每天',
      ],
      score_anchors: [
        '情绪基本稳定',
        '有几天低落，不持续，能自我调节',
        '超过半数天低落或沮丧，调节困难',
        '几乎每天持续低落或绝望，感觉无法改变',
      ],
    },
    {
      id: 'Q3',
      original_item: '入睡困难、睡不安稳或睡眠过多',
      core_intent: '过去两周，睡眠是否出现异常（包括失眠和嗜睡两个方向）',
      probe_direction: '睡多还是睡少（方向先于频率）',
      is_high_risk: false,
      fallback_question: '最近两周，睡眠状况怎么样？',
      fallback_prompt: '过去两周，入睡困难、睡不安稳或睡眠过多——',
      fallback_options: [
        '睡眠基本正常',
        '偶尔睡不好或睡太多，不影响日常',
        '睡眠问题比较频繁，影响第二天状态',
        '几乎每天睡眠都有问题，很影响状态',
      ],
      fallback_options_original: [
        '完全没有',
        '有几天',
        '一半以上天数',
        '几乎每天',
      ],
      score_anchors: [
        '睡眠正常',
        '偶尔睡不好或睡太多，不影响日常',
        '睡眠问题较频繁，影响第二天状态',
        '几乎每天严重睡眠问题，严重影响功能',
      ],
    },
    {
      id: 'Q4',
      original_item: '感觉疲倦或没有活力',
      core_intent: '过去两周，是否经常感到疲劳或缺乏完成日常事务的精力',
      probe_direction: '程度 / 对日常生活的影响',
      is_high_risk: false,
      fallback_question: '最近两周，精力和体力状态怎么样？',
      fallback_prompt: '过去两周，感觉疲倦或没有活力——',
      fallback_options: [
        '和平时差不多，没什么问题',
        '偶尔会比较累，但能完成日常',
        '经常感到疲惫，做事需要努力撑着',
        '几乎每天都很累，连基本的事也很费力',
      ],
      fallback_options_original: [
        '完全没有',
        '有几天',
        '一半以上天数',
        '几乎每天',
      ],
      score_anchors: [
        '精力正常',
        '有几天比平时累，但能完成日常',
        '经常感到疲惫，做事需要努力撑着',
        '几乎每天极度疲劳，连基本事务也很费力',
      ],
    },
    {
      id: 'Q5',
      original_item: '食欲不振或吃太多',
      core_intent: '过去两周，食欲是否出现明显变化（包括减少和增加两个方向）',
      probe_direction: '吃多还是吃少（方向先于频率）',
      is_high_risk: false,
      fallback_question: '最近两周，饮食和食欲有什么变化吗？',
      fallback_prompt: '过去两周，食欲不振或吃太多——',
      fallback_options: [
        '和平时差不多，没什么变化',
        '偶尔有点变化，但不明显',
        '变化比较明显，影响到进食了',
        '几乎每天食欲都有很大变化，很难控制',
      ],
      fallback_options_original: [
        '完全没有',
        '有几天',
        '一半以上天数',
        '几乎每天',
      ],
      score_anchors: [
        '食欲正常',
        '偶有变化，幅度不大',
        '食欲明显变化超过半数时间，影响进食',
        '几乎每天食欲极低或暴食，明显失控感',
      ],
    },
    {
      id: 'Q6',
      original_item: '觉得自己很糟，或觉得自己很失败，或让自己或家人失望',
      core_intent: '过去两周，是否存在自我贬低、自责或感到自己是负担的想法',
      probe_direction: '具体怎么觉得自己不好 / 有没有觉得自己是负担',
      is_high_risk: false,
      fallback_question: '最近两周，对自己的感觉怎么样？',
      fallback_prompt: '过去两周，觉得自己很糟，或觉得自己很失败，或让自己或家人失望——',
      fallback_options: [
        '对自己基本还好，没有特别负面',
        '偶尔会觉得自己不够好，但不持续',
        '经常觉得自己很差劲，影响心情',
        '几乎每天都很否定自己，觉得是别人的负担',
      ],
      fallback_options_original: [
        '完全没有',
        '有几天',
        '一半以上天数',
        '几乎每天',
      ],
      score_anchors: [
        '对自己基本中立或正向',
        '偶尔觉得自己不够好，短暂',
        '经常觉得自己很差劲，影响自我感受',
        '几乎每天强烈自我否定或觉得自己是负担',
      ],
    },
    {
      id: 'Q7',
      original_item: '做事时难以集中注意力，例如看报纸或看电视',
      core_intent: '过去两周，集中注意力完成任务的能力是否下降',
      probe_direction: '影响到哪些具体事情（学习/日常）',
      is_high_risk: false,
      fallback_question: '最近两周，专注和注意力的状态怎么样？',
      fallback_prompt: '过去两周，做事时难以集中注意力，例如看报纸或看电视——',
      fallback_options: [
        '和平时差不多，没什么问题',
        '偶尔难以集中，但不明显',
        '经常难以集中，影响学习和日常',
        '几乎无法集中，严重影响日常功能',
      ],
      fallback_options_original: [
        '完全没有',
        '有几天',
        '一半以上天数',
        '几乎每天',
      ],
      score_anchors: [
        '注意力正常',
        '偶尔难以集中，轻微',
        '经常难以集中，影响学习效率',
        '几乎无法集中，严重影响日常功能',
      ],
    },
    {
      id: 'Q8',
      original_item: '行动或说话速度变慢，或烦躁或坐立不安，以至于别人已经注意到',
      core_intent: '过去两周，是否出现行动或语言迟缓，或激越，且程度明显到他人可察觉',
      probe_direction: '自己感觉到 还是 别人注意到',
      is_high_risk: false,
      fallback_question: '最近两周，行动和反应上有什么变化吗？',
      fallback_prompt: '过去两周，行动或说话速度变慢，或烦躁或坐立不安，以至于别人已经注意到——',
      fallback_options: [
        '和平时差不多，没什么变化',
        '偶尔感觉有点不一样，但不明显',
        '经常能感觉到明显变化',
        '几乎每天都很明显，别人也注意到了',
      ],
      fallback_options_original: [
        '完全没有',
        '有几天',
        '一半以上天数',
        '几乎每天',
      ],
      score_anchors: [
        '与平时无异',
        '偶尔轻微变化，本人有感觉',
        '经常明显，本人觉察明显',
        '几乎每天明显，他人也注意到',
      ],
    },
    {
      id: 'Q9',
      original_item: '有不如死掉或用某种方式伤害自己的念头',
      core_intent: '过去两周，是否出现任何形式的自伤念头、被动死亡意念或主动自杀想法',
      probe_direction: '被动想法（消失就好）还是 主动念头（有计划）',
      is_high_risk: true,
      fallback_question: '最近两周，有没有一些比较难说出口的内心感受？',
      fallback_prompt: '过去两周，有不如死掉或用某种方式伤害自己的念头——',
      fallback_options: [
        '完全没有',
        '偶尔有一点这样一闪而过的念头，但不会真的去想',
        '有过这样的想法，但没有想过具体要怎么做',
        '认真想过具体怎么做，或者曾经尝试过',
      ],
      fallback_options_original: [
        '完全没有',
        '有几天',
        '一半以上天数',
        '几乎每天',
      ],
      score_anchors: [
        '完全没有',
        '偶有被动死亡意念（消失就好了）',
        '有主动想法但无具体计划',
        '有具体计划或行为',
      ],
    },
  ],
}

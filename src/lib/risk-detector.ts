export type RiskDetectionResult = {
  detected: boolean
  type: 'self_harm' | 'suicide_ideation' | 'extreme_despair' | null
  confidence: number
}

const RISK_PATTERNS: {
  type: NonNullable<RiskDetectionResult['type']>
  patterns: RegExp[]
  keywords: string[]
}[] = [
  {
    type: 'suicide_ideation',
    patterns: [
      /不想活[了啦]/,
      /活[着得]没[意思劲意义]/,
      /想死/,
      /不如死[了掉]/,
      /结束(一切|生命)/,
      /离开(这个)?世界/,
      /永[远久]地?[睡安]/,
      /走[了啦]就[好算]/,
      /没有[我俺]会更?好/,
    ],
    keywords: ['不想活', '想死', '不想存在', '想消失', '活不下去', '自我了断', '轻生'],
  },
  {
    type: 'self_harm',
    patterns: [
      /伤害自己/,
      /自[残伤]/,
      /割[腕手]/,
      /想[让叫]自己[痛疼]/,
      /弄伤/,
    ],
    keywords: ['自伤', '自残', '伤害自己', '自虐', '想打自己', '打自己一拳', '想揍自己', '伤害自己'],
  },
  {
    type: 'extreme_despair',
    patterns: [
      /没有意义/,
      /没有希望/,
      /毫无意义/,
      /撑不下去[了啦]/,
      /坚持不下去[了啦]/,
      /看不到(任何)?希望/,
      /活着[好真很]累/,
      /一[切个]都?没有?意义/,
      /想消失/,
      /消失就[好行]/,
      /绝望/,
    ],
    keywords: ['没有意义', '绝望', '撑不下去', '太累了', '毫无希望', '不想存在', '想消失'],
  },
]

export const RISK_MODAL_TEXT = {
  interventionMessage: '谢谢你愿意告诉我这些。每个人在某些时候都可能会有这样的感受，你并不孤单。接下来的几个问题可能会让你有一些感受——你可以选择现在回答，也可以先停下来透口气。',
  continueLabel: '现在回答',
  pauseLabel: '先休息一下',
  hotline: '400-161-9995',
  pauseMessage: '如果你现在很难受，有些伤害自己的想法——\n\n全国心理援助热线 400-161-9995，24 小时在线。\n会有人接你电话的，你不是一个人。\n\n准备好了随时可以继续。',
}

export function detectRisk(text: string): RiskDetectionResult {
  const normalized = text.trim()

  // 否定语境快速出口：学生明确否认风险内容时，不做误匹配
  if (/没想过|完全没有|从来没|不会想|不至于|从没想|想都没想/.test(normalized)) {
    return { detected: false, type: null, confidence: 0 }
  }

  for (const category of RISK_PATTERNS) {
    for (const pattern of category.patterns) {
      if (pattern.test(normalized)) {
        return { detected: true, type: category.type, confidence: 0.9 }
      }
    }

    for (const keyword of category.keywords) {
      if (normalized.includes(keyword)) {
        return { detected: true, type: category.type, confidence: 0.85 }
      }
    }
  }

  return { detected: false, type: null, confidence: 0 }
}

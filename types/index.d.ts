export type Goal = {
  text: string
  status: 'active' | 'met' | 'done'
  reason?: string
  isRejected?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'session-goal': {
      goal: Goal | null
      isHintHidden: boolean
      skipNextJudgement: boolean
    }
  }
}

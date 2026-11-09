import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Goal } from '../types'

const goal = atom({ plugin: 'session-goal', key: 'goal' } as const, null)
const isHintHidden = atom(
  { plugin: 'session-goal', key: 'isHintHidden' } as const,
  false,
)
const skipNextJudgement = atom(
  { plugin: 'session-goal', key: 'skipNextJudgement' } as const,
  false,
)

const titleOf = (text: string) =>
  text.length > 40 ? `${text.slice(0, 40)}…` : text

const judgePrompt = (target: Goal) =>
  [
    '[session-goal 평가] 이 메시지는 자동 평가입니다. 작업을 이어 가지 말고 판정만 하세요.',
    `세션 목표: ${target.text}`,
    '지금까지의 대화에서 목표가 끝났다는 근거가 있는지 엄격하게 판정하세요.',
    '근거가 대화에 없거나, 일부가 남았거나, 검증되지 않았으면 NOT_MET입니다.',
    target.isRejected
      ? '사용자가 이전의 달성 판정을 거부했습니다. 그 이후의 새 근거가 있을 때만 MET입니다.'
      : '',
    '첫 줄에 `MET: <한 문장 근거>` 또는 `NOT_MET: <한 문장 근거>`만 쓰세요.',
  ]
    .filter(Boolean)
    .join('\n')

const parseMet = (reply: string) => {
  const line = reply.trim().split('\n')[0] ?? ''
  const match = /^MET\s*:\s*(.+)$/.exec(line)

  return match?.[1]?.trim() ?? null
}

const judge = async ($: EngineInterface, target: Goal) => {
  const reply = await $.model.fork({ prompt: judgePrompt(target) })

  if (!reply.isAnswered) {
    return
  }

  const reason = parseMet(reply.text)

  if (reason === null) {
    return
  }

  await update($, goal, current =>
    current?.text === target.text && current.status === 'active'
      ? { ...current, status: 'met' as const, reason }
      : current,
  )
}

const askClaude = ($: EngineInterface, text: string) => {
  // A command.run hook may not submit a prompt: the host would deadlock on it.
  void $.clock.after(0, () => {
    void $.prompt.submit({ text }).catch((error: unknown) => {
      $.ui.toast(`session-goal: Claude에게 요청을 보내지 못했습니다. ${String(error)}`)
    })
  })
}

const setGoal = async ($: EngineInterface, text: string) => {
  await update($, goal, () => ({ text, status: 'active' }))
  await update($, skipNextJudgement, () => true)
  askClaude(
    $,
    [
      `세션 목표가 설정됐습니다: ${text}`,
      `mcp__ccd_session_mgmt__set_session_title로 이 세션(session_id "self")의 제목을 "목표: ${titleOf(text)}"로 바꾸세요.`,
      '제목 변경 외의 작업은 시작하지 말고, 한 문장으로만 답하세요.',
    ].join('\n'),
  )
}

const finishGoal = async ($: EngineInterface, target: Goal) => {
  await update($, goal, () => ({ ...target, status: 'done' }))
  await update($, skipNextJudgement, () => true)
  askClaude(
    $,
    [
      `세션 목표가 완료 처리됐습니다: ${target.text}`,
      `1. mcp__ccd_session_mgmt__set_session_title로 이 세션(session_id "self")의 제목을 "[완료] ${titleOf(target.text)}"로 바꾸세요.`,
      '2. 다음 세션에 넘길 맥락이 있으면 세 줄 이내로 정리하세요.',
      '새 세션 안내는 입력창 위 띠가 맡습니다. new_session 액션은 쓰지 마세요.',
      '추가 작업은 시작하지 마세요.',
    ].join('\n'),
  )
}

const NEW_SESSION_URL = 'claude://code/new?source=desktop_action'

const openNewSession = async ($: EngineInterface) => {
  const { exitCode } = await $.process.run(['open', NEW_SESSION_URL])

  if (exitCode !== 0) {
    $.ui.toast('session-goal: 새 세션 화면을 열지 못했습니다. 사이드바에서 시작해 주세요.')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'session-goal',
      description: '이 세션의 목표를 설정합니다 (clear로 해제)',
      argumentHint: '[목표 | clear]',
    })
    await $.command.register({
      name: 'session-done',
      description: '세션 목표를 완료 처리하고 새 세션을 안내합니다',
    })

    return next(e)
  })

  on('command.run', { command: 'session-goal' }, async ($, e) => {
    const text = e.args.trim()

    if (text === 'clear') {
      await update($, goal, () => null)

      return { text: '세션 목표를 해제했습니다.' }
    }

    if (text === '') {
      const current = await read($, goal)

      return {
        text: current
          ? `현재 목표: ${current.text}`
          : '사용법: /session-goal <목표와 완료 조건>',
      }
    }

    await setGoal($, text)

    return { text: `세션 목표를 설정했습니다: ${text}` }
  })

  on('command.run', { command: 'session-done' }, async $ => {
    const current = await read($, goal)

    if (current === null) {
      return { text: '설정된 세션 목표가 없습니다.' }
    }

    await finishGoal($, current)

    return { text: `세션 목표를 완료 처리했습니다: ${current.text}` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId !== undefined) {
      return result
    }

    if (await read($, skipNextJudgement)) {
      await update($, skipNextJudgement, () => false)

      return result
    }

    const current = await read($, goal)

    if (e.reason === 'answer' && current?.status === 'active') {
      void $.clock.after(0, () => {
        void judge($, current)
      })
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const current = await read($, goal)
    const { Box, Button, Text } = $.ui.resolve(e)

    if (current === null) {
      if (await read($, isHintHidden)) {
        return next(e)
      }

      return (
        <Box>
          <Text dimColor>
            이 세션의 목표가 없습니다. /session-goal &lt;목표&gt;로 설정하세요.{' '}
          </Text>
          <Button
            key="skip"
            label="건너뛰기"
            onPress={() => update($, isHintHidden, () => true)}
          />
        </Box>
      )
    }

    if (current.status === 'done') {
      return (
        <Box>
          <Text dimColor>목표 완료: {current.text} </Text>
          <Button
            key="new-session"
            label="새 세션 열기"
            onPress={() => openNewSession($)}
          />
        </Box>
      )
    }

    if (current.status === 'met') {
      return (
        <Box flexDirection="column">
          <Text bold>목표를 달성한 것으로 보입니다: {current.text}</Text>
          <Text dimColor>{current.reason}</Text>
          <Box>
            <Button
              key="finish"
              label="완료하고 새 세션으로"
              onPress={async () => {
                await finishGoal($, current)
                await openNewSession($)
              }}
            />
            <Button
              key="reject"
              label="아직 아닙니다"
              onPress={() =>
                update($, goal, () => ({
                  text: current.text,
                  status: 'active' as const,
                  isRejected: true,
                }))
              }
            />
          </Box>
        </Box>
      )
    }

    return (
      <Box>
        <Text>목표: {current.text} </Text>
        <Button
          key="done"
          label="완료"
          onPress={() => finishGoal($, current)}
        />
      </Box>
    )
  })
}

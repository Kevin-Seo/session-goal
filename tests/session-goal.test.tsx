import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'session-goal',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const TURN = {
  answer: 'done',
  durationMs: 1,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
} as const

const setUp = async ($: Engine, on: On, verdict: string) => {
  const clock = mock.clock(on)
  const prompts: string[] = []
  let judgements = 0

  on('ui.toast', (_, e) => {
    prompts.push(`toast: ${JSON.stringify(e)}`)

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    prompts.push(`open: ${e.argv.join(' ')}`)

    return {
      value: {
        exitCode: 0,
        stdout: '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))
  on('model.fork', () => {
    judgements += 1

    return { value: { isAnswered: true, text: verdict, usage: USAGE } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({
    command: 'session-goal',
    args: '로그인 버그 수정',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  await clock.advance(0)

  return { clock, prompts, judgements: () => judgements }
}

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

test('setting a goal asks for the title and skips judging that turn', async ($, on) => {
  const { clock, prompts, judgements } = await setUp($, on, 'MET: fixed')

  expect(prompts[0]).toContain('목표: 로그인 버그 수정')
  await $.turn.complete(TURN)
  await clock.advance(0)
  expect(judgements()).toBe(0)
})

test('a MET verdict offers a new session and starts no work', async ($, on) => {
  const { clock, prompts, judgements } = await setUp($, on, 'MET: fixed')

  await $.turn.complete(TURN)
  await $.turn.complete({ ...TURN, turnId: 't2' })
  await clock.advance(0)
  expect(judgements()).toBe(1)
  expect(prompts.length).toBe(1)

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /달성/ }))?.text).toContain('로그인')
  await ui.press({ key: 'finish' })
  await clock.advance(0)
  expect(prompts).toContain('open: open claude://code/new?source=desktop_action')
  expect(prompts.some(text => text.includes('[완료]'))).toBe(true)
  await ui.unmount()
})

test('a NOT_MET verdict keeps the goal active', async ($, on) => {
  const { clock } = await setUp($, on, 'NOT_MET: tests remain')

  await $.turn.complete(TURN)
  await $.turn.complete({ ...TURN, turnId: 't2' })
  await clock.advance(0)

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /목표:/ }))?.text).toContain('로그인')
  expect(await ui.find({ type: 'Text', text: /달성/ })).toBe(undefined)
  await ui.unmount()
})

test('a built-in goal name is not registered', async ($, on) => {
  const names: string[] = []

  on('command.register', (_, e) => {
    names.push(e.name)

    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(names.includes('goal')).toBe(false)
  expect(names).toEqual(['session-goal', 'session-done'])
})

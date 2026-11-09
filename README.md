# session-goal

A Claude Code mod that gives a session one goal, shows it above the prompt and in the sidebar title, judges completion after each turn, and points you to a new session when the goal is done.

Unlike the built-in `/goal`, it never makes Claude keep working. It only judges and suggests.

## Install

At the prompt of a terminal session:

```
/plugin install session-goal --marketplace YH-Seo/session-goal
```

From a shell:

```bash
claude plugin install session-goal --marketplace YH-Seo/session-goal
```

## Usage

| Command | What it does |
| --- | --- |
| `/session-goal <goal and done condition>` | Sets the goal and renames the session to `목표: ...` |
| `/session-goal` | Shows the current goal |
| `/session-goal clear` | Clears the goal |
| `/session-done` | Marks the goal done and renames the session to `[완료] ...` |

After each answered turn, one extra model call reads the conversation and judges the goal. When it looks met, the band above the prompt shows the reason with two buttons: finish and open a new session, or reject the verdict.

## Limits

- Opening a new session uses the `claude://code/new` link through macOS `open`, so that button works on macOS with the Claude desktop app only.
- The automatic judgement adds one model call per turn in sessions that have a goal.
- The UI text is in Korean.

# Session Lights

With a few Claude sessions going at once, you can't tell from the sidebar which one is working, which one is stuck on a permission prompt, and which one is done and waiting on you. This puts a status emoji at the front of each session's title so you can see it at a glance.

| Emoji | Means |
|---|---|
| ⚙️ | Working, including background work still running after a reply |
| 🔐 | Waiting for you to allow a tool |
| ❓ | Waiting for you to answer a question or approve a plan |
| 🟢 🟡 🔴 | Done. The light is the last 🟢, 🟡 or 🔴 in Claude's reply |
| ⚪ | Done, and the reply had no light in it |
| ⚠️ | The turn ended on an error |

The title itself never changes, only the emoji in front of it. Rename a session any time and the light keeps working on the new name.

## The traffic light

The green, yellow and red come from Claude's own reply. If you ask Claude to end every reply with one of them (green when it's done, yellow when it's done with optional next steps, red when something's still running or it needs you), the sidebar shows that too. A line like this in your CLAUDE.md or AGENTS.md is enough:

```
End every reply with 🟢 if the task is done, 🟡 if done with optional follow-ups, or 🔴 if something is still running or you need me.
```

Without it, finished sessions show ⚪.

## Install

Needs the Claude desktop app (the Code tab) and Claude Code 2.1.308 or newer, since it's built on Claude Code's plugin hooks modules, which are early access.

```bash
claude plugin marketplace add DHRlabs/session-lights
```

```bash
claude plugin install session-lights@session-lights
```

New sessions pick it up. Sessions already open get it the next time they start.

## How it works

It's one small hooks module, [claude/hooks/register.ts](claude/hooks/register.ts). It listens for a turn starting, a permission prompt, a question or plan approval, and a turn ending, then renames the session through the desktop app's own session tools, so it only ever touches the session it's running in. Those two calls are allowed without a prompt, and nothing else is.

In the terminal, with no desktop app around, it does nothing.

## License

Session Lights is licensed under the [GNU General Public License v3.0](LICENSE).

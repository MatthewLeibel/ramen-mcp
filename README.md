# RAMen connector (MCP)

[RAMen](https://getramenai.com) is one memory for all your AI apps. It saves what you tell them (your people, your
work, your rules, how you like answers) and looks it up when it matters, with a receipt for every note: your own
words, the date and the app. Long chats can be saved and continued in a fresh chat, in any app.

This package connects RAMen to any app that runs MCP servers on your computer: Claude Desktop, Cursor, VS Code,
Windsurf, Zed, Cline, Codex, Gemini CLI and others. It signs in with your RAMen license key and passes each request
to RAMen's hosted service, where all of RAMen runs. It has no dependencies.

## 1. Get a license key

Get a free key at [getramenai.com](https://getramenai.com). RAMen Free keeps up to 50 notes, 3 saved chats a month
and 2 connected apps. RAMen Pro is $1.99 a month, with a 14-day trial of everything.

## 2. Add it to your app

Claude Desktop (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`), Windsurf, Cline and most others:

```json
{
  "mcpServers": {
    "ramen": {
      "command": "npx",
      "args": ["-y", "github:MatthewLeibel/ramen-mcp"],
      "env": { "RAMEN_LICENSE_KEY": "your RAMen license key" }
    }
  }
}
```

VS Code (`.vscode/mcp.json`) uses `"servers"` in place of `"mcpServers"`.

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.ramen]
command = "npx"
args = ["-y", "github:MatthewLeibel/ramen-mcp"]
env = { RAMEN_LICENSE_KEY = "your RAMen license key" }
```

Claude Code: `claude mcp add ramen -e RAMEN_LICENSE_KEY=your-key -- npx -y github:MatthewLeibel/ramen-mcp`, or
install the [RAMen plugin](https://github.com/MatthewLeibel/ramen-plugins).

Apps that connect to remote MCP servers themselves (claude.ai, ChatGPT and others) don't need this package: add
`https://ramen-online.matthewsleibel.workers.dev/mcp` and sign in with your key in the browser.

Needs Node.js 18.18 or later.

## Tools

| Tool | What it does |
| --- | --- |
| `recall` | Looks up what RAMen knows that matters to your message |
| `remember` | Saves a note, with your own words as its receipt |
| `forget` | Deletes notes about something you name |
| `memory_status` | Shows what RAMen keeps and what your plan includes |
| `save_thread` | Saves a long chat (goal, decisions, open items, drafts) to continue later |
| `resume_thread` | Continues a saved chat in a fresh one |
| `recall_thread` | Finds a detail in a saved chat |

See, edit and delete everything on your RAMen page: [getramenai.com](https://getramenai.com).

## Settings

| Variable | |
| --- | --- |
| `RAMEN_LICENSE_KEY` | Your RAMen license key (required) |
| `RAMEN_APP` | The app name on your notes' receipts. By default, the name your app gives itself |
| `RAMEN_DEBUG` | Set to `1` for more messages (on stderr) |

Without a key, the connector still starts and lists RAMen's tools; using one tells you to add your key.

The sign-in is saved in `~/.config/ramen-mcp` (on Windows, `%APPDATA%\ramen-mcp`), readable only by you, so the key
is sent to RAMen once per app and not on every start.

## Privacy

Your key and your requests go only to RAMen. RAMen never receives your full conversations, only what your AI saves
or looks up. Privacy policy: [getramenai.com/privacy.html](https://getramenai.com/privacy.html).
Support: support@getramenai.com.

## Test

`RAMEN_LICENSE_KEY=your-key npm test` starts the connector, lists the tools and runs two read-only tools against RAMen.

## License

MIT, for this connector. RAMen's hosted service is not open source.

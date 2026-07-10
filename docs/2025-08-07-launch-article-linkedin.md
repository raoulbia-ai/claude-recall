<!--
Archived: the original Claude Recall launch article, published on LinkedIn by
Raoul Biagioni on August 7, 2025. Preserved verbatim as a historical record of
the project's origin. NOTE: it predates most of what Claude Recall is today —
Pi and Kiro support, the outcome-aware learning loop, LLM-based capture, the
no-API-key/subscription architecture — so treat it as origin story, not docs.
-->

# Why I Spent My Weekend Teaching a Goldfish-Brained AI to Remember

**Raoul Biagioni** — ♾️ AI Development Specialist | Agentic Engineer | Enabling AI-driven Business Innovation

*Published on LinkedIn, August 7, 2025*

---

Claude Code forgets what you just told it. Not just between sessions. Even 10 messages into a conversation.

But what if it didn't?

## The Problem That Sparked a Solution

Over the past six months, I watched myself explain the same codebase preferences to Claude over and over again.

PostgreSQL for data. TypeScript strict mode. Tests directory for saving tests.

Not just in new sessions. Even 20 conversation turns later, as the context window fills up, Claude starts forgetting what we discussed at the beginning.

That's when I decided: Claude Code needs a memory.

## Building Claude Recall: A Memory That Actually Works

Sure, there are memory solutions out there. xmem requires an external vector database for storing memory. Mem0 (OpenMemory) needs Chrome extensions and API keys to connect across tools.

But I wanted something different: truly local, minimal dependencies, and built directly into Claude Code using MCP. No browser extensions. No vector DB setup. No API keys. Just `npm install claude-recall` and you're done.

Here's what I built in 72 hours of coding:

### 🧠 Smart Capture

- Hooks that watch every tool Claude uses (118-line robust implementation)
- Patterns detected automatically from your workflow
- Zero configuration needed

### ⚡ Smart Retrieval

- MCP server provides memory tools directly to Claude
- Pattern-based intent detection from natural language
- Context-aware memory filtering and relevance scoring

### 🔧 The Tech Stack

Claude Recall consists of three main components: A JavaScript hook that intercepts Claude's tool usage (file reads, bash commands, etc.), a Node.js MCP server to expose memory search and retrieval tools to Claude, and a SQLite database that stores captured patterns and preferences locally.

When Claude performs an action, the hook captures it and sends it to the pattern detector. The detector uses regex-based pattern matching to identify things like file locations, tool preferences, and coding styles with confidence scores. Patterns scoring above 0.8 are stored in SQLite. During Claude sessions, the MCP server provides tools that Claude can call to search and retrieve these stored memories based on context and relevance scoring.

## Real Results From Real Conversations

**Before Claude Recall (message #25 in same chat):**

- "What database do we use?" → Claude searches everywhere
- "Where's the auth logic?" → Claude searches everywhere
- "Write a test" → Claude saves the test in the project root

**After Claude Recall (message #100, still remembers):**

- "What database do we use?" → "PostgreSQL, as always"
- "Where's the auth logic?" → "src/services/auth.ts:42"
- "Write a test" → Claude saves the test in tests/

## The Reality Check

I'm conscious that in the fast-evolving GenAI ecosystem, many projects are quickly destined to oblivion. I have no doubt that the problem I described and solved for myself will be solved better by someone else soon. But here's the thing: I had an absolute blast building Claude Recall with the help of Claude Code by Anthropic, and the amazing AI Orchestration Platform Claude-Flow by Reuven Cohen from Agentics Foundation.

Sometimes the best tools are the ones you build for yourself, not because they'll change the world, but because they solve your specific problem right now.

> 💡 **Key Takeaway:** We're living in the stone age of AI assistants. They're powerful but goldfish-brained — forgetting context even within the same conversation. That changes now.

🔗 Link: in the comments.

💬 Question for you: What's the ONE thing you wish your AI assistant would remember?

#AITools #DeveloperProductivity #OpenSource #ClaudeAI

# Claude Code Skills: How SKILL.md Works

Research findings on Anthropic's Skills system for Claude Code.

## Overview

Skills are a filesystem-based mechanism for extending Claude's capabilities with domain-specific expertise. Each skill is a directory containing a `SKILL.md` file with optional supporting resources.

## Directory Structure

Skills can be stored in three locations:

| Location | Scope | Use Case |
|----------|-------|----------|
| `~/.claude/skills/` | Personal (all projects) | Individual workflows |
| `.claude/skills/` | Project (version controlled) | Team-shared expertise |
| Plugin-bundled | Plugin scope | Distributed with plugins |

```
.claude/skills/
└── my-skill/
    ├── SKILL.md          # Required: main instructions
    ├── REFERENCE.md      # Optional: detailed docs
    ├── scripts/          # Optional: executable code
    └── templates/        # Optional: output templates
```

## SKILL.md Format

Two parts: YAML frontmatter + Markdown content.

```yaml
---
name: my-skill-name
description: What it does AND when to use it. Include trigger contexts.
version: 1.0.0
allowed-tools: "Read, Write, Bash"
---

# My Skill Name

Instructions go here...
```

### Required Fields

- **name**: Lowercase, hyphens only, max 64 chars
- **description**: Max 1024 chars - THE most critical field

### Optional Fields

- **version**: Semantic versioning (e.g., "1.0.0")
- **license**: SPDX identifier (e.g., "MIT")
- **allowed-tools**: Comma-separated tool restrictions
- **model**: Override default model for execution

## Progressive Disclosure Architecture

Skills use a three-level loading hierarchy to minimize context window usage:

| Level | What Loads | When | Token Cost |
|-------|-----------|------|------------|
| 1 | Metadata (name + description) | Session startup | ~30-50 tokens/skill |
| 2 | Full SKILL.md body | When Claude invokes skill | 1,000-5,000 tokens |
| 3 | Supporting files | On-demand via filesystem | Variable |

This means 100 skills installed = only ~3,000-5,000 tokens at startup, not the full content of all skills.

## How Skill Invocation Works

### Phase 1: Discovery (Startup)

1. Claude Code scans skill directories
2. Parses YAML frontmatter from each SKILL.md
3. Embeds skill names + descriptions into the `Skill` tool's description
4. Full SKILL.md content is NOT loaded yet

### Phase 2: Selection (During Conversation)

1. User sends a message
2. Claude sees available skills in the `Skill` tool description
3. Claude uses **pure LLM reasoning** (not embeddings/classifiers) to match user intent
4. If relevant, Claude calls: `Skill({ "command": "skill-name" })`

### Phase 3: Injection (On Invocation)

Two user messages are injected into conversation:

1. **Visible message**: Status like "The 'pdf' skill is running..."
2. **Hidden message** (isMeta: true): Full SKILL.md body (minus frontmatter)

Key: Skills inject as **user messages**, NOT system prompt modifications. This keeps the effect scoped to the current task rather than persisting globally.

## Skills and Tool Calling

**Important distinction**: Skills are NOT a new type of tool. Skills provide **instructions** that tell Claude how to use existing tools.

### How Bundled Scripts Work

A skill can bundle executable scripts in a `scripts/` directory:

```
my-skill/
├── SKILL.md
└── scripts/
    └── validate.py
```

The SKILL.md contains instructions referencing the script:

```markdown
## Validation

To validate input files, run:

`python {baseDir}/scripts/validate.py input.txt`
```

### Execution Flow

When Claude follows these instructions, it uses standard tool calling:

```
1. Skill loads → SKILL.md content injected into conversation
2. Claude reads instruction: "run python {baseDir}/scripts/validate.py"
3. Claude calls Bash tool: Bash({ command: "python /resolved/path/scripts/validate.py input.txt" })
4. Script executes in sandbox
5. Output returns to Claude
6. Claude uses output to continue the task
```

### What This Means

- **Skills = Instructions + Resources** (text, scripts, templates)
- **Tool Calling = How Claude acts** on those instructions
- The `allowed-tools` frontmatter field restricts which tools the skill can use
- Scripts run in Claude Code's sandbox with normal security restrictions

### Example: PDF Skill with Script

```yaml
---
name: pdf-processor
description: Extract and analyze PDF content. Use when user mentions PDFs or document extraction.
allowed-tools: "Bash, Read, Write"
---

# PDF Processor

## Text Extraction

To extract text from a PDF:

`python {baseDir}/scripts/extract_text.py input.pdf output.txt`

## Table Extraction

For tables, use:

`python {baseDir}/scripts/extract_tables.py input.pdf --format csv`
```

When invoked, Claude reads these instructions and executes the appropriate script via the Bash tool based on what the user needs.

## The Description Field is Critical

From Anthropic's official documentation:

> "The description is critical for skill selection: Claude uses it to choose the right Skill from potentially 100+ available Skills."

> "The description determines when your skill activates, making it the most critical component."

### What to Include

1. **Capabilities**: What the skill does
2. **Triggers**: When Claude should use it
3. **Context**: Relevant scenarios
4. **Boundaries**: What it doesn't do

### Good vs Bad Descriptions

**Good:**
```
Extract text and tables from PDF files, fill forms, merge documents.
Use when working with PDF files or when the user mentions PDFs, forms,
or document extraction.
```

**Bad:**
```
Helps with documents.
```

### Writing Style

- Write in **third person** (not "you can use this to...")
- Include explicit trigger words users might say
- Be specific about file types, actions, contexts

## Best Practices

### Keep SKILL.md Concise

- Target under 500 lines
- Put detailed reference material in separate files
- Use progressive disclosure: "For advanced usage, see [REFERENCE.md](REFERENCE.md)"

### Use {baseDir} for Portability

```markdown
Run `python {baseDir}/scripts/validate.py input.txt`
```

The `{baseDir}` variable resolves to the skill's installation directory at runtime.

### Assume Claude's Knowledge

Don't explain what PDFs are. Focus on domain-specific procedures:
- Good: "Use pdfplumber to extract text from page boundaries"
- Bad: "A PDF is a Portable Document Format file..."

### Iterate Based on Real Usage

1. Work with Claude on representative tasks
2. Observe where it succeeds/struggles
3. Ask Claude to self-reflect on what went wrong
4. Update SKILL.md based on what Claude actually needs

## Security Considerations

- Only install skills from trusted sources
- Audit all bundled scripts before enabling
- Review `allowed-tools` permissions
- Check for external network calls in instructions

## Cross-Platform Support

Skills work consistently across:
- Claude.ai (web interface)
- Claude Code (CLI)
- Claude Agent SDK
- Claude API (with code execution)

## Official Documentation

- [Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Equipping Agents with Skills (Engineering Blog)](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

---

*Research compiled: December 2024*

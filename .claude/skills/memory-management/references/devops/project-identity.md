# Project Identity Patterns

Patterns for capturing what the project is and what it's built with.

## Project Purpose Examples

**Automatically Captured:**
- "This is a teleprompter tool for interviews"
- "This is a REST API for user management"
- "Building a chat application with real-time messaging"
- "Creating an e-commerce platform"

**Stored As:**
```json
{
  "type": "devops",
  "category": "project_purpose",
  "value": "teleprompter tool for interviews",
  "confidence": 0.85
}
```

## Tech Stack Examples

**Automatically Captured:**
- "Built with Python and Electron"
- "Uses React + TypeScript for frontend"
- "Backend is FastAPI with PostgreSQL"
- "Frontend framework is Vue.js"

**Stored As:**
```json
{
  "type": "devops",
  "category": "tech_stack",
  "value": "Python and Electron",
  "confidence": 0.85
}
```

## Dependency Examples

**Automatically Captured:**
- "Requires Blue Yeti microphone"
- "Depends on Redis for caching"
- "Requires Python 3.11+"
- "Needs Docker and docker-compose"

**Stored As:**
```json
{
  "type": "devops",
  "category": "dependency",
  "value": "Blue Yeti microphone",
  "confidence": 0.8
}
```

## Best Practices

**Be explicit:**
✅ "Built with React and TypeScript"
✅ "This is a CLI tool for database migrations"
✅ "Requires Node.js 18+"

**Not vague:**
❌ "Maybe use React" (uncertain)
❌ "Could use TypeScript" (suggestion)
❌ "What about Node?" (question)

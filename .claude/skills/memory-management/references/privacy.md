# Privacy & Security Guidelines

This reference provides detailed guidance on what NOT to store in Claude Recall memories to protect sensitive data.

## Core Principle: Privacy by Default

**Claude Recall stores data locally** (`~/.claude-recall/claude-recall.db`), but memories could be exported, shared, or synced in the future. Following privacy-by-default prevents accidental data leaks.

## ❌ NEVER Store These

### 1. Secrets & Credentials

**API Keys and Tokens**:
- ❌ `API_KEY=sk_live_abc123xyz`
- ❌ `ANTHROPIC_API_KEY=sk-ant-api03-...`
- ❌ `GITHUB_TOKEN=ghp_abc123xyz`
- ❌ `AWS_SECRET_ACCESS_KEY=...`
- ✅ "We use Anthropic API for AI features" (architecture pattern)

**Passwords**:
- ❌ `DB_PASSWORD=mySecretPass123`
- ❌ `ADMIN_PASSWORD=...`
- ❌ User login credentials
- ✅ "Database requires authentication" (architecture pattern)

**Private Keys & Certificates**:
- ❌ SSH private keys
- ❌ SSL/TLS certificates
- ❌ JWT signing keys (the actual key value)
- ✅ "We use RS256 for JWT signing" (algorithm choice)

### 2. Personal Identifiable Information (PII)

**Email Addresses**:
- ❌ `user@example.com`
- ❌ Customer email addresses from databases
- ❌ Support ticket emails
- ✅ "Email validation uses RFC 5322 format" (pattern)

**Phone Numbers**:
- ❌ `+1-555-123-4567`
- ❌ Customer phone numbers
- ✅ "Phone field uses E.164 format" (pattern)

**Government IDs**:
- ❌ Social Security Numbers (SSN)
- ❌ Tax IDs (EIN, VAT numbers)
- ❌ Driver's license numbers
- ❌ Passport numbers

**Financial Data**:
- ❌ Credit card numbers
- ❌ Bank account numbers
- ❌ Payment processor credentials
- ✅ "We use Stripe for payments" (tool choice)

### 3. Sensitive Configuration

**Database Connection Strings**:
- ❌ `postgres://user:password@localhost:5432/db`
- ❌ `mongodb+srv://admin:pass@cluster.mongodb.net/`
- ✅ `postgres://localhost:5432/db` (no credentials)
- ✅ "Production DB uses connection pooling" (pattern)

**OAuth Secrets**:
- ❌ `OAUTH_CLIENT_SECRET=abc123xyz`
- ❌ `GOOGLE_CLIENT_SECRET=...`
- ✅ "OAuth2 flow uses PKCE for web clients" (architecture)

**Webhook & Signing Secrets**:
- ❌ `WEBHOOK_SECRET=whsec_abc123`
- ❌ `SLACK_SIGNING_SECRET=...`
- ✅ "Webhooks validated using HMAC-SHA256" (pattern)

**Environment-Specific Secrets**:
- ❌ Production encryption keys
- ❌ Session secret keys
- ❌ Cookie signing secrets
- ✅ "Sessions use secure, httpOnly cookies" (pattern)

## ✅ SAFE to Store

### Architecture Patterns
```
✅ "We use JWT for authentication, not sessions"
✅ "OAuth2 with PKCE flow for web clients"
✅ "API uses bearer token authentication"
✅ "Passwords hashed with bcrypt (cost factor 12)"
```

### Tool & Technology Choices
```
✅ "PostgreSQL for relational data"
✅ "Redis for session storage"
✅ "Stripe for payment processing"
✅ "SendGrid for transactional emails"
```

### Workflow Rules
```
✅ "Always rotate API keys every 90 days"
✅ "Never commit .env files to git"
✅ "Use AWS Secrets Manager for production secrets"
✅ "All API endpoints require authentication except /health"
```

### Non-Sensitive Configuration
```
✅ "API base URL: https://api.example.com"
✅ "Rate limit: 100 requests per minute"
✅ "Session timeout: 30 minutes"
✅ "Max file upload size: 10MB"
```

### Development Patterns
```
✅ "Local development uses .env.local for secrets"
✅ "Test environment uses mock API keys"
✅ "CI/CD gets secrets from GitHub Secrets"
```

## Automatic Filtering (Future Enhancement)

**Planned automatic detection** for v0.7.0+:

```typescript
// Patterns that will be automatically filtered
const SENSITIVE_PATTERNS = [
  /API_KEY/i,
  /SECRET/i,
  /PASSWORD/i,
  /TOKEN/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN format
  /sk-[a-zA-Z0-9-_]{32,}/, // API key format
  /ghp_[a-zA-Z0-9]{36}/, // GitHub token
];
```

**When storing memories, these patterns will:**
1. Trigger a warning: "⚠️ Potential sensitive data detected"
2. Suggest redacting: "Consider removing: sk-ant-api03-..."
3. Block storage if high-risk pattern found

## Examples: Safe vs. Unsafe

### Example 1: Database Configuration

❌ **Unsafe**:
```
User: "Our database connection is postgres://admin:SuperSecret123@db.prod.example.com:5432/myapp"
[This gets stored → LEAK RISK]
```

✅ **Safe**:
```
User: "We use PostgreSQL in production with connection pooling"
[Pattern stored, no credentials]
```

### Example 2: API Integration

❌ **Unsafe**:
```
User: "Here's the Stripe API key: sk_live_51Abc123xyz..."
[This gets stored → LEAK RISK]
```

✅ **Safe**:
```
User: "We use Stripe for payments. API keys are in AWS Secrets Manager."
[Pattern stored, architecture documented]
```

### Example 3: Email Service

❌ **Unsafe**:
```
User: "Send errors to admin@ourcompany.com and billing@ourcompany.com"
[Email addresses stored → PII LEAK]
```

✅ **Safe**:
```
User: "Error notifications go to admin team, billing notifications to finance team"
[Workflow stored, no PII]
```

### Example 4: User Data

❌ **Unsafe**:
```
User: "Test with user john.doe@example.com, phone +1-555-123-4567"
[PII stored → PRIVACY VIOLATION]
```

✅ **Safe**:
```
User: "Testing uses faker.js to generate random user data"
[Testing approach stored, no real PII]
```

## What to Do If You Accidentally Store Secrets

If sensitive data was accidentally stored in memories:

1. **Find the memory**:
```bash
npx claude-recall search "your-search-term"
```

2. **Clear all memories** (nuclear option):
```bash
npx claude-recall clear --force
```

3. **Rotate the exposed secret immediately**:
   - Generate new API key
   - Update secret in environment
   - Revoke old key

4. **Review exports**:
   - Check if memory was exported: `npx claude-recall export backup.json`
   - Delete any exported files with secrets
   - Ensure exports never committed to git

## Best Practices Summary

1. **Store patterns, not values** - "We use X for Y" not "X=abc123"
2. **Store architecture, not implementation** - "JWT auth" not "secret_key=..."
3. **Store workflows, not credentials** - "Rotate keys monthly" not "current_key=..."
4. **Store tool choices, not access details** - "Use Stripe" not "sk_live_..."
5. **When in doubt, leave it out** - If it feels sensitive, don't store it

## Future Enhancements

Planned for v0.7.0+:
- Automatic PII/secret detection before storage
- Content filtering with redaction suggestions
- Warnings when sensitive patterns detected
- Export sanitization (auto-redact before export)
- Allowlist for safe patterns (e.g., public API URLs)

---

**Remember**: Local storage doesn't mean private forever. Design for privacy by default.

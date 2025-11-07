# Architecture Patterns

Patterns for capturing system architecture, design patterns, and structural decisions.

## Architecture Style Examples

**Automatically Captured:**
- "Uses microservices architecture"
- "Follows event-driven pattern"
- "We use MVC design pattern"
- "Built with serverless architecture"
- "Monolithic architecture with modular design"
- "Service-oriented architecture (SOA)"

**Stored As:**
```json
{
  "type": "devops",
  "category": "architecture",
  "value": "microservices architecture",
  "confidence": 0.85
}
```

## Design Pattern Examples

**Automatically Captured:**
- "Repository pattern for data access"
- "Factory pattern for object creation"
- "Observer pattern for event handling"
- "Singleton for configuration"
- "Dependency injection throughout"

**Examples:**
```
✅ "Use repository pattern for database access"
✅ "Dependency injection via constructor"
✅ "Factory pattern for creating services"
✅ "Strategy pattern for payment processors"
```

## Layered Architecture

**Automatically Captured:**
- "Three-tier architecture (UI, business, data)"
- "Clean architecture with domain at center"
- "Hexagonal architecture (ports and adapters)"
- "Onion architecture pattern"

**Examples:**
```
✅ "Controllers → Services → Repositories"
✅ "Presentation, domain, infrastructure layers"
✅ "Core business logic isolated from frameworks"
✅ "Domain entities never depend on infrastructure"
```

## Communication Patterns

**Automatically Captured:**
- "Event-driven with message queues"
- "REST API for client-server communication"
- "GraphQL for flexible data fetching"
- "gRPC for service-to-service calls"
- "WebSockets for real-time updates"

**Examples:**
```
✅ "REST API for public endpoints"
✅ "Internal services use gRPC"
✅ "Event bus for async communication"
✅ "WebSocket for live notifications"
```

## Data Architecture

**Automatically Captured:**
- "CQRS (Command Query Responsibility Segregation)"
- "Event sourcing for audit trail"
- "Database per microservice"
- "Shared database with separate schemas"
- "Read replicas for scaling"

**Examples:**
```
✅ "Separate read and write models (CQRS)"
✅ "Event sourcing for orders"
✅ "Each service owns its database"
✅ "Redis for caching layer"
```

## Scalability Patterns

**Automatically Captured:**
- "Horizontal scaling with load balancer"
- "Auto-scaling based on CPU usage"
- "Stateless services for easy scaling"
- "CDN for static asset delivery"
- "Database sharding by tenant ID"

**Examples:**
```
✅ "Horizontal pod autoscaling in Kubernetes"
✅ "Stateless API servers"
✅ "CloudFront for asset delivery"
✅ "Database sharded by region"
```

## Resilience Patterns

**Automatically Captured:**
- "Circuit breaker for external services"
- "Retry with exponential backoff"
- "Bulkhead pattern for isolation"
- "Fallback to cached data"
- "Health checks for all services"

**Examples:**
```
✅ "Circuit breaker on payment gateway calls"
✅ "Retry failed requests up to 3 times"
✅ "Graceful degradation when service unavailable"
✅ "/health endpoint for monitoring"
```

## Security Architecture

**Automatically Captured:**
- "Zero-trust security model"
- "API gateway for authentication"
- "OAuth2 for authorization"
- "Encryption at rest and in transit"
- "Defense in depth strategy"

**Examples:**
```
✅ "API gateway handles auth"
✅ "JWT tokens for authentication"
✅ "TLS 1.3 for all connections"
✅ "Principle of least privilege"
```

## Complex Architecture Example

**User States:**
```
"Our microservices architecture:
- API Gateway (authentication, rate limiting)
- User Service (PostgreSQL database)
- Order Service (PostgreSQL + Redis cache)
- Payment Service (external Stripe integration)
- Notification Service (sends emails/SMS)
- Event Bus (RabbitMQ) connects all services
- Each service is independently deployable
- Services communicate via events (async) or REST (sync)"
```

**Store Manually for Complex Systems:**
```javascript
mcp__claude-recall__store_memory({
  content: `Microservices architecture:
- API Gateway (auth + rate limiting)
- User Service (PostgreSQL)
- Order Service (PostgreSQL + Redis)
- Payment Service (Stripe integration)
- Notification Service (email/SMS)
- RabbitMQ event bus
- Independent deployment
- Communication: events (async) + REST (sync)`,
  metadata: {
    type: "devops",
    category: "architecture",
    style: "microservices",
    services: 5
  }
})
```

## Integration Patterns

**Automatically Captured:**
- "API-first design"
- "Webhook callbacks for async operations"
- "Polling for legacy systems"
- "Adapter pattern for third-party APIs"

**Examples:**
```
✅ "OpenAPI spec drives implementation"
✅ "Webhooks for payment notifications"
✅ "Adapter layer for legacy SOAP services"
✅ "Anti-corruption layer for external APIs"
```

## Deployment Architecture

**Automatically Captured:**
- "Blue-green deployments"
- "Canary releases for gradual rollout"
- "Rolling updates in Kubernetes"
- "Immutable infrastructure"

**Examples:**
```
✅ "Blue-green deployment for zero downtime"
✅ "Canary 10% of traffic to new version"
✅ "Immutable Docker containers"
✅ "Infrastructure as code with Terraform"
```

## Confidence Boosters

These keywords increase confidence for architecture patterns:

- **Strong**: "architecture", "pattern", "design"
- **Specific**: "microservices", "MVC", "CQRS", "event-driven"
- **Structural**: "layer", "tier", "module", "service"
- **Principles**: "separation of concerns", "loose coupling"

**Example:**
- "use microservices" → 70% confidence
- "microservices architecture" → 85% confidence
- "follows microservices architecture pattern" → 92% confidence
- "our system uses microservices with event-driven communication" → 95% confidence

## What Won't Be Captured

❌ "Maybe try microservices" (uncertain)
❌ "Should we use MVC?" (question)
❌ "Consider event-driven" (vague)
❌ "Microservices could work" (possibility)

**Make it explicit:**
✅ "Microservices architecture"
✅ "Use MVC pattern"
✅ "Event-driven design"
✅ "CQRS for read/write separation"

## Architecture Anti-Patterns to Store

**Automatically Captured:**
- "Avoid god objects"
- "Don't couple services tightly"
- "No circular dependencies"
- "Avoid shared database across services"

**Examples:**
```
✅ "Never create god classes"
✅ "Services must be loosely coupled"
✅ "No bidirectional dependencies"
✅ "Each service owns its data"
```

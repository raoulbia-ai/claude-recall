# Build & Deploy Patterns

Patterns for capturing build processes, CI/CD pipelines, and deployment strategies.

## Build Process Examples

**Automatically Captured:**
- "Build with npm run build"
- "Compile TypeScript with tsc"
- "Bundle with Webpack"
- "Use Vite for fast builds"
- "Maven for Java builds"

**Stored As:**
```json
{
  "type": "devops",
  "category": "build_deploy",
  "value": "npm run build",
  "confidence": 0.85
}
```

## CI/CD Pipeline Examples

**Automatically Captured:**
- "CI/CD pipeline uses GitHub Actions"
- "Jenkins runs build and test"
- "GitLab CI for automated deployment"
- "CircleCI for continuous integration"
- "Azure Pipelines for builds"

**Examples:**
```
✅ "GitHub Actions for CI/CD"
✅ "Jenkins pipeline builds and deploys"
✅ "GitLab CI runs tests on every push"
✅ "CircleCI for test automation"
```

## Deployment Strategy Examples

**Automatically Captured:**
- "Deploy using Docker"
- "Run with docker-compose up"
- "Kubernetes for orchestration"
- "Deploy to AWS ECS"
- "Vercel for frontend deployment"

**Examples:**
```
✅ "Deploy Docker containers to ECS"
✅ "Kubernetes manifests in k8s/ directory"
✅ "Frontend deploys to Vercel on merge"
✅ "Backend on AWS Lambda"
```

## Build Optimization

**Automatically Captured:**
- "Use build cache for faster builds"
- "Multi-stage Docker builds"
- "Parallel test execution"
- "Incremental TypeScript compilation"

**Examples:**
```
✅ "Docker layer caching in CI"
✅ "Multi-stage builds for smaller images"
✅ "Parallel Jest tests with --maxWorkers"
✅ "Turborepo for monorepo builds"
```

## Deployment Environments

**Automatically Captured:**
- "Deploy to staging first, then production"
- "Development environment on local Docker"
- "Staging mirrors production setup"
- "Production on AWS us-east-1"

**Examples:**
```
✅ "Dev → Staging → Production pipeline"
✅ "Staging uses production-like data"
✅ "Production deploys require manual approval"
✅ "Canary deployment to 10% of users"
```

## Container & Orchestration

**Automatically Captured:**
- "Docker images tagged with commit SHA"
- "Push images to ECR"
- "Kubernetes deployments use rolling updates"
- "Helm charts for application deployment"

**Examples:**
```
✅ "Docker images: repo/app:commit-sha"
✅ "Images pushed to Docker Hub"
✅ "K8s rolling updates with 25% max surge"
✅ "Helm for templated deployments"
```

## Release Management

**Automatically Captured:**
- "Semantic versioning for releases"
- "Tag releases in git"
- "Automated changelog generation"
- "Release notes from PR descriptions"

**Examples:**
```
✅ "Follow semver (1.2.3)"
✅ "Git tags trigger release workflow"
✅ "Changelog from conventional commits"
✅ "Release notes auto-generated"
```

## Rollback Strategies

**Automatically Captured:**
- "Keep last 3 deployments for rollback"
- "Automated rollback on health check failure"
- "Blue-green deployments for instant rollback"
- "Database migrations are reversible"

**Examples:**
```
✅ "Rollback to previous deployment if errors spike"
✅ "Blue-green allows instant rollback"
✅ "Keep 5 previous Docker images"
✅ "Migrations have down() method"
```

## Build Artifacts

**Automatically Captured:**
- "Build artifacts in dist/ directory"
- "Upload build to S3"
- "Store artifacts for 30 days"
- "Publish npm package on release"

**Examples:**
```
✅ "Build output to dist/, ignore in git"
✅ "CI uploads artifacts to S3"
✅ "npm publish on version tag"
✅ "Docker images are build artifacts"
```

## Environment Variables

**Automatically Captured:**
- "Environment variables from .env"
- "Secrets stored in AWS Secrets Manager"
- "CI gets env vars from GitHub Secrets"
- "Production config in Kubernetes ConfigMap"

**Examples:**
```
✅ ".env for local, Secrets Manager for prod"
✅ "CI variables in GitHub repository settings"
✅ "K8s ConfigMap for non-sensitive config"
✅ "Never commit .env files"
```

## Complex Deployment Pipeline Example

**User States:**
```
"Our deployment pipeline:
1. Developer pushes to feature branch
2. GitHub Actions runs:
   - Lint code
   - Run unit tests
   - Run integration tests
   - Build Docker image
   - Scan image for vulnerabilities
3. On merge to main:
   - Tag image with commit SHA
   - Push to ECR
   - Deploy to staging automatically
   - Run E2E tests in staging
4. Manual approval for production
5. Deploy to production (blue-green)
6. Monitor error rates for 30 minutes
7. Auto-rollback if errors exceed threshold"
```

**Store Manually for Multi-Step:**
```javascript
mcp__claude-recall__store_memory({
  content: `Deployment pipeline:
1. Push to feature branch
2. CI runs lint, test, build, scan
3. On main merge:
   - Tag image (commit SHA)
   - Push to ECR
   - Auto-deploy to staging
   - Run E2E tests
4. Manual approval for prod
5. Blue-green deployment
6. Monitor 30 min
7. Auto-rollback if errors spike`,
  metadata: {
    type: "devops",
    category: "build_deploy",
    steps: 7,
    strategy: "blue-green",
    monitoring: "30min"
  }
})
```

## Infrastructure as Code

**Automatically Captured:**
- "Terraform for infrastructure"
- "CloudFormation templates in infra/"
- "Pulumi for cloud resources"
- "Ansible for server configuration"

**Examples:**
```
✅ "Terraform manages AWS infrastructure"
✅ "CloudFormation stacks in infra/cf/"
✅ "Pulumi for multi-cloud deployment"
✅ "Ansible playbooks for provisioning"
```

## Deployment Validation

**Automatically Captured:**
- "Smoke tests after deployment"
- "Health checks before switching traffic"
- "Validate migrations before deploy"
- "Database backup before production deploy"

**Examples:**
```
✅ "Run smoke tests post-deployment"
✅ "/health must return 200 before cutover"
✅ "Migrations tested in staging first"
✅ "Auto-backup DB before prod deploy"
```

## Build Dependencies

**Automatically Captured:**
- "Node.js 18 required for build"
- "Build requires Docker buildx"
- "Maven 3.8+ for Java builds"
- "Python 3.11 and pip for build tools"

**Examples:**
```
✅ "Build requires Node 18 and pnpm"
✅ "Docker buildx for multi-platform images"
✅ "Go 1.21+ for compilation"
✅ "Rust toolchain with cargo"
```

## Confidence Boosters

These keywords increase confidence for build/deploy patterns:

- **Strong**: "always", "automated", "pipeline"
- **Tools**: "Docker", "Kubernetes", "Jenkins", "GitHub Actions"
- **Actions**: "build", "deploy", "release", "push"
- **Environments**: "staging", "production", "development"

**Example:**
- "use Docker" → 65% confidence
- "deploy with Docker" → 80% confidence
- "automated deployment using Docker containers" → 92% confidence
- "CI/CD pipeline builds Docker images and deploys to Kubernetes" → 96% confidence

## What Won't Be Captured

❌ "Maybe use Docker" (uncertain)
❌ "Should we deploy with Jenkins?" (question)
❌ "Consider CI/CD" (vague)
❌ "Docker might work" (uncertain)

**Make it explicit:**
✅ "Deploy with Docker"
✅ "Use Jenkins for CI/CD"
✅ "GitHub Actions runs builds"
✅ "Kubernetes for orchestration"

## Deployment Anti-Patterns to Store

**Automatically Captured:**
- "Never deploy on Friday"
- "Don't skip staging environment"
- "Avoid manual production deployments"
- "No deployments during business hours"

**Examples:**
```
✅ "Never deploy Friday afternoon"
✅ "All changes go through staging first"
✅ "Automate all deployments"
✅ "Deploy outside peak hours"
```

## Monitoring & Observability

**Automatically Captured:**
- "Monitor deployments with Datadog"
- "Application logs to CloudWatch"
- "Metrics tracked in Prometheus"
- "Distributed tracing with Jaeger"

**Examples:**
```
✅ "Datadog for application monitoring"
✅ "Structured logs to ELK stack"
✅ "Prometheus + Grafana for metrics"
✅ "OpenTelemetry for tracing"
```

## Post-Deployment

**Automatically Captured:**
- "Notify team in Slack after deploy"
- "Create deploy tracking ticket"
- "Update deployment log"
- "Run database migrations after deploy"

**Examples:**
```
✅ "Slack notification on production deploy"
✅ "JIRA ticket for deployment tracking"
✅ "Migrations run automatically"
✅ "Post-deploy smoke tests"
```

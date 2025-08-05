# Release Process for Claude Recall

## Overview
This document outlines the process for creating public releases from the private development repository.

## Repository Structure
- **Private**: `claude-recall-dev` - All development work
- **Public**: `claude-recall` - Clean, public releases only

## Release Steps

### 1. Prepare Release Branch
```bash
# From main branch with all features ready
git checkout main
git checkout -b release/vX.Y.Z
```

### 2. Clean Development Files
The following are automatically excluded by .gitignore-dev:
- `test-*.{ts,js,sh,md}` files
- `demo-*.ts` and `debug-*.ts` files
- Log files and test artifacts
- Test directories (test-final/, tests-arlo/, etc.)

Additional manual cleanup:
- Remove internal documentation (STAGE*.md, task-phase-*.md)
- Remove swarm-tasks/ directory
- Remove .claude-flow/ directory
- Remove settings/ and config/ directories
- Remove any .example.json files

### 3. Update Public Files
```bash
# Copy public versions (keep these in a /public folder on main)
cp public/README-public.md README.md
cp public/.gitignore-public .gitignore
cp public/LICENSE LICENSE
```

### 4. Update Version
```bash
# Update package.json version
npm version patch/minor/major
```

### 5. Build and Test
```bash
npm run build
npm test
```

### 6. Commit Clean Version
```bash
git add -A
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
```

### 7. Push to Public Repository
```bash
# Add public remote if not already added
git remote add public https://github.com/raoulbia-ai/claude-recall.git

# Push release branch to public main
git push public release/vX.Y.Z:main --force
git push public vX.Y.Z  # Push tag
```

### 8. Create GitHub Release
1. Go to https://github.com/raoulbia-ai/claude-recall/releases
2. Click "Create a new release"
3. Select the version tag
4. Add release notes
5. Publish release

### 9. Publish to NPM (optional)
```bash
npm publish
```

## Important Notes
- NEVER push development branches to public repo
- Always test the clean build before pushing
- Keep public README focused on users, not developers
- Maintain version consistency across package.json and git tags
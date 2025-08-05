#!/bin/bash

# Claude Recall Publishing Script
# This script publishes to npm and pushes to the public GitHub repository

set -e  # Exit on error

echo "🚀 Claude Recall Publishing Script"
echo "=================================="

# Check if we're in the project directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must be run from the project directory"
    exit 1
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📦 Current version: $CURRENT_VERSION"

# Check if version argument provided
if [ -z "$1" ]; then
    echo "❌ Error: Please provide version type (patch, minor, major) or specific version"
    echo "Usage: ./scripts/publish.sh [patch|minor|major|x.x.x]"
    exit 1
fi

# Update version
echo "📝 Updating version..."
npm version $1 --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "✅ New version: $NEW_VERSION"

# Run tests
echo "🧪 Running tests..."
npm test

# Build the project
echo "🔨 Building project..."
npm run build

# Publish to npm
echo "📤 Publishing to npm..."
npm publish

# Update package.json in public repo
echo "📋 Updating package.json version in workspace..."
cd ..
git add project/package.json
git commit -m "Release v$NEW_VERSION"

# Push to public repository
echo "🌐 Pushing to public GitHub repository..."
git subtree push --prefix=project public main

# Create and push tag
echo "🏷️  Creating git tag..."
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
git push public "v$NEW_VERSION"

echo "✅ Successfully published claude-recall v$NEW_VERSION!"
echo ""
echo "📌 Post-publish checklist:"
echo "  - Check npm: https://www.npmjs.com/package/claude-recall"
echo "  - Check GitHub: https://github.com/raoulbia-ai/claude-recall"
echo "  - Create GitHub release notes if needed"
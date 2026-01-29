#!/bin/bash

set -e  # Exit immediately on error

echo "🔨 Starting build and package..."

echo "📦 Cleaning old build artifacts..."
rm -rf out
rm -f *.vsix

if [ ! -d "node_modules" ]; then
  echo "📥 Installing dependencies..."
  npm ci
fi

echo "🔍 Running lint checks..."
npm run lint

echo "⚙️  Building production bundle..."
npm run build:prod

echo "📦 Packaging VSIX..."
npm run package

VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="antigravity-cockpit-${VERSION}.vsix"

if [ -f "$VSIX_FILE" ]; then
  echo "✅ Packaged: $VSIX_FILE"
  ls -lh "$VSIX_FILE"
else
  echo "❌ Package failed: $VSIX_FILE not found"
  exit 1
fi

echo "🎉 Build and package complete!"

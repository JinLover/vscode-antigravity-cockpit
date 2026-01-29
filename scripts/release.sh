#!/bin/bash


set -e

if [ -n "$1" ]; then
    VERSION=$1
    echo "📝 Updating version to: ${VERSION}"
    
    if ! git diff-index --quiet HEAD --; then
        echo "⚠️  Uncommitted changes detected. Commit or stash first."
        git status --short
        exit 1
    fi
    
    sed -i '' "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" package.json
    
    git add package.json
    git commit -m "chore: bump version to ${VERSION}"
else
    VERSION=$(node -p "require('./package.json').version")
    echo "📌 Using current version: ${VERSION}"
fi

TAG="v${VERSION}"

echo ""
echo "🚀 Starting release flow: ${VERSION}"
echo ""

echo "🧹 Cleaning old build artifacts..."
rm -rf out
rm -f *.vsix

echo "🔍 Running lint checks..."
npm run lint

echo "⚙️  Building production bundle..."
npm run build:prod

echo "📦 Packaging VSIX..."
npm run package

VSIX_FILE="antigravity-cockpit-${VERSION}.vsix"
if [ ! -f "$VSIX_FILE" ]; then
    echo "❌ Error: $VSIX_FILE not found"
    exit 1
fi

echo "✅ Packaged: $VSIX_FILE ($(ls -lh "$VSIX_FILE" | awk '{print $5}'))"
echo ""

if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "⚠️  Tag ${TAG} already exists; skipping creation"
else
    echo "🏷️  Creating tag: ${TAG}..."
    git tag -a "${TAG}" -m "Release ${VERSION}"
fi

echo "🚀 Pushing to GitHub..."
git push origin main
git push origin "${TAG}"

echo ""
echo "✅ Release process started!"
echo ""
echo "📊 Track release progress:"
echo "   https://github.com/jlcodes99/vscode-antigravity-cockpit/actions"
echo ""
echo "📦 Release artifacts:"
echo "   https://open-vsx.org/extension/jlcodes/antigravity-cockpit"
echo ""
echo "💡 Note: GitHub Actions will:"
echo "   - Publish to GitHub Releases"
echo "   - Publish to Open VSX Registry"

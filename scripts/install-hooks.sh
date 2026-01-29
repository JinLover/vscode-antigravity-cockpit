#!/bin/bash

set -e

HOOKS_DIR=".git/hooks"
SCRIPTS_DIR="scripts"

echo "🔧 Installing Git hooks..."

cat > "$HOOKS_DIR/pre-push" << 'EOF'
#!/bin/bash

while read local_ref local_sha remote_ref remote_sha
do
  if [[ "$remote_ref" =~ refs/tags/v.* ]]; then
    echo "🏷️  Tag push detected: $remote_ref"
    echo "⚠️  Make sure you ran 'npm run release' for the latest package"
    
    VERSION=$(node -p "require('./package.json').version")
    VSIX_FILE="antigravity-cockpit-${VERSION}.vsix"
    
    if [ ! -f "$VSIX_FILE" ]; then
      echo "❌ Error: $VSIX_FILE not found"
      echo "💡 Run: npm run release"
      exit 1
    fi
    
    echo "✅ Found VSIX: $VSIX_FILE"
  fi
done

exit 0
EOF

chmod +x "$HOOKS_DIR/pre-push"

echo "✅ Git hooks installed!"
echo ""
echo "Installed hooks:"
echo "  - pre-push: check VSIX exists before tag push"
echo ""
echo "💡 Usage:"
echo "  1. Bump version: npm version patch/minor/major"
echo "  2. Package release: npm run release"
echo "  3. Push: git push && git push --tags"

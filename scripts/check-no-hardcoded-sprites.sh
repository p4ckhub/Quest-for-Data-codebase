#!/bin/bash
# Check for hardcoded colors/emoji/paths in ui/src (except sprites.tsx and theme files)
# Follows §9.3: Zero hardcoded colors/emoji/paths in components

set -e

echo "Checking for hardcoded sprites in ui/src..."

# Patterns to find (hex colors, emoji, paths)
PATTERNS=(
    '"#[0-9a-fA-F]\{3,\}"'
    '"[❤️🧡💛💚💙💜🖤🤍🤎]"
    '"/.*\.(png|jpg|jpeg|gif|svg)"
)

FOUND_VIOLATIONS=0

for pattern in "${PATTERNS[@]}"; do
    # Find matches excluding sprites.tsx and theme.css
    matches=$(grep -r -E "$pattern" ui/src/ 2>/dev/null | grep -v 'sprites.tsx' | grep -v 'theme.css' || true)
    
    if [ -n "$matches" ]; then
        echo "WARNING: Potential hardcoded pattern found:"
        echo "$matches"
        FOUND_VIOLATIONS=$((FOUND_VIOLATIONS + 1))
    fi
done

if [ $FOUND_VIOLATIONS -gt 0 ]; then
    echo ""
    echo "ERROR: Found $FOUND_VIOLATIONS hardcoded sprite patterns in ui/src/"
    echo "All colors, emoji, and paths must come from content/sprites.json"
    exit 1
fi

echo "No hardcoded sprites found. All good!"
exit 0

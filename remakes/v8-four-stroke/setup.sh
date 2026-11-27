#!/usr/bin/env bash
# Fetch the teardown kit (MIT) at the commit this remake was matched against,
# drop the remake's script and score into it, install deps and build the page.
#   bash setup.sh [WORKDIR]       (default ./work)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$HERE/work}"
COMMIT=a91262ac1109051e014662d42ecb0b7bc1f113b1

if [ ! -d "$WORK/teardown/.git" ]; then
  git clone https://github.com/elvarofficial/teardown.git "$WORK/teardown"
fi
cd "$WORK/teardown"
git fetch --depth 1 origin "$COMMIT" 2>/dev/null || true
git checkout -q "$COMMIT"

cp "$HERE/src/v8-shared/film_post.js" "$HERE/src/v8-shared/score_post.py" sims/v8-shared/
mkdir -p sims/v8-post
cp "$HERE/src/v8-post/main.js" "$HERE/src/v8-post/timeline.json" sims/v8-post/

# Uses a pre-installed Chromium if CHROMIUM is set; otherwise downloads one.
if [ -n "${CHROMIUM:-}" ]; then
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund
else
  npm install --no-audit --no-fund && npx playwright install chromium
fi
node sims/build.mjs v8-post
echo "built: $WORK/teardown/teardown-out/dist/v8-post.html"

#!/bin/bash
# launchd(com.keibaapp.shutubawatch.plist)から毎日呼ばれる想定のラッパー。
# launchdはPATHをほぼ空の状態で起動するため、Homebrewのnpm/nodeを明示的に通す。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/../.."
npm run sync:netkeiba:shutuba-watch -- --env-file .env.local

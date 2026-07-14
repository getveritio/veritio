#!/usr/bin/env bash
#
# Publishes the release trio — @veritio/core, @veritio/storage,
# @veritio/claude-code — in dependency order. Run AFTER the release commit
# (version bumps + exact claude-code pins + bun.lock + CHANGELOG) is merged.
#
# Requires NPM_TOKEN: a SHORT-LIVED npm automation token supplied by the
# operator at run time. It is passed to bun via NPM_CONFIG_TOKEN only for the
# publish commands and never written to disk. `bun publish` also rewrites
# storage's `workspace:*` dependency on @veritio/core to the concrete version,
# which plain `npm publish` would ship broken.
#
# Usage: NPM_TOKEN=npm_xxx scripts/release-npm.sh

set -euo pipefail

: "${NPM_TOKEN:?Set NPM_TOKEN to a short-lived npm automation token}"

cd "$(git rev-parse --show-toplevel)"

echo "release-npm: running the full verify gate first" >&2
bun run verify

for pkg in sdks/typescript storage adapters/claude-code; do
  name="$(node -p "require('./${pkg}/package.json').name")"
  version="$(node -p "require('./${pkg}/package.json').version")"
  echo "release-npm: publishing ${name}@${version}" >&2
  (cd "$pkg" && NPM_CONFIG_TOKEN="$NPM_TOKEN" bun publish --access public)
done

echo "release-npm: verifying the registry sees the new versions" >&2
for name in core storage claude-code; do
  echo "@veritio/${name}: $(npm view "@veritio/${name}" version)"
done

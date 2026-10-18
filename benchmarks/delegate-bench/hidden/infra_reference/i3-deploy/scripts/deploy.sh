#!/bin/bash
# Deploys a release of the shop app: unpacks build/shop-<tag>.tar.gz into $DEPLOY_ROOT/releases/<tag>,
# points $DEPLOY_ROOT/current at it and restarts the service.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <release-tag>" >&2
  exit 2
fi

DEPLOY_ROOT=${DEPLOY_ROOT:-/srv/shop}
TAG=$1
KEEP=5

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

tar -xzf "build/shop-$TAG.tar.gz" -C "$TMP"
mkdir -p "$DEPLOY_ROOT/releases/$TAG"
cp -R "$TMP"/. "$DEPLOY_ROOT/releases/$TAG/"
ln -sfn "$DEPLOY_ROOT/releases/$TAG" "$DEPLOY_ROOT/current"
systemctl restart shop-app
echo "deployed $TAG"

# Keep the newest $KEEP releases, never the current one.
current=$(basename "$(readlink "$DEPLOY_ROOT/current")")
count=0
while IFS= read -r release; do
  count=$((count + 1))
  name=$(basename "$release")
  if [ "$count" -gt "$KEEP" ] && [ "$name" != "$current" ]; then
    rm -rf "${release:?}"
  fi
done < <(ls -1dt "$DEPLOY_ROOT"/releases/*/)

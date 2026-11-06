#!/usr/bin/env sh
# Runs gitleaks with the repository config. Uses a local binary when present,
# otherwise the pinned container image. Fails when neither is available, so a
# missing scanner never lets a commit through silently.
#
#   scripts/privacy/gitleaks.sh staged     scan the staged diff (pre-commit)
#   scripts/privacy/gitleaks.sh unpushed   scan commits not on a remote yet (pre-push)
#   scripts/privacy/gitleaks.sh history    scan the full history (CI)
set -eu

GITLEAKS_VERSION="v8.30.1"
root="$(git rev-parse --show-toplevel)"
cd "$root"

case "${1:-}" in
  staged) set -- git --pre-commit --staged ;;
  unpushed) set -- git --log-opts="--branches --not --remotes" ;;
  history) set -- git ;;
  *) echo "usage: gitleaks.sh staged|unpushed|history" >&2; exit 2 ;;
esac

common="--config=.gitleaks.toml --redact --no-banner --exit-code=1"

bin="${GITLEAKS_BIN:-}"
if [ -z "$bin" ] && command -v gitleaks >/dev/null 2>&1; then
  bin="gitleaks"
fi

if [ -n "$bin" ]; then
  # shellcheck disable=SC2086
  exec "$bin" "$@" $common .
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  exec docker run --rm -v "$root:/repo" -w /repo "ghcr.io/gitleaks/gitleaks:${GITLEAKS_VERSION}" "$@" $common /repo
fi

echo "gitleaks: not installed and Docker is not available. Install gitleaks ${GITLEAKS_VERSION} (see docs/privacy-guard.md)." >&2
exit 1

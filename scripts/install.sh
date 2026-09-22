#!/bin/sh
# One-line installer: download the bundle as a tarball (no git clone) and install it
# into a project's .takt/ with scripts/use-lang.sh.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ideo-plus/takt-workflows/main/scripts/install.sh \
#     | sh -s -- <en|ja> [project-dir] [--no-runtime] [--ref <branch|tag|commit>]
#
#   --ref defaults to "main". TAKT_WORKFLOWS_REF may be used instead of --ref.
#   Everything else is passed through to scripts/use-lang.sh.
#
# Requires curl and tar. The download goes to a temporary directory that is removed afterwards,
# so nothing is cloned into the project (a git clone inside a repository would become an
# embedded repository that git does not track).
set -eu

repo="ideo-plus/takt-workflows"
ref="${TAKT_WORKFLOWS_REF:-main}"
args=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) [ $# -ge 2 ] || { echo "--ref needs a value" >&2; exit 2; }; ref="$2"; shift 2 ;;
    --ref=*) ref="${1#--ref=}"; shift ;;
    *) args="$args \"$1\""; shift ;;
  esac
done

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 2; }
command -v tar  >/dev/null 2>&1 || { echo "tar is required" >&2; exit 2; }

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t takt-workflows)"
trap 'rm -rf "$tmp"' EXIT INT TERM

url="https://codeload.github.com/${repo}/tar.gz/${ref}"
echo "downloading ${repo}@${ref}"
curl -fsSL "$url" -o "$tmp/bundle.tgz" || { echo "download failed: ${url} (does the ref \"${ref}\" exist?)" >&2; exit 1; }
tar -xzf "$tmp/bundle.tgz" -C "$tmp"
rm -f "$tmp/bundle.tgz"
bundle="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -n "$bundle" ] && [ -x "$bundle/scripts/use-lang.sh" ] || { echo "unexpected archive layout for ${repo}@${ref}" >&2; exit 1; }

TAKT_WORKFLOWS_SOURCE="https://github.com/${repo}" TAKT_WORKFLOWS_VERSION="$ref" \
  eval "\"$bundle/scripts/use-lang.sh\" $args"

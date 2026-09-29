#!/bin/sh
# プロジェクト内設定と指定した Codex アカウントで TAKT を起動する。
#
#   scripts/run-codex.sh --codex-account <設定ディレクトリ> [takt の引数...]
#   引数を省略すると、最新の失敗/中断 run を resume する。
# カレントディレクトリを対象プロジェクトとし、provider/model はその runtime.yaml に従う。
set -eu

usage() {
    echo "usage: scripts/run-codex.sh --codex-account <設定ディレクトリ> [takt の引数...]" >&2
    exit 2
}

[ "$#" -ge 2 ] || usage
[ "$1" = "--codex-account" ] || usage
account_dir=$2
shift 2

if [ ! -d "$account_dir" ]; then
    echo "run-codex: Codex の設定ディレクトリがない: $account_dir" >&2
    exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(pwd -P)
TAKT_CODEX_CLI_PATH=$script_dir/takt-codex.sh
TAKT_CODEX_ACCOUNT_DIR=$(CDPATH= cd -- "$account_dir" && pwd)
TAKT_CONFIG_DIR=$project_dir/.takt/home
CODEX_HOME=$TAKT_CODEX_ACCOUNT_DIR
unset OPENAI_API_KEY CODEX_API_KEY TAKT_OPENAI_API_KEY
export TAKT_CODEX_CLI_PATH TAKT_CODEX_ACCOUNT_DIR TAKT_CONFIG_DIR CODEX_HOME

if [ "$#" -eq 0 ]; then
    set -- resume
fi

echo "run-codex: Codex の設定: $TAKT_CODEX_ACCOUNT_DIR" >&2
echo "run-codex: TAKT_CONFIG_DIR: $TAKT_CONFIG_DIR" >&2
exec "${TAKT_REAL_CLI:-takt}" "$@"

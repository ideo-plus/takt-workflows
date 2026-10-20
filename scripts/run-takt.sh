#!/bin/sh
# TAKT を、claude と codex のアカウントを指定して起動する。
#
#   .takt/bin/run-takt.sh --claude-account <設定ディレクトリ> --codex-account <設定ディレクトリ> [takt の引数...]
#   例: .takt/bin/run-takt.sh --claude-account ~/.claude-work --codex-account ~/.codex-work --pipeline --auto-pr -b fix/x -i 9 --workflow flash-default
#   (インストーラがプロジェクトの .takt/bin/ に置く。takt-workflows のリポジトリの中では scripts/run-takt.sh)
#
# runtime.yaml は 1 回の実行で claude と codex の両方を使う。TAKT_CLAUDE_CLI_PATH にこのスクリプトと同じ
# ディレクトリの takt-claude.sh、TAKT_CODEX_CLI_PATH に takt-codex.sh を絶対パスで渡し、TAKT が起動する claude と codex を、
# それぞれ指定したアカウント (CLAUDE_CONFIG_DIR、CODEX_HOME) で動かす。
# アカウントの上限に当たったときに、別のアカウントへ切り替えて再開するために使う。アカウントの名前は
# マシンごとの事情なので、リポジトリには書かず、起動のたびに指定する。TAKT の設定はカレントディレクトリの
# プロジェクトの .takt/home から読む (TAKT_CONFIG_DIR)。アカウントの指定の後ろの引数は、そのまま takt に渡す。
set -eu

usage() {
    echo "usage: $0 --claude-account <設定ディレクトリ> --codex-account <設定ディレクトリ> [takt の引数...]" >&2
    exit 2
}

claude_account=
codex_account=
while [ "$#" -gt 0 ]; do
    case $1 in
        --claude-account)
            [ "$#" -ge 2 ] || usage
            claude_account=$2
            shift 2
            ;;
        --codex-account)
            [ "$#" -ge 2 ] || usage
            codex_account=$2
            shift 2
            ;;
        *)
            break
            ;;
    esac
done
[ -n "$claude_account" ] || usage
[ -n "$codex_account" ] || usage

if [ ! -d "$claude_account" ]; then
    echo "run-takt: claude のアカウント設定ディレクトリがない: $claude_account" >&2
    exit 1
fi
if [ ! -d "$codex_account" ]; then
    echo "run-takt: Codex の設定ディレクトリがない: $codex_account" >&2
    exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(pwd -P)

resolve_cli() (
    cli_name=$1
    cli_candidate=$2
    if ! cli_path=$(command -v "$cli_candidate"); then
        echo "run-takt: $cli_name CLI が見つからない: $cli_candidate" >&2
        exit 1
    fi
    case $cli_path in
        /*) ;;
        *) cli_path=$project_dir/$cli_path ;;
    esac
    if [ ! -f "$cli_path" ] || [ ! -x "$cli_path" ]; then
        echo "run-takt: $cli_name CLI を実行できない: $cli_path" >&2
        exit 1
    fi
    cli_dir=$(CDPATH= cd -- "$(dirname -- "$cli_path")" && pwd -P)
    printf '%s/%s\n' "$cli_dir" "$(basename -- "$cli_path")"
)

cli_version() {
    if ! version_output=$("$1" --version </dev/null 2>&1); then
        echo "run-takt: CLI の版を取得できない: $1 ($version_output)" >&2
        return 1
    fi
    if [ -z "$version_output" ]; then
        echo "run-takt: CLI の版が空: $1" >&2
        return 1
    fi
    printf '%s\n' "$version_output"
}

TAKT_CLAUDE_REAL_CLI=$(resolve_cli claude "${TAKT_CLAUDE_REAL_CLI:-claude}")
TAKT_CODEX_REAL_CLI=$(resolve_cli codex "${TAKT_CODEX_REAL_CLI:-codex}")
claude_version=$(cli_version "$TAKT_CLAUDE_REAL_CLI")
codex_version=$(cli_version "$TAKT_CODEX_REAL_CLI")
# Claude Opus 5.5 requires Claude Code 2.1.280 or later. The version is the first X.Y.Z
# (optionally prefixed with v) anywhere in the output, so "v2.1.290" and "claude 2.1.290" pass too.
if ! printf '%s\n' "$claude_version" | awk '
    {
        if (line == "" && match($0, /(^|[^0-9])v?[0-9]+\.[0-9]+\.[0-9]+([^0-9.]|$)/)) {
            line = substr($0, RSTART, RLENGTH)
            sub(/[^0-9]*$/, "", line)
            sub(/^[^0-9]*/, "", line)
        }
    }
    END {
        if (line == "") exit 1
        split(line, v, ".")
        exit !(v[1] > 2 || (v[1] == 2 && (v[2] > 1 || (v[2] == 1 && v[3] >= 280))))
    }
'; then
    echo "run-takt: claude 2.1.280 以上が必要 (取得した版: $claude_version)" >&2
    exit 1
fi
TAKT_CLAUDE_CLI_PATH=$script_dir/takt-claude.sh
TAKT_CLAUDE_ACCOUNT_DIR=$(CDPATH= cd -- "$claude_account" && pwd)
TAKT_CODEX_CLI_PATH=$script_dir/takt-codex.sh
TAKT_CODEX_ACCOUNT_DIR=$(CDPATH= cd -- "$codex_account" && pwd)
TAKT_CONFIG_DIR=$project_dir/.takt/home
CODEX_HOME=$TAKT_CODEX_ACCOUNT_DIR
# 認証・提供元・接続先・モデルを上書きする変数。入口のスクリプト (takt-claude.sh、takt-codex.sh) が
# claude と codex を起動する前に外すものを、TAKT の環境からも外す。TAKT 自身や、入口のスクリプトを
# 通らないツール (版と更新の確認など) がこれらを使い、指定したアカウントではなくそちらで動くため。
# TAKT の API key も、指定したアカウントの認証より優先されるので含める。
OVERRIDES='CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_USE_BEDROCK
    CLAUDE_CODE_USE_VERTEX ANTHROPIC_PROFILE ANTHROPIC_FEDERATION_RULE_ID ANTHROPIC_ORGANIZATION_ID ANTHROPIC_WORKSPACE_ID
    CLAUDE_CODE_USE_ANTHROPIC_AWS CLAUDE_CODE_USE_FOUNDRY CLAUDE_CODE_USE_MANTLE ANTHROPIC_BASE_URL
    ANTHROPIC_AWS_BASE_URL ANTHROPIC_BEDROCK_BASE_URL ANTHROPIC_BEDROCK_MANTLE_BASE_URL ANTHROPIC_FOUNDRY_BASE_URL
    ANTHROPIC_VERTEX_BASE_URL ANTHROPIC_CUSTOM_HEADERS ANTHROPIC_MODEL ANTHROPIC_DEFAULT_MODEL
    ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL
    ANTHROPIC_DEFAULT_FABLE_MODEL ANTHROPIC_SMALL_FAST_MODEL CLAUDE_CODE_SUBAGENT_MODEL
    CLAUDE_CODE_SUBAGENT_MODEL_FORCE TAKT_ANTHROPIC_API_KEY
    OPENAI_API_KEY CODEX_API_KEY OPENAI_BASE_URL CODEX_ACCESS_TOKEN OPENAI_IDENTITY_TOKEN_FILE
    OPENAI_FEDERATION_RULE_ID TAKT_OPENAI_API_KEY'
for override_name in $OVERRIDES; do
    unset "$override_name"
done
export TAKT_CLAUDE_CLI_PATH TAKT_CLAUDE_ACCOUNT_DIR TAKT_CODEX_CLI_PATH TAKT_CODEX_ACCOUNT_DIR TAKT_CONFIG_DIR CODEX_HOME
export TAKT_CLAUDE_REAL_CLI TAKT_CODEX_REAL_CLI

echo "run-takt: claude のアカウント設定: $TAKT_CLAUDE_ACCOUNT_DIR" >&2
echo "run-takt: Codex の設定: $TAKT_CODEX_ACCOUNT_DIR" >&2
echo "run-takt: claude CLI: $TAKT_CLAUDE_REAL_CLI ($claude_version)" >&2
echo "run-takt: Codex CLI: $TAKT_CODEX_REAL_CLI ($codex_version)" >&2
echo "run-takt: TAKT_CONFIG_DIR: $TAKT_CONFIG_DIR" >&2
# takt は、mise があれば mise exec で起動する。プロジェクトの mise.toml で固定した版を、mise が
# 有効でないシェルや IDE から呼ばれても使うため。TAKT_REAL_CLI (mise も含めて差し替える) と
# TAKT_REAL_MISE (mise だけを差し替える) はテストのための差し替え。
if [ -n "${TAKT_REAL_CLI:-}" ]; then
    exec "$TAKT_REAL_CLI" "$@"
elif command -v mise >/dev/null 2>&1; then
    # mise trust --show は、プロジェクトとその親ディレクトリの設定をすべて表示する。mise exec は、
    # 信頼していない設定が (親ディレクトリを含めて) あると止まるので、表示されたものがすべて
    # 信頼されているときだけ進む。止まるときは、どの設定を信頼していないかを示す。
    if ! mise_trust=$(cd -- "$project_dir" && mise trust --show); then
        echo "run-takt: mise の信頼状態を確認できない。プロジェクトで mise trust を実行してください: $project_dir" >&2
        exit 1
    fi
    mise_untrusted=$(printf '%s\n' "$mise_trust" | awk '
        !/: trusted$/ { sub(/: [^:]*$/, ""); line = line (line == "" ? "" : ", ") $0 }
        END { print line }
    ')
    if [ -n "$mise_untrusted" ] || [ -z "$mise_trust" ]; then
        echo "run-takt: mise の設定が信頼されていない ($mise_untrusted)。それぞれの場所で mise trust を実行してください: $project_dir" >&2
        exit 1
    fi
    if [ -n "${TAKT_REAL_MISE:-}" ]; then
        mise_path=$TAKT_REAL_MISE
    else
        mise_path=$(command -v mise)
    fi
    # mise はプロジェクトの設定の [env] を、呼び出し元の環境より優先して適用する。選んだアカウントと
    # 入口のスクリプトを指す変数と、外した上書きの変数が [env] で戻らないようにする。mise exec は
    # プロセスを置き換えるので、mise exec の後にシェルを動かすことはできない。代わりに、選んだ値と
    # 上書きの一覧を一時ファイルに書いておく。入口のスクリプト (takt-claude.sh、takt-codex.sh) は、
    # claude と codex を起動するときにこのファイルから読み直す。takt 自身は、PATH 上の takt への
    # 小さな入口 (run-takt-exec.sh) を通して動かし、そこでも同じファイルから外し直す。
    # mise exec はプロセスを置き換えるので trap は動かないことに注意する。
    state_dir=$(mktemp -d "${TMPDIR:-/tmp}/run-takt.XXXXXX")
    state=$state_dir/launch
    printf '%s\n' "$TAKT_CLAUDE_ACCOUNT_DIR" "$TAKT_CODEX_ACCOUNT_DIR" "$TAKT_CONFIG_DIR" "$CODEX_HOME" > "$state"
    for override_name in $OVERRIDES; do
        printf '%s\n' "$override_name" >> "$state.tmp"
    done
    export RUN_TAKT_CLAUDE_CLI_PATH=$TAKT_CLAUDE_CLI_PATH RUN_TAKT_CODEX_CLI_PATH=$TAKT_CODEX_CLI_PATH
    export RUN_TAKT_LAUNCH_STATE=$state
    exec mise exec -- sh -c '
        if command -v takt >/dev/null 2>&1; then
            takt_path=$(command -v takt)
        else
            takt_path=takt
        fi
        exec "$0" "$takt_path" "$@"
    ' "$script_dir/run-takt-exec.sh" "$@"
fi
# mise が無いのにプロジェクトが mise の設定を持つときは、固定した版でない takt を動かさないよう止める。
for mise_config in mise.toml .mise.toml mise.local.toml .mise.local.toml mise/config.toml .mise/config.toml \
    .config/mise.toml .config/mise/config.toml .tool-versions; do
    if [ -f "$project_dir/$mise_config" ]; then
        echo "run-takt: プロジェクトに mise の設定 ($mise_config) があるのに mise が見つからない。固定した版の takt を使うため、mise を入れてから実行してください: $project_dir" >&2
        exit 1
    fi
done
exec takt "$@"

#!/bin/sh
# TAKT の Codex SDK が起動する Codex CLI の入口。
# TAKT_CODEX_ACCOUNT_DIR でアカウントごとの CODEX_HOME を選ぶ。
set -eu

# mise exec を通したときは、プロジェクトの mise の設定の [env] が選んだアカウントを上書きし、
# 外した変数を戻していることがある。run-takt.sh が残した RUN_TAKT_LAUNCH_STATE の 2 行目の値を使う。
if [ -n "${RUN_TAKT_LAUNCH_STATE:-}" ] && [ -f "$RUN_TAKT_LAUNCH_STATE" ]; then
    TAKT_CODEX_ACCOUNT_DIR=$(sed -n '2p' "$RUN_TAKT_LAUNCH_STATE")
fi

account_dir=${TAKT_CODEX_ACCOUNT_DIR:-}
if [ -z "$account_dir" ]; then
    echo "takt-codex: TAKT_CODEX_ACCOUNT_DIR が必要です" >&2
    exit 1
fi
if [ ! -d "$account_dir" ]; then
    echo "takt-codex: Codex の設定ディレクトリがない: $account_dir" >&2
    exit 1
fi

# 選択した ChatGPT アカウントを確実に使う。API key が残っていると CODEX_HOME
# の OAuth 認証より優先されるため、明示的な account 選択時は取り除く。
# 接続先・トークン・外部認証の上書きも、CODEX_HOME のアカウントより優先されるため外す。
unset OPENAI_API_KEY CODEX_API_KEY OPENAI_BASE_URL CODEX_ACCESS_TOKEN OPENAI_IDENTITY_TOKEN_FILE OPENAI_FEDERATION_RULE_ID \
    TAKT_OPENAI_API_KEY
CODEX_HOME=$account_dir
export CODEX_HOME
TAKT_AGENT=1
export TAKT_AGENT
exec "${TAKT_CODEX_REAL_CLI:-codex}" "$@"

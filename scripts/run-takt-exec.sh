#!/bin/sh
# run-takt.sh が mise exec で takt を起動するときの入口 (PATH 上の takt の絶対パスを第 1 引数に受け取る)。
# mise がプロジェクトの設定の [env] で戻した上書きの変数を、RUN_TAKT_LAUNCH_STATE.tmp の一覧で外し直す。
# 選んだアカウントを指す変数は、入口のスクリプト (takt-claude.sh、takt-codex.sh) が
# RUN_TAKT_LAUNCH_STATE の 1、2 行目から読み直す。通常は同じディレクトリの run-takt.sh から使う。
set -eu

state=${RUN_TAKT_LAUNCH_STATE:-}
if [ -z "$state" ] || [ ! -f "$state.tmp" ]; then
    echo "run-takt-exec: 起動の状態ファイルがない: ${state:-<未指定>}.tmp" >&2
    exit 1
fi
if [ "$#" -lt 1 ]; then
    echo "run-takt-exec: takt のパスが指定されていない" >&2
    exit 1
fi
takt_path=$1
shift
# 1 行に 1 つずつ変数の名前を書いた一覧を、そのまま外す。
while IFS= read -r override_name || [ -n "$override_name" ]; do
    [ -n "$override_name" ] || continue
    unset "$override_name"
done < "$state.tmp"
exec "$takt_path" "$@"

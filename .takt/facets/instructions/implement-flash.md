Process the completion contract table in the plan (`plan.md`) from top to bottom, and finish implementation and verification one contract row at a time.
Refer only to the reports in the Report Directory named in the Workflow Context and to the upstream artifacts injected below. Do not search or read any other report directory.

**Handling a contract row:**
- Edit only the files listed in that row's 「実装箇所」 (implementation location) column.
- Run the verification command in that row's 「完了証拠」 (completion evidence) column and paste the command and its output verbatim into your result.
- Do not explore or edit files that are not listed in 「実装箇所」, do not investigate responsibility boundaries, do not root-cause pre-existing problems, and do not judge whether the plan is sound.

**When to stop and report:**
If a contract row lacks an 「実装箇所」 entry or a 「完了証拠」 verification command, or if running the verification command produces a result that contradicts the contract, stop working, report the following three items, and return need_replan.
1. The contract ID concerned
2. The command you ran and its output
3. What cannot be decided

**Completion check:**
Run the verification command of every contract row you changed. If any of them has not been run, return need_replan.

### Plan
{report:plan.md}

### Test report
{report:test-report.md}

**Change scope record (create when you start implementing):**
```markdown
# 変更スコープ宣言

## タスク
{one-line summary of the task}

## 変更予定
| 種別 | ファイル |
|------|---------|
| 作成 | `src/example.ts` |
| 変更 | `src/routes.ts` |

## 推定規模
Small / Medium / Large

## 影響範囲
- {affected modules or features}
```

**Required output (include these headings verbatim):**
## 作業結果
- {summary of what was done, per contract ID}
## 変更内容
- {summary of the changes}
## ビルド結果
- {build result}
## テスト結果
- {verification command and output for each contract row}

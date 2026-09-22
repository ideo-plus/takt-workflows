{extends:scenario-based-plan}

## Additional rules for Flash implementation

Implementation is done by a Flash-class model that processes only closed contract rows. The completion contract table and the implementation guidelines must satisfy the following.

- Always fill 「実装箇所」 (implementation location) in the completion contract table at file granularity. Vague entries such as "under consideration" or "the relevant place" are not allowed.
- Make 「完了証拠」 (completion evidence) a command that can be run as a single line.
- Never omit 「Coder 向け実装ガイドライン」 (implementation guidelines for the coder), even for small tasks. List the file:line of existing patterns to follow, the signatures of new functions, and every place that needs wiring.
- If one contract row would change more than 5 files, split the row.

---
name: close-posta
description: Run the controlled technical closing workflow for a completed Habit Tracker posta/task. Reconstruct Git state, verify scope/evidence/tests and — only under explicit human authorization — perform conditional stage+commit (Gate C) or fast-forward merge (Gate D).
argument-hint: "[status|pre-commit|commit|post-commit|pre-merge|merge|dry-run]"
disable-model-invocation: true
disallowed-tools: Write Edit
---

# Security
Never modify `.claude/settings.local.json`, global Claude configuration or
permission rules as part of closing a posta.

A blocked permission is reported as a blocker or required human authorization;
it is never solved by weakening the permission boundary.


# Close Posta — Habit Tracker

Execute the controlled closing procedure for the current posta/task.

This skill:

- verifies state;

- verifies scope;

- verifies evidence;

- coordinates Git checkpoints.

It does NOT:

- implement features;

- fix findings;

- make product decisions;

- modify production files;

- migrate user data.

It may stage/commit/merge only under the exact Gate C / Gate D rules below.

Always obey root `CLAUDE.md`.

---

# Active task contract

The active SPEC/task/posta defines:

- objective;

- scope;

- allowed files;

- invariants;

- acceptance criteria;

- required tests;

- explicit out-of-scope items.

If no formal SPEC exists, reconstruct the contract from:

1. explicit current human authorization;

2. `CLAUDE.md`;

3. `HABIT_TRACKER_AUDIT.md`.

Never invent missing product decisions.

If required scope is ambiguous:

STOP.

---

# Invocation

Supported modes:

- `status`

- `pre-commit`

- `commit`

- `post-commit`

- `pre-merge`

- `merge`

- `dry-run [commit|merge]`



`status`

Read-only state reconstruction.

`pre-commit`

Read-only Gate C preparation.

`commit`

Conditional Gate C stage + commit.

`post-commit`

Read-only verification of an existing commit.

`pre-merge`

Read-only Gate D preparation.

`merge`

Conditional Gate D fast-forward merge.

`dry-run`

Read-only simulation.

If mode is missing or ambiguous, ask.

Invocation itself is NOT authorization.

---

# State reconstruction

Always reconstruct actual state from Git first.

Never rely on:

- conversation memory;

- previous summaries;

- temp files;

- assumptions.

Use read-only commands such as:

- `git branch --show-current`

- `git log -1 --format=...`

- `git status --short --untracked-files=all`

- `git diff --cached --name-status`

- `git diff --name-only`

- `git merge-base <base> <feature>`

- `git merge-base --is-ancestor <base> <feature>`

- `git log --oneline <base>..<feature>`

- `git log --oneline <feature>..<base>`

- `git diff --name-status <base>...<feature>`

Classify into exactly one:

1. `sin-stage`

2. `staged-parcial`

3. `ya-commiteada`

4. `lista-para-merge`

5. `ya-mergeada`

If actual state does not cleanly fit one state:

STOP.



Never guess.



Never auto-correct Git state.



Never repeat an operation already shown as completed.



---



# Evidence



Evidence belongs to exact content.



Before commit:



tie evidence to the exact relevant working-tree content.



After commit:



tie evidence to commit SHA.



Document-only changes do not invalidate functional evidence if relevant code

did not change.



Changes to:



- production JavaScript;

- tests;

- persistence;

- migrations;

- import/export;

- service worker;

- relevant configuration



invalidate only the evidence associated with those changed areas.



State concretely what must be rerun and why.



Never reuse PASS evidence from an older implementation merely because the

change seems small.



Never rerun expensive or sensitive matrices ceremonially when exact validated

content is unchanged.



Never hide exit codes.



No polling.



No automatic retries.



---



# Pre-commit — read-only

Before accepting test evidence, verify that any disposable harness used to
produce it:

- tested the real production code rather than a copied reimplementation;
- did not modify production files as part of execution;
- used synthetic data unless Gate B explicitly authorized otherwise.

A harness that duplicates production logic is not sufficient evidence for
closing the posta.


1. Reconstruct state.

2. Confirm branch and HEAD.

3. Compare expected files against actually changed files.

4. Any unexpected file:

&#x20;  - report;

&#x20;  - do not stage;

&#x20;  - STOP if Gate C cannot be exact.

5. Run `git diff --check`.

6. Review current diff against:

&#x20;  - active task;

&#x20;  - `CLAUDE.md`;

&#x20;  - audit decisions;

&#x20;  - invariants;

&#x20;  - out-of-scope items.

7. Look for:

&#x20;  - missing implementation;

&#x20;  - unrelated refactor;

&#x20;  - accidental config change;

&#x20;  - personal data;

&#x20;  - `.db`/SQLite;

&#x20;  - exports/backups;

&#x20;  - secrets;

&#x20;  - generated test artifacts;

&#x20;  - dead code;

&#x20;  - absolute GitHub Pages paths;

&#x20;  - unexpected dependencies.

8. Determine required verification level using `CLAUDE.md`.

9. Confirm available evidence still corresponds to exact current code.

10. Invoke reviewer/tester only according to Gate A policy.

11. Emit report.


Never stage.



Never commit.



---



# Gate B awareness



This skill NEVER grants Gate B.



If closure depends on execution involving:



- real Loop `.db`;

- real personal exports;

- real import replace;

- localStorage → IndexedDB migration against actual user data;

- destructive storage operation;



report:



GATE B AUTHORIZATION REQUIRED



Do not execute it.



---



# Gate C authorization



`commit` requires authorization in the current request containing:



- expected current branch;

- exact paths;

- exact commit message.



Previous approval does not carry over automatically.



Example conceptually:



branch:

claude/habit-tracker



paths:

js/app.js

HABIT_TRACKER_AUDIT.md



message:

feat: corregir frecuencias y rachas por periodo



If any required piece is missing:



STOP.



Ask for it.



---



# Gate C — stage + commit



1. Reconstruct state.

2. Confirm state is compatible with commit.

3. Confirm branch equals authorized branch.

4. Confirm changed/untracked/staged files do not violate authorized scope.



Important:



An unrelated intentionally untracked file may exist only if the authorization

and project workflow explicitly establish that it must remain untouched.



Never silently include it.



5. Confirm evidence is valid.

6. Run read-only checks required by pre-commit.

7. If any precondition fails:



STOP.



Stage nothing.



8. Stage only exact authorized paths:



`git add -- <path1> <path2>`



Never:



- `git add .`

- `git add -A`

- `git add *`

- globs



9. Verify:



`git diff --cached --name-status`



must match authorized scope exactly.



10. Run:



`git diff --cached --check`



11. Create exactly one commit with the authorized message.



No:



- `--amend`;

- body not explicitly authorized;

- `Co-Authored-By`;

- `Claude-Session`;

- `Signed-off-by`;

- Claude metadata.



12. No push.



13. Immediately perform post-commit verification.



---



# Post-commit — read-only



Verify:



- current branch;

- new HEAD;

- exact commit message;

- files contained in commit;

- no unrelated files included;

- working tree;

- known untracked/manual files remain untouched;

- no push occurred.



Compare commit against approved scope.



Unexpected committed file:



STOP.



Report immediately.



---



# Pre-merge — read-only



Normal base for this repository:



main



If current task explicitly defines another base, use that.



Verify:



- working tree;

- feature branch;

- base;

- commit range;

- accumulated diff;

- accumulated file list;

- no unrelated commits;

- evidence still represents final branch;

- findings resolved;

- no pending HUMAN DECISION REQUIRED.



Do not rerun tests merely for ceremony.



Rerun only if relevant content changed or evidence became stale.



No merge.



---



# Gate D authorization



`merge` requires current human authorization with:



- base branch;

- feature branch.



Previous approval does not carry over.



---



# Gate D — fast-forward merge only



1. Reconstruct state.

2. Confirm working tree is clean.

3. Confirm current topology.

4. Confirm:



`git merge-base --is-ancestor <base> <feature>`



If base is not an ancestor:



STOP.



5. Show:



`git log --oneline <base>..<feature>`



and:



`git diff --name-status <base>...<feature>`



6. Confirm range matches approved scope.



Unexpected commit/file:



STOP.



7. Execute:



`git switch <base>`



then:



`git merge --ff-only <feature>`



No other merge strategy.



Never:



- rebase;

- cherry-pick;

- squash automatically;

- create merge commit;

- delete feature branch;

- push.



8. If fast-forward fails:



STOP.



Do not attempt another strategy.



9. Verify:



- base HEAD;

- feature HEAD;

- both point where expected;

- feature branch still exists;

- working tree clean;

- no push.



---



# Dry-run



`dry-run commit`



Runs every Gate C verification but never:



- stages;

- commits;

- modifies Git.



`dry-run merge`



Runs every Gate D verification but never:



- switches;

- merges;

- modifies Git.



Report exactly what would occur.



---



# Reviewer and tester integration



Reviewer:



- independent;

- read-only;

- no commands;

- no fixes.



Tester:



- adversarial;

- may execute approved tests;

- no production edits;

- no Git mutations.



Their findings return to implementer.



This skill never fixes findings.



BLOCKER/HIGH/product decision/scope expansion:



STOP human.



---



# Required compact report



Use only applicable blocks:



RESULTADO

ESTADO

SCOPE

EVIDENCIA

FINDINGS

MÉTRICAS

SIGUIENTE GATE

REANUDAR



`REANUDAR` is always present.



Include at minimum:



- posta/gate;

- branch;

- HEAD;

- working tree state;

- valid evidence reference;

- next operation;

- pending prohibition or authorization.



Do not reprint already-valid evidence unnecessarily.



---



# Metrics



Report only if actually observable.



Never estimate.



Possible metrics:



- distinct human authorizations;

- commands executed;

- agent invocations;

- test invocations;

- retries;

- automatic corrections;

- elapsed time only when reliably known.



Do not persist metrics to project files.



---



# Safety rules



While this skill is active:



- never Write/Edit project files;

- never modify source/config/docs;

- Git mutations only inside authorized Gate C/Gate D;

- never broad-stage;

- never commit without exact authorization;

- never amend;

- never add authorship metadata;

- never push;

- never destructive reset/clean;

- never rebase/cherry-pick;

- never stash to manipulate gate state;

- never restore/checkout files to manufacture a clean state;

- never delete branches;

- never change remotes;

- never change permissions;

- never modify secrets;

- never execute Gate B operations;

- never broaden scope;

- never resolve new product decisions;

- never hide exit code;

- never bypass denied permissions;

- never retry automatically after a sensitive failure.



If a command requires permission:



request permission normally.



Never bypass the permission system.



---



# Core principle



A posta is ready to advance only when the evidence corresponds to the exact

code that is about to advance.



Do not optimize for producing PASS.



Optimize for detecting whether the posta is actually ready.


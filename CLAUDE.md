# Claude Code — Illustrated Vault

Read `AGENTS.md` first. It is the governing repository-wide agent contract.

This file adds Claude Code-specific workflow instructions.

## Working environment

Canonical local repository:

`C:\dev\illustrated-vault`

Remote:

`https://github.com/VladimirBuslayev/illustrated-vault.git`

Production branch:

`main`

GitHub CLI is available and authenticated as the repository owner.

This is the full repository. Do not ask for uploaded copies of repo files when
the required files already exist in the working tree.

## Default session behavior

At the beginning of implementation work:

1. inspect `git status`;
2. confirm the current branch;
3. fetch current remote state;
4. inspect the requested files and relevant repository docs;
5. explain any material architecture ambiguity before editing.

If the working tree contains unexplained changes, stop rather than absorbing
them into the task.

Do not use browser/Chrome tools for normal repository work unless the user
explicitly asks for browser interaction or runtime visual QA that genuinely
requires them.

## Branch workflow

Never implement directly on `main`.

For a new approved slice:

1. return to `main`;
2. ensure the working tree is clean;
3. `git fetch origin`;
4. `git pull --ff-only origin main`;
5. create a clearly named branch;
6. implement only the approved slice.

Prefer branch names such as:

- `feature/<slice>-<short-description>`
- `fix/<slice>-<short-description>`
- `audit/<slice>-<short-description>`
- `workflow/<short-description>`

Do not merge your own PR unless explicitly instructed.

## Editing behavior

Inspect before editing.

Prefer modifying the smallest reasonable set of files.

Do not perform broad formatting, renaming, extraction, or refactoring unless it
is part of the approved task.

Do not rewrite large files merely for stylistic consistency.

Preserve existing code conventions unless changing them is part of the slice.

When adding comments, explain authority boundaries, non-obvious invariants, or
failure behavior rather than narrating obvious syntax.

## Commands and dependencies

On this Windows environment, use:

`npm.cmd run build`

for the real production Vite build.

Do not run `npm install` unless dependencies actually need to be installed or
changed for the approved task.

Do not introduce/update dependencies without explicit scope.

Do not run:

`npm audit fix --force`

as incidental cleanup.

If npm reports vulnerabilities, report them separately unless the active slice
is dependency/security remediation.

## Before commit

Run:

- relevant slice-specific validation;
- `npm.cmd run build` for runtime/frontend changes;
- `git diff --check`;
- `git status --short`.

Inspect the final diff.

Confirm that:
- only intended files changed;
- no `.env`, secret, credential, export, or generated artifact was added;
- no unrelated product behavior changed.

If validation fails, do not hide or bypass the failure.

## Commit and push

Use a concise commit message tied to the approved slice.

Push only the current feature branch.

Never push implementation commits directly to `main`.

After push, create a GitHub pull request with `gh`.

## Pull-request handoff

Use `gh pr create` and target `main`.

The PR description should include:

### Objective
What this slice changes.

### Changed files
Exact file list.

### Validation
Build/tests/audits performed and their result.

### Containment
Important behavior intentionally left unchanged.

### Deviations / risks
Anything that differs from the approved task or remains uncertain.

### Manual QA
Specific production or preview checks still required.

Do not merge the PR.

Return the PR number/URL to the user so the PR can be independently reviewed.

## Corrections after review

When review requests a correction:

- stay on the same feature branch;
- make only the requested correction unless another issue is required for
  correctness;
- rerun relevant validation;
- commit and push the correction;
- do not open a second PR for the same slice.

## Database work

For SQL/database tasks, follow `AGENTS.md` strictly.

Do not execute production SQL merely because a migration file was written.

Separate:
- inspection;
- migration authoring;
- production execution;
- validation;
- repo closeout.

Stop at explicit gates.

## End-of-task report

At the end of implementation work report:

- branch;
- commit SHA;
- PR number/URL;
- exact changed files;
- validation result;
- deviations/risks;
- manual QA remaining.

Do not return ZIP packages when the branch/PR is already available through
GitHub unless the user explicitly requests an artifact.

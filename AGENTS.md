# Illustrated Vault — Agent Contract

This repository is the canonical implementation source for Illustrated Vault.

Illustrated Vault is a premium visual archive and physical collection companion
for Pokémon card collectors. Its near-term product wedge is an artist-first
collecting experience.

## Source-of-truth hierarchy

For implementation work, use this order:

1. current production behavior and repository code;
2. `docs/CURRENT_STATE.md`;
3. `docs/ARCHITECTURE.md`;
4. `docs/DECISION_LOG.md`;
5. relevant current closeout/spec documents;
6. `docs/ROADMAP.md` and `docs/SURFACE_MAP.md`.

If documentation conflicts with current code or production evidence, do not
silently choose one. Report the conflict before changing behavior.

Product exploration and unapproved ideas are not architecture authority.

## Required reading

Before implementing a meaningful slice, inspect:

- `docs/CURRENT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISION_LOG.md`
- the files directly involved in the requested change
- any relevant closeout/spec/audit documents

Read only what is relevant; do not perform broad rewrites merely because older
documentation exists.

## Git and deployment rules

- `main` is production.
- Never implement directly on `main`.
- Begin work from current `origin/main`.
- Use one clearly named feature/workflow branch per approved slice.
- Never merge a PR unless explicitly instructed.
- Never deploy unless explicitly instructed.
- Do not force-push shared branches unless explicitly approved.
- Keep commits scoped to the requested slice.
- Do not mix opportunistic cleanup into unrelated work.

## Scope discipline

Inspect before editing.

Preserve existing working behavior outside the approved slice.

Prefer narrow vertical changes over broad refactors.

When a task exposes an adjacent problem:
- report it;
- contain it if necessary for correctness;
- do not expand scope without approval.

If a requested change would require a materially different architecture,
schema change, ownership policy, or product decision, stop and surface the
decision before implementing it.

## Product guardrails

Illustrated Vault is not:
- a generic collection tracker;
- a marketplace;
- a deals app;
- an investment/portfolio tool;
- a price-first product.

The product spine is:

**Beautiful visual organization + intentional collecting**

The collector loop is:

**Discover → Want → Acquire → Archive → Share → Hunt again**

Card art should remain the visual hero.

Pricing is useful buying context, not the product identity.

Preserve the calm, premium, curated, editorial feel.

## Data and authority guardrails

Physical printing ownership, artwork identity, and collecting goals are separate
concepts.

False-positive physical ownership is unacceptable.

Do not infer ownership of one printing from another printing, language, or
artwork.

Do not substitute card images across different physical printings unless a
future explicitly labelled artwork-proxy policy authorizes it.

Ownership authority must follow the current canonical ownership architecture
documented in the repository.

Binder authority boundaries must remain distinct:
- Binder membership answers which exact cards belong to a Binder Plan.
- Binder manual order answers list order.
- Page Layout answers where Binder membership rows are physically placed.
- Do not reinterpret Binder list `position` as a pocket index.

Hunt intent remains a global card-level planning state unless a later approved
architecture changes that.

## Database and SQL rules

Do not make schema changes casually.

Any schema/RLS/RPC migration requires:
- explicit approval for the schema slice;
- inspection of current production structure first;
- additive/backward-compatible design where feasible;
- production-safe validation;
- repo-tracked SQL under the established `docs/sql/` convention.

Do not perform destructive production writes, cleanup, or data rewrites unless
the task explicitly authorizes them.

Prefer read-only evidence gathering before mutation.

Never weaken RLS or authorization merely to make frontend code easier.

## Security and secrets

Never commit:
- `.env` files;
- Supabase service-role secrets;
- API secrets;
- auth tokens;
- private credentials;
- user-private exports or personal data unless explicitly approved for a safe
  test fixture.

Treat the public repository as public information.

Do not print secrets into logs, PR descriptions, reports, screenshots, or test
output.

## Validation

For frontend/runtime changes, run the real repository build before commit:

`npm.cmd run build` on the current Windows development environment.

Also run any slice-specific validation that exists.

Do not run `npm audit fix --force` or make dependency upgrades as incidental
cleanup.

Before committing, verify:
- `git status`;
- intended changed-file list;
- no accidental generated/private files;
- build/test result;
- no unrelated diff.

## Pull requests

Every implementation slice should reach GitHub as a PR before `main`.

PRs should state:
- objective/scope;
- exact changed files;
- validation performed;
- known deviations or unresolved risks;
- manual QA still required;
- whether schema, ownership, auth, or security behavior changed.

A PR is the review boundary between implementation and production.

## Documentation closeout

Do not update canonical state documents speculatively.

After a slice is actually approved/deployed/validated, update the relevant
current-state/architecture/decision/closeout documentation as a deliberate
closeout step.

## Stop conditions

Stop and ask/report rather than guessing when:
- production authority is unclear;
- two sources of truth conflict;
- a schema change appears necessary but was not approved;
- ownership semantics would change;
- security or user-data exposure is uncertain;
- required files/data are unavailable;
- the working tree contains unexplained changes;
- validation fails and the cause is not understood.

Fail closed on integrity questions.

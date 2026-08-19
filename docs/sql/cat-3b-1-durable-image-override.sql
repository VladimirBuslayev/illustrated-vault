-- docs/sql/cat-3b-1-durable-image-override.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-3B — Durable Approved Image Override Prerequisite
--
-- Creates the CHANNEL. Populates NOTHING.
--
-- Full document: docs/CAT-3B_DURABLE_IMAGE_OVERRIDE.md
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ STATUS: PREPARED — NOT EXECUTED
-- ─────────────────────────────────────────────────────────────────────────
-- No statement in this file has been run against production. Deployment is a
-- separately approved step. This slice writes NO override rows: after a
-- successful deploy, public.card_extras holds exactly the same 5 rows it holds
-- today and every new column is NULL on every one of them.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT PROBLEM THIS SOLVES
-- ─────────────────────────────────────────────────────────────────────────
-- public.cards.image_url is RAW PROVIDER-DERIVED DATA. sync-cards.mjs
-- mapCardToRow() performs a full-row upsert that rewrites it from whatever
-- TCGdex returns. A curated image written into that column would be silently
-- reverted the next time its set is not skipped, with nothing recording that
-- the value was ever deliberate.
--
-- CAT-3B adds a DURABLE, PROVENANCE-BEARING override channel beside the raw
-- column, on a table the sync path structurally cannot address.
--
-- ⚠ THE PREREQUISITE IS THE CHANNEL, NOT THE IMAGE WRITE. Creating override
--   rows — including for the 192 CAT-3A-measured pairs — is explicitly OUT OF
--   SCOPE here and requires its own approval.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY card_extras AND NOT A NEW TABLE
-- ─────────────────────────────────────────────────────────────────────────
-- card_extras is ALREADY the manual-enrichment override channel: it already
-- overrides `illustrator` through cards_effective, already has an FK to
-- cards(id), RLS enabled with SELECT-only for anon/authenticated (no write
-- policies, so writes are implicitly denied), an explicit GRANT, and an
-- updated_at trigger. New columns inherit all of that.
--
-- A dedicated table would mean a second LEFT JOIN in the hottest view in the
-- product, plus its own RLS, policies, grants and trigger — strictly more
-- surface for the same outcome.
--
-- NOTE ON CAT-0 F-15. That finding flagged that cards_effective COALESCEs
-- illustrator_override while taking artist_id straight from cards, so an
-- override changes the display and never the derived FK. `image_url` has NO
-- derived companion column, so the analogous divergence class does not exist
-- for images. This is the obvious objection to reusing the pattern, and it
-- does not apply.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS CHANNEL CAN AND CANNOT EXPRESS
-- ─────────────────────────────────────────────────────────────────────────
-- It is restricted to APPROVED ALIAS RELATIONSHIPS. It is NOT hard-coded to
-- any particular set of cards.
--
--   * An override may only cite a source that public.card_identity_resolution
--     already reports as an approved alias OF THAT CANONICAL CARD.
--   * A future alias approved by a later slice therefore becomes eligible
--     automatically — but NOTHING is applied automatically. An explicit
--     override write is always required. Approving an alias never renders a
--     pixel by itself.
--   * There is no path here for a non-alias source, a translated provider id,
--     a fuzzy match, or a cross-printing / cross-language image.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EXECUTION CONTRACT
-- ─────────────────────────────────────────────────────────────────────────
--   * run as the migration owner, in order, top to bottom;
--   * additive and reversible — see cat-3b-1-rollback below in §6;
--   * every new column is nullable with no default, so
--     coalesce(NULL, c.image_url) is a PROVABLE NO-OP at deploy time;
--   * NO SECURITY DEFINER anywhere in this file. The trigger runs with the
--     writer's own privileges and reads only objects the writer can already
--     address.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- §1. card_extras — the override columns
-- ═══════════════════════════════════════════════════════════════════════════
--
-- image_override_source_card_id carries an FK to cards(id) with ON DELETE
-- RESTRICT, deliberately NOT the CASCADE used by card_extras.card_id.
--
--   card_id CASCADEs because an enrichment row is meaningless once its card is
--   gone. The SOURCE reference is the opposite case: it is the provenance of a
--   deliberate human decision. Silently deleting the record of where an
--   approved image came from — because some unrelated cleanup removed the
--   retained provider-history row — would destroy the audit trail while
--   leaving the override itself in place and unexplained. RESTRICT forces that
--   collision to surface as an error somebody has to resolve.
--
-- Note it points at raw public.cards, not cards_effective: an alias source row
-- is by construction EXCLUDED from the effective catalog.

alter table public.card_extras
  add column if not exists image_url_override             text,
  add column if not exists image_override_source_card_id  text,
  add column if not exists image_override_evidence        jsonb,
  add column if not exists image_override_approved_by     text,
  add column if not exists image_override_approved_at     timestamptz;

-- FK added separately so the statement is re-runnable and the constraint is
-- named explicitly rather than auto-generated.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'card_extras_image_override_source_fk'
  ) then
    alter table public.card_extras
      add constraint card_extras_image_override_source_fk
      foreign key (image_override_source_card_id)
      references public.cards(id)
      on delete restrict;
  end if;
end $$;

comment on column public.card_extras.image_url_override is
  'CAT-3B. Durable approved image override. Survives sync because sync-cards.mjs writes only public.cards. Admitted only when it equals an approved alias source card''s image_url AT ADMISSION TIME (see card_extras_admit_image_override). Never auto-populated.';
comment on column public.card_extras.image_override_source_card_id is
  'CAT-3B. The approved alias card this image came from. Must be an approved alias of card_id per public.card_identity_resolution. FK ON DELETE RESTRICT: this is provenance for a human decision and must not vanish silently.';
comment on column public.card_extras.image_override_evidence is
  'CAT-3B. Structured provenance for the override decision. Required whenever image_url_override is set.';
comment on column public.card_extras.image_override_approved_by is
  'CAT-3B. Who approved this override. Required whenever image_url_override is set.';
comment on column public.card_extras.image_override_approved_at is
  'CAT-3B. When this override was approved. Required whenever image_url_override is set.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §2. All-or-nothing provenance
-- ═══════════════════════════════════════════════════════════════════════════
-- An override without provenance is worse than no override: it renders a
-- curated pixel that nobody can trace. Either all five fields are present or
-- all five are absent. There is no partial state.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'card_extras_image_override_all_or_nothing'
  ) then
    alter table public.card_extras
      add constraint card_extras_image_override_all_or_nothing check (
        (    image_url_override            is null
         and image_override_source_card_id is null
         and image_override_evidence       is null
         and image_override_approved_by    is null
         and image_override_approved_at    is null)
        or
        (    image_url_override            is not null
         and image_override_source_card_id is not null
         and image_override_evidence       is not null
         and image_override_approved_by    is not null
         and image_override_approved_at    is not null)
      );
  end if;

  -- Provenance that is present must also be meaningful.
  if not exists (
    select 1 from pg_constraint where conname = 'card_extras_image_override_approved_by_nonempty'
  ) then
    alter table public.card_extras
      add constraint card_extras_image_override_approved_by_nonempty check (
        image_override_approved_by is null
        or length(btrim(image_override_approved_by)) > 0
      );
  end if;

  -- A card cannot be its own provenance. Implied by the no-self-alias rule in
  -- CAT-2D.1, restated here so it holds independently of that table.
  if not exists (
    select 1 from pg_constraint where conname = 'card_extras_image_override_source_not_self'
  ) then
    alter table public.card_extras
      add constraint card_extras_image_override_source_not_self check (
        image_override_source_card_id is null
        or image_override_source_card_id <> card_id
      );
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- §3. Shape constraint — this is a TCGdex base-path channel, not a URL field
-- ═══════════════════════════════════════════════════════════════════════════
--
-- src/utils/imageUrl.js renders:
--     imgSmall = `${image}/low.webp`      imgLarge = `${image}/high.webp`
--
-- So a stored value MUST be a TCGdex asset BASE PATH — correct host, no
-- trailing slash, no file extension, no whitespace. A value shaped like a
-- finished file URL would render as `.../x.png/low.webp` and 404.
--
-- Constraining the host is the point, not incidental hardening: without it
-- this column becomes an arbitrary external-image channel, which is precisely
-- the generic multi-provider framework CAT-3B is scoped to avoid.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'card_extras_image_override_shape'
  ) then
    alter table public.card_extras
      add constraint card_extras_image_override_shape check (
        image_url_override is null
        or (
              image_url_override = btrim(image_url_override)          -- no edge whitespace
          and image_url_override ~ '^https://assets\.tcgdex\.net/[^[:space:]]+$'
          and image_url_override !~ '/$'                              -- not a directory
          and image_url_override !~* '\.(png|jpe?g|webp|gif|avif|svg)$' -- base path, not a file
        )
      );
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- §4. Admission trigger — the identity wall
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ ADMISSION-TIME SEMANTICS. THIS IS A DELIBERATE DESIGN DECISION, NOT A GAP.
--
--   The equality between the override and its source card's image_url is
--   checked WHEN THE OVERRIDE IS WRITTEN, and never again.
--
--   Raw public.cards is provider history. A future sync may legitimately
--   change or null the alias row's image_url. The stored override MUST survive
--   that: it records a human decision that a specific asset represents this
--   printing, taken against evidence captured at a known moment. Re-deriving
--   it later would make a curated value silently dependent on provider
--   churn — exactly the fragility CAT-3B exists to remove.
--
--   Consequence, stated plainly: after admission the override and the source
--   row's current image_url MAY diverge, and that divergence is CORRECT.
--   docs/sql/cat-3b-3-durability-test.sql proves it empirically.
--
-- ⚠ NO SECURITY DEFINER. This function runs with the privileges of whoever
--   writes card_extras (owner or service_role; anon/authenticated have no
--   write policy and cannot reach it). It reads public.card_identity_resolution
--   — the two-column PUBLIC surface granted to anon, authenticated and
--   service_role by CAT-2D.1 §3 — and public.cards. It never touches
--   public.card_identity_aliases, whose privilege wall stays intact. Nothing
--   here widens anyone's access.

create or replace function public.card_extras_admit_image_override()
returns trigger
language plpgsql
as $$
declare
  v_source_image text;
begin
  -- Not an override write. Nothing to admit.
  if new.image_url_override is null then
    return new;
  end if;

  -- R1 — provenance completeness.
  -- The all-or-nothing CHECK also enforces this. Repeated here as the second
  -- wall and because a trigger can say WHICH field is missing.
  if new.image_override_source_card_id is null
     or new.image_override_evidence    is null
     or new.image_override_approved_by is null
     or new.image_override_approved_at is null then
    raise exception
      'card_extras: image override for % rejected — provenance incomplete. '
      'image_url_override requires source_card_id, evidence, approved_by and approved_at.',
      new.card_id
      using errcode = 'check_violation';
  end if;

  -- R2 — the source must be an APPROVED ALIAS OF THIS CANONICAL CARD.
  -- This is the identity wall. It is what makes a cross-printing or
  -- cross-language image unstorable rather than merely discouraged.
  if not exists (
    select 1
    from public.card_identity_resolution r
    where r.alias_card_id     = new.image_override_source_card_id
      and r.canonical_card_id = new.card_id
  ) then
    raise exception
      'card_extras: image override for % rejected — % is not an approved alias '
      'of it. Only a printing already admitted as the same physical card may '
      'supply an image.',
      new.card_id, new.image_override_source_card_id
      using errcode = 'check_violation';
  end if;

  -- R3 — at ADMISSION TIME the override must be the source row's own image.
  select c.image_url into v_source_image
  from public.cards c
  where c.id = new.image_override_source_card_id;

  if v_source_image is null or btrim(v_source_image) = '' then
    raise exception
      'card_extras: image override for % rejected — source % currently has no '
      'image_url to admit.',
      new.card_id, new.image_override_source_card_id
      using errcode = 'check_violation';
  end if;

  if v_source_image <> new.image_url_override then
    raise exception
      'card_extras: image override for % rejected — value does not match the '
      'current image_url of source % at admission time.',
      new.card_id, new.image_override_source_card_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.card_extras_admit_image_override() is
  'CAT-3B. Write-time admission control for card_extras image overrides. Rejects a source that is not an approved alias of the canonical card, an override that does not equal that source''s image_url AT ADMISSION TIME, and incomplete provenance. Deliberately SECURITY INVOKER and deliberately not re-evaluated after admission.';

drop trigger if exists card_extras_admit_image_override on public.card_extras;
create trigger card_extras_admit_image_override
  before insert or update on public.card_extras
  for each row execute function public.card_extras_admit_image_override();


-- ═══════════════════════════════════════════════════════════════════════════
-- §5. public.cards_effective — one COALESCE, nothing else
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ REBUILT FROM THE CURRENT CAT-2D.1 PRODUCTION DEFINITION
--   (docs/sql/cat-2d1-1-dark-alias-foundation.sql §4), NOT from the stale
--   definition in docs/sql/card_extras_and_view.sql, which predates the alias
--   exclusion and would silently revert CAT-2D.1 if used as the base.
--
-- Preserved EXACTLY:
--   * with (security_invoker = true) — reads still execute with the caller's
--     permissions against public.cards and public.card_extras, so RLS there
--     continues to govern. NOT relaxed.
--   * all 14 columns, in order, with artist_id last;
--   * the LEFT JOIN to card_extras;
--   * the trailing NOT EXISTS alias exclusion against
--     public.card_identity_resolution.
--
-- The ONLY effective-value semantic change in this entire slice:
--
--     c.image_url                                  -- before
--     coalesce(ce.image_url_override, c.image_url) -- after
--
-- With zero override rows this is a provable no-op: coalesce(NULL, x) = x for
-- every row. cat-3b-2-validation.sql proves output equivalence row-for-row.

create or replace view public.cards_effective
  with (security_invoker = true)
as
  select
    c.id,
    c.name,
    c.set_id,
    c.set_name,
    c.local_id,
    coalesce(ce.illustrator_override, c.illustrator) as illustrator,
    coalesce(ce.image_url_override, c.image_url)     as image_url,
    c.rarity,
    c.release_date,
    c.pricing,
    c.pricing_updated_at,
    c.pricing_source,
    c.last_synced_at,
    c.artist_id
  from public.cards c
  left join public.card_extras ce on c.id = ce.card_id
  where not exists (
    select 1
    from public.card_identity_resolution r
    where r.alias_card_id = c.id
  );

-- Grants restated so this migration is self-contained (CREATE OR REPLACE
-- preserves them; these match the CAT-2D.1 state).
grant select on public.cards_effective to anon, authenticated, service_role;

comment on view public.cards_effective is
  'Canonical product-facing catalog. CAT-2D.1 alias exclusion + CAT-3B durable image override. illustrator and image_url are the only overridable values; both come from public.card_extras. security_invoker = true.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §6. ROLLBACK — do not run during deployment
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Restoring the view is a single statement and is instant. Because this slice
-- writes no override rows, rolling back loses no data.
--
--   create or replace view public.cards_effective
--     with (security_invoker = true)
--   as
--     select
--       c.id, c.name, c.set_id, c.set_name, c.local_id,
--       coalesce(ce.illustrator_override, c.illustrator) as illustrator,
--       c.image_url,
--       c.rarity, c.release_date, c.pricing, c.pricing_updated_at,
--       c.pricing_source, c.last_synced_at, c.artist_id
--     from public.cards c
--     left join public.card_extras ce on c.id = ce.card_id
--     where not exists (
--       select 1 from public.card_identity_resolution r
--       where r.alias_card_id = c.id
--     );
--   grant select on public.cards_effective to anon, authenticated, service_role;
--
-- The columns, constraints and trigger may be left in place — they are inert
-- while every override field is NULL. Drop them only if the channel is being
-- abandoned, and only after confirming zero override rows:
--
--   drop trigger if exists card_extras_admit_image_override on public.card_extras;
--   drop function if exists public.card_extras_admit_image_override();
--   alter table public.card_extras
--     drop constraint if exists card_extras_image_override_shape,
--     drop constraint if exists card_extras_image_override_source_not_self,
--     drop constraint if exists card_extras_image_override_approved_by_nonempty,
--     drop constraint if exists card_extras_image_override_all_or_nothing,
--     drop constraint if exists card_extras_image_override_source_fk,
--     drop column if exists image_override_approved_at,
--     drop column if exists image_override_approved_by,
--     drop column if exists image_override_evidence,
--     drop column if exists image_override_source_card_id,
--     drop column if exists image_url_override;

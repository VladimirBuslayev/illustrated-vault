// src/components/CardImage.jsx
// OL-2C.1 — Image Resilience. The single seam for card image source selection,
// failure transitions, retry limits, and exact-printing policy.
//
// Hierarchy, identical for every card that reaches render:
//   primary exact TCGdex URL
//   -> one retry of that same URL
//   -> verified exact Pokémon TCG API fallback
//   -> one retry of that verified fallback URL
//   -> neutral unavailable state
//
// Scope qualifier: four editorial/decorative surfaces select their candidates
// synchronously by primary-image presence (App.jsx :278, :839, :2070/:2217), so
// a fallback-only card never enters them. OL-2C.1 hardens the cards those
// surfaces already select; it deliberately does NOT introduce asynchronous
// fallback-aware candidate selection.
//
// No error classification at the image element: <img onError> carries no usable
// diagnostic, so any failed URL is retried exactly once regardless of cause.
// (HTTP status classification happens inside imageService, which is separate.)
//
// Limitless is NOT used at runtime anywhere in this module.
//
// R1 — stale cross-card containment.
//   All mutable resolution state lives in ONE state object stamped with the
//   verification identity it belongs to. The identity is recomputed every
//   render and, when it changes, the state object is replaced SYNCHRONOUSLY
//   during that same render (React's sanctioned "adjust state on prop change"
//   pattern) rather than in a passive effect. It is therefore impossible for a
//   new card to be rendered for even one frame combined with a previous card's
//   phase or fallback record.
//
//   The identity includes the verification fingerprint from imageService — the
//   exact same fingerprintCard function used for cache validation, in-flight
//   dedupe and mismatch logging — so it changes whenever card id, normalized
//   local number or normalized name changes, not merely when card.id changes.
//
//   Async commits additionally re-check the identity inside a functional
//   setState, so a resolved verdict can never land on a different identity. The
//   request-id and cancellation guards are preserved on top of that.

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { imgSmall, imgLarge } from "../utils/imageUrl.js";
import { fetchFallbackImage, fingerprintCard } from "../services/imageService.js";

// ── Preview-only instrumentation guards ──────────────────────────────────────
// TWO independent guards. Both must pass before ANY audit or fixture behavior
// runs. The hostname guard makes instrumentation inert on the production host
// even if this module is accidentally shipped with IV_IMAGE_AUDIT still true.
// Removed entirely by the pre-merge instrumentation-removal commit.
const IV_IMAGE_AUDIT = true;
const IV_AUDIT_HOST_OK =
  typeof window !== "undefined" &&
  !!window.location &&
  !/(^|\.)illustratedvault\.com$/i.test(window.location.hostname || "");
const IV_AUDIT_ON = IV_IMAGE_AUDIT && IV_AUDIT_HOST_OK;

if (IV_AUDIT_ON) {
  if (!Array.isArray(window.__ivImageAudit)) window.__ivImageAudit = [];
  window.__ivImageAuditCsv = function () {
    const cols = ["card_id","surface","requested_size","primary_url","fallback_url","tier","verified",
      "fingerprint","id_match","number_match","name_match","set_match","observed_id","observed_name",
      "observed_number","observed_set_id","final_state","retry_count_total","retry_count_current","reason"];
    const esc = v => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = (window.__ivImageAudit || []).map(r => cols.map(c => esc(r[c])).join(","));
    return [cols.join(","), ...rows].join("\n");
  };
}

function auditRow(row) {
  if (!IV_AUDIT_ON) return;
  try { window.__ivImageAudit.push(row); } catch { /* never break rendering */ }
}

// Deterministic fixtures, read ONLY when the guard passes. On the production
// host this is never consulted, so a stray console assignment cannot alter
// image selection.
function readFixture(cardId) {
  if (!IV_AUDIT_ON) return null;
  try {
    const all = window.__ivImageFixtures;
    if (!all || typeof all !== "object") return null;
    return all[cardId] || null;
  } catch { return null; }
}

// ── Retry URL construction ───────────────────────────────────────────────────
// The retry targets the SAME URL. A cache-busting suffix is required, otherwise
// the browser's negative cache makes the retry a no-op and the bounded retry is
// decorative. Applied ONLY to the retry attempt, never the first.
function retryUrl(url) {
  if (!url) return null;
  return url + (url.indexOf("?") === -1 ? "?r=1" : "&r=1");
}

const PHASE = {
  PRIMARY: "primary",
  PRIMARY_RETRY: "primary-retry",
  FALLBACK_PENDING: "fallback-pending",
  FALLBACK: "fallback",
  FALLBACK_RETRY: "fallback-retry",
  UNAVAILABLE: "unavailable",
};

function initialState(identity, hasPrimary) {
  return {
    identity,
    phase: hasPrimary ? PHASE.PRIMARY : PHASE.FALLBACK_PENDING,
    record: null,
    retryCurrent: 0,
    retryTotal: 0,
  };
}

/**
 * useCardImage — the OL-2C.1 policy hook.
 *
 * @param {object} card canonical card ({id, name, localId, image, set})
 * @param {object} options {size:'small'|'large', surface:string, enabled?:boolean}
 * @returns {{src:string|null, state:'loading'|'ready'|'unavailable',
 *            tier:'primary'|'ptcgio-verified'|'none', verified:boolean,
 *            retryCountCurrent:number, retryCountTotal:number,
 *            onError:Function, onLoad:Function, identityKey:string}}
 */
export function useCardImage(card, options) {
  const size = (options && options.size) || "small";
  const surface = (options && options.surface) || "unknown";
  const enabled = !(options && options.enabled === false);

  const cardId = card ? card.id : null;
  const fixture = readFixture(cardId);
  const fixturePrimary = fixture && Array.isArray(fixture.primary) ? fixture.primary : null;

  const basePrimary = useMemo(() => {
    if (!card) return null;
    if (fixturePrimary) return fixturePrimary[0] || null;
    return size === "large" ? imgLarge(card) : imgSmall(card);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, size, fixturePrimary && fixturePrimary[0]]);

  // Verification fingerprint — the SAME function imageService uses for cache
  // validation, in-flight dedupe and mismatch logging. Never reimplemented here.
  const fp = useMemo(() => (card ? fingerprintCard(card) : null), [card]);

  // Identity = fingerprint (card id + normalized number + normalized name)
  // + requested size + primary URL. When fingerprintCard returns null the card
  // cannot be verified at all; fall back to the raw id so distinct unverifiable
  // cards still get distinct identities.
  const identityKey = `${fp === null ? `nofp:${cardId}` : fp}|${size}|${basePrimary || "null"}`;

  const [s, setS] = useState(() => initialState(identityKey, !!basePrimary));

  // ── SYNCHRONOUS identity reset ─────────────────────────────────────────────
  // Render-phase state adjustment. `cur` is what this render uses, so a stale
  // record can never be paired with a new identity — not even for one render.
  let cur = s;
  if (s.identity !== identityKey) {
    cur = initialState(identityKey, !!basePrimary);
    setS(cur);
  }

  // Supersession guard (async): request id bumped per identity in an effect.
  const reqIdRef = useRef(0);
  // Latch key includes identity AND phase, so a permitted retry whose URL string
  // is identical to the previous attempt (fixture primary:[bad,bad]) is still
  // processed, while duplicate onError events within one phase are ignored.
  const failedRef = useRef(new Set());
  const auditedRef = useRef(new Set());

  useEffect(() => { reqIdRef.current += 1; }, [identityKey]);

  // Fallback fetch: issued exactly once per identity, on entry to
  // fallback-pending. Cancellation guard for unmount is preserved.
  useEffect(() => {
    if (!enabled || cur.phase !== PHASE.FALLBACK_PENDING || !card) return undefined;
    let cancelled = false;
    const myIdentity = identityKey;
    const myReq = reqIdRef.current;

    const fx = fixture && fixture.fallback
      ? Promise.resolve(fixture.fallback)
      : fetchFallbackImage(card);

    fx.then(v => {
      if (cancelled) return;                  // guard: unmounted
      if (myReq !== reqIdRef.current) return; // guard: superseded request
      setS(prev => {
        // guard: identity changed — never commit a verdict onto another card
        if (prev.identity !== myIdentity) return prev;
        if (prev.phase !== PHASE.FALLBACK_PENDING) return prev;
        const ok = v && v.status === "verified" && (v.small || v.large);
        return { ...prev, record: v || null, phase: ok ? PHASE.FALLBACK : PHASE.UNAVAILABLE, retryCurrent: 0 };
      });
    }).catch(() => {
      if (cancelled) return;
      setS(prev => (prev.identity === myIdentity && prev.phase === PHASE.FALLBACK_PENDING)
        ? { ...prev, phase: PHASE.UNAVAILABLE } : prev);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, cur.phase, enabled]);

  // ── Resolve the URL for the current phase (from `cur`, never from `s`) ─────
  const record = cur.record;
  const fallbackBase = record && record.status === "verified"
    ? (size === "large" ? (record.large || record.small) : (record.small || record.large))
    : null;

  let src = null;
  let tier = "none";
  if (cur.phase === PHASE.PRIMARY)             { src = basePrimary; tier = "primary"; }
  else if (cur.phase === PHASE.PRIMARY_RETRY)  { src = fixturePrimary ? (fixturePrimary[1] || null) : retryUrl(basePrimary); tier = "primary"; }
  else if (cur.phase === PHASE.FALLBACK)       { src = fallbackBase; tier = "ptcgio-verified"; }
  else if (cur.phase === PHASE.FALLBACK_RETRY) { src = retryUrl(fallbackBase); tier = "ptcgio-verified"; }

  const state = cur.phase === PHASE.UNAVAILABLE
    ? "unavailable"
    : cur.phase === PHASE.FALLBACK_PENDING
      ? "loading"
      : (src ? "ready" : "unavailable");

  const emit = useCallback((finalState, reasonToken, tierNow, srcNow, rCur, rTot) => {
    if (!IV_AUDIT_ON) return;
    const key = `${identityKey}|${finalState}|${reasonToken}`;
    if (auditedRef.current.has(key)) return;
    auditedRef.current.add(key);
    const rec = record || {};
    const checks = rec.checks || {};
    const obs = rec.observed || {};
    auditRow({
      card_id: cardId,
      surface,
      requested_size: size,
      primary_url: basePrimary,
      fallback_url: tierNow === "ptcgio-verified" ? srcNow : (rec.status === "verified" ? fallbackBase : null),
      tier: tierNow,
      verified: tierNow !== "none",
      fingerprint: rec.fp || fp,
      id_match: checks.id_match,
      number_match: checks.number_match,
      name_match: checks.name_match,
      set_match: checks.set_match,
      observed_id: obs.id,
      observed_name: obs.name,
      observed_number: obs.number,
      observed_set_id: obs.setId,
      final_state: finalState,
      retry_count_total: rTot,
      retry_count_current: rCur,
      reason: reasonToken,
    });
  }, [identityKey, cardId, surface, size, basePrimary, record, fallbackBase, fp]);

  // Terminal audit for the unavailable state.
  useEffect(() => {
    if (cur.phase !== PHASE.UNAVAILABLE) return;
    const rec = cur.record || {};
    let reason;
    if (rec.reason) reason = rec.reason;
    else if (!basePrimary) reason = "no_primary_no_fallback";
    else reason = "primary_dead_no_fallback";
    emit("unavailable", reason, "none", null, cur.retryCurrent, cur.retryTotal);
  }, [cur.phase, cur.record, cur.retryCurrent, cur.retryTotal, basePrimary, emit]);

  const onError = useCallback(() => {
    if (!src) return;
    // Latch on identity + phase + src. Duplicate events within one phase are
    // ignored; a permitted retry with an identical URL string still advances.
    const latch = `${identityKey}|${cur.phase}|${src}`;
    if (failedRef.current.has(latch)) return;
    failedRef.current.add(latch);

    setS(prev => {
      if (prev.identity !== identityKey) return prev; // superseded mid-flight
      if (prev.phase === PHASE.PRIMARY) {
        return { ...prev, phase: PHASE.PRIMARY_RETRY, retryCurrent: 1, retryTotal: Math.min(prev.retryTotal + 1, 2) };
      }
      if (prev.phase === PHASE.PRIMARY_RETRY) {
        return { ...prev, phase: PHASE.FALLBACK_PENDING, retryCurrent: 0 }; // per-URL counter resets on tier advance
      }
      if (prev.phase === PHASE.FALLBACK) {
        return { ...prev, phase: PHASE.FALLBACK_RETRY, retryCurrent: 1, retryTotal: Math.min(prev.retryTotal + 1, 2) };
      }
      if (prev.phase === PHASE.FALLBACK_RETRY) {
        return { ...prev, phase: PHASE.UNAVAILABLE, retryCurrent: 0 };
      }
      return prev; // UNAVAILABLE is absorbing
    });
  }, [identityKey, cur.phase, src]);

  const onLoad = useCallback(() => {
    let reason;
    if (cur.phase === PHASE.PRIMARY) reason = "primary_ok";
    else if (cur.phase === PHASE.PRIMARY_RETRY) reason = "primary_retry_ok";
    else if (cur.phase === PHASE.FALLBACK) reason = "fallback_verified_ok";
    else if (cur.phase === PHASE.FALLBACK_RETRY) reason = "fallback_retry_ok";
    else return;
    emit("ready", reason, tier, src, cur.retryCurrent, cur.retryTotal);
  }, [cur.phase, cur.retryCurrent, cur.retryTotal, tier, src, emit]);

  return {
    src: state === "ready" ? src : null,
    state,
    tier: state === "ready" ? tier : "none",
    verified: state === "ready",
    retryCountCurrent: cur.retryCurrent,
    retryCountTotal: cur.retryTotal,
    onError,
    onLoad,
    identityKey,
  };
}

// ── Presentational wrapper ───────────────────────────────────────────────────
// Renders ONLY the image-or-placeholder content and introduces NO wrapping
// element, so the <img> stays a plain descendant of .card-tile / .ol-frame and
// every existing selector (.card-tile img, .card-tile.missing img,
// .card-tile.owned img, .card-tile:hover img, .ol-frame img) keeps applying
// unchanged. Ownership grayscale, hover lift and object-fit are preserved.
export function CardImage(props) {
  const {
    card, size = "small", surface = "unknown", variant = "inline",
    alt, loadingAttr, className, style, onClick,
    spinner = null, missing = null, frameStyle,
  } = props;

  const img = useCardImage(card, { size, surface });

  if (img.state === "ready") {
    return (
      <img
        key={img.identityKey}
        src={img.src}
        alt={alt !== undefined ? alt : (card ? card.name : "")}
        loading={loadingAttr}
        decoding="async"
        className={className}
        style={style}
        onClick={onClick}
        onError={img.onError}
        onLoad={img.onLoad}
      />
    );
  }

  const isLoading = img.state === "loading";

  // "decorative": purely ornamental imagery (the artist hero collage). Renders
  // NOTHING when unavailable — a rotated, absolutely-positioned hatch panel
  // would read as a design element rather than a missing card.
  if (variant === "decorative") return null;

  if (variant === "card-blank") {
    return (
      <div className="card-blank" style={frameStyle} onClick={onClick}>
        <div className="blank-inner">
          {isLoading ? spinner : missing}
          <span>{card ? card.name : ""}</span>
        </div>
      </div>
    );
  }

  if (variant === "ol-miss") {
    return (
      <div className="ol-miss" aria-hidden="true" style={frameStyle}>
        {isLoading ? spinner : missing}
        <span style={{ fontSize: 10, color: "#5a5a82", marginTop: 4 }}>{card ? card.name : ""}</span>
      </div>
    );
  }

  // "inline": neutral frame sized by the caller. Loading and unavailable are
  // visually distinct (moving shimmer vs static hatch + icon).
  return (
    <div
      className={`iv-frame ${isLoading ? "iv-load" : "iv-miss"} ${className || ""}`}
      style={style}
      onClick={onClick}
      aria-hidden="true"
    >
      {isLoading ? null : missing}
    </div>
  );
}

export default CardImage;

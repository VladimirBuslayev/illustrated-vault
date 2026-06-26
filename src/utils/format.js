// src/utils/format.js
// Price formatter and date string helper.
// Source: index.legacy.html line 222 (fmt$) and line 223 (todayStr).
//
// Naming note: legacy called this fmt$ — the trailing $ is valid JS but
// unusual in ESM exports. Renamed to fmtPrice for clarity; behavior identical.
// parseDateNum (also on line 223) is dead code superseded by SET_ORDER and
// is intentionally excluded.

const fmtPrice = n => (n != null && !isNaN(n)) ? `$${Number(n).toFixed(2)}` : '—';
const todayStr = () => new Date().toISOString().slice(0, 10);

export { fmtPrice, todayStr };

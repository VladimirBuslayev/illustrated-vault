// src/utils/keys.js
// Card-name/number/set normalisers and Supabase ownership key builders.
// Source: index.legacy.html lines 219-221, 255-256.
//
// CRITICAL: makeKeys output is persisted in Supabase user_collection.owned_keys.
// Key formats: name::num::{localId}  and  name::set::{setName}
// Do NOT alter makeKeys or the norm* functions — changes break ownership matching.

const normName=s=>(s||"").toLowerCase().trim().replace(/[^a-z0-9\s]/g,"").replace(/\s+/g," ");
const normNum =n=>(n||"").toString().toLowerCase().trim().replace(/\/.*$/,"").trim();
const normSet =s=>(s||"").toLowerCase().replace(/&/g,"and").replace(/[—–]/g," ").replace(/[^a-z0-9\s]/g,"").replace(/\bpromos?\b/g,"promo").replace(/\s+/g," ").trim();
const makeKeys=(cn,num,sn)=>{const n=normName(cn);if(!n)return[];const k=[];const nu=normNum(num);if(nu)k.push(n+"::num::"+nu);const s=normSet(sn);if(s)k.push(n+"::set::"+s);return k;};
const isCardOwned=(card,ownedKeySet,mo,mm)=>{if(mm.has(card.id))return false;if(mo.has(card.id))return true;return makeKeys(card.name||"",card.localId||"",card.set&&card.set.name||"").some(k=>ownedKeySet.has(k));};

export { normName, normNum, normSet, makeKeys, isCardOwned };

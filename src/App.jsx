// src/App.jsx
// Illustrated Vault — main React component tree.
// Vite/React app served from Vercel. Supabase is the runtime data source.
// This file still contains the main component tree while the app remains in single-file MVP evolution.

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Papa from 'papaparse';
// Brand V-B: final logo asset lives in /public (served at site root by Vite).
const logoSrc = '/illustrated-logo-gradient.svg';

// ── Constants ─────────────────────────────────────────────────────────────────
import { ARTISTS, ARTIST_FACTS, ARTIST_META } from './constants/artists.js';
import { SET_ORDER }                           from './constants/setOrder.js';
import { CACHE_TTL, PRICE_VARIANT_ORDER }       from './constants/config.js';

// ── Utils ─────────────────────────────────────────────────────────────────────
import { lsGet, lsSet, lsDel }                           from './utils/cache.js';
import { toSlug }                                         from './utils/slug.js';
import { normName, normNum, normSet, makeKeys, isCardOwned } from './utils/keys.js';
import { isTcgPocketCard }                               from './utils/cardUtils.js';
import { fetchUserIntent, setCardIntent, clearCardIntent } from './services/intentService.js';
import { getBestPrice, sortCards }                        from './utils/sort.js';
import { fmtPrice, todayStr }                             from './utils/format.js';
import { imgSmall, imgLarge }                             from './utils/imageUrl.js';

// ── Services ──────────────────────────────────────────────────────────────────
import { supabase }                                       from './services/supabaseClient.js';
import { loadUserData, saveCollection, saveOverride, savePricePoint }
                                                          from './services/collectionService.js';
import { fetchSharedCollection }                          from './services/shareService.js';
import { fetchTrackedArtistTiers, fetchArtistIdentities,
         searchIllustratorDirectory, addArtistToArchive,
         updateArtistTier, removeArtistFromArchive } from './services/artistService.js'; // A-D2b0 + A-D2c + A-D2d
import { fetchArtistCards }                               from './services/cardService.js';
import { fetchFallbackImage, buildLimitlessGuess }        from './services/imageService.js';
import { fetchBinders, fetchBinder, createBinder, deleteBinder, updateBinder,
         fetchBinderCardIds, addCardToBinder, removeCardFromBinder,
         searchCatalogCards, fetchCardsByIds } from './services/binderService.js'; // BP-0A1 + BP-0A3/4 + BP-0B
import { classifyCollectrRows, MATCHER_VERSION } from './services/snapshotMatcher.js';    // OL-0C
import { loadCatalogIndex }                      from './services/catalogIndexLoader.js';  // OL-0C
import { createImportSnapshot }                  from './services/importSnapshotService.js';// OL-0C
import { fetchActiveSnapshotReadModel }          from './services/ownedLibraryService.js';   // OL-1 (Owned Library read model)

// ── NAV-1A: URL-backed top-level surface persistence ─────────────────────────
// Diagnosis: `view` is plain useState seeded to "checking-auth", and the data
// load unconditionally ends with setView("dashboard"). Nothing about the current
// surface ever reaches the URL, so a hard refresh always lands on Dashboard.
//
// Fix, deliberately narrow — no router, no route tree, no path segments (so
// Vercel needs no rewrite rules and no SPA fallback change):
//   • One query param, ?v=<surface>, appended to the existing URL.
//   • Only the simple, identifier-free top-level surfaces are addressable.
//     "artist" (needs a slug) and "plan" (needs a uuid) are DEFERRED: never
//     written to the URL, never restored from it.
//   • SharedBinder is untouched. It is mounted off ?share=<token> outside this
//     component, so App never renders on a share URL; as defence in depth we
//     also refuse to read or write ?v= whenever ?share= is present.
//   • "dashboard" is canonical and is represented by the ABSENCE of ?v=, so the
//     bare root URL keeps working and stays clean.
const NAV_PARAM = "v";
const NAV_SURFACES = new Set(["dashboard","binder","hunt","hunt-show","artists","plans","owned-library"]);
const navHasShare = () => { try { return new URLSearchParams(window.location.search).has("share"); } catch(e){ return false; } };
// URL → surface. Unknown / absent / identifier-bearing values collapse to
// "dashboard". Validating against the allowlist is load-bearing: App's render
// chain treats ANY unmatched `view` as the Binder fallthrough, so an unvalidated
// param would silently render the wrong surface.
function navReadSurface(){
  try{
    if(navHasShare())return "dashboard";
    const v=new URLSearchParams(window.location.search).get(NAV_PARAM);
    return v&&NAV_SURFACES.has(v)?v:"dashboard";
  }catch(e){ return "dashboard"; }
}
// surface → URL. Every other query param and the hash are preserved verbatim.
// Returns null when the URL already says what we want, so we never push a
// duplicate history entry.
function navBuildUrl(surface){
  try{
    const params=new URLSearchParams(window.location.search);
    const next=surface==="dashboard"?null:surface;
    if((params.get(NAV_PARAM)||null)===next)return null;
    if(next===null)params.delete(NAV_PARAM);else params.set(NAV_PARAM,next);
    const qs=params.toString();
    return window.location.pathname+(qs?"?"+qs:"")+window.location.hash;
  }catch(e){ return null; }
}

// ── ICONS ─────────────────────────────────────────────────────────────────────
const Ico=({children,size})=><svg width={size||16} height={size||16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
const IcoSearch=()=><Ico><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></Ico>;
const IcoUpload=()=><Ico><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></Ico>;
const IcoX    =()=><Ico><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ico>;
const IcoDownload=()=><Ico size={13}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></Ico>;
const IcoGear =()=><Ico><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></Ico>;
const IcoCheck=()=><Ico><polyline points="20 6 9 17 4 12"/></Ico>;
const IcoRetry=()=><Ico><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></Ico>;
const IcoEdit =()=><Ico><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></Ico>;
const IcoSpin =({size})=><svg className="spinner" width={size||14} height={size||14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a10 10 0 0 1 0 20A10 10 0 0 1 12 2" strokeOpacity="0.2"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>;
const IcoChev =({open})=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{transform:open?"rotate(0deg)":"rotate(-90deg)",transition:"transform .2s ease",flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>;
const IcoNoImage=({size})=><svg width={size||20} height={size||20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.4"/><path d="m21 15-5-5L5 21"/><line x1="2.5" y1="2.5" x2="21.5" y2="21.5" opacity="0.45"/></svg>;
const IcoInfo=()=><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.5" r="0.5" fill="currentColor" stroke="none"/></svg>;
const IcoEye=()=><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>;
const IcoContrast=()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>;

// ── LOGO ───────────────────────────────────────────────────────────────────────
// Renders the Illustrated Vault brushstroke-flame mark (public SVG asset).
// Component name kept as BlazLogo to avoid touching its 11 call sites.
function BlazLogo({size=32,glow=false}){
  return(
    <img src={logoSrc} width={size} height={size} alt="Illustrated"
      style={{display:"block",filter:glow?"drop-shadow(0 0 5px rgba(240,120,50,0.30)) drop-shadow(0 0 16px rgba(155,127,232,0.10))":"none"}}/>
  );
}

// ── FLAME BACKGROUND ──────────────────────────────────────────────────────────
const FDEFS=[
  {left:"8%", w:70, h:260,blur:14,delay:0,  dur:2.1,anim:"flameFlicker"},
  {left:"18%",w:45, h:180,blur:10,delay:.4, dur:1.7,anim:"flameFlicker2"},
  {left:"30%",w:90, h:310,blur:18,delay:.15,dur:2.4,anim:"flameFlicker"},
  {left:"42%",w:55, h:220,blur:12,delay:.7, dur:1.9,anim:"flameFlicker2"},
  {left:"54%",w:100,h:340,blur:20,delay:.05,dur:2.2,anim:"flameFlicker"},
  {left:"66%",w:60, h:200,blur:11,delay:.55,dur:1.8,anim:"flameFlicker2"},
  {left:"78%",w:80, h:280,blur:16,delay:.3, dur:2.0,anim:"flameFlicker"},
  {left:"90%",w:50, h:170,blur:9, delay:.65,dur:1.6,anim:"flameFlicker2"},
];
const EDEFS=Array.from({length:22},(_,i)=>({left:(5+i*4.2+Math.sin(i*1.3)*8)%95+"%",size:3+(i%4),delay:(i*.37)%4,dur:2.2+(i%3)*.8}));
function FlameBackground({dim}){
  const op=dim?.5:1;
  return(<>
    <div style={{position:"absolute",bottom:0,left:0,right:0,height:"65%",overflow:"hidden",opacity:op}}>
      {FDEFS.map((f,i)=><div key={i} style={{position:"absolute",bottom:0,left:f.left,marginLeft:-f.w/2,width:f.w,height:f.h,background:"linear-gradient(to top,#ff2200 0%,#ff6600 40%,#ffaa00 70%,#ffe066 90%,transparent 100%)",borderRadius:"50% 50% 25% 25% / 55% 55% 45% 45%",filter:`blur(${f.blur}px)`,transformOrigin:"bottom center",animation:`${f.anim} ${f.dur}s ${f.delay}s ease-in-out infinite`,opacity:.5}}/>)}
    </div>
    <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",opacity:op}}>
      {EDEFS.map((e,i)=><div key={i} style={{position:"absolute",bottom:"15%",left:e.left,width:e.size,height:e.size,borderRadius:"50%",background:"#e8873a",boxShadow:`0 0 ${e.size*2}px rgba(224,90,20,0.55)`,animation:`emberRise ${e.dur}s ${e.delay}s ease-out infinite`,opacity:0}}/>)}
    </div>
    <div style={{position:"absolute",bottom:0,left:0,right:0,height:120,background:"linear-gradient(to top,rgba(255,60,0,0.16),transparent)",animation:"glowPulse 2.5s ease-in-out infinite",opacity:op}}/>
  </>);
}

// ── LANDING / AUTH ────────────────────────────────────────────────────────────
function LandingPage({user,onEnter,onSendLink,onVerifyCode,onSignOut}){
  const[email,setEmail]=useState("");
  const[linkSent,setLinkSent]=useState(false);
  const[sending,setSending]=useState(false);
  const[error,setError]=useState("");
  const[exiting,setExiting]=useState(false);
  const[code,setCode]=useState("");
  const[verifying,setVerifying]=useState(false);
  const[codeError,setCodeError]=useState("");
  const isLoggedIn=!!user;
  const enter=()=>{setExiting(true);setTimeout(onEnter,420);};
  useEffect(()=>{const fn=e=>{if(e.key==="Enter"&&isLoggedIn)enter();};window.addEventListener("keydown",fn);return()=>window.removeEventListener("keydown",fn);},[isLoggedIn]);
  const send=async()=>{if(!email.trim())return;setSending(true);setError("");try{await onSendLink(email.trim());setLinkSent(true);}catch(err){setError(err.message||"Failed to send.");}finally{setSending(false);}};
  const verify=async()=>{if(!code.trim())return;setVerifying(true);setCodeError("");try{await onVerifyCode(email.trim(),code.trim());}catch(err){setCodeError(err.message||"That code didn't work.");}finally{setVerifying(false);}};
  const cardStyle={background:"rgba(7,7,15,0.78)",border:"1px solid rgba(255,100,0,0.18)",borderRadius:16,padding:"1.75rem",maxWidth:360,width:"100%",backdropFilter:"blur(14px)",WebkitBackdropFilter:"blur(14px)"};
  const inputStyle={width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,100,0,0.3)",borderRadius:10,color:"#fff8f0",padding:".65rem 1rem",fontSize:"1rem",marginBottom:".75rem",outline:"none"};
  return(
    <div className={exiting?"landing-exit":""} onClick={isLoggedIn?enter:undefined}
      style={{position:"fixed",inset:0,zIndex:9999,cursor:isLoggedIn?"pointer":"default",background:"radial-gradient(ellipse at 50% 110%,#3d0f00 0%,#1a0500 40%,#080200 70%,#030100 100%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
      <FlameBackground/>
      <div className="fade-in" style={{position:"relative",zIndex:10,textAlign:"center",padding:"1rem",width:"100%",maxWidth:400}}>
        <div style={{position:"relative",display:"flex",justifyContent:"center",marginBottom:"1.25rem"}}>
          <div style={{position:"absolute",width:200,height:200,borderRadius:"50%",background:"radial-gradient(circle,rgba(198,87,143,0.5) 0%,rgba(21,3,83,0.35) 55%,transparent 75%)",filter:"blur(18px)",animation:"cosmicBreathe 4.5s ease-in-out infinite",pointerEvents:"none"}}/>
          <BlazLogo size={64} glow/>
        </div>
        <h1 className="font-display" style={{position:"relative",fontSize:"clamp(2.4rem,9vw,4.2rem)",fontWeight:700,letterSpacing:"-.02em",lineHeight:1,marginBottom:".7rem",backgroundImage:"linear-gradient(90deg,#fcd99d 0%,#f38e29 22%,#ea2515 45%,#c6578f 70%,#150353 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",filter:"drop-shadow(0 0 10px rgba(234,37,21,0.15))"}}>
          Illustrated
        </h1>
        {isLoggedIn?(
          <>
            <p style={{fontSize:".78rem",color:"#5a2a10",fontStyle:"italic",marginBottom:"2.25rem",letterSpacing:".04em"}}>For collectors who follow the art.</p>
            <button onClick={e=>{e.stopPropagation();enter();}} style={{background:"linear-gradient(160deg,#a8330e,#cf5417)",color:"#fff3ea",border:"none",borderRadius:50,padding:".9rem 3rem",fontSize:"1rem",fontWeight:800,cursor:"pointer",letterSpacing:".04em",boxShadow:"0 4px 18px rgba(190,70,20,0.28)"}}
              onMouseEnter={e=>e.currentTarget.style.transform="scale(1.06)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
              Enter the Vault
            </button>
            <div style={{marginTop:"1.5rem",display:"flex",alignItems:"center",justifyContent:"center",gap:".75rem"}}>
              <span style={{fontSize:".68rem",color:"#4a2010"}}>{user.email}</span>
              <button onClick={e=>{e.stopPropagation();onSignOut();}} style={{fontSize:".68rem",color:"#ff6633",background:"none",border:"1px solid rgba(255,100,50,0.2)",borderRadius:6,padding:"2px 8px",cursor:"pointer"}}>Sign out</button>
            </div>
          </>
        ):linkSent?(
          <div onClick={e=>e.stopPropagation()} style={{...cardStyle,marginTop:"1rem"}}>
            <div style={{fontSize:"2rem",marginBottom:".75rem"}}>📬</div>
            <h2 style={{fontSize:"1.05rem",fontWeight:700,color:"#fff8f0",marginBottom:".5rem"}}>Check your email</h2>
            <p style={{fontSize:".82rem",color:"#ff9944",marginBottom:"1rem",lineHeight:1.5}}>Sent to <strong style={{color:"#fff8f0"}}>{email}</strong>. Tap the link if you're on desktop or in a regular browser tab.</p>
            <div style={{borderTop:"1px solid rgba(255,100,0,0.18)",paddingTop:".9rem",marginBottom:".9rem"}}>
              <p style={{fontSize:".7rem",color:"#c87840",marginBottom:".55rem",lineHeight:1.4}}>Installed the app to your home screen? Tapping the link opens it in your browser instead — type the code from the same email here instead, it'll sign in right in the app.</p>
              <input type="text" inputMode="numeric" placeholder="123456" value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==="Enter"&&verify()} style={{...inputStyle,marginBottom:".5rem",textAlign:"center",letterSpacing:".2em",fontSize:"1.1rem"}}/>
              {codeError&&<p style={{fontSize:".72rem",color:"#f87171",marginBottom:".5rem"}}>{codeError}</p>}
              <button onClick={verify} disabled={verifying||!code.trim()} style={{width:"100%",background:"linear-gradient(135deg,#ff5500,#ff2200)",color:"#fff8f0",border:"none",borderRadius:10,padding:".65rem",fontSize:".85rem",fontWeight:800,cursor:"pointer",opacity:(verifying||!code.trim())?.45:1}}>{verifying?"Checking…":"Enter Code"}</button>
            </div>
            <button onClick={()=>{setLinkSent(false);setCode("");setCodeError("");}} style={{background:"none",border:"1px solid rgba(255,100,0,0.3)",color:"#ff9944",borderRadius:8,padding:".45rem 1rem",cursor:"pointer",fontSize:".78rem"}}>Try a different email</button>
          </div>
        ):(
          <div onClick={e=>e.stopPropagation()} style={{...cardStyle,marginTop:"1rem"}}>
            <p style={{fontSize:".82rem",color:"#c87040",marginBottom:"1rem",lineHeight:1.5,fontStyle:"italic"}}>For collectors who follow the art.</p>
            <input type="email" placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} style={inputStyle} autoFocus/>
            {error&&<p style={{fontSize:".72rem",color:"#f87171",marginBottom:".5rem"}}>{error}</p>}
            <button onClick={send} disabled={sending||!email.trim()} style={{width:"100%",background:"linear-gradient(160deg,#a8330e,#cf5417)",color:"#fff3ea",border:"none",borderRadius:10,padding:".75rem",fontSize:".95rem",fontWeight:800,cursor:"pointer",boxShadow:"0 4px 14px rgba(190,70,20,0.25)",opacity:(sending||!email.trim())?.45:1}}>
              {sending?"Sending…":"Send sign-in link"}
            </button>
            <p style={{marginTop:".65rem",fontSize:".65rem",color:"#4a2810",lineHeight:1.4}}>No password — a link arrives in your email.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({cardData,checkOwned,favorites,user,intentMap,onGoBinder,onUploadCSV,csvStatus,syncStatus,loadingSet,errors,onCardClick,roster,heroPick,setHeroPick,queuePage,setQueuePage}){
  // A-D2b0: roster = effectiveRoster (curated ARTISTS + dynamic additions).
  // Defensive fallback keeps the dashboard rendering even if the prop is omitted.
  const rosterList=roster||ARTISTS;
  const totalCards=useMemo(()=>Object.values(cardData).reduce((s,a)=>s+a.length,0),[cardData]);
  const totalOwned=useMemo(()=>Object.values(cardData).reduce((s,a)=>s+a.filter(checkOwned).length,0),[cardData,checkOwned]);
  const totalPct=totalCards?Math.round((totalOwned/totalCards)*100):0;

  const artistStats=useMemo(()=>rosterList.map(entry=>{
    const cards=cardData[toSlug(entry.name)]||[];
    const owned=cards.filter(checkOwned).length;
    return{...entry,cards,total:cards.length,owned,pct:cards.length?Math.round((owned/cards.length)*100):0};
  }).filter(a=>a.total>0),[cardData,checkOwned,rosterList]);

  const mostWanted=useMemo(()=>{
    const w=[];
    rosterList.forEach(entry=>{
      (cardData[toSlug(entry.name)]||[]).forEach(card=>{
        if(favorites.has(card.id)&&!checkOwned(card))w.push({card,artist:entry});
      });
    });
    return w;
  },[cardData,favorites,checkOwned,rosterList]);

  const[showAllWanted,setShowAllWanted]=useState(false);
  const visibleWanted=showAllWanted?mostWanted:mostWanted.slice(0,3);
  // V-C.1: collapsible artist sections. Main defaults open, Secondary &
  // Special defaults collapsed (Hunt Board "MAYBE LATER" precedent). Local
  // state only — not persisted.
  const[mainOpen,setMainOpen]=useState(true);
  const[secOpen,setSecOpen]=useState(false);
  // A-D2b0: explicit tier split. secondary+special partition identically to the
  // old tier!=="main" filter when no "added" entries exist.
  const mainStats =artistStats.filter(a=>a.tier==="main");
  const secStats  =artistStats.filter(a=>a.tier==="secondary"||a.tier==="special");
  const addedStats=artistStats.filter(a=>a.tier==="added");
  // V-C: Vault Feature — one curated archive moment for the Dashboard hero.
  // Priority ladder: hunting > want > most-wanted favorite > artist focus > empty.
  // Deterministic and stable: roster order, then existing cardData order
  // (release date / set / number). No price signal, no rotation — the first
  // best candidate wins. Card tiers require art (imgSmall); imageless
  // candidates are skipped so the panel never renders a blank frame. Ownership
  // is checked at selection time, so Force Owned or stale intent drops a card
  // from candidacy on the next render (same suppression rule as Hunt Board).
  // Intent semantics are read-only here — this memo never writes intent.
  //
  // V-C.1: the ladder now collects up to 4 candidates (feature + Vault Queue)
  // in the same order the old single-pick walked. Candidate [0] is therefore
  // byte-identical to the pre-V-C.1 featured card. Tapping a queue item sets a
  // session-only heroPick (card id, plain useState — no persistence, no
  // schema, no localStorage); an invalid/stale pick silently falls back to
  // candidate [0].
  // V-C.2: no cap here — every eligible hunting/want/favorite candidate is
  // collected using the same priority order and dedup as before. Candidate
  // [0] is therefore still byte-identical to the pre-V-C.1/V-C.2 featured
  // card. Only the rendered Vault Queue (below) is limited, via paging.
  const vaultCandidates=useMemo(()=>{
    const seen=new Set();
    const out=[];
    const collect=(mode,label)=>{
      for(const entry of rosterList){
        const cards=cardData[toSlug(entry.name)]||[];
        for(const card of cards){
          if(seen.has(card.id))continue;
          if(checkOwned(card))continue;
          if(mode==="fav"){if(!favorites.has(card.id))continue;}
          else if(!intentMap||intentMap.get(card.id)!==mode)continue;
          if(!imgSmall(card))continue;
          seen.add(card.id);
          out.push({card,artist:entry,label});
        }
      }
    };
    collect("hunting","CURRENT HUNT");
    collect("want","ON THE LIST");
    collect("fav","MOST WANTED");
    return out;
  },[cardData,checkOwned,favorites,intentMap,rosterList]);

  // V-C.3: heroPick and queuePage now live in App (passed down as props) so
  // the featured card and queue page survive navigating away from and back
  // to Dashboard. Still plain useState at the App level — no persistence,
  // no schema, no localStorage — so a full browser refresh still resets both.

  const vaultFeature=useMemo(()=>{
    if(vaultCandidates.length>0){
      const picked=(heroPick&&vaultCandidates.find(c=>c.card.id===heroPick))||vaultCandidates[0];
      return{kind:"card",...picked};
    }
    const focus=artistStats.filter(a=>a.pct<100).sort((a,b)=>b.pct-a.pct||b.owned-a.owned)[0];
    if(focus)return{kind:"artist",artist:focus};
    return{kind:"empty"};
  },[vaultCandidates,heroPick,artistStats]);

  // V-C.2: Vault Queue paging. otherCandidates is the full eligible pool
  // minus whichever card is currently featured. queuePage is session-only
  // (plain useState in App, no persistence) and is intentionally NOT reset
  // when the feature card changes — selecting a queue item shouldn't jump
  // the user back to page 1. It's only clamped down if the current page
  // becomes out of range (e.g. the pool shrinks because a card gets marked
  // owned). Clamping behavior is unchanged from V-C.2.
  const QUEUE_PAGE_SIZE=3;
  const otherCandidates=vaultFeature.kind==="card"
    ?vaultCandidates.filter(c=>c.card.id!==vaultFeature.card.id)
    :[];
  const queuePageCount=otherCandidates.length?Math.ceil(otherCandidates.length/QUEUE_PAGE_SIZE):0;
  const safeQueuePage=queuePageCount?Math.min(queuePage,queuePageCount-1):0;
  useEffect(()=>{
    if(safeQueuePage!==queuePage)setQueuePage(safeQueuePage);
  },[safeQueuePage,queuePage]);
  const vaultQueue=otherCandidates.slice(safeQueuePage*QUEUE_PAGE_SIZE,safeQueuePage*QUEUE_PAGE_SIZE+QUEUE_PAGE_SIZE);
  // V-C.3: eligible Hunt Show pool — every vaultCandidates entry that came
  // from explicit hunting/want intent (excludes the "MOST WANTED" favorites
  // stage). Reuses vaultCandidates' existing dedup/ownership filtering
  // rather than re-deriving intent membership from scratch.
  const huntShowCount=vaultCandidates.filter(c=>c.label!=="MOST WANTED").length;
  // Quiet archive context for the hero's right side when no alternates exist.
  const featureArtistStat=vaultFeature.kind==="card"
    ?artistStats.find(a=>a.name===vaultFeature.artist.name)||null
    :null;

  const syncIcon =syncStatus==="syncing"?<IcoSpin/>:syncStatus==="synced"?<span style={{color:"#22c55e",fontSize:".65rem"}}>✓</span>:null;

  return(
    <div style={{minHeight:"100dvh",background:"#07070f",paddingBottom:"5rem"}}>
      <header style={{position:"sticky",top:0,zIndex:100,background:"rgba(7,7,15,0.97)",backdropFilter:"blur(18px)",borderBottom:"1px solid #1e1e35"}}>
        <div style={{maxWidth:900,margin:"0 auto",padding:".6rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",rowGap:".45rem"}}>
          <div style={{display:"flex",alignItems:"center",gap:".5rem",cursor:"pointer",minWidth:0}} onClick={()=>onGoBinder("landing")}>
            <span style={{display:"flex",transform:"translateY(0.5px)"}}><BlazLogo size={14}/></span>
            <span className="font-display" style={{fontWeight:600,fontSize:"1.12rem",color:"#e8e8f4",letterSpacing:"-.01em"}}>Illustrated</span>
          </div>
          <div style={{display:"flex",gap:".4rem",alignItems:"center",marginLeft:"auto",flexWrap:"wrap",justifyContent:"flex-end"}}>
            {csvStatus==="loading"&&<span style={{fontSize:".7rem",color:"#6b6b90",display:"flex",alignItems:"center",gap:4}}><IcoSpin/>Reading…</span>}
            {csvStatus?.count&&<span style={{fontSize:".7rem",color:"#22c55e"}}>✓ {csvStatus.count} cards</span>}
            {syncIcon&&<span style={{display:"flex",alignItems:"center",gap:3}}>{syncIcon}</span>}
            <button onClick={onUploadCSV} className="btn-ghost hide-on-narrow" title="Import your Collectr CSV export" style={{display:"flex",alignItems:"center",gap:".3rem",color:"#7a7aa0",borderRadius:8,padding:".35rem .6rem",fontSize:".72rem",fontWeight:600}}>
              <IcoUpload/> Import
            </button>
            <button onClick={()=>onGoBinder("hunt")} className="btn-ghost" style={{color:"#9b7fe8",borderRadius:8,padding:".35rem .6rem",fontSize:".72rem",fontWeight:600,whiteSpace:"nowrap"}}>Hunt Board</button>
            <button onClick={()=>onGoBinder("binder")} className="btn-flame" style={{borderRadius:8,padding:".35rem .75rem",fontSize:".72rem",fontWeight:700,letterSpacing:".03em"}}>
              Open Binder →
            </button>
          </div>
        </div>
      </header>

      <div style={{maxWidth:900,margin:"0 auto",padding:"0 1rem"}}>
        {loadingSet&&loadingSet.size>0&&(
          <div style={{marginTop:"1.5rem",padding:".7rem 1rem",background:"rgba(139,108,216,0.08)",border:"1px solid rgba(139,108,216,0.25)",borderRadius:10,display:"flex",alignItems:"center",gap:".6rem",fontSize:".8rem",color:"#9b9bc0"}}>
            <IcoSpin/>
            <span>Loading card data — {rosterList.length-loadingSet.size}/{rosterList.length} artists ready. First load can take up to a minute, this page will fill in automatically.</span>
          </div>
        )}
        {errors&&Object.keys(errors).length>0&&(
          <div style={{marginTop:loadingSet&&loadingSet.size>0?".6rem":"1.5rem",padding:".6rem 1rem",background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.25)",borderRadius:10,fontSize:".78rem",color:"#f87171"}}>
            ⚠ {Object.keys(errors).length} artist{Object.keys(errors).length>1?"s":""} failed to load — open the binder to see which, and retry.
          </div>
        )}
        {/* V-C: Vault Feature hero — a curated archive moment built from the
            user's own collection data (hunting > want > favorite > artist
            focus > empty). Replaces the stat-block hero and resolves the old
            TODO(hero-visual): personal collection visual, not a brand mark. */}
        <div style={{marginTop:"1.5rem",marginBottom:"1.5rem",background:"linear-gradient(150deg,#0e0b13 0%,#0a0810 55%,#0c0a13 100%)",border:"1px solid #1e1e35",borderRadius:20,padding:"1.75rem 1.5rem 1.5rem"}}>
          <div style={{fontSize:".6rem",letterSpacing:".18em",color:"#7a6a56",fontWeight:700,marginBottom:"1.15rem"}}>YOUR VAULT</div>

          {vaultFeature.kind==="card"&&(
            <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"1.75rem",marginBottom:"1.5rem"}}>
              <div onClick={()=>onCardClick&&onCardClick(vaultFeature.card)} style={{position:"relative",flexShrink:0,cursor:"pointer",width:"clamp(118px,26vw,164px)"}}>
                <div style={{position:"absolute",inset:"-16%",borderRadius:"50%",background:"radial-gradient(circle,rgba(139,108,216,0.20) 0%,rgba(207,84,23,0.07) 55%,transparent 78%)",filter:"blur(14px)",pointerEvents:"none"}}/>
                <img src={imgLarge(vaultFeature.card)||imgSmall(vaultFeature.card)} alt={vaultFeature.card.name} loading="lazy" decoding="async" style={{position:"relative",display:"block",width:"100%",height:"auto",borderRadius:10,border:"1px solid rgba(255,255,255,0.08)",boxShadow:"0 10px 30px rgba(0,0,0,0.5)"}}/>
              </div>
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontSize:".6rem",letterSpacing:".2em",color:"#c8925a",fontWeight:700,marginBottom:".55rem"}}>{vaultFeature.label}</div>
                <h2 className="font-display" style={{fontSize:"clamp(1.5rem,4.5vw,2.3rem)",fontWeight:700,letterSpacing:"-.02em",lineHeight:1.08,color:"#f2e9df",marginBottom:".45rem"}}>{vaultFeature.card.name}</h2>
                <div style={{fontSize:".78rem",color:"#8888a8",marginBottom:"1.15rem"}}>{vaultFeature.artist.name}{vaultFeature.card.set?.name?<> · {vaultFeature.card.set.name}</>:null}</div>
                <button onClick={()=>onCardClick&&onCardClick(vaultFeature.card)} className="btn-ghost" style={{borderRadius:10,padding:".55rem 1.1rem",fontSize:".78rem",fontWeight:600}}>View card →</button>
              </div>
              {/* V-C.1: Vault Queue — the other hero candidates, session-swap
                  only. When no alternates exist, a quiet archive-context note
                  fills the space instead of empty placeholders. */}
              {vaultQueue.length>0?(
                <div className="vault-queue">
                  <div className="vault-queue-label" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:".4rem"}}>
                    <span style={{fontSize:".56rem",letterSpacing:".18em",color:"#54547a",fontWeight:700}}>UP NEXT</span>
                    {queuePageCount>1&&(
                      <div style={{display:"flex",gap:".25rem",flexShrink:0}}>
                        <button onClick={()=>setQueuePage(p=>Math.max(0,p-1))} disabled={safeQueuePage===0} aria-label="Previous vault queue page"
                          style={{background:"none",border:"1px solid #1e1e35",borderRadius:6,width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",padding:0,lineHeight:1,fontSize:".62rem",cursor:safeQueuePage===0?"default":"pointer",color:safeQueuePage===0?"#2a2a45":"#8b6cd8"}}>‹</button>
                        <button onClick={()=>setQueuePage(p=>Math.min(queuePageCount-1,p+1))} disabled={safeQueuePage>=queuePageCount-1} aria-label="Next vault queue page"
                          style={{background:"none",border:"1px solid #1e1e35",borderRadius:6,width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",padding:0,lineHeight:1,fontSize:".62rem",cursor:safeQueuePage>=queuePageCount-1?"default":"pointer",color:safeQueuePage>=queuePageCount-1?"#2a2a45":"#8b6cd8"}}>›</button>
                      </div>
                    )}
                  </div>
                  {vaultQueue.map(q=>(
                    <button key={q.card.id} className="vault-queue-item" onClick={()=>setHeroPick(q.card.id)}>
                      <img src={imgSmall(q.card)} alt={q.card.name} loading="lazy" decoding="async" style={{width:34,height:"auto",borderRadius:4,flexShrink:0,display:"block"}}/>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:".7rem",color:"#c8c8e0",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{q.card.name}</div>
                        <div style={{fontSize:".58rem",color:"#54547a",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{q.artist.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ):featureArtistStat?(
                <div className="vault-queue" style={{justifyContent:"center"}}>
                  <div className="vault-queue-label" style={{fontSize:".56rem",letterSpacing:".18em",color:"#54547a",fontWeight:700}}>IN YOUR VAULT</div>
                  <div style={{fontSize:".74rem",color:"#8888a8",lineHeight:1.45}}>
                    <span style={{color:"#c8c8e0",fontWeight:600}}>{featureArtistStat.owned}/{featureArtistStat.total}</span> {featureArtistStat.name}
                  </div>
                  <div style={{height:3,background:"#1e1e35",borderRadius:2,overflow:"hidden",width:"100%",maxWidth:150}}>
                    <div className="prog-fill" style={{width:`${featureArtistStat.pct}%`,height:"100%",borderRadius:2,background:"#4a3880"}}/>
                  </div>
                </div>
              ):null}
            </div>
          )}

          {vaultFeature.kind==="artist"&&(
            <div style={{marginBottom:"1.5rem"}}>
              <div style={{fontSize:".6rem",letterSpacing:".2em",color:"#c8925a",fontWeight:700,marginBottom:".55rem"}}>ARTIST FOCUS</div>
              <h2 className="font-display" style={{fontSize:"clamp(1.5rem,4.5vw,2.3rem)",fontWeight:700,letterSpacing:"-.02em",lineHeight:1.08,color:"#f2e9df",marginBottom:".45rem"}}>{vaultFeature.artist.name}</h2>
              <div style={{fontSize:".78rem",color:"#8888a8",marginBottom:".85rem"}}>{vaultFeature.artist.owned}/{vaultFeature.artist.total} cards · {vaultFeature.artist.pct}% complete</div>
              <div style={{height:4,background:"#1e1e35",borderRadius:2,overflow:"hidden",maxWidth:260,marginBottom:"1.15rem"}}>
                <div className="prog-fill" style={{width:`${vaultFeature.artist.pct}%`,height:"100%",borderRadius:2,background:"linear-gradient(90deg,#cf5417,#8b6cd8)"}}/>
              </div>
              <button onClick={()=>onGoBinder("artist:"+toSlug(vaultFeature.artist.name))} className="btn-ghost" style={{borderRadius:10,padding:".55rem 1.1rem",fontSize:".78rem",fontWeight:600}}>Continue this artist →</button>
            </div>
          )}

          {vaultFeature.kind==="empty"&&(
            loadingSet&&loadingSet.size>0?(
              <div style={{fontSize:".82rem",color:"#4a4a70",marginBottom:"1.5rem"}}>Your vault is loading…</div>
            ):(
              <div style={{marginBottom:"1.5rem"}}>
                <h2 className="font-display" style={{fontSize:"clamp(1.35rem,4vw,1.9rem)",fontWeight:700,letterSpacing:"-.02em",lineHeight:1.15,color:"#f2e9df",marginBottom:"1rem"}}>Your archive starts with an artist.</h2>
                <button onClick={()=>onGoBinder("artists")} className="btn-ghost" style={{borderRadius:10,padding:".55rem 1.1rem",fontSize:".78rem",fontWeight:600}}>Explore Artists →</button>
              </div>
            )
          )}

          {/* V-C.3: quiet Hunt Show entry point — only appears when there is
              at least one card with explicit hunting/want intent. */}
          {huntShowCount>0&&(
            <div style={{marginBottom:"1.25rem"}}>
              <button onClick={()=>onGoBinder("hunt-show")} style={{background:"none",border:"none",cursor:"pointer",color:"#8b6cd8",fontSize:".74rem",fontWeight:600,letterSpacing:".01em",padding:0}}>Show my full hunt →</button>
            </div>
          )}

          <div style={{display:"flex",flexWrap:"wrap",alignItems:"baseline",gap:"1.5rem",borderTop:"1px solid #16162a",paddingTop:"1.1rem"}}>
            <div style={{display:"flex",alignItems:"baseline",gap:".35rem"}}>
              <span style={{fontSize:"1.2rem",fontWeight:800,color:"#FF8833",letterSpacing:"-.02em"}}>{totalPct}%</span>
              <span style={{fontSize:".65rem",color:"#6b6b90"}}>complete</span>
            </div>
            <div style={{display:"flex",alignItems:"baseline",gap:".35rem"}}>
              <span style={{fontSize:"1.2rem",fontWeight:800,color:"#e8e8f4",letterSpacing:"-.02em"}}>{totalOwned.toLocaleString()}</span>
              <span style={{fontSize:".65rem",color:"#6b6b90"}}>cards owned</span>
            </div>
            {favorites.size>0&&(
              <div style={{display:"flex",alignItems:"baseline",gap:".35rem"}}>
                <span style={{fontSize:"1.2rem",fontWeight:800,color:"#E8C030",letterSpacing:"-.02em"}}>{mostWanted.length}</span>
                <span style={{fontSize:".65rem",color:"#6b6b90"}}>still wanted</span>
              </div>
            )}
          </div>
          <div style={{height:4,background:"#1e1e35",borderRadius:2,overflow:"hidden",maxWidth:320,marginTop:".75rem"}}>
            <div className="prog-fill" style={{width:`${totalPct}%`,height:"100%",borderRadius:2,background:"linear-gradient(90deg,#cf5417,#8b6cd8)"}}/>
          </div>
        </div>

        <section style={{marginBottom:"1.5rem"}}>
          <h3 style={{fontSize:".62rem",letterSpacing:".14em",color:"#6b6b90",fontWeight:700,marginBottom:".75rem",paddingBottom:".5rem",borderBottom:"1px solid #1e1e35"}}>★ MOST WANTED</h3>
          {favorites.size===0?(
            <div style={{fontSize:".8rem",color:"#3a3a5a",padding:"1.25rem",textAlign:"center",border:"1px dashed #1e1e35",borderRadius:12,lineHeight:1.6}}>
              Tap the <strong style={{color:"#E8C030"}}>★</strong> on any card to add it to your Most Wanted list.<br/>
              <span style={{fontSize:".72rem",color:"#2a2a4a"}}>Your wishlist for the next card show.</span>
            </div>
          ):mostWanted.length===0?(
            <div style={{fontSize:".82rem",color:"#8fae98",padding:"1.25rem",textAlign:"center",border:"1px solid #1e1e35",borderRadius:12,letterSpacing:".01em"}}>Every card on your list is home.</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
              {visibleWanted.map(({card,artist},i)=>{
                const ebayQ=encodeURIComponent(`${card.name} ${card.localId||""} ${(card.set?.name||"").replace(/&/g,"and")} pokemon card near mint`);
                const ebayUrl=`https://www.ebay.com/sch/i.html?_nkw=${ebayQ}&LH_Complete=1&LH_Sold=1`;
                const price=getBestPrice(card);
                const sm=imgSmall(card);
                return(
                  <div key={card.id} className="wanted-row" onClick={()=>onCardClick&&onCardClick(card)} style={{display:"flex",alignItems:"center",gap:".75rem",padding:".6rem .75rem",cursor:"pointer"}}>
                    <div style={{fontSize:".7rem",color:"#3a3a5a",fontWeight:700,flexShrink:0,width:18}}>{i+1}</div>
                    {sm&&<img src={sm} alt={card.name} style={{width:38,height:"auto",borderRadius:4,filter:"grayscale(0.15)",flexShrink:0}}/>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:".85rem",color:"#e8e8f4",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{card.name}</div>
                      <div style={{fontSize:".67rem",color:"#6b6b90"}}>{artist.name} · {card.set?.name}</div>
                    </div>
                    {price&&<div style={{fontWeight:700,color:"#9b9bc0",fontSize:".82rem",flexShrink:0}}>{fmtPrice(price.amount)}</div>}
                    <a href={ebayUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"flex",alignItems:"center",background:"#1a1810",color:"#c8a020",border:"1px solid #3a3010",borderRadius:6,padding:"3px 8px",textDecoration:"none",fontSize:".68rem",fontWeight:600,flexShrink:0,whiteSpace:"nowrap"}}>eBay →</a>
                  </div>
                );
              })}
              {mostWanted.length>3&&(
                <button onClick={()=>setShowAllWanted(v=>!v)} style={{marginTop:"4px",width:"100%",background:"none",border:"1px dashed #1e1e35",borderRadius:8,padding:".55rem",cursor:"pointer",color:"#4a4a70",fontSize:".72rem",fontWeight:600,letterSpacing:".06em",transition:"color .15s,border-color .15s"}} onMouseEnter={e=>{e.currentTarget.style.color="#9b7ce8";e.currentTarget.style.borderColor="#9b7ce8";}} onMouseLeave={e=>{e.currentTarget.style.color="#4a4a70";e.currentTarget.style.borderColor="#1e1e35";}}>
                  {showAllWanted?`Show fewer ↑`:`Show all ${mostWanted.length} ↓`}
                </button>
              )}
            </div>
          )}
        </section>

        <section style={{marginBottom:"1.5rem"}}>
          <h3 onClick={()=>setMainOpen(v=>!v)} style={{fontSize:".62rem",letterSpacing:".14em",color:"#6b6b90",fontWeight:700,marginBottom:mainOpen?".75rem":0,padding:".35rem 0 .5rem",borderBottom:"1px solid #1e1e35",display:"flex",alignItems:"baseline",gap:".6rem",cursor:"pointer",userSelect:"none"}}>
            <span style={{fontSize:".55rem",color:"#4a4a70"}}>{mainOpen?"▼":"▶"}</span>
            <span>MAIN ARTISTS</span>
            {!mainOpen&&<span style={{color:"#3a3a5a",fontWeight:600,letterSpacing:0}}>· {mainStats.length}</span>}
            <button onClick={e=>{e.stopPropagation();onGoBinder("artists");}} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#8b6cd8",fontSize:".64rem",fontWeight:700,letterSpacing:".04em",padding:0,whiteSpace:"nowrap"}}>Explore Artists →</button>
          </h3>
          {mainOpen&&<div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
            {mainStats.map(entry=>(
              <div key={entry.name} className="artist-row" onClick={()=>onGoBinder("artist:"+toSlug(entry.name))} style={{display:"flex",alignItems:"center",gap:".75rem",padding:".6rem .75rem"}}>
                <div style={{width:145,flexShrink:0}}><span style={{fontSize:".875rem",fontWeight:600,color:entry.pct===100?"#22c55e":"#e8e8f4"}}>{entry.name}{entry.pct===100?" ✓":""}</span></div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{height:4,background:"#1e1e35",borderRadius:2,overflow:"hidden"}}><div className="prog-fill" style={{width:`${entry.pct}%`,height:"100%",borderRadius:2,background:entry.pct===100?"#22c55e":"linear-gradient(90deg,#7b5cc8,#9b7ce8)"}}/></div>
                </div>
                <div style={{fontSize:".72rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums",flexShrink:0,minWidth:65,textAlign:"right"}}>{entry.owned}/{entry.total} <span style={{color:entry.pct===100?"#22c55e":entry.pct>50?"#8b6cd8":"#4a4a70"}}>{entry.pct}%</span></div>
                <div style={{fontSize:".65rem",color:"#2a2a40",flexShrink:0}}>→</div>
              </div>
            ))}
          </div>}
        </section>

        {secStats.length>0&&(
          <section style={{marginBottom:"1.5rem"}}>
            <h3 onClick={()=>setSecOpen(v=>!v)} style={{fontSize:".62rem",letterSpacing:".14em",color:"#6b6b90",fontWeight:700,marginBottom:secOpen?".75rem":0,padding:".35rem 0 .5rem",borderBottom:"1px solid #1e1e35",display:"flex",alignItems:"baseline",gap:".6rem",cursor:"pointer",userSelect:"none"}}>
              <span style={{fontSize:".55rem",color:"#4a4a70"}}>{secOpen?"▼":"▶"}</span>
              <span>SECONDARY & SPECIAL</span>
              {!secOpen&&<span style={{color:"#3a3a5a",fontWeight:600,letterSpacing:0}}>· {secStats.length}</span>}
            </h3>
            {secOpen&&<div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
              {secStats.map(entry=>(
                <div key={entry.name} className="artist-row" onClick={()=>onGoBinder("artist:"+toSlug(entry.name))} style={{display:"flex",alignItems:"center",gap:".75rem",padding:".5rem .75rem"}}>
                  <div style={{width:145,flexShrink:0}}><span style={{fontSize:".8rem",color:entry.pct===100?"#22c55e":"#8888a8"}}>{entry.name}{entry.pct===100?" ✓":""}</span></div>
                  <div style={{flex:1,minWidth:0}}><div style={{height:3,background:"#1e1e35",borderRadius:2,overflow:"hidden"}}><div className="prog-fill" style={{width:`${entry.pct}%`,height:"100%",borderRadius:2,background:entry.pct===100?"#22c55e":"#4a3880"}}/></div></div>
                  <div style={{fontSize:".68rem",color:"#3a3a60",fontVariantNumeric:"tabular-nums",flexShrink:0,minWidth:50,textAlign:"right"}}>{entry.owned}/{entry.total}</div>
                  <div style={{fontSize:".65rem",color:"#1e1e30",flexShrink:0}}>→</div>
                </div>
              ))}
            </div>}
          </section>
        )}

        {addedStats.length>0&&(
          <section style={{marginBottom:"1.5rem"}}>
            <h3 style={{fontSize:".62rem",letterSpacing:".14em",color:"#6b6b90",fontWeight:700,marginBottom:".75rem",paddingBottom:".5rem",borderBottom:"1px solid #1e1e35"}}>YOUR ADDITIONS</h3>
            <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
              {addedStats.map(entry=>(
                <div key={entry.name} className="artist-row" onClick={()=>onGoBinder("artist:"+toSlug(entry.name))} style={{display:"flex",alignItems:"center",gap:".75rem",padding:".5rem .75rem"}}>
                  <div style={{width:145,flexShrink:0}}><span style={{fontSize:".8rem",color:entry.pct===100?"#22c55e":"#8888a8"}}>{entry.name}{entry.pct===100?" ✓":""}</span></div>
                  <div style={{flex:1,minWidth:0}}><div style={{height:3,background:"#1e1e35",borderRadius:2,overflow:"hidden"}}><div className="prog-fill" style={{width:`${entry.pct}%`,height:"100%",borderRadius:2,background:entry.pct===100?"#22c55e":"#4a3880"}}/></div></div>
                  <div style={{fontSize:".68rem",color:"#3a3a60",fontVariantNumeric:"tabular-nums",flexShrink:0,minWidth:50,textAlign:"right"}}>{entry.owned}/{entry.total}</div>
                  <div style={{fontSize:".65rem",color:"#1e1e30",flexShrink:0}}>→</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* V-C.1: intentional Explore Artists CTA near the artist sections. */}
        <div style={{marginBottom:"1rem"}}>
          <button onClick={()=>onGoBinder("artists")} className="btn-ghost" style={{width:"100%",borderRadius:12,padding:".7rem",fontSize:".78rem",fontWeight:600,color:"#8b6cd8",display:"flex",alignItems:"center",justifyContent:"center",gap:".4rem"}}>Explore the artist archive →</button>
        </div>

        {/* OL-1: quiet Owned Library doorway. No fetch here — data loads only
            after entering the view. */}
        <button onClick={()=>onGoBinder("owned-library")} className="artist-row" style={{width:"100%",display:"flex",flexDirection:"column",alignItems:"flex-start",gap:2,background:"rgba(255,255,255,0.02)",border:"1px solid #1a1a30",borderRadius:12,padding:".7rem .85rem",marginBottom:"1.5rem",textAlign:"left",cursor:"pointer"}}>
          <span style={{fontSize:".82rem",fontWeight:600,color:"#e8e8f4"}}>Owned Library</span>
          <span style={{fontSize:".7rem",color:"#7a7aa0"}}>Browse the cards matched from your latest import →</span>
        </button>

        <div style={{textAlign:"center",padding:"1.5rem 0 3rem"}}>
          <button onClick={()=>onGoBinder("binder")} className="btn-flame" style={{borderRadius:50,padding:".85rem 2.5rem",fontSize:".95rem",fontWeight:800,letterSpacing:".08em",boxShadow:"0 4px 16px rgba(190,70,20,0.22)"}}>OPEN FULL BINDER →</button>
        </div>
      </div>
    </div>
  );
}

// ── CARD TILE ──────────────────────────────────────────────────────────────────
const CardTile=React.memo(function CardTile({card,owned,manualOwned,manualMissing,isFavorite,onCardClick,onToggleFavorite,readOnly,intentStatus}){
  const badge=owned?{color:"#22c55e",label:"✓"}:null;
  const sm=imgSmall(card);
  const[fallback,setFallback]=useState(undefined); // undefined=not tried yet, false=tried & missing, {small,large}=found
  const[limitlessFailed,setLimitlessFailed]=useState(false);
  useEffect(()=>{
    if(sm||fallback!==undefined)return;
    let cancelled=false;
    fetchFallbackImage(card.id).then(r=>{if(!cancelled)setFallback(r);});
    return()=>{cancelled=true;};
  },[sm,card.id]);
  const limitlessGuess=fallback===false?buildLimitlessGuess(card):null;
  const displaySrc=sm||(fallback&&fallback.small)||(limitlessGuess&&!limitlessFailed?limitlessGuess.small:null);
  const isUnverified=!sm&&!(fallback&&fallback.small)&&!!displaySrc;
  return(
    <div className={`card-tile ${owned?"owned":"missing"}`}>
      <div onClick={()=>onCardClick(card)} style={{display:"block"}}>
        {displaySrc?<img src={displaySrc} alt={card.name} loading="lazy" decoding="async" onError={isUnverified?()=>setLimitlessFailed(true):undefined}/>:<div className="card-blank"><div className="blank-inner">{fallback===undefined?<IcoSpin/>:<IcoNoImage/>}<span>{card.name}</span></div></div>}
      </div>
      {badge&&<div style={{position:"absolute",top:3,right:3,background:badge.color,borderRadius:"50%",width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:"white",fontWeight:700,pointerEvents:"none"}}>{badge.label}</div>}
      {!readOnly&&!owned&&(intentStatus==="hunting"||intentStatus==="want")&&<div title={`Hunt status: ${intentStatus}`} style={{position:"absolute",top:3,left:3,width:9,height:9,borderRadius:"50%",background:intentStatus==="hunting"?"#9b7fe8":"transparent",border:intentStatus==="hunting"?"1.5px solid rgba(7,7,15,0.85)":"1.5px solid #9b7fe8",boxShadow:"0 1px 4px rgba(0,0,0,0.6)",pointerEvents:"none"}}/>}
      {!readOnly&&<button className={`fav-btn ${isFavorite?"on":"off"}`} onClick={e=>{e.stopPropagation();onToggleFavorite(card.id);}}>★</button>}
    </div>
  );
});

// ── PRICE CHART ────────────────────────────────────────────────────────────────
function PriceChart({history}){
  const hist=(history||[]).slice(-90);
  if(hist.length<2)return<div style={{textAlign:"center",color:"#6b6b90",fontSize:".75rem",padding:"1.25rem 0",lineHeight:1.6}}>Price history builds over time as you open cards.<br/>{hist.length===1?"1 point recorded.":"No history yet."}</div>;
  const prices=hist.map(h=>h.price),dates=hist.map(h=>h.date.slice(5));
  const minP=Math.min(...prices),maxP=Math.max(...prices),range=maxP-minP||1;
  const W=340,H=80,PX=8,PY=12,W2=W-2*PX,H2=H-2*PY;
  const pts=prices.map((p,i)=>[PX+(prices.length>1?(i/(prices.length-1))*W2:W2/2),PY+H2-((p-minP)/range)*H2]);
  const poly=pts.map(pt=>pt[0]+","+pt[1]).join(" ");
  const last=pts[pts.length-1],first=pts[0];
  const areaD=["M "+first[0]+","+(H-PY),...pts.map(pt=>"L "+pt[0]+","+pt[1]),"L "+last[0]+","+(H-PY),"Z"].join(" ");
  const gid="g"+(hist[0]?.date||"x").replace(/\D/g,"");
  return(
    <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",display:"block"}}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b6cd8" stopOpacity="0.25"/><stop offset="100%" stopColor="#8b6cd8" stopOpacity="0.02"/></linearGradient></defs>
      <line x1={PX} y1={PY} x2={W-PX} y2={PY} stroke="#1e1e35" strokeWidth="1"/>
      <line x1={PX} y1={PY+H2/2} x2={W-PX} y2={PY+H2/2} stroke="#1e1e35" strokeWidth="1"/>
      <line x1={PX} y1={H-PY} x2={W-PX} y2={H-PY} stroke="#1e1e35" strokeWidth="1"/>
      <path d={areaD} fill={"url(#"+gid+")"}/>
      <polyline points={poly} fill="none" stroke="#8b6cd8" strokeWidth="2" strokeLinejoin="round"/>
      <circle cx={last[0]} cy={last[1]} r="3" fill="#8b6cd8"/>
      <text x={W-PX} y={PY-2} textAnchor="end" fontSize="8" fill="#6b6b90">{fmtPrice(maxP)}</text>
      <text x={W-PX} y={H-1} textAnchor="end" fontSize="8" fill="#6b6b90">{fmtPrice(minP)}</text>
      <text x={PX} y={H-1} fontSize="8" fill="#6b6b90">{dates[0]}</text>
      <text x={W/2} y={H-1} textAnchor="middle" fontSize="8" fill="#6b6b90">{dates[Math.floor(dates.length/2)]}</text>
    </svg>
  );
}

// ── CARD MODAL ─────────────────────────────────────────────────────────────────
function CardModal({card,owned,manualOwned,manualMissing,isFavorite,priceHistory,onToggleManual,onToggleFavorite,onRecordPrice,onClose,readOnly,intentStatus,onSetIntent,onClearIntent}){
  const price=getBestPrice(card);
  const allVariants=card&&card.pricing&&card.pricing.tcgplayer?card.pricing.tcgplayer:{};
  const cmPrices=card&&card.pricing&&card.pricing.cardmarket&&card.pricing.cardmarket.prices?card.pricing.cardmarket.prices:null;
  const cmTrend=cmPrices?(cmPrices.trendPrice??cmPrices.averageSellPrice??null):null;
  const cmUrl=card&&card.pricing&&card.pricing.cardmarket?card.pricing.cardmarket.url:null;
  const isManualOwned  =manualOwned.has(card.id);
  const isManualMissing=manualMissing.has(card.id);
  const cardHistory=priceHistory[card.id]||[];
  const overrideStatus=isManualOwned?"manual-owned":isManualMissing?"manual-missing":"auto";
  const ebayQ=encodeURIComponent(`${card.name} ${card.localId||""} ${(card.set?.name||"").replace(/&/g,"and")} pokemon card near mint`);
  const ebayUrl=`https://www.ebay.com/sch/i.html?_nkw=${ebayQ}&LH_Complete=1&LH_Sold=1`;
  const tcgplayerUrl=`https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(card.name+" "+(card.set?.name||""))}`;
  const lg=imgLarge(card);
  const[modalFallback,setModalFallback]=useState(undefined);
  const[modalLimitlessFailed,setModalLimitlessFailed]=useState(false);
  const[zoomed,setZoomed]=useState(false);
  useEffect(()=>{
    setModalFallback(undefined);
    setModalLimitlessFailed(false);
    if(lg)return;
    let cancelled=false;
    fetchFallbackImage(card.id).then(r=>{if(!cancelled)setModalFallback(r);});
    return()=>{cancelled=true;};
  },[lg,card.id]);
  const modalLimitlessGuess=modalFallback===false?buildLimitlessGuess(card):null;
  const displayLg=lg||(modalFallback&&(modalFallback.large||modalFallback.small))||(modalLimitlessGuess&&!modalLimitlessFailed?modalLimitlessGuess.large:null);
  const sourceTier=lg?"tcgdex":((modalFallback&&(modalFallback.large||modalFallback.small))?"ptcgio":(displayLg?"limitless":null));

  useEffect(()=>{if(readOnly||!card||!price)return;const td=todayStr();if(!cardHistory.find(h=>h.date===td))onRecordPrice(card.id,price.amount,td);},[card&&card.id]);
  useEffect(()=>{const fn=e=>{if(e.key==="Escape")onClose();};window.addEventListener("keydown",fn);return()=>window.removeEventListener("keydown",fn);},[onClose]);
  useEffect(()=>{document.body.style.overflow="hidden";return()=>{document.body.style.overflow="";};},[]);
  if(!card)return null;

  const variantEntries=Object.entries(allVariants).filter(([k,v])=>k!=="updated"&&k!=="unit"&&v&&v.marketPrice!=null);

  return(<>
    <div className="modal-bg" onClick={onClose} style={{position:"fixed",inset:0,zIndex:200,background:"rgba(7,7,15,0.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div className="fade-up" onClick={e=>e.stopPropagation()} style={{background:"#141425",border:"1px solid #1e1e35",borderRadius:16,maxWidth:460,width:"100%",maxHeight:"90dvh",overflowY:"auto",padding:"1.25rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"1rem"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
              <h2 style={{fontWeight:700,fontSize:"1.05rem",color:"#e8e8f4"}}>{card.name}</h2>
              {!readOnly&&<button onClick={()=>onToggleFavorite(card.id)} style={{background:isFavorite?"rgba(255,200,30,0.15)":"rgba(255,255,255,0.05)",border:`1px solid ${isFavorite?"rgba(255,200,30,0.4)":"#1e1e35"}`,borderRadius:6,padding:"2px 7px",cursor:"pointer",fontSize:".75rem",color:isFavorite?"#E8C030":"#4a4a70",flexShrink:0}}>{isFavorite?"★ Favorite":"☆ Favorite"}</button>}
            </div>
            <div style={{fontSize:".7rem",color:"#6b6b90",marginTop:2}}>{card.set&&card.set.name} · #{card.localId} · {card.rarity}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#6b6b90",cursor:"pointer",padding:4,display:"flex",flexShrink:0}}><IcoX/></button>
        </div>

        <div style={{display:"flex",gap:"1rem",marginBottom:"1.25rem"}}>
          <div style={{flexShrink:0,width:128}}>
            {displayLg?<img src={displayLg} alt={card.name} onClick={()=>setZoomed(true)} style={{width:"100%",borderRadius:8,cursor:"zoom-in"}} onError={sourceTier==="limitless"?()=>setModalLimitlessFailed(true):undefined}/>:<div className="card-blank" style={{borderRadius:8}}><div className="blank-inner">{!lg&&modalFallback===undefined?<IcoSpin size={26}/>:<IcoNoImage size={26}/>}<span style={{fontSize:".68rem"}}>{!lg&&modalFallback===undefined?"Checking for an image…":<>No image available<br/>for this card</>}</span></div></div>}
            {sourceTier==="ptcgio"&&<div style={{fontSize:".6rem",color:"#4a4a70",marginTop:4,textAlign:"center"}}>Image via Pokémon TCG API archive (TCGdex has none for this card)</div>}
            {sourceTier==="limitless"&&<div style={{fontSize:".6rem",color:"#4a4a70",marginTop:4,textAlign:"center"}}>Image via Limitless TCG — unverified match, TCGdex has none for this card</div>}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{marginBottom:".75rem"}}>
              <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:4,fontSize:".7rem",fontWeight:600,background:owned?"rgba(34,197,94,0.12)":"rgba(107,107,144,0.15)",color:owned?"#22c55e":"#6b6b90"}}>
                {owned?<span style={{display:"flex",alignItems:"center",gap:3}}><IcoCheck/> In Collection</span>:"Missing"}
              </span>
              {isManualOwned  &&<span style={{marginLeft:6,fontSize:".65rem",color:"#60a5fa",background:"rgba(96,165,250,0.12)",padding:"1px 6px",borderRadius:4}}>✏ Manual</span>}
              {isManualMissing&&<span style={{marginLeft:6,fontSize:".65rem",color:"#f87171",background:"rgba(248,113,113,0.12)",padding:"1px 6px",borderRadius:4}}>✏ Override</span>}
            </div>
            <div style={{fontSize:".68rem",color:"#6b6b90"}}>Artist</div>
            <div style={{fontSize:".85rem",color:"#e8e8f4",marginBottom:".75rem",fontWeight:500}}>{card.illustrator}</div>
            {price?(
              <div>
                <div style={{fontSize:".68rem",color:"#6b6b90"}}>TCGPlayer Market</div>
                <div style={{fontSize:"1.5rem",fontWeight:800,color:"#8b6cd8",letterSpacing:"-.02em",lineHeight:1.1,marginBottom:".3rem"}}>{fmtPrice(price.amount)}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:".5rem",fontSize:".68rem"}}>
                  {price.prices?.low !=null&&<span style={{color:"#6b6b90"}}>Low  <span style={{color:"#9b9bc0"}}>{fmtPrice(price.prices.low)}</span></span>}
                  {price.prices?.mid !=null&&<span style={{color:"#6b6b90"}}>Mid  <span style={{color:"#9b9bc0"}}>{fmtPrice(price.prices.mid)}</span></span>}
                  {price.prices?.high!=null&&<span style={{color:"#6b6b90"}}>High <span style={{color:"#9b9bc0"}}>{fmtPrice(price.prices.high)}</span></span>}
                </div>
              </div>
            ):<div style={{fontSize:".78rem",color:"#6b6b90"}}>No pricing data</div>}
            {cmTrend!=null&&(
              <div style={{marginTop:".5rem",paddingTop:".5rem",borderTop:"1px solid #1e1e35"}}>
                <div style={{fontSize:".68rem",color:"#6b6b90"}}>Cardmarket Trend</div>
                <div style={{fontSize:"1.1rem",fontWeight:700,color:"#5b9dd8",letterSpacing:"-.01em"}}>€{cmTrend.toFixed(2)}</div>
                {cmPrices.lowPrice!=null&&<div style={{fontSize:".68rem",color:"#6b6b90"}}>Low <span style={{color:"#9b9bc0"}}>€{cmPrices.lowPrice.toFixed(2)}</span></div>}
              </div>
            )}
          </div>
        </div>

        {!readOnly&&(
          <div style={{marginBottom:"1rem",padding:".7rem",background:"#0f0f1c",borderRadius:10,border:"1px solid #1e1e35"}}>
            <div style={{fontSize:".65rem",color:"#6b6b90",marginBottom:".45rem",display:"flex",alignItems:"center",gap:4}}><IcoEdit/> Manual Override</div>
            <div style={{display:"flex",gap:".4rem"}}>
              <button onClick={()=>onToggleManual(card.id,"owned")} style={{flex:1,background:isManualOwned?"rgba(96,165,250,0.15)":"#141425",color:isManualOwned?"#60a5fa":"#6b6b90",border:`1px solid ${isManualOwned?"#60a5fa":"#1e1e35"}`,borderRadius:7,padding:".38rem .5rem",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>✓ Force Owned</button>
              <button onClick={()=>onToggleManual(card.id,"missing")} style={{flex:1,background:isManualMissing?"rgba(248,113,113,0.15)":"#141425",color:isManualMissing?"#f87171":"#6b6b90",border:`1px solid ${isManualMissing?"#f87171":"#1e1e35"}`,borderRadius:7,padding:".38rem .5rem",cursor:"pointer",fontSize:".72rem",fontWeight:600}}>✕ Force Missing</button>
              {overrideStatus!=="auto"&&<button onClick={()=>onToggleManual(card.id,"reset")} style={{background:"#141425",color:"#6b6b90",border:"1px solid #1e1e35",borderRadius:7,padding:".38rem .6rem",cursor:"pointer",fontSize:".72rem"}}>Reset</button>}
            </div>
          </div>
        )}

        {variantEntries.length>1&&(
          <div style={{marginBottom:"1rem"}}>
            <div style={{fontSize:".68rem",color:"#6b6b90",marginBottom:".4rem"}}>All Variants</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:".4rem"}}>
              {variantEntries.map(([k,v])=><div key={k} style={{background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:6,padding:"3px 8px",fontSize:".67rem"}}><span style={{color:"#6b6b90"}}>{k.replace(/-/g," ")}: </span><span style={{color:"#e8e8f4",fontWeight:600}}>{fmtPrice(v.marketPrice)}</span></div>)}
            </div>
          </div>
        )}

        <div style={{marginBottom:".75rem"}}>
          <div style={{fontSize:".68rem",color:"#6b6b90",marginBottom:".4rem"}}>Price History</div>
          <PriceChart history={cardHistory}/>
        </div>

        {!readOnly&&!owned&&onSetIntent&&(
          <div style={{marginBottom:".75rem"}}>
            <div style={{fontSize:".65rem",color:"#6b6b90",marginBottom:".4rem"}}>Hunt status</div>
            <div style={{display:"flex",gap:".35rem"}}>
              {['want','hunting','maybe','ignore'].map(s=>(
                <button key={s} onClick={()=>intentStatus===s?onClearIntent(card.id):onSetIntent(card,s)} style={{flex:1,background:intentStatus===s?"rgba(139,108,216,0.18)":"#141425",color:intentStatus===s?"#9b7fe8":"#4a4a70",border:`1px solid ${intentStatus===s?"#5a3d9e":"#1e1e35"}`,borderRadius:7,padding:".35rem .3rem",cursor:"pointer",fontSize:".68rem",fontWeight:intentStatus===s?700:500,textTransform:"capitalize"}}>{s}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:".5rem"}}>
          <a href={tcgplayerUrl} target="_blank" rel="noopener noreferrer" style={{flex:1,display:"block",textAlign:"center",background:"#1a1430",color:"#9b7fe8",padding:".5rem",borderRadius:8,textDecoration:"none",fontSize:".75rem",border:"1px solid #2e2255",fontWeight:500}}>TCGPlayer →</a>
          <a href={ebayUrl} target="_blank" rel="noopener noreferrer" style={{flex:1,display:"block",textAlign:"center",background:"#1a1810",color:"#c8a020",padding:".5rem",borderRadius:8,textDecoration:"none",fontSize:".75rem",border:"1px solid #3a3010",fontWeight:500}}>eBay Sold →</a>
        </div>
      </div>
    </div>
    {zoomed&&displayLg&&(
      <div onClick={()=>setZoomed(false)} style={{position:"fixed",inset:0,zIndex:400,background:"rgba(0,0,0,0.95)",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem",cursor:"zoom-out"}}>
        <img src={displayLg} alt={card.name} style={{maxWidth:"min(96vw,700px)",maxHeight:"92dvh",width:"auto",height:"auto",borderRadius:12,boxShadow:"0 0 60px rgba(139,108,216,0.25)"}} onClick={e=>e.stopPropagation()}/>
        <button onClick={()=>setZoomed(false)} style={{position:"absolute",top:"1rem",right:"1rem",background:"rgba(255,255,255,0.1)",border:"none",color:"#fff",borderRadius:"50%",width:36,height:36,cursor:"pointer",fontSize:"1.1rem",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
      </div>
    )}
  </>
  );
}


// ── ARTIST PAGE ─────────────────────────────────────────────────────────────────
// Dedicated full-screen page for a single illustrator.
// Each artist gets a unique accent colour, quote, and hero layout.
function ArtistPage({slug,entry,cards,checkOwned,manualOwned,manualMissing,favorites,onCardClick,onToggleFavorite,intentMap,showAllColor,toggleShowAllColor,onBack}){
  const meta=ARTIST_META[slug]||{};
  const accent=meta.accent||"#8b6cd8";
  const grad=meta.grad||"rgba(139,108,216,0.12)";
  const fact=entry?ARTIST_FACTS[entry.name]:null;
  const[search,setSearch]=useState("");
  const[sortBy,setSortBy]=useState("date-asc");
  const[viewMode,setViewMode]=useState(null);
  const[bandOpen,setBandOpen]=useState(true); // Slice C: archive band collapse, local only
  const owned=useMemo(()=>cards.filter(checkOwned).length,[cards,checkOwned]);
  const total=cards.length;
  const pct=total?Math.round((owned/total)*100):0;
  const intentCounts=useMemo(()=>{
    const c={want:0,hunting:0,maybe:0,ignore:0};
    if(intentMap&&intentMap.size)cards.forEach(card=>{if(checkOwned(card))return;const st=intentMap.get(card.id);if(st!==undefined&&c[st]!==undefined)c[st]++;});
    return c;
  },[cards,intentMap,checkOwned]);
  // Slice C: planning chips only. Owned/Missing chips duplicated the
  // progress line and had no job; Hunting / On the list are now tappable
  // shortcuts into the Hunting segment (same viewMode state as the sticky
  // controls — no new state). Intent semantics untouched: read-only counts.
  const planChips=[
    ...(intentCounts.hunting>0?[{label:"Hunting",value:intentCounts.hunting,clr:accent}]:[]),
    ...(intentCounts.want>0?[{label:"On the list",value:intentCounts.want,clr:"#9b7fe8"}]:[]),
  ];

  // One pick per named Pokémon in topCardNames — prefer cards with images
  const topCards=useMemo(()=>{
    if(!meta.topCardNames||!meta.topCardNames.length)return[];
    const result=[];const seen=new Set();
    meta.topCardNames.forEach(name=>{
      const norm=name.toLowerCase();
      if(seen.has(norm))return;
      const matches=cards.filter(c=>(c.name||"").toLowerCase().startsWith(norm));
      if(matches.length){
        const withImg=matches.filter(c=>imgSmall(c));
        result.push(withImg.length?withImg[0]:matches[0]);
        seen.add(norm);
      }
    });
    return result;
  },[cards,meta.topCardNames]);

  // Hero uses top cards for the scattered backdrop if we have enough, else first few
  const heroCards=useMemo(()=>(topCards.length>=2?topCards:cards.filter(c=>imgSmall(c))).filter(c=>imgSmall(c)).slice(0,3),[cards,topCards]);

  const POSES=[
    {r:"5%", t:"8%",  rot:"-7deg",w:132,op:1   },
    {r:"36%",t:"30%", rot:"5deg", w:108,op:0.87},
    {r:"10%",t:"54%", rot:"-3deg",w:90, op:0.72},
  ];
  const displayName=entry?.name||slug;
  const selSt={background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:7,color:"#e8e8f4",padding:".35rem .55rem",fontSize:".74rem"};

  return(
    <div className={showAllColor?"color-mode":""} style={{minHeight:"100dvh",background:"#07070f"}}>

      {/* ── sticky mini-header ── */}
      <div style={{position:"sticky",top:0,zIndex:100,background:"rgba(7,7,15,0.96)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderBottom:"1px solid #1e1e35",display:"flex",alignItems:"center",gap:".6rem",padding:".6rem 1rem"}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#6b6b90",cursor:"pointer",display:"flex",alignItems:"center",gap:".25rem",fontSize:".76rem",padding:"3px 5px",borderRadius:5,transition:"color .12s"}} onMouseEnter={e=>e.currentTarget.style.color="#e8e8f4"} onMouseLeave={e=>e.currentTarget.style.color="#6b6b90"}>
          ← Dashboard
        </button>
        <div style={{width:1,height:14,background:"#1e1e35",flexShrink:0}}/>
        <span style={{fontSize:".78rem",fontWeight:700,color:accent,letterSpacing:".02em",flex:1,minWidth:0,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{displayName}</span>
        <span style={{fontSize:".68rem",color:"#3a3a5a",whiteSpace:"nowrap"}}>{owned}/{total}</span>
      </div>

      {/* ── hero ── */}
      <div style={{position:"relative",overflow:"hidden",minHeight:268,background:`radial-gradient(ellipse at 18% 65%, ${grad.replace(/[\d.]+\)$/,"0.22)")} 0%, transparent 68%)`,padding:"2rem 1.25rem 1.75rem"}}>
        <div style={{position:"absolute",inset:0,zIndex:1,background:"linear-gradient(to right, #07070f 36%, rgba(7,7,15,0.75) 56%, transparent 100%)"}}/>
        {heroCards.map((card,i)=>{
          const p=POSES[i];
          return(<img key={card.id} src={imgSmall(card)} alt={card.name} style={{position:"absolute",zIndex:0,right:p.r,top:p.t,width:p.w,height:"auto",borderRadius:9,transform:`rotate(${p.rot})`,opacity:p.op,boxShadow:`0 14px 44px rgba(0,0,0,0.72), 0 0 28px ${accent}28`,filter:"brightness(0.88)"}}/>);
        })}
        <div style={{position:"relative",zIndex:2,maxWidth:"63%",minWidth:170}}>
          {meta.tags&&<div style={{fontSize:".58rem",letterSpacing:".16em",color:accent,fontWeight:800,marginBottom:".55rem",opacity:.85,lineHeight:1.6}}>{meta.tags}</div>}
          <h1 className="font-display" style={{fontSize:"clamp(1.55rem,6.5vw,2.7rem)",fontWeight:900,color:"#f0f0ff",letterSpacing:"-.03em",lineHeight:1.05,marginBottom:".5rem"}}>{displayName}</h1>
          {fact?.since&&<div style={{fontSize:".62rem",color:"rgba(190,190,210,0.38)",marginBottom:".75rem",letterSpacing:".04em"}}>{fact.since}</div>}
          {meta.quote&&(
            <div style={{fontStyle:"italic",fontSize:".87rem",color:"rgba(228,224,248,0.62)",lineHeight:1.58,maxWidth:258,marginBottom:"1.2rem",borderLeft:`2px solid ${accent}`,paddingLeft:".65rem"}}>
              "{meta.quote}"
            </div>
          )}
          <div style={{display:"flex",alignItems:"center",gap:".7rem"}}>
            <div style={{flex:1,maxWidth:156}}>
              <div style={{height:3,background:"rgba(255,255,255,0.07)",borderRadius:2,overflow:"hidden"}}>
                <div style={{width:`${pct}%`,height:"100%",borderRadius:2,background:pct===100?"#22c55e":accent,transition:"width 1.2s cubic-bezier(.16,1,.3,1)"}}/>
              </div>
            </div>
            <span style={{fontSize:".75rem",fontWeight:700,color:pct===100?"#22c55e":accent}}>{pct===100?"Complete ✓":`${pct}%`}</span>
            <span style={{fontSize:".66rem",color:"rgba(190,190,210,0.32)"}}>{owned}/{total}</span>
          </div>
          {planChips.length>0&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:".4rem",marginTop:".85rem"}}>
              {planChips.map(ch=>(
                <button key={ch.label} onClick={()=>setViewMode("hunting")} className="btn-tap" title="View hunt targets for this artist" style={{display:"inline-flex",alignItems:"center",gap:".35rem",padding:"3px 9px",borderRadius:20,background:"rgba(255,255,255,0.03)",border:"1px solid #1e1e35",fontSize:".62rem",letterSpacing:".05em",color:"#8888a8",whiteSpace:"nowrap",cursor:"pointer"}}>
                  <span style={{fontWeight:800,fontVariantNumeric:"tabular-nums",color:ch.clr}}>{ch.value}</span>{ch.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── archive band: story + notable cards (Slice C merged) ──
          One collapsible band (default open, local state, not persisted)
          replaces the separate About and Notable Cards bands. When an artist
          has neither story nor notable cards (all dynamic artists today), a
          quiet fallback line keeps the page skeleton identical instead of
          silently dropping the band. No curation/reordering system. */}
      {(fact?.story||fact?.fact||topCards.length>0)?(
        <div style={{borderBottom:"1px solid #1e1e35",background:`linear-gradient(135deg,${grad.replace(/[\d.]+\)$/,"0.06)")} 0%,transparent 60%)`}}>
          <div onClick={()=>setBandOpen(v=>!v)} style={{display:"flex",alignItems:"baseline",gap:".55rem",padding:".85rem 1.25rem",cursor:"pointer",userSelect:"none"}}>
            <span style={{fontSize:".55rem",color:"#4a4a70"}}>{bandOpen?"▼":"▶"}</span>
            <span style={{fontSize:".6rem",letterSpacing:".14em",fontWeight:800,color:accent}}>FROM THE ARCHIVE</span>
            {!bandOpen&&topCards.length>0&&<span style={{fontSize:".6rem",color:"#3a3a5a",fontWeight:600}}>· {topCards.length} notable card{topCards.length===1?"":"s"}</span>}
          </div>
          {bandOpen&&(
            <div style={{paddingBottom:".9rem"}}>
              {(fact?.story||fact?.fact)&&(
                <p style={{margin:0,padding:`0 1.25rem ${topCards.length>0?"1rem":".1rem"}`,fontSize:".82rem",lineHeight:1.72,color:"rgba(200,192,218,0.85)"}}>{fact.story||fact.fact}</p>
              )}
              {topCards.length>0&&(
                <div style={{display:"flex",gap:"10px",overflowX:"auto",padding:"0 1.25rem",scrollbarWidth:"none",WebkitOverflowScrolling:"touch"}}>
                  {topCards.map(card=>{
                    const isOwned=checkOwned(card);
                    const sm=imgSmall(card);
                    return(
                      <div key={card.id} onClick={()=>onCardClick(card)} style={{flexShrink:0,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:5,width:90,paddingBottom:4}}>
                        <div style={{borderRadius:9,overflow:"hidden",boxShadow:isOwned?`0 0 0 2px ${accent}, 0 6px 22px rgba(0,0,0,0.55)`:"0 4px 14px rgba(0,0,0,0.45)",transition:"transform .15s,box-shadow .15s"}} onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.05)";e.currentTarget.style.boxShadow=isOwned?`0 0 0 2px ${accent}, 0 10px 30px rgba(0,0,0,0.7)`:"0 8px 24px rgba(0,0,0,0.65)";}} onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.boxShadow=isOwned?`0 0 0 2px ${accent}, 0 6px 22px rgba(0,0,0,0.55)`:"0 4px 14px rgba(0,0,0,0.45)";}}>
                          {sm&&<img src={sm} alt={card.name} style={{display:"block",width:90,height:"auto",filter:isOwned?"brightness(1.05)":"grayscale(0.2) brightness(0.85)"}}/>}
                        </div>
                        <span style={{fontSize:".58rem",color:"#6b6b90",fontWeight:isOwned?600:500,textAlign:"center",lineHeight:1.2,width:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{isOwned?"✓ ":""}{card.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ):total>0?(
        <div style={{borderBottom:"1px solid #1e1e35",padding:".85rem 1.25rem"}}>
          <p style={{margin:0,fontSize:".76rem",color:"#6b6b90",letterSpacing:".01em"}}>
            {entry?.isDynamic?`One of your additions · ${total} card${total===1?"":"s"} in the archive.`:`${total} card${total===1?"":"s"} in the archive.`}
          </p>
        </div>
      ):null}

      {/* ── controls ── */}
      <div style={{position:"sticky",top:49,zIndex:90,background:"rgba(7,7,15,0.96)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",borderBottom:"1px solid #1e1e35",display:"flex",gap:".35rem",alignItems:"center",padding:".45rem .75rem",flexWrap:"wrap"}}>
        <div style={{flex:"1 1 110px",position:"relative",minWidth:0}}>
          <span style={{position:"absolute",left:".55rem",top:"50%",transform:"translateY(-50%)",color:"#6b6b90",fontSize:".7rem",pointerEvents:"none"}}>⌕</span>
          <input type="search" placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)} style={{...selSt,width:"100%",paddingLeft:"1.6rem"}}/>
        </div>
        <div style={{display:"flex",gap:2,background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,padding:2}}>
          {[{key:null,label:"All",on:"#e8e8f4",bg:"rgba(255,255,255,0.08)",bd:"#3a3a5a"},{key:"owned",label:"Owned",on:"#6ee7b7",bg:"rgba(34,197,94,0.12)",bd:"#22c55e"},{key:"missing",label:"Missing",on:"#c0a0f8",bg:"rgba(139,108,216,0.18)",bd:"#8b6cd8"},{key:"hunting",label:"Hunting",on:"#b9a3f2",bg:"rgba(155,127,232,0.16)",bd:"#9b7fe8"}].map(seg=>{const active=viewMode===seg.key;return(<button key={seg.label} onClick={()=>setViewMode(seg.key)} style={{background:active?seg.bg:"transparent",color:active?seg.on:"#6b6b90",border:`1px solid ${active?seg.bd:"transparent"}`,borderRadius:6,padding:".3rem .55rem",cursor:"pointer",fontSize:".72rem",fontWeight:active?700:500,whiteSpace:"nowrap",transition:"all .12s"}}>{seg.label}</button>);})}
        </div>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...selSt,maxWidth:72}}>
          <option value="name">A–Z</option>
          <option value="price-desc">$↓</option>
          <option value="price-asc">$↑</option>
          <option value="date-desc">New</option>
          <option value="date-asc">Old</option>
        </select>
        {toggleShowAllColor&&<button onClick={toggleShowAllColor} className="btn-ghost" title={showAllColor?"Showing missing cards in color":"Showing missing cards grayed out"} style={{color:showAllColor?"#c0589e":"#6b6b90",borderRadius:8,padding:".38rem",display:"flex",background:showAllColor?"rgba(192,88,158,0.12)":undefined,border:showAllColor?"1px solid rgba(192,88,158,0.3)":undefined}}><IcoContrast/></button>}
      </div>

      {/* ── hunting summary (Slice C) — artist-level planning framing.
          Hidden while searching so counts never disagree with the filtered
          grid below. Read-only over intentCounts. ── */}
      {viewMode==="hunting"&&!search&&(intentCounts.hunting+intentCounts.want>0)&&(
        <div style={{maxWidth:860,margin:"0 auto",padding:"1rem 1rem 0"}}>
          <p style={{margin:0,fontSize:".74rem",color:"#6b6b90",letterSpacing:".01em"}}>
            <span style={{color:"#b9a3f2",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{intentCounts.hunting}</span> active target{intentCounts.hunting===1?"":"s"} · <span style={{color:"#8888b8",fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{intentCounts.want}</span> on the list
          </p>
        </div>
      )}

      {/* ── full card grid ── */}
      <div style={{maxWidth:860,margin:"0 auto",padding:"1rem"}}>
        <ArtistSection entry={entry} cards={cards} checkOwned={checkOwned} manualOwned={manualOwned} manualMissing={manualMissing} favorites={favorites} onCardClick={onCardClick} onToggleFavorite={onToggleFavorite} searchQuery={search} sortBy={sortBy} viewMode={viewMode} intentMap={intentMap} soloSections noHeader/>
      </div>

    </div>
  );
}


// ── ARTIST SECTION ─────────────────────────────────────────────────────────────
function ArtistSection({entry,cards,checkOwned,manualOwned,manualMissing,favorites,onCardClick,onToggleFavorite,searchQuery,sortBy,viewMode,readOnly,noHeader,intentMap,soloSections,startCollapsed}){
  const isSecondary=entry.tier==="secondary";
  // B-1: startCollapsed is opt-in (default false) so only the Binder's own
  // ArtistSection calls it — ArtistPage (noHeader=true, always shows its one
  // section) and SharedBinder (prop omitted) are unaffected and keep the
  // pre-B-1 default (main tiers open, secondary collapsed).
  const[open,setOpen]=useState(()=>noHeader?true:(startCollapsed?false:!isSecondary));
  const[showFact,setShowFact]=useState(false);
  const fact=ARTIST_FACTS[entry.name];
  const displayCards=useMemo(()=>{let arr=cards;if(searchQuery){const q=searchQuery.toLowerCase();arr=arr.filter(c=>(c.name||"").toLowerCase().includes(q));}return sortCards(arr,sortBy,checkOwned);},[cards,searchQuery,sortBy,checkOwned]);
  const groupedBySet=useMemo(()=>{if(!viewMode)return null;const filtered=searchQuery?cards.filter(c=>(c.name||"").toLowerCase().includes(searchQuery.toLowerCase())):cards;const missingCards=filtered.filter(c=>!checkOwned(c));const ownedCards=filtered.filter(c=>checkOwned(c));const bySet=list=>{const groups=new Map();list.forEach(card=>{const sid=(card.set&&card.set.id)||"unknown",sname=(card.set&&card.set.name)||"Unknown Set";if(!groups.has(sid))groups.set(sid,{id:sid,name:sname,cards:[]});groups.get(sid).cards.push(card);});groups.forEach(g=>{if(sortBy==="price-desc"){g.cards.sort((a,b)=>{const pa=getBestPrice(a),pb=getBestPrice(b);if(!pa&&!pb)return(a.name||"").localeCompare(b.name||"");if(!pa)return 1;if(!pb)return-1;return pb.amount-pa.amount;});}else if(sortBy==="price-asc"){g.cards.sort((a,b)=>{const pa=getBestPrice(a),pb=getBestPrice(b);if(!pa&&!pb)return(a.name||"").localeCompare(b.name||"");if(!pa)return 1;if(!pb)return-1;return pa.amount-pb.amount;});}else{g.cards.sort((a,b)=>(a.name||"").localeCompare(b.name||""));}});return Array.from(groups.values()).sort((a,b)=>{const oa=SET_ORDER[a.id]??999,ob=SET_ORDER[b.id]??999;if(sortBy==="date-desc")return oa===ob?(a.name||"").localeCompare(b.name||""):ob-oa;return oa===ob?(a.name||"").localeCompare(b.name||""):oa-ob;});};if(viewMode==="hunting"){const st=id=>intentMap?intentMap.get(id):undefined;const huntCards=missingCards.filter(c=>st(c.id)==="hunting");const wantCards=missingCards.filter(c=>st(c.id)==="want");return{hunting:bySet(huntCards),want:bySet(wantCards),huntingCount:huntCards.length,wantCount:wantCards.length};}return{missing:bySet(missingCards),owned:bySet(ownedCards),missingCount:missingCards.length,ownedCount:ownedCards.length};},[cards,searchQuery,sortBy,viewMode,checkOwned,intentMap]);
  const ownedCount=useMemo(()=>cards.filter(checkOwned).length,[cards,checkOwned]);
  const pct=cards.length?Math.round((ownedCount/cards.length)*100):0;
  const complete=pct===100&&cards.length>0;
  useEffect(()=>{if(searchQuery&&displayCards.length>0)setOpen(true);},[searchQuery,displayCards.length]);
  if(searchQuery&&displayCards.length===0)return null;
  return(
    <div style={{marginBottom:"2rem"}}>
      {!noHeader&&<div onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:".6rem",paddingBottom:".6rem",marginBottom:".75rem",borderBottom:"1px solid #1e1e35",cursor:"pointer",userSelect:"none"}}>
        <IcoChev open={open}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"baseline",flexWrap:"wrap",gap:".4rem"}}>
            <span style={{fontSize:isSecondary?".9rem":"1.05rem",fontWeight:700,letterSpacing:"-.01em",color:complete?"#22c55e":"#e8e8f4"}}>{entry.tier==="special"?"🎮 ":""}{entry.name}{complete?" ✓":""}</span>
            {fact&&<button className={`info-btn ${showFact?"active":""}`} onClick={e=>{e.stopPropagation();setShowFact(s=>!s);}} aria-label="About this artist"><IcoInfo/></button>}
            <span style={{fontSize:".73rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums"}}>{ownedCount} / {cards.length}</span>
            {isSecondary&&<span style={{fontSize:".6rem",color:"#3a3a5a",background:"#141425",border:"1px solid #1e1e35",padding:"0px 5px",borderRadius:3}}>secondary</span>}
          </div>
          <div style={{marginTop:".3rem",height:2,background:"#1e1e35",borderRadius:1,maxWidth:180,overflow:"hidden"}}><div className="prog-fill" style={{width:`${pct}%`,height:"100%",borderRadius:1,background:complete?"#22c55e":"#8b6cd8"}}/></div>
        </div>
      </div>}
      {!noHeader&&fact&&showFact&&(
        <div className="fact-panel" onClick={e=>e.stopPropagation()} style={{marginTop:"-.4rem",marginBottom:"1rem",padding:".7rem .85rem",background:"rgba(192,88,158,0.06)",border:"1px solid rgba(192,88,158,0.22)",borderRadius:10,fontSize:".78rem",lineHeight:1.5,color:"#c9b8d8"}}>
          <div style={{fontSize:".64rem",letterSpacing:".06em",color:"#9a7ab0",fontWeight:700,marginBottom:".25rem",textTransform:"uppercase"}}>{fact.since}</div>
          {fact.fact}
        </div>
      )}
      {(open||noHeader)&&(
        groupedBySet?(
          <>{viewMode==="hunting"&&(groupedBySet.huntingCount+groupedBySet.wantCount===0)&&(<div style={{padding:"2rem 1rem",textAlign:"center",fontSize:".78rem",color:"#4a4a70",border:"1px dashed #1e1e35",borderRadius:10}}>No hunt targets for this artist yet — mark a missing card as Hunting and it will gather here.</div>)}{soloSections&&viewMode==="missing"&&groupedBySet.missingCount===0&&(<div style={{padding:"2rem 1rem",textAlign:"center",fontSize:".78rem",color:"#4a4a70",border:"1px dashed #1e1e35",borderRadius:10}}>Complete — no missing cards for this artist.</div>)}{soloSections&&viewMode==="owned"&&groupedBySet.ownedCount===0&&(<div style={{padding:"2rem 1rem",textAlign:"center",fontSize:".78rem",color:"#4a4a70",border:"1px dashed #1e1e35",borderRadius:10}}>No owned cards yet for this artist.</div>)}{(viewMode==="hunting"?[{key:"hunt",label:"HUNTING",count:groupedBySet.huntingCount,groups:groupedBySet.hunting,ownedFlag:false,hdr:"#b9a3f2",hdrLine:"rgba(155,127,232,0.25)",grpClr:"#4a4a70",divBg:"#0d0d1a"},{key:"want",label:"ON THE LIST",count:groupedBySet.wantCount,groups:groupedBySet.want,ownedFlag:false,hdr:"#8888b8",hdrLine:"rgba(136,136,184,0.18)",grpClr:"#4a4a70",divBg:"#0d0d1a"}]:viewMode==="missing"?(soloSections?[{key:"miss",label:"MISSING",count:groupedBySet.missingCount,groups:groupedBySet.missing,ownedFlag:false,hdr:"#9b7ce8",hdrLine:"rgba(139,108,216,0.18)",grpClr:"#4a4a70",divBg:"#0d0d1a"}]:[{key:"miss",label:"MISSING",count:groupedBySet.missingCount,groups:groupedBySet.missing,ownedFlag:false,hdr:"#9b7ce8",hdrLine:"rgba(139,108,216,0.18)",grpClr:"#4a4a70",divBg:"#0d0d1a"},{key:"own",label:"OWNED",count:groupedBySet.ownedCount,groups:groupedBySet.owned,ownedFlag:true,hdr:"#3a7a4a",hdrLine:"rgba(34,197,94,0.12)",grpClr:"#2a3a2a",divBg:"#09120a"}]):(soloSections?[{key:"own",label:"OWNED",count:groupedBySet.ownedCount,groups:groupedBySet.owned,ownedFlag:true,hdr:"#3a7a4a",hdrLine:"rgba(34,197,94,0.12)",grpClr:"#2a3a2a",divBg:"#09120a"}]:[{key:"own",label:"OWNED",count:groupedBySet.ownedCount,groups:groupedBySet.owned,ownedFlag:true,hdr:"#3a7a4a",hdrLine:"rgba(34,197,94,0.12)",grpClr:"#2a3a2a",divBg:"#09120a"},{key:"miss",label:"MISSING",count:groupedBySet.missingCount,groups:groupedBySet.missing,ownedFlag:false,hdr:"#9b7ce8",hdrLine:"rgba(139,108,216,0.18)",grpClr:"#4a4a70",divBg:"#0d0d1a"}])).filter(s=>s.count>0).map((s,si)=>(<div key={s.key} style={{marginBottom:si===0?"1.5rem":0}}><div style={{display:"flex",alignItems:"center",gap:".6rem",marginBottom:".75rem"}}><span style={{fontSize:".58rem",letterSpacing:".12em",fontWeight:800,color:s.hdr,whiteSpace:"nowrap"}}>{s.label} · {s.count}</span><div style={{flex:1,height:"1px",background:s.hdrLine}}/></div>{s.groups.map((group,gi)=>(<div key={group.name+gi} style={{marginBottom:".7rem"}}><div style={{display:"flex",alignItems:"center",gap:".5rem",marginBottom:".3rem"}}><span style={{fontSize:".58rem",color:s.grpClr,fontWeight:700,letterSpacing:".04em",whiteSpace:"nowrap"}}>{group.name}</span><div style={{flex:1,height:"1px",background:s.divBg}}/><span style={{fontSize:".55rem",color:s.grpClr,whiteSpace:"nowrap",flexShrink:0}}>{group.cards.length}</span></div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(76px,1fr))",gap:"6px"}}>{group.cards.map(card=><CardTile key={card.id} card={card} intentStatus={intentMap?.get(card.id)} owned={s.ownedFlag} manualOwned={manualOwned} manualMissing={manualMissing} isFavorite={favorites.has(card.id)} onCardClick={onCardClick} onToggleFavorite={onToggleFavorite} readOnly={readOnly}/>)}</div></div>))}</div>))}</>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(76px,1fr))",gap:"6px"}}>
            {displayCards.map(card=><CardTile key={card.id} card={card} intentStatus={intentMap?.get(card.id)} owned={checkOwned(card)} manualOwned={manualOwned} manualMissing={manualMissing} isFavorite={favorites.has(card.id)} onCardClick={onCardClick} onToggleFavorite={onToggleFavorite} readOnly={readOnly}/>)}
          </div>
        )
      )}
    </div>
  );
}

// ── SETTINGS ───────────────────────────────────────────────────────────────────
function ArtistPicker({selected,onToggle,onSelectAll,onSelectNone}){
  const groups=[["Main Artists",ARTISTS.filter(a=>a.tier==="main")],["Secondary Artists",ARTISTS.filter(a=>a.tier==="secondary")]];
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".4rem"}}>
        <span style={{fontSize:".64rem",color:"#4a4a70"}}>{selected.size} of {ARTISTS.length} selected</span>
        <div style={{display:"flex",gap:".6rem"}}>
          <button onClick={onSelectAll} style={{background:"none",border:"none",color:"#8b6cd8",fontSize:".66rem",cursor:"pointer",padding:0}}>Select all</button>
          <button onClick={onSelectNone} style={{background:"none",border:"none",color:"#6b6b90",fontSize:".66rem",cursor:"pointer",padding:0}}>None</button>
        </div>
      </div>
      <div style={{maxHeight:220,overflowY:"auto",background:"#0a0a14",border:"1px solid #1e1e35",borderRadius:8,padding:".3rem .2rem"}}>
        {groups.map(([label,list])=>(
          <div key={label}>
            <div style={{fontSize:".6rem",color:"#3a3a5a",fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",padding:".4rem .5rem .2rem"}}>{label}</div>
            {list.map(a=>{
              const slug=toSlug(a.name),checked=selected.has(slug);
              return(
                <label key={slug} onClick={()=>onToggle(slug)} style={{display:"flex",alignItems:"center",gap:".55rem",padding:".34rem .5rem",borderRadius:6,cursor:"pointer",fontSize:".78rem",color:checked?"#e8e8f4":"#7a7aa0"}}>
                  <span style={{width:16,height:16,borderRadius:4,border:`1.5px solid ${checked?"#8b6cd8":"#2a2a45"}`,background:checked?"#8b6cd8":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"background .12s,border-color .12s"}}>{checked&&<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}</span>
                  {a.name}
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShareLinkPanel({user}){
  const[link, setLink] =useState(undefined); // undefined=loading, null=none yet, {token,enabled,artist_slugs}=exists
  const[copied,setCopied]=useState(false);
  const[busy, setBusy] =useState(false);
  const[selectedSlugs,setSelectedSlugs]=useState(new Set());
  const[showPicker,setShowPicker]=useState(false);

  useEffect(()=>{
    if(!user)return;
    supabase.from("share_links").select("token,enabled,artist_slugs").eq("user_id",user.id).maybeSingle().then(({data})=>{
      setLink(data||null);
      setSelectedSlugs(new Set(data&&data.artist_slugs&&data.artist_slugs.length?data.artist_slugs:[]));
    });
  },[user]);

  const shareUrl=link&&link.token?`${window.location.origin}${window.location.pathname}?share=${link.token}`:null;
  const savedSlugs=useMemo(()=>new Set(link&&link.artist_slugs||[]),[link]);
  const slugsDirty=link&&(selectedSlugs.size!==savedSlugs.size||[...selectedSlugs].some(s=>!savedSlugs.has(s)));

  const toggleSlug=slug=>setSelectedSlugs(s=>{const n=new Set(s);n.has(slug)?n.delete(slug):n.add(slug);return n;});
  const selectAll=()=>setSelectedSlugs(new Set(ARTISTS.map(a=>toSlug(a.name))));
  const selectNone=()=>setSelectedSlugs(new Set());

  const create=async()=>{
    if(selectedSlugs.size===0)return;
    setBusy(true);
    const token=(crypto.randomUUID?crypto.randomUUID():`${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g,"");
    const{data}=await supabase.from("share_links").upsert({user_id:user.id,token,enabled:true,artist_slugs:[...selectedSlugs]},{onConflict:"user_id"}).select("token,enabled,artist_slugs").maybeSingle();
    setLink(data||{token,enabled:true,artist_slugs:[...selectedSlugs]});
    setShowPicker(false);
    setBusy(false);
  };
  const saveArtists=async()=>{
    if(selectedSlugs.size===0)return;
    setBusy(true);
    await supabase.from("share_links").update({artist_slugs:[...selectedSlugs]}).eq("user_id",user.id);
    setLink(l=>({...l,artist_slugs:[...selectedSlugs]}));
    setShowPicker(false);
    setBusy(false);
  };
  const toggleEnabled=async()=>{
    if(!link)return;
    setBusy(true);
    const next=!link.enabled;
    await supabase.from("share_links").update({enabled:next}).eq("user_id",user.id);
    setLink(l=>({...l,enabled:next}));
    setBusy(false);
  };
  const regenerate=async()=>{
    if(!window.confirm("Generate a new link? The old link will stop working immediately."))return;
    await create();
  };
  const copy=()=>{
    if(!shareUrl)return;
    navigator.clipboard.writeText(shareUrl).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1800);});
  };

  if(!user)return null;

  return(
    <div style={{padding:".75rem",marginBottom:"1rem",background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:10}}>
      <div style={{fontSize:".8rem",color:"#e8e8f4",fontWeight:600,marginBottom:2}}>Share Your Binder</div>
      <div style={{fontSize:".66rem",color:"#4a4a70",marginBottom:".6rem",lineHeight:1.4}}>Gives anyone with the link a read-only view of just the artists you choose — they can see what you own and what's missing, but can't change anything.</div>
      {link===undefined?(
        <div style={{fontSize:".72rem",color:"#4a4a70",display:"flex",alignItems:"center",gap:6}}><IcoSpin/> Checking…</div>
      ):!link?(
        <>
          <ArtistPicker selected={selectedSlugs} onToggle={toggleSlug} onSelectAll={selectAll} onSelectNone={selectNone}/>
          <button onClick={create} disabled={busy||selectedSlugs.size===0} className="btn-moon" style={{borderRadius:7,padding:".45rem .8rem",fontSize:".75rem",fontWeight:700,width:"100%",marginTop:".6rem",opacity:selectedSlugs.size===0?.5:1}}>{busy?"Creating…":selectedSlugs.size===0?"Pick at least one artist":"Create Share Link"}</button>
        </>
      ):(
        <>
          <div style={{display:"flex",gap:".4rem",marginBottom:".6rem"}}>
            <div style={{flex:1,minWidth:0,background:"#141425",border:"1px solid #1e1e35",borderRadius:7,padding:".4rem .55rem",fontSize:".68rem",color:link.enabled?"#9b9bc0":"#4a4a70",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{shareUrl}</div>
            <button onClick={copy} className="btn-tap" style={{background:"#1e1e35",color:copied?"#22c55e":"#8b6cd8",border:"none",borderRadius:7,padding:".4rem .6rem",fontSize:".7rem",fontWeight:600,flexShrink:0,cursor:"pointer"}}>{copied?"Copied ✓":"Copy"}</button>
          </div>
          {!link.enabled&&<div style={{fontSize:".64rem",color:"#f87171",marginBottom:".5rem"}}>Paused — this link won't load for anyone right now.</div>}
          <button onClick={()=>setShowPicker(s=>!s)} style={{background:"none",border:"none",color:"#9b9bc0",fontSize:".68rem",cursor:"pointer",padding:0,marginBottom:showPicker?".5rem":".7rem",display:"flex",alignItems:"center",gap:4}}>
            <IcoChev open={showPicker}/> Sharing {savedSlugs.size} of {ARTISTS.length} artists
          </button>
          {showPicker&&(
            <div style={{marginBottom:".6rem"}}>
              <ArtistPicker selected={selectedSlugs} onToggle={toggleSlug} onSelectAll={selectAll} onSelectNone={selectNone}/>
              <button onClick={saveArtists} disabled={busy||!slugsDirty||selectedSlugs.size===0} className="btn-moon" style={{borderRadius:7,padding:".4rem .7rem",fontSize:".72rem",fontWeight:700,width:"100%",marginTop:".5rem",opacity:(!slugsDirty||selectedSlugs.size===0)?.5:1}}>{busy?"Saving…":"Save changes"}</button>
            </div>
          )}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:".5rem"}}>
            <button onClick={toggleEnabled} disabled={busy} className="btn-tap" style={{background:"none",border:"none",color:link.enabled?"#9b9bc0":"#60a5fa",cursor:"pointer",fontSize:".68rem",padding:0}}>{link.enabled?"⏸ Pause link":"▶ Resume link"}</button>
            <button onClick={regenerate} disabled={busy} className="btn-tap" style={{background:"none",border:"none",color:"#f87171",cursor:"pointer",fontSize:".68rem",padding:0}}>Generate new link</button>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsPanel({onClose,onClearCache,onClearManual,onSignOut,hideTcgPocket,onToggleTcgPocket,user,onUploadCSV}){
  useEffect(()=>{const fn=e=>{if(e.key==="Escape")onClose();};window.addEventListener("keydown",fn);return()=>window.removeEventListener("keydown",fn);},[onClose]);
  const btn={width:"100%",borderRadius:8,padding:".45rem",cursor:"pointer",fontSize:".78rem",border:"none"};
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:300,background:"rgba(7,7,15,0.8)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div className="fade-up" onClick={e=>e.stopPropagation()} style={{background:"#141425",border:"1px solid #1e1e35",borderRadius:16,padding:"1.5rem",maxWidth:380,width:"100%"}}>
        <h3 style={{fontWeight:700,fontSize:"1rem",color:"#e8e8f4",marginBottom:"1.25rem"}}>Settings</h3>
        <p style={{fontSize:".72rem",color:"#4a4a70",marginBottom:"1rem",lineHeight:1.5}}>Artist card display is sourced from a Supabase sync updated weekly from TCGdex. The local cache expires after 24 hours. TCGdex remains the ingestion layer.</p>
        <div onClick={onToggleTcgPocket} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:".75rem",padding:".75rem",marginBottom:"1rem",background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:10,cursor:"pointer"}}>
          <div>
            <div style={{fontSize:".8rem",color:"#e8e8f4",fontWeight:600}}>Hide TCG Pocket cards</div>
            <div style={{fontSize:".66rem",color:"#4a4a70",marginTop:2,lineHeight:1.4}}>Excludes the virtual-only mobile app from your binder</div>
          </div>
          <button onClick={e=>{e.stopPropagation();onToggleTcgPocket();}} className="btn-tap" style={{width:38,height:22,borderRadius:11,border:"none",cursor:"pointer",background:hideTcgPocket?"#8b6cd8":"#2a2a45",position:"relative",flexShrink:0,padding:0,transition:"background .15s ease"}}>
            <span style={{position:"absolute",top:2,left:hideTcgPocket?18:2,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .15s ease"}}/>
          </button>
        </div>
        {onUploadCSV&&<div style={{marginBottom:"1rem",padding:".75rem",background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:10}}><div style={{fontSize:".8rem",color:"#e8e8f4",fontWeight:600,marginBottom:2}}>Sync Collection</div><div style={{fontSize:".66rem",color:"#4a4a70",marginBottom:".6rem",lineHeight:1.4}}>Upload your Collectr CSV export to update which cards you own.</div><button onClick={()=>{onUploadCSV();onClose();}} className="btn-ghost" style={{width:"100%",borderRadius:8,padding:".45rem",fontSize:".78rem",display:"flex",alignItems:"center",justifyContent:"center",gap:".4rem",color:"#8b6cd8"}}><IcoUpload/> Upload Collectr CSV</button></div>}
        <ShareLinkPanel user={user}/>
        <div style={{display:"flex",flexDirection:"column",gap:".5rem"}}>
          <button onClick={()=>{if(window.confirm("Clear card cache? Cards will be re-fetched from Supabase immediately.")){onClearCache();onClose();}}} className="btn-tap" style={{...btn,background:"#200f18",color:"#f87171"}}>Clear card cache</button>
          <button onClick={()=>{if(window.confirm("Reset all manual overrides?")){onClearManual();onClose();}}} className="btn-tap" style={{...btn,background:"#0f1a20",color:"#60a5fa"}}>Reset all manual overrides</button>
          <button onClick={()=>{onSignOut();onClose();}} className="btn-tap" style={{...btn,background:"#1a1020",color:"#c084fc"}}>Sign out</button>
        </div>
        <button onClick={onClose} className="btn-ghost" style={{width:"100%",marginTop:"1rem",borderRadius:8,padding:".55rem",fontSize:".875rem"}}>Close</button>
      </div>
    </div>
  );
}

// ── ERROR BOUNDARY ─────────────────────────────────────────────────────────────
// Safety net: if any single component throws unexpectedly, show a recoverable
// screen instead of leaving the whole binder blank.
class ErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={hasError:false,error:null};}
  static getDerivedStateFromError(error){return{hasError:true,error};}
  componentDidCatch(error,info){console.error("Illustrated crashed:",error,info);}
  render(){
    if(this.state.hasError){
      return(
        <div style={{position:"fixed",inset:0,background:"#07070f",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2rem",textAlign:"center",gap:"1rem"}}>
          <BlazLogo size={40}/>
          <p style={{color:"#f87171",fontSize:"1rem",fontWeight:700}}>Something went wrong.</p>
          <p style={{color:"#6b6b90",fontSize:".8rem",maxWidth:320,lineHeight:1.5}}>{(this.state.error&&this.state.error.message)||"An unexpected error occurred."}</p>
          <button onClick={()=>window.location.reload()} style={{background:"linear-gradient(135deg,#ff5500,#ff2200)",color:"#fff",border:"none",borderRadius:8,padding:".65rem 1.75rem",cursor:"pointer",fontWeight:700,fontSize:".85rem"}}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── APP ────────────────────────────────────────────────────────────────────────
// ── SHARED (READ-ONLY) BINDER ──────────────────────────────────────────────────
function SharedBinder({token}){
  const[status,        setStatus]       =useState("loading"); // loading | invalid | ready
  const[ownedKeySet,    setOwnedKeySet]  =useState(new Set());
  const[manualOwned,    setManualOwned]  =useState(new Set());
  const[manualMissing,  setManualMissing]=useState(new Set());
  const[favorites,      setFavorites]    =useState(new Set());
  const[cardData,       setCardData]     =useState({});
  const[loadingSet,     setLoadingSet]   =useState(new Set());
  const[errors,         setErrors]       =useState({});
  const[selectedCard,   setSelectedCard] =useState(null);
  const[search,         setSearch]       =useState("");
  const[filterSlug,     setFilterSlug]   =useState("all");
  const[sortBy,         setSortBy]       =useState("name");
  const[viewMode,       setViewMode]     =useState(null);
  const[showAllColor,   setShowAllColor] =useState(false);
  const[includedSlugs,  setIncludedSlugs]=useState(null); // null = no restriction (older/legacy links)
  const searchRef=useRef(null);

  useEffect(()=>{
    let cancelled=false;
    fetchSharedCollection(token).then(data=>{
      if(cancelled)return;
      if(!data){setStatus("invalid");return;}
      setOwnedKeySet(new Set(data.owned_keys||[]));
      const mo=new Set(),mm=new Set();
      (data.overrides||[]).forEach(r=>r.override_type==="owned"?mo.add(r.card_id):mm.add(r.card_id));
      setManualOwned(mo);setManualMissing(mm);
      setFavorites(new Set(data.favorites||[]));
      setIncludedSlugs(data.artist_slugs&&data.artist_slugs.length?new Set(data.artist_slugs):null);
      setStatus("ready");
    });
    return()=>{cancelled=true;};
  },[token]);

  const sharedArtists=useMemo(()=>includedSlugs?ARTISTS.filter(a=>includedSlugs.has(toSlug(a.name))):ARTISTS,[includedSlugs]);

  const loadEntry=useCallback(async entry=>{
    const slug=toSlug(entry.name);
    setLoadingSet(s=>new Set([...s,slug]));setErrors(e=>{const n={...e};delete n[slug];return n;});
    try{const cards=await fetchArtistCards(entry);setCardData(d=>({...d,[slug]:cards}));}
    catch(err){setErrors(e=>({...e,[slug]:err.message}));}
    finally{setLoadingSet(s=>{const n=new Set(s);n.delete(slug);return n;});}
  },[]);
  useEffect(()=>{
    if(status!=="ready")return;
    let cancelled=false;
    (async()=>{
      const CONC=4;
      for(let i=0;i<sharedArtists.length;i+=CONC){
        if(cancelled)return;
        await Promise.all(sharedArtists.slice(i,i+CONC).map(loadEntry));
      }
    })();
    return()=>{cancelled=true;};
  },[status,loadEntry,sharedArtists]);

  const checkOwned=useCallback(card=>isCardOwned(card,ownedKeySet,manualOwned,manualMissing),[ownedKeySet,manualOwned,manualMissing]);
  const visibleCardData=useMemo(()=>{
    const out={};
    Object.keys(cardData).forEach(slug=>{out[slug]=cardData[slug].filter(c=>!isTcgPocketCard(c));});
    return out;
  },[cardData]);

  const visibleArtists=filterSlug==="all"?sharedArtists:sharedArtists.filter(a=>toSlug(a.name)===filterSlug);

  const exportMissingCSV=useCallback(()=>{
    // Read-only, client-side export of the missing-card list currently represented by this
    // shared link: respects the share's artist selection, the viewer's artist dropdown, and
    // TCG Pocket filtering (visibleCardData). Intentionally ignores the search box so a
    // transient search never silently truncates a shop-owner export. No intent, favorites,
    // or private user data — only what the page already displays.
    const esc=v=>`"${String(v==null?"":v).replace(/"/g,'""')}"`;
    const rows=[["Artist","Card Name","Set","Set ID","Card Number","Rarity","Illustrator","Market Price (USD)","Card ID"]];
    visibleArtists.forEach(entry=>{
      const slug=toSlug(entry.name);
      const missing=(visibleCardData[slug]||[]).filter(c=>!checkOwned(c)).slice().sort((a,b)=>{
        const oa=SET_ORDER[(a.set&&a.set.id)]??999,ob=SET_ORDER[(b.set&&b.set.id)]??999;
        if(oa!==ob)return oa-ob;
        return String(a.localId||"").localeCompare(String(b.localId||""),undefined,{numeric:true});
      });
      missing.forEach(card=>{
        const p=getBestPrice(card);
        rows.push([entry.name,card.name||"",(card.set&&card.set.name)||"",(card.set&&card.set.id)||"",card.localId||"",card.rarity||"",card.illustrator||"",(p&&p.amount!=null)?p.amount.toFixed(2):"",card.id||""]);
      });
    });
    const csv="\uFEFF"+rows.map(r=>r.map(esc).join(",")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=`illustrated-vault-missing-${todayStr()}.csv`;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },[visibleArtists,visibleCardData,checkOwned]);

  if(status==="loading")return<div style={{position:"fixed",inset:0,background:"#030100",display:"flex",alignItems:"center",justifyContent:"center"}}><IcoSpin/></div>;
  if(status==="invalid")return(
    <div style={{minHeight:"100dvh",background:"#07070f",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1rem",padding:"2rem",textAlign:"center"}}>
      <BlazLogo size={52}/>
      <h2 style={{color:"#e8e8f4",fontSize:"1.15rem",fontWeight:800}}>This share link isn't active</h2>
      <p style={{color:"#6b6b90",fontSize:".85rem",maxWidth:320,lineHeight:1.5}}>It may have been revoked, paused, or copied incorrectly. Ask whoever shared it for a fresh link.</p>
    </div>
  );

  
  const totalCards=Object.values(visibleCardData).reduce((s,a)=>s+a.length,0);
  const totalOwned=Object.values(visibleCardData).reduce((s,cards)=>s+cards.filter(checkOwned).length,0);
  const totalPct=totalCards?Math.round((totalOwned/totalCards)*100):0;
  const selSt={background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,color:"#e8e8f4",padding:".4rem .6rem",fontSize:".76rem"};

  return(
    <div className={showAllColor?"color-mode":""} style={{minHeight:"100dvh",background:"#07070f"}}>
      <header style={{position:"sticky",top:0,zIndex:100,background:"rgba(7,7,15,0.97)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderBottom:"1px solid #1e1e35"}}>
        <div style={{maxWidth:860,margin:"0 auto",padding:".7rem 1rem"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".6rem",flexWrap:"wrap",gap:".5rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
              <BlazLogo size={22}/>
              <div style={{display:"flex",alignItems:"baseline",gap:".5rem",flexWrap:"wrap"}}>
                <span className="font-display" style={{fontWeight:600,fontSize:"1.02rem",color:"#e8e8f4",letterSpacing:"-.01em"}}>Illustrated</span>
                {totalCards>0&&<span style={{fontSize:".7rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums"}}>{totalOwned}/{totalCards} · {totalPct}%</span>}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
              <button onClick={()=>setShowAllColor(v=>!v)} className="btn-ghost" title={showAllColor?"Showing missing cards in color":"Showing missing cards grayed out"} style={{color:showAllColor?"#c0589e":"#6b6b90",borderRadius:8,padding:".38rem",display:"flex",background:showAllColor?"rgba(192,88,158,0.12)":undefined,border:showAllColor?"1px solid rgba(192,88,158,0.3)":undefined}}><IcoContrast/></button>
              <button onClick={exportMissingCSV} className="btn-ghost" title="Download the missing-cards list as a CSV (opens in Excel)" style={{color:"#8b6cd8",borderRadius:8,padding:".38rem .6rem",display:"flex",alignItems:"center",gap:".35rem",fontSize:".7rem",fontWeight:600,border:"1px solid #1e1e35",whiteSpace:"nowrap",cursor:"pointer"}}><IcoDownload/> Missing CSV</button>
              <span style={{fontSize:".68rem",color:"#c0589e",background:"rgba(192,88,158,0.12)",border:"1px solid rgba(192,88,158,0.28)",padding:"3px 9px",borderRadius:6,fontWeight:600,display:"flex",alignItems:"center",gap:5}}><IcoEye/> View only</span>
            </div>
          </div>
          <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
            <div style={{flex:"1 1 160px",position:"relative",minWidth:0}}>
              <span style={{position:"absolute",left:".6rem",top:"50%",transform:"translateY(-50%)",color:"#6b6b90",display:"flex",pointerEvents:"none"}}><IcoSearch/></span>
              <input ref={searchRef} type="search" placeholder="Search cards…" value={search} onChange={e=>setSearch(e.target.value)} style={{...selSt,width:"100%",padding:".4rem 2rem .4rem 2rem",fontSize:".85rem"}}/>
              {search&&<button onClick={()=>{setSearch("");searchRef.current&&searchRef.current.focus();}} style={{position:"absolute",right:".4rem",top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#6b6b90",cursor:"pointer",display:"flex"}}><IcoX/></button>}
            </div>
            <select value={filterSlug} onChange={e=>setFilterSlug(e.target.value)} style={{...selSt,maxWidth:148}}>
              <option value="all">All Artists</option>
              <optgroup label="Main">{sharedArtists.filter(a=>a.tier==="main").map(a=><option key={a.name} value={toSlug(a.name)}>{a.name}</option>)}</optgroup>
              <optgroup label="Secondary">{sharedArtists.filter(a=>a.tier==="secondary").map(a=><option key={a.name} value={toSlug(a.name)}>{a.name}</option>)}</optgroup>
              <optgroup label="Special">{ARTISTS.filter(a=>a.tier==="special").map(a=><option key={a.name} value={toSlug(a.name)}>{a.name}</option>)}</optgroup>
            </select>
            <div style={{display:"flex",gap:".3rem",alignItems:"center",flexShrink:0}}>
              <button onClick={()=>setViewMode(viewMode==="missing"?null:"missing")} style={{background:viewMode==="missing"?"rgba(139,108,216,0.2)":"#0f0f1c",color:viewMode==="missing"?"#c0a0f8":"#6b6b90",border:`1px solid ${viewMode==="missing"?"#8b6cd8":"#1e1e35"}`,borderRadius:7,padding:".38rem .65rem",cursor:"pointer",fontSize:".74rem",fontWeight:viewMode==="missing"?700:500,whiteSpace:"nowrap"}}>Missing</button>
              <button onClick={()=>setViewMode(viewMode==="owned"?null:"owned")} style={{background:viewMode==="owned"?"rgba(34,197,94,0.12)":"#0f0f1c",color:viewMode==="owned"?"#6ee7b7":"#6b6b90",border:`1px solid ${viewMode==="owned"?"#22c55e":"#1e1e35"}`,borderRadius:7,padding:".38rem .65rem",cursor:"pointer",fontSize:".74rem",fontWeight:viewMode==="owned"?700:500,whiteSpace:"nowrap"}}>Owned</button>
              <button onClick={()=>setViewMode(null)} style={{background:viewMode===null?"rgba(100,100,160,0.2)":"#0f0f1c",color:viewMode===null?"#b0b0e8":"#6b6b90",border:`1px solid ${viewMode===null?"#6060a0":"#1e1e35"}`,borderRadius:7,padding:".38rem .6rem",cursor:"pointer",fontSize:".74rem",fontWeight:viewMode===null?700:500,whiteSpace:"nowrap"}}>A–Z</button>
            </div>
          </div>
        </div>
      </header>

      <main style={{maxWidth:860,margin:"0 auto",padding:"1rem"}}>
        {totalCards>0&&<div style={{height:2,background:"#1e1e35",borderRadius:1,overflow:"hidden",marginBottom:"1.5rem"}}><div className="prog-fill" style={{width:`${totalPct}%`,height:"100%",background:"linear-gradient(90deg,#ff4400,#ff8800 50%,#c0589e 80%,#8b6cd8 100%)",borderRadius:1}}/></div>}
        {visibleArtists.map(entry=>{
          const slug=toSlug(entry.name),cards=visibleCardData[slug]||[];
          const isLoading=loadingSet.has(slug),err=errors[slug];
          if(isLoading&&!cards.length)return<div key={entry.name} style={{display:"flex",alignItems:"center",gap:".5rem",padding:".6rem 0",color:"#6b6b90",fontSize:".8rem"}}><IcoSpin/> Loading {entry.name}…</div>;
          if(err||!cards.length)return null;
          return<ArtistSection key={entry.name} entry={entry} cards={cards} checkOwned={checkOwned} manualOwned={manualOwned} manualMissing={manualMissing} favorites={favorites} onCardClick={setSelectedCard} onToggleFavorite={()=>{}} searchQuery={search} sortBy={sortBy} viewMode={viewMode} readOnly/>;
        })}
        {search&&!visibleArtists.some(entry=>{const cards=visibleCardData[toSlug(entry.name)]||[];const q=search.toLowerCase();return cards.some(c=>(c.name||"").toLowerCase().includes(q));})&&(
          <div style={{textAlign:"center",padding:"3rem 1rem",color:"#6b6b90",fontSize:".875rem"}}>No cards matching "{search}"</div>
        )}
      </main>

      {selectedCard&&<CardModal card={selectedCard} owned={checkOwned(selectedCard)} manualOwned={manualOwned} manualMissing={manualMissing} isFavorite={favorites.has(selectedCard.id)} priceHistory={{}} onToggleManual={()=>{}} onToggleFavorite={()=>{}} onRecordPrice={()=>{}} onClose={()=>setSelectedCard(null)} readOnly/>}
    </div>
  );
}


// ── HUNT BOARD ────────────────────────────────────────────────────────────────
const HUNT_SECTIONS=[
  {key:"hunting",label:"ACTIVE TARGETS",clr:"#b9a3f2",line:"rgba(155,127,232,0.25)"},
  {key:"want",   label:"ON THE LIST",   clr:"#8888b8",line:"rgba(136,136,184,0.18)"},
  {key:"maybe",  label:"MAYBE LATER",   clr:"#5a5a82",line:"rgba(90,90,130,0.18)"},
];
function HuntStatusDot({status}){
  const st={width:8,height:8,borderRadius:"50%",flexShrink:0};
  if(status==="hunting")return<div style={{...st,background:"#9b7fe8"}}/>;
  if(status==="want")return<div style={{...st,background:"transparent",border:"1.5px solid #9b7fe8"}}/>;
  return<div style={{...st,background:"transparent",border:"1.5px solid #4a4a70"}}/>;
}
function HuntBoard({visibleCardData,intentMap,checkOwned,onCardClick,onBack,roster}){
  // A-D2b0: roster = effectiveRoster; defensive fallback to curated ARTISTS.
  const rosterList=roster||ARTISTS;
  const groups=useMemo(()=>{
    const out={hunting:[],want:[],maybe:[]};
    if(!intentMap||!intentMap.size)return out;
    const seen=new Set();
    rosterList.forEach(entry=>{
      const slug=toSlug(entry.name);
      const bucket={hunting:[],want:[],maybe:[]};
      (visibleCardData[slug]||[]).forEach(card=>{
        const st=intentMap.get(card.id);
        if(!st||!bucket[st])return;           // no intent, or ignore -> off the board
        if(seen.has(card.id))return;          // defensive dedupe across slugs
        if(checkOwned(card))return;           // owned suppression (stale intent rows stay in DB)
        seen.add(card.id);
        bucket[st].push(card);
      });
      HUNT_SECTIONS.forEach(({key})=>{
        if(!bucket[key].length)return;
        bucket[key].sort((a,b)=>{
          const pa=getBestPrice(a),pb=getBestPrice(b);
          const va=pa&&pa.amount!=null?pa.amount:-1,vb=pb&&pb.amount!=null?pb.amount:-1;
          return vb-va;                        // price desc, unpriced last
        });
        out[key].push({artist:entry.name,cards:bucket[key]});
      });
    });
    return out;
  },[visibleCardData,intentMap,checkOwned,rosterList]);
  const total=HUNT_SECTIONS.reduce((s,{key})=>s+groups[key].reduce((n,g)=>n+g.cards.length,0),0);
  const [collapsed,setCollapsed]=useState({maybe:true});
  const toggleSection=key=>setCollapsed(c=>({...c,[key]:!c[key]}));

  // ── H-3: view style + filters ─────────────────────────────────────────────
  // Session-only useState — no persistence, no schema, no localStorage.
  // Filtering happens downstream of the (untouched) groups derivation so
  // dedupe, ignore-exclusion, and owned suppression stay exactly as they are.
  const[viewStyle,setViewStyle]=useState("list");     // "list" | "grid"
  const[statusFilter,setStatusFilter]=useState("all"); // "all" | hunting | want | maybe
  const[artistFilter,setArtistFilter]=useState("all"); // "all" | artist name
  // Artists actually represented on the board, in roster order.
  const boardArtists=useMemo(()=>{
    const present=new Set();
    HUNT_SECTIONS.forEach(({key})=>groups[key].forEach(g=>present.add(g.artist)));
    return rosterList.map(e=>e.name).filter(n=>present.has(n));
  },[groups,rosterList]);
  const filteredGroups=useMemo(()=>{
    const out={};
    HUNT_SECTIONS.forEach(({key})=>{
      if(statusFilter!=="all"&&key!==statusFilter){out[key]=[];return;}
      out[key]=artistFilter==="all"?groups[key]:groups[key].filter(g=>g.artist===artistFilter);
    });
    return out;
  },[groups,statusFilter,artistFilter]);
  const filteredTotal=HUNT_SECTIONS.reduce((s,{key})=>s+filteredGroups[key].reduce((n,g)=>n+g.cards.length,0),0);
  const filtersActive=statusFilter!=="all"||artistFilter!=="all";
  const clearFilters=()=>{setStatusFilter("all");setArtistFilter("all");};
  const selSt={background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,color:"#e8e8f4",padding:".38rem 1.6rem .38rem .6rem",fontSize:".72rem",backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%236b6b90'/%3E%3C/svg%3E\")",backgroundRepeat:"no-repeat",backgroundPosition:"right .55rem center"};
  const segSt=on=>({background:on?"rgba(155,127,232,0.16)":"transparent",color:on?"#b9a3f2":"#6b6b90",border:`1px solid ${on?"#9b7fe8":"transparent"}`,borderRadius:6,padding:".3rem .6rem",cursor:"pointer",fontSize:".72rem",fontWeight:on?700:500,whiteSpace:"nowrap",transition:"all .12s"});

  return(
    <div style={{minHeight:"100dvh",background:"#07070f"}}>
      <header style={{position:"sticky",top:0,zIndex:100,background:"rgba(7,7,15,0.97)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderBottom:"1px solid #1e1e35"}}>
        <div style={{maxWidth:860,margin:"0 auto",padding:".7rem 1rem",display:"flex",alignItems:"center",gap:".8rem"}}>
          <button onClick={onBack} className="btn-ghost" style={{color:"#6b6b90",borderRadius:8,padding:".35rem .55rem",fontSize:".74rem",display:"flex",alignItems:"center",gap:".3rem",whiteSpace:"nowrap"}}>← Dashboard</button>
          <span className="font-display" style={{fontWeight:600,fontSize:"1.02rem",color:"#e8e8f4",letterSpacing:"-.01em"}}>Hunt Board</span>
          <span style={{marginLeft:"auto",fontSize:".7rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{filtersActive?`${filteredTotal} of ${total} ${total===1?"target":"targets"}`:`${total} ${total===1?"target":"targets"}`}</span>
        </div>
      </header>
      <main style={{maxWidth:860,margin:"0 auto",padding:"1.2rem 1rem 3rem"}}>
        {/* H-3: quiet control row — scrolls with the page, not sticky. */}
        {total>0&&(
          <div style={{display:"flex",alignItems:"center",gap:".5rem",flexWrap:"wrap",marginBottom:"1.4rem"}}>
            <div style={{display:"flex",gap:".25rem",alignItems:"center"}}>
              <button onClick={()=>setViewStyle("list")} style={segSt(viewStyle==="list")}>List</button>
              <button onClick={()=>setViewStyle("grid")} style={segSt(viewStyle==="grid")}>Grid</button>
            </div>
            <div style={{display:"flex",gap:".4rem",alignItems:"center",marginLeft:"auto",flexWrap:"wrap",justifyContent:"flex-end"}}>
              <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={selSt} aria-label="Filter by hunt status">
                <option value="all">All statuses</option>
                <option value="hunting">Hunting</option>
                <option value="want">On the List</option>
                <option value="maybe">Maybe</option>
              </select>
              {boardArtists.length>1&&(
                <select value={artistFilter} onChange={e=>setArtistFilter(e.target.value)} style={selSt} aria-label="Filter by artist">
                  <option value="all">All Artists</option>
                  {boardArtists.map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
        {total===0&&(
          <div style={{padding:"3rem 1.2rem",textAlign:"center",fontSize:".8rem",lineHeight:1.6,color:"#4a4a70",border:"1px dashed #1e1e35",borderRadius:12,marginTop:"1.5rem"}}>
            Your Hunt Board is empty. Open any missing card and set a Hunt status to start planning your next finds.
          </div>
        )}
        {/* H-3: calm filtered-empty state with an easy way back. */}
        {total>0&&filteredTotal===0&&(
          <div style={{padding:"3rem 1.2rem",textAlign:"center",fontSize:".8rem",lineHeight:1.6,color:"#4a4a70",border:"1px dashed #1e1e35",borderRadius:12}}>
            No cards match these filters.
            <div style={{marginTop:".8rem"}}>
              <button onClick={clearFilters} style={{background:"none",border:"none",cursor:"pointer",color:"#8b6cd8",fontSize:".76rem",fontWeight:600,padding:0}}>Clear filters</button>
            </div>
          </div>
        )}
        {HUNT_SECTIONS.map(sec=>{
          const artistGroups=filteredGroups[sec.key];
          if(!artistGroups.length)return null;
          const count=artistGroups.reduce((n,g)=>n+g.cards.length,0);
          return(
            <section key={sec.key} style={{marginBottom:"2.2rem"}}>
              <div onClick={()=>toggleSection(sec.key)} style={{display:"flex",alignItems:"center",gap:".6rem",marginBottom:collapsed[sec.key]?"0":".9rem",cursor:"pointer",userSelect:"none",padding:".55rem 0"}}>
                <span style={{color:sec.clr,display:"flex"}}><IcoChev open={!collapsed[sec.key]}/></span>
                <span style={{fontSize:".64rem",fontWeight:800,letterSpacing:".14em",color:sec.clr,whiteSpace:"nowrap"}}>{sec.label} · {count}</span>
                <div style={{flex:1,height:1,background:sec.line}}/>
              </div>
              {!collapsed[sec.key]&&artistGroups.map(g=>(
                <div key={g.artist} style={{marginBottom:"1.1rem"}}>
                  <div style={{fontSize:".66rem",fontWeight:700,letterSpacing:".08em",color:"#8b8bb0",marginBottom:viewStyle==="grid"?".55rem":".35rem",paddingLeft:".1rem"}}>{g.artist} · {g.cards.length}</div>
                  {viewStyle==="grid"?(
                    /* H-3 Grid: art-forward, full color (every card here is
                       unowned by definition — CardTile's .missing grayscale
                       would wash out the whole board, same reasoning as Hunt
                       Show). Section headings already carry intent, so grid
                       cards stay quiet: image, name, artist only. */
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:"1rem"}}>
                      {g.cards.map(card=>{
                        const src=imgLarge(card)||imgSmall(card);
                        return(
                          <div key={card.id} onClick={()=>onCardClick(card)} style={{cursor:"pointer"}}>
                            <div className="card-tile" style={{marginBottom:".4rem"}}>
                              {src?<img src={src} alt={card.name} loading="lazy" decoding="async" style={{width:"100%",height:"auto",display:"block",borderRadius:6}}/>:<div className="card-blank"><div className="blank-inner"><IcoNoImage/><span>{card.name}</span></div></div>}
                            </div>
                            <div style={{fontSize:".76rem",color:"#e8e8f4",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{card.name}</div>
                            <div style={{fontSize:".64rem",color:"#6b6b90",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.artist}</div>
                          </div>
                        );
                      })}
                    </div>
                  ):(
                  <div style={{display:"flex",flexDirection:"column"}}>
                    {g.cards.map(card=>{
                      const price=getBestPrice(card);
                      const sm=imgSmall(card);
                      return(
                        <div key={card.id} className="wanted-row" onClick={()=>onCardClick(card)} style={{display:"flex",alignItems:"center",gap:".7rem",padding:".5rem .6rem",cursor:"pointer",borderRadius:10}}>
                          {sm&&<img src={sm} alt={card.name} style={{width:38,height:"auto",borderRadius:4,flexShrink:0}}/>}
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:".82rem",fontWeight:700,color:"#e8e8f4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{card.name}</div>
                            <div style={{fontSize:".64rem",color:"#6b6b90",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.artist} · {(card.set&&card.set.name)||"—"}{card.localId?` · #${card.localId}`:""}{card.rarity?` · ${card.rarity}`:""}</div>
                          </div>
                          <HuntStatusDot status={sec.key}/>
                          <div style={{fontSize:".78rem",fontWeight:700,color:price&&price.amount!=null?"#e8e8f4":"#3a3a5a",fontVariantNumeric:"tabular-nums",minWidth:58,textAlign:"right",flexShrink:0}}>{price&&price.amount!=null?fmtPrice(price.amount,price.currency):""}</div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              ))}
            </section>
          );
        })}
      </main>
    </div>
  );
}

// ── HUNT SHOW v0 ──────────────────────────────────────────────────────────────
// A narrowly scoped presentation layer over the same intentMap data Hunt
// Board already reads — not a new data model, not a duplicate hunt system.
// Flat (no per-artist grouping, unlike Hunt Board) and image-forward, meant
// to be handed to someone at a card show. Cards are shown at full color —
// the ".missing" grayscale treatment used elsewhere doesn't apply here on
// purpose: every card in this view is, by definition, not yet owned, so
// applying that treatment would gray out the entire screen and defeat the
// point of a clear vendor-facing display. Everything else (ownership check,
// intent semantics, ARTISTS/roster, CardModal) is reused as-is.
function HuntShow({visibleCardData,intentMap,checkOwned,onCardClick,onBack,roster}){
  const rosterList=roster||ARTISTS;
  const{hunting,want}=useMemo(()=>{
    const huntingOut=[],wantOut=[],seen=new Set();
    rosterList.forEach(entry=>{
      (visibleCardData[toSlug(entry.name)]||[]).forEach(card=>{
        if(seen.has(card.id))return;
        const st=intentMap?intentMap.get(card.id):undefined;
        if(st!=="hunting"&&st!=="want")return;   // excludes maybe/ignore and plain favorites
        if(checkOwned(card))return;               // same ownership suppression as Hunt Board
        seen.add(card.id);
        (st==="hunting"?huntingOut:wantOut).push({card,artist:entry.name});
      });
    });
    return{hunting:huntingOut,want:wantOut};
  },[visibleCardData,intentMap,checkOwned,rosterList]);
  const total=hunting.length+want.length;

  const Grid=({items})=>(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:"1rem"}}>
      {items.map(({card,artist})=>(
        <div key={card.id} onClick={()=>onCardClick(card)} style={{cursor:"pointer"}}>
          <div className="card-tile" style={{marginBottom:".4rem"}}>
            <img src={imgLarge(card)||imgSmall(card)} alt={card.name} loading="lazy" decoding="async" style={{width:"100%",height:"auto",display:"block",borderRadius:6}}/>
          </div>
          <div style={{fontSize:".76rem",color:"#e8e8f4",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{card.name}</div>
          <div style={{fontSize:".64rem",color:"#6b6b90",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{artist}</div>
        </div>
      ))}
    </div>
  );

  return(
    <div style={{minHeight:"100dvh",background:"#07070f"}}>
      <header style={{position:"sticky",top:0,zIndex:100,background:"rgba(7,7,15,0.97)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderBottom:"1px solid #1e1e35"}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:".7rem 1rem",display:"flex",alignItems:"center",gap:".8rem"}}>
          <button onClick={onBack} className="btn-ghost" style={{color:"#6b6b90",borderRadius:8,padding:".35rem .55rem",fontSize:".74rem",display:"flex",alignItems:"center",gap:".3rem",whiteSpace:"nowrap"}}>← Dashboard</button>
          <span className="font-display" style={{fontWeight:600,fontSize:"1.02rem",color:"#e8e8f4",letterSpacing:"-.01em"}}>MY HUNT</span>
          <span style={{marginLeft:"auto",fontSize:".7rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{hunting.length} active target{hunting.length===1?"":"s"} · {want.length} on the list</span>
        </div>
      </header>
      <main style={{maxWidth:960,margin:"0 auto",padding:"1.4rem 1rem 3rem"}}>
        {total===0&&(
          <div style={{padding:"3rem 1.2rem",textAlign:"center",fontSize:".8rem",lineHeight:1.6,color:"#4a4a70",border:"1px dashed #1e1e35",borderRadius:12,marginTop:"1.5rem"}}>
            Nothing to show yet. Open any missing card and set a Hunt status of Hunting or Want to add it here.
          </div>
        )}
        {hunting.length>0&&(
          <section style={{marginBottom:want.length>0?"2.2rem":0}}>
            <div style={{display:"flex",alignItems:"center",gap:".6rem",marginBottom:".9rem"}}>
              <span style={{fontSize:".64rem",fontWeight:800,letterSpacing:".14em",color:"#b9a3f2",whiteSpace:"nowrap"}}>HUNTING · {hunting.length}</span>
              <div style={{flex:1,height:1,background:"rgba(155,127,232,0.25)"}}/>
            </div>
            <Grid items={hunting}/>
          </section>
        )}
        {want.length>0&&(
          <section>
            <div style={{display:"flex",alignItems:"center",gap:".6rem",marginBottom:".9rem"}}>
              <span style={{fontSize:".64rem",fontWeight:800,letterSpacing:".14em",color:"#8888b8",whiteSpace:"nowrap"}}>ON THE LIST · {want.length}</span>
              <div style={{flex:1,height:1,background:"rgba(136,136,184,0.18)"}}/>
            </div>
            <Grid items={want}/>
          </section>
        )}
      </main>
    </div>
  );
}

// ── BINDER PLANNING (BP-0A2) ─────────────────────────────────────────────────
// Planned Binders index + a calm detail placeholder. Self-fetching (App holds
// only planId), session-only UI state, no caching. Card membership, catalog
// search, ownership treatment, and progress counts are BP-0A3/BP-0A4 —
// deliberately absent here.
function BinderPlansIndex({user,onOpenPlan,onBack}){
  const[binders,setBinders]=useState(undefined); // undefined=loading, null=load failed, []=empty
  const[refresh,setRefresh]=useState(0);
  const[formOpen,setFormOpen]=useState(false);
  const[name,setName]=useState("");
  const[desc,setDesc]=useState("");
  const[busy,setBusy]=useState(false);
  const[formError,setFormError]=useState("");
  const[deletingId,setDeletingId]=useState(null);
  useEffect(()=>{
    let cancelled=false;
    setBinders(undefined);
    fetchBinders(user.id).then(rows=>{if(!cancelled)setBinders(rows);});
    return()=>{cancelled=true;};
  },[user.id,refresh]);
  const handleCreate=async()=>{
    if(busy)return;
    setBusy(true);setFormError("");
    try{
      await createBinder(user.id,{name,description:desc});
      setName("");setDesc("");setFormOpen(false);setRefresh(n=>n+1);
    }catch(e){setFormError(e.message||"Could not create the binder.");}
    finally{setBusy(false);}
  };
  const handleDelete=async(e,b)=>{
    e.stopPropagation(); // row is clickable — deleting must not navigate into the binder
    if(deletingId)return;
    if(!window.confirm(`Delete "${b.name}"? Its card list will be removed.`))return;
    setDeletingId(b.id);
    try{await deleteBinder(user.id,b.id);setRefresh(n=>n+1);}
    catch(err){console.error(err);alert("Could not delete the binder. Please try again.");}
    finally{setDeletingId(null);}
  };
  const inputSt={width:"100%",background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,color:"#e8e8f4",padding:".5rem .7rem",fontSize:".85rem"};
  const createForm=(
    <div style={{border:"1px solid #1e1e35",borderRadius:12,padding:".9rem",marginBottom:"1.25rem",background:"rgba(255,255,255,0.015)"}}>
      <input value={name} onChange={e=>setName(e.target.value)} maxLength={80} placeholder="Binder name" style={{...inputSt,marginBottom:".5rem"}} autoFocus/>
      <input value={desc} onChange={e=>setDesc(e.target.value)} maxLength={280} placeholder="Short description (optional)" style={{...inputSt,marginBottom:".65rem",fontSize:".78rem"}}/>
      {formError&&<div style={{fontSize:".72rem",color:"#f87171",marginBottom:".55rem"}}>{formError}</div>}
      <div style={{display:"flex",gap:".5rem"}}>
        <button onClick={handleCreate} disabled={busy||!name.trim()} className="btn-flame" style={{borderRadius:8,padding:".45rem 1rem",fontSize:".76rem",fontWeight:700,opacity:(busy||!name.trim())?0.55:1}}>{busy?"Creating…":"Create binder"}</button>
        <button onClick={()=>{setFormOpen(false);setFormError("");}} className="btn-ghost" style={{borderRadius:8,padding:".45rem .9rem",fontSize:".76rem",fontWeight:600}}>Cancel</button>
      </div>
    </div>
  );
  return(
    <div style={{minHeight:"100dvh",background:"#07070f"}}>
      <header style={{position:"sticky",top:0,zIndex:100,background:"rgba(7,7,15,0.97)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderBottom:"1px solid #1e1e35"}}>
        <div style={{maxWidth:860,margin:"0 auto",padding:".7rem 1rem",display:"flex",alignItems:"center",gap:".8rem"}}>
          <button onClick={onBack} className="btn-ghost" style={{color:"#6b6b90",borderRadius:8,padding:".35rem .55rem",fontSize:".74rem",display:"flex",alignItems:"center",gap:".3rem",whiteSpace:"nowrap"}}>← Binder</button>
          <span className="font-display" style={{fontWeight:600,fontSize:"1.02rem",color:"#e8e8f4",letterSpacing:"-.01em"}}>Planned Binders</span>
        </div>
      </header>
      <main style={{maxWidth:860,margin:"0 auto",padding:"1.2rem 1rem 3rem"}}>
        {binders===undefined&&(
          <div style={{display:"flex",alignItems:"center",gap:".5rem",padding:"2rem 0",color:"#6b6b90",fontSize:".8rem"}}><IcoSpin/> Loading your binders…</div>
        )}
        {binders===null&&(
          <div style={{padding:"2rem 1.2rem",textAlign:"center",fontSize:".8rem",lineHeight:1.6,color:"#f87171",border:"1px solid rgba(248,113,113,0.25)",borderRadius:12,marginTop:"1rem"}}>
            Couldn't load your binders. <button onClick={()=>setRefresh(n=>n+1)} style={{color:"#8b6cd8",background:"none",border:"none",cursor:"pointer",fontSize:".8rem",fontWeight:600,padding:0}}>Retry</button>
          </div>
        )}
        {Array.isArray(binders)&&binders.length===0&&!formOpen&&(
          <div style={{padding:"3rem 1.2rem",textAlign:"center",marginTop:"1rem"}}>
            <h2 className="font-display" style={{fontSize:"clamp(1.3rem,4vw,1.8rem)",fontWeight:700,letterSpacing:"-.02em",color:"#f2e9df",marginBottom:".5rem"}}>A binder starts with an idea.</h2>
            <p style={{fontSize:".8rem",color:"#6b6b90",lineHeight:1.6,maxWidth:420,margin:"0 auto 1.5rem"}}>Name the collection you want to build — an artist's best work, one Pokémon across eras, a theme only you can see.</p>
            <button onClick={()=>setFormOpen(true)} className="btn-flame" style={{borderRadius:10,padding:".6rem 1.4rem",fontSize:".82rem",fontWeight:700}}>Create your first binder</button>
          </div>
        )}
        {Array.isArray(binders)&&(binders.length>0||formOpen)&&(
          <>
            {formOpen?createForm:(
              <div style={{marginBottom:"1.25rem"}}>
                <button onClick={()=>setFormOpen(true)} className="btn-ghost" style={{borderRadius:10,padding:".5rem 1rem",fontSize:".76rem",fontWeight:600,color:"#8b6cd8"}}>New binder +</button>
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
              {binders.map(b=>(
                <div key={b.id} className="artist-row" onClick={()=>onOpenPlan(b.id)} style={{display:"flex",alignItems:"center",gap:".75rem",padding:".7rem .75rem"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:".92rem",fontWeight:700,color:"#e8e8f4",letterSpacing:"-.01em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name}</div>
                    {b.description&&<div style={{fontSize:".7rem",color:"#6b6b90",marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.description}</div>}
                  </div>
                  <button onClick={e=>handleDelete(e,b)} disabled={deletingId===b.id} title="Delete binder" style={{background:"none",border:"none",cursor:"pointer",color:deletingId===b.id?"#3a3a5a":"#4a4a70",fontSize:".66rem",fontWeight:600,padding:".3rem .4rem",flexShrink:0,transition:"color .15s"}} onMouseEnter={e=>{if(deletingId!==b.id)e.currentTarget.style.color="#f87171";}} onMouseLeave={e=>{e.currentTarget.style.color=deletingId===b.id?"#3a3a5a":"#4a4a70";}}>{deletingId===b.id?"Deleting…":"Delete"}</button>
                  <div style={{fontSize:".65rem",color:"#2a2a40",flexShrink:0}}>→</div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function BinderPlanPage({planId,user,onBack,checkOwned,onCardClick}){
  const[binder,setBinder]=useState(undefined); // undefined=loading, null=not found/unauthorized/error
  // BP-0B: inline edit of name/description. Session-only form state; Save
  // writes through updateBinder and applies the returned row locally —
  // binder id and memberships are untouched, updated_at handled by trigger.
  const[editing,setEditing]=useState(false);
  const[editName,setEditName]=useState("");
  const[editDesc,setEditDesc]=useState("");
  const[editBusy,setEditBusy]=useState(false);
  const[editError,setEditError]=useState("");
  // BP-0A3: membership. memberIds are the source of truth for the total;
  // memberCards are whatever resolves against cards_effective. Their
  // difference is the orphan count (rows retained, surfaced, never
  // silently deleted).
  const[memberIds,setMemberIds]=useState(undefined);   // undefined=loading, null=load failed, string[]
  const[memberCards,setMemberCards]=useState([]);
  const[membersReady,setMembersReady]=useState(false);
  // BP-0A4: catalog search. results: undefined=idle, null=failed, array.
  const[query,setQuery]=useState("");
  const[results,setResults]=useState(undefined);
  const[searching,setSearching]=useState(false);
  const[busyIds,setBusyIds]=useState(()=>new Set());
  useEffect(()=>{
    let cancelled=false;
    setBinder(undefined);setMemberIds(undefined);setMemberCards([]);setMembersReady(false);
    setEditing(false);setEditError(""); // BP-0B: never carry edit mode across binders
    fetchBinder(planId).then(row=>{if(!cancelled)setBinder(row);});
    fetchBinderCardIds(planId).then(async ids=>{
      if(cancelled)return;
      setMemberIds(ids);
      if(!ids){setMembersReady(true);return;}
      const cards=await fetchCardsByIds(ids);
      if(cancelled)return;
      if(cards){
        const byId=new Map(cards.map(c=>[c.id,c]));
        setMemberCards(ids.map(id=>byId.get(id)).filter(Boolean)); // keep membership order
      }
      setMembersReady(true);
    });
    return()=>{cancelled=true;};
  },[planId]);
  // Debounced catalog search (300ms, min 2 chars). Session-only.
  useEffect(()=>{
    const q=query.trim();
    if(q.length<2){setResults(undefined);setSearching(false);return;}
    setSearching(true);
    let cancelled=false;
    const t=setTimeout(async()=>{
      const rows=await searchCatalogCards(q,24);
      if(cancelled)return;
      setResults(rows);setSearching(false);
    },300);
    return()=>{cancelled=true;clearTimeout(t);};
  },[query]);
  const memberIdSet=useMemo(()=>new Set(memberIds||[]),[memberIds]);
  const ownedCount=useMemo(()=>memberCards.filter(checkOwned).length,[memberCards,checkOwned]);
  const plannedCount=memberCards.length-ownedCount;     // resolved-only, per approved semantics
  const totalCount=(memberIds||[]).length;               // every membership row, orphans included
  const orphanCount=totalCount-memberCards.length;
  const setBusy=(id,on)=>setBusyIds(prev=>{const n=new Set(prev);on?n.add(id):n.delete(id);return n;});
  const handleAdd=async card=>{
    if(busyIds.has(card.id)||memberIdSet.has(card.id))return;
    setBusy(card.id,true);
    try{
      await addCardToBinder(planId,card.id); // true=inserted, false=already there — both converge below
      setMemberIds(ids=>(ids&&!ids.includes(card.id))?[...ids,card.id]:ids);
      setMemberCards(cs=>cs.some(c=>c.id===card.id)?cs:[...cs,card]);
    }catch(err){console.error(err);alert("Could not add the card. Please try again.");}
    finally{setBusy(card.id,false);}
  };
  const handleRemove=async(e,cardId)=>{
    e.stopPropagation(); // tile taps open CardModal — removal must not
    if(busyIds.has(cardId))return;
    setBusy(cardId,true);
    try{
      await removeCardFromBinder(planId,cardId);
      setMemberIds(ids=>ids?ids.filter(id=>id!==cardId):ids);
      setMemberCards(cs=>cs.filter(c=>c.id!==cardId));
    }catch(err){console.error(err);alert("Could not remove the card. Please try again.");}
    finally{setBusy(cardId,false);}
  };
  const startEdit=()=>{
    setEditName(binder.name);
    setEditDesc(binder.description||"");
    setEditError("");
    setEditing(true);
  };
  const cancelEdit=()=>{setEditing(false);setEditError("");};
  const handleSaveEdit=async()=>{
    if(editBusy)return;
    setEditBusy(true);setEditError("");
    try{
      const row=await updateBinder(user.id,planId,{name:editName,description:editDesc});
      setBinder(row);
      setEditing(false);
    }catch(e){setEditError(e.message||"Could not save changes.");}
    finally{setEditBusy(false);}
  };
  const summary=membersReady&&memberIds
    ?`${ownedCount} owned · ${plannedCount} planned · ${totalCount} ${totalCount===1?"card":"cards"}`
    :null;
  return(
    <div style={{minHeight:"100dvh",background:"#07070f"}}>
      <header style={{position:"sticky",top:0,zIndex:100,background:"rgba(7,7,15,0.97)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderBottom:"1px solid #1e1e35"}}>
        <div style={{maxWidth:860,margin:"0 auto",padding:".7rem 1rem",display:"flex",alignItems:"center",gap:".8rem"}}>
          <button onClick={onBack} className="btn-ghost" style={{color:"#6b6b90",borderRadius:8,padding:".35rem .55rem",fontSize:".74rem",display:"flex",alignItems:"center",gap:".3rem",whiteSpace:"nowrap"}}>← Planned Binders</button>
          {binder&&<span className="font-display" style={{fontWeight:600,fontSize:"1.02rem",color:"#e8e8f4",letterSpacing:"-.01em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{binder.name}</span>}
          {summary&&<span className="hide-on-narrow" style={{marginLeft:"auto",fontSize:".68rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{summary}</span>}
        </div>
      </header>
      <main style={{maxWidth:860,margin:"0 auto",padding:"1.2rem 1rem 3rem"}}>
        {binder===undefined&&(
          <div style={{display:"flex",alignItems:"center",gap:".5rem",padding:"2rem 0",color:"#6b6b90",fontSize:".8rem"}}><IcoSpin/> Opening binder…</div>
        )}
        {binder===null&&(
          <div style={{padding:"3rem 1.2rem",textAlign:"center",fontSize:".8rem",lineHeight:1.6,color:"#4a4a70",border:"1px dashed #1e1e35",borderRadius:12,marginTop:"1rem"}}>
            This binder isn't available. It may have been deleted.
            <div style={{marginTop:".8rem"}}>
              <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:"#8b6cd8",fontSize:".76rem",fontWeight:600,padding:0}}>Back to Planned Binders</button>
            </div>
          </div>
        )}
        {binder&&(
          <>
            {editing?(
              /* ── BP-0B: inline edit — same compact form language as create ── */
              <div style={{border:"1px solid #1e1e35",borderRadius:12,padding:".9rem",marginBottom:"1.4rem",background:"rgba(255,255,255,0.015)",maxWidth:560}}>
                <input value={editName} onChange={e=>setEditName(e.target.value)} maxLength={80} placeholder="Binder name"
                  style={{width:"100%",background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,color:"#e8e8f4",padding:".5rem .7rem",fontSize:".85rem",marginBottom:".5rem"}} autoFocus/>
                <input value={editDesc} onChange={e=>setEditDesc(e.target.value)} maxLength={280} placeholder="Short description (optional)"
                  style={{width:"100%",background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,color:"#e8e8f4",padding:".5rem .7rem",fontSize:".78rem",marginBottom:".65rem"}}/>
                {editError&&<div style={{fontSize:".72rem",color:"#f87171",marginBottom:".55rem"}}>{editError}</div>}
                <div style={{display:"flex",gap:".5rem"}}>
                  <button onClick={handleSaveEdit} disabled={editBusy||!editName.trim()} className="btn-flame" style={{borderRadius:8,padding:".45rem 1rem",fontSize:".76rem",fontWeight:700,opacity:(editBusy||!editName.trim())?0.55:1}}>{editBusy?"Saving…":"Save"}</button>
                  <button onClick={cancelEdit} className="btn-ghost" style={{borderRadius:8,padding:".45rem .9rem",fontSize:".76rem",fontWeight:600}}>Cancel</button>
                </div>
              </div>
            ):(
              <>
                {binder.description&&<p style={{fontSize:".84rem",color:"#8888a8",lineHeight:1.55,maxWidth:560,marginBottom:".9rem"}}>{binder.description}</p>}
                {/* BP-0B: summary · legend · Edit — one quiet row, wraps on mobile. */}
                <div style={{display:"flex",alignItems:"baseline",gap:".45rem .8rem",flexWrap:"wrap",marginBottom:"1.2rem"}}>
                  {summary&&<span style={{fontSize:".72rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{summary}</span>}
                  {membersReady&&totalCount>0&&<span style={{fontSize:".66rem",color:"#4a4a70"}}>Owned cards appear in full color · planned cards stay dimmed</span>}
                  <button onClick={startEdit} style={{background:"none",border:"none",cursor:"pointer",color:"#8b6cd8",fontSize:".7rem",fontWeight:600,padding:0,marginLeft:"auto",whiteSpace:"nowrap"}}>Edit</button>
                </div>
              </>
            )}

            {/* ── BP-0A4: search / add region ── */}
            <div style={{marginBottom:"1.6rem"}}>
              <div style={{position:"relative",maxWidth:420}}>
                <div style={{position:"absolute",left:".65rem",top:"50%",transform:"translateY(-50%)",color:"#52527a",display:"flex"}}><IcoSearch/></div>
                <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search any card in the catalog…"
                  style={{width:"100%",background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:10,color:"#e8e8f4",padding:".55rem .8rem .55rem 2.2rem",fontSize:".84rem"}}/>
              </div>
              {query.trim().length===1&&(
                <div style={{marginTop:".45rem",fontSize:".68rem",color:"#4a4a70"}}>Type at least 2 characters to search.</div>
              )}
              {query.trim().length>=2&&(
                <div style={{marginTop:".7rem",border:"1px solid #16162a",borderRadius:12,padding:".35rem",background:"rgba(255,255,255,0.012)"}}>
                  {searching&&(
                    <div style={{display:"flex",alignItems:"center",gap:".5rem",padding:".8rem .6rem",color:"#6b6b90",fontSize:".76rem"}}><IcoSpin/> Searching the catalog…</div>
                  )}
                  {!searching&&results===null&&(
                    <div style={{padding:".8rem .6rem",color:"#f87171",fontSize:".76rem"}}>Search failed. Check your connection and try again.</div>
                  )}
                  {!searching&&Array.isArray(results)&&results.length===0&&(
                    <div style={{padding:".8rem .6rem",color:"#4a4a70",fontSize:".76rem"}}>No cards match "{query.trim()}".</div>
                  )}
                  {!searching&&Array.isArray(results)&&results.map(card=>{
                    const owned=checkOwned(card);
                    const inBinder=memberIdSet.has(card.id);
                    const busy=busyIds.has(card.id);
                    const sm=imgSmall(card);
                    return(
                      <div key={card.id} className="wanted-row" onClick={()=>onCardClick(card)} style={{display:"flex",alignItems:"center",gap:".65rem",padding:".45rem .55rem",cursor:"pointer"}}>
                        {sm?<img src={sm} alt={card.name} loading="lazy" decoding="async" style={{width:34,height:"auto",borderRadius:4,flexShrink:0}}/>:<div style={{width:34,height:47,borderRadius:4,background:"#13131f",border:"1px solid #1e1e35",flexShrink:0}}/>}
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:".8rem",fontWeight:600,color:"#e8e8f4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{card.name}</div>
                          <div style={{fontSize:".62rem",color:"#6b6b90",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{(card.set&&card.set.name)||"—"}{card.localId?` · #${card.localId}`:""}{card.illustrator?` · ${card.illustrator}`:""}</div>
                        </div>
                        {owned&&<span style={{fontSize:".6rem",fontWeight:700,color:"#22c55e",letterSpacing:".06em",flexShrink:0}}>OWNED</span>}
                        <button onClick={e=>{e.stopPropagation();handleAdd(card);}} disabled={inBinder||busy}
                          className={inBinder?undefined:"btn-ghost"}
                          style={{borderRadius:8,padding:".32rem .6rem",fontSize:".68rem",fontWeight:600,flexShrink:0,cursor:inBinder?"default":"pointer",...(inBinder?{background:"none",border:"1px solid transparent",color:"rgba(34,197,94,0.75)"}:{color:"#8b6cd8"}),opacity:busy?0.55:1}}>
                          {inBinder?"Added ✓":busy?"Adding…":"+ Add"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── BP-0A3: binder collection grid ── */}
            {memberIds===undefined&&(
              <div style={{display:"flex",alignItems:"center",gap:".5rem",padding:"1.5rem 0",color:"#6b6b90",fontSize:".8rem"}}><IcoSpin/> Loading cards…</div>
            )}
            {memberIds===null&&(
              <div style={{padding:"2rem 1.2rem",textAlign:"center",fontSize:".78rem",lineHeight:1.6,color:"#f87171",border:"1px solid rgba(248,113,113,0.25)",borderRadius:12}}>
                Couldn't load this binder's cards. Refresh to try again.
              </div>
            )}
            {membersReady&&memberIds&&totalCount===0&&query.trim().length<2&&(
              <div style={{padding:"2.6rem 1.2rem",textAlign:"center",border:"1px dashed #1e1e35",borderRadius:12}}>
                <div style={{fontSize:".84rem",color:"#8888a8",lineHeight:1.6,maxWidth:420,margin:"0 auto .35rem"}}>This binder is where a theme takes shape — cards you own and cards you're still after, side by side.</div>
                <div style={{fontSize:".76rem",color:"#4a4a70",lineHeight:1.6}}>Search the catalog above to place the first card.</div>
              </div>
            )}
            {membersReady&&memberCards.length>0&&(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:".85rem"}}>
                {memberCards.map(card=>{
                  const busy=busyIds.has(card.id);
                  return(
                    <div key={card.id} style={{opacity:busy?0.45:1,transition:"opacity .15s"}}>
                      <div style={{position:"relative"}}>
                        <CardTile card={card} owned={checkOwned(card)} onCardClick={onCardClick} readOnly/>
                        <button onClick={e=>handleRemove(e,card.id)} disabled={busy} title="Remove from binder" aria-label={`Remove ${card.name} from binder`}
                          style={{position:"absolute",bottom:0,right:0,width:28,height:28,background:"none",border:"none",padding:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}
                          onMouseEnter={e=>{const g=e.currentTarget.firstElementChild;g.style.background="rgba(190,40,40,0.85)";g.style.color="#fff";}}
                          onMouseLeave={e=>{const g=e.currentTarget.firstElementChild;g.style.background="rgba(0,0,0,0.55)";g.style.color="rgba(255,255,255,0.5)";}}>
                          <span style={{width:17,height:17,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,lineHeight:1,background:"rgba(0,0,0,0.55)",color:"rgba(255,255,255,0.5)",transition:"background .12s,color .12s",pointerEvents:"none"}}>✕</span>
                        </button>
                      </div>
                      <div style={{fontSize:".68rem",color:"#c8c8de",fontWeight:600,marginTop:".3rem",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{card.name}</div>
                      <div style={{fontSize:".58rem",color:"#5a5a80",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{(card.set&&card.set.name)||"—"}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {membersReady&&orphanCount>0&&(
              <div style={{marginTop:"1rem",fontSize:".66rem",color:"#4a4a70",lineHeight:1.5}}>
                {orphanCount} {orphanCount===1?"card in this binder is":"cards in this binder are"} no longer in the catalog. {orphanCount===1?"It's":"They're"} still counted in the total and will reappear if the catalog restores {orphanCount===1?"it":"them"}.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── ARTIST DIRECTORY (A-D1) ───────────────────────────────────────────────────
// Read-only visual directory of the tracked artist roster ("Explore Artists").
// Derived entirely from in-memory state — no Supabase calls, no mutation.
// Tapping an artist opens the existing Artist Page. Track/untrack is A-D2.
function ArtistDirectory({visibleCardData,checkOwned,loadingSet,errors,onOpenArtist,onBack,roster,onArtistAdded,onChangeTier,onRemoveArtist}){
  // A-D2b0: roster = effectiveRoster; defensive fallback to curated ARTISTS.
  const rosterList=roster||ARTISTS;
  // ── A-D2c: Find an illustrator (quiet doorway, not a database page) ─────────
  // All hooks unconditional and grouped here — never behind conditionals.
  const[findQuery,  setFindQuery]  =useState("");
  const[findResults,setFindResults]=useState(null);   // null = no search yet; [] = no matches
  const[findStatus, setFindStatus] =useState("idle"); // idle | searching | done | error
  const[addStatus,  setAddStatus]  =useState({});     // illustrator → adding | added | error
  const[addErrors,  setAddErrors]  =useState({});     // illustrator → short human-readable reason
  // A-D2d: Manage control state, keyed by artistId — mirrors the addStatus/
  // addErrors pattern above. "busy" covers both a tier change and a remove
  // in flight (only one action per row at a time).
  const[manageBusy,  setManageBusy]  =useState({});   // artistId → true while a change/remove is in flight
  const[manageErrors,setManageErrors]=useState({});   // artistId → short human-readable reason
  const[openManage,  setOpenManage]  =useState(null);  // artistId of the currently-open manage popover, or null
  // Names already in the archive (curated + dynamic), lowercased, incl. aliases —
  // used to label "In your archive" and prevent duplicate adds.
  const trackedNames=useMemo(()=>{
    const s=new Set();
    rosterList.forEach(a=>{
      if(a.name)s.add(String(a.name).toLowerCase());
      (a.aliases||[]).forEach(al=>s.add(String(al).toLowerCase()));
    });
    return s;
  },[rosterList]);
  const runFind=useCallback(async()=>{
    const q=findQuery.trim();
    if(!q)return;
    setFindStatus("searching");
    const results=await searchIllustratorDirectory(q,12); // null = soft-fail
    if(results===null){setFindResults(null);setFindStatus("error");return;}
    setFindResults(results);setFindStatus("done");
  },[findQuery]);
  const handleAdd=useCallback(async illustrator=>{
    // Only real illustrator_directory results reach this handler — never free text.
    setAddStatus(s=>({...s,[illustrator]:"adding"}));
    setAddErrors(s=>{const n={...s};delete n[illustrator];return n;});
    const res=await addArtistToArchive(illustrator);
    if(res.ok){
      setAddStatus(s=>({...s,[illustrator]:"added"}));
      onArtistAdded&&onArtistAdded(); // App refetches tracked ids → YOUR ADDITIONS updates
    }else{
      setAddStatus(s=>({...s,[illustrator]:"error"}));
      setAddErrors(s=>({...s,[illustrator]:res.error||"Couldn't add right now."}));
    }
  },[onArtistAdded]);
  // A-D2d: Manage control — tier reassignment and remove, dynamic artists only.
  const handleTierChange=useCallback(async(artistId,tier)=>{
    if(!onChangeTier)return;
    setManageBusy(s=>({...s,[artistId]:true}));
    setManageErrors(s=>{const n={...s};delete n[artistId];return n;});
    const res=await onChangeTier(artistId,tier);
    setManageBusy(s=>{const n={...s};delete n[artistId];return n;});
    if(res&&res.ok){setOpenManage(null);}
    else{setManageErrors(s=>({...s,[artistId]:(res&&res.error)||"Couldn't update — try again."}));}
  },[onChangeTier]);
  const handleRemove=useCallback(async artistId=>{
    if(!onRemoveArtist)return;
    if(!window.confirm("Remove this artist from your archive? This only removes it from your archive — nothing is deleted from your collection."))return;
    setManageBusy(s=>({...s,[artistId]:true}));
    setManageErrors(s=>{const n={...s};delete n[artistId];return n;});
    const res=await onRemoveArtist(artistId);
    setManageBusy(s=>{const n={...s};delete n[artistId];return n;});
    if(res&&res.ok){setOpenManage(null);}
    else{setManageErrors(s=>({...s,[artistId]:(res&&res.error)||"Couldn't remove — try again."}));}
  },[onRemoveArtist]);
  const stats=useMemo(()=>rosterList.map(entry=>{
    const slug=toSlug(entry.name);
    const meta=ARTIST_META[slug]||{};
    const cards=visibleCardData[slug]||[];
    const owned=cards.filter(checkOwned).length;
    const pct=cards.length?Math.round((owned/cards.length)*100):0;
    // Preview picks: prefer curated topCardNames, fill from existing sorted
    // order. Only cards with an image are eligible; always shown in color.
    const withImg=cards.filter(c=>c&&c.image);
    const picks=[];const used=new Set();
    (meta.topCardNames||[]).forEach(n=>{
      if(picks.length>=3)return;
      const c=withImg.find(x=>x.name===n&&!used.has(x.id));
      if(c){picks.push(c);used.add(c.id);}
    });
    for(let i=0;i<withImg.length&&picks.length<3;i++){
      if(!used.has(withImg[i].id)){picks.push(withImg[i]);used.add(withImg[i].id);}
    }
    return{...entry,slug,meta,total:cards.length,owned,pct,picks};
  }),[visibleCardData,checkOwned,rosterList]);
  // A-D2b0: explicit tier split; "YOUR ADDITIONS" renders only when non-empty
  // (the existing sec.items.length>0 guard below). secondary+special partition
  // identically to the old tier!=="main" filter when no "added" entries exist.
  const sections=[
    {label:"MAIN ARTISTS",items:stats.filter(a=>a.tier==="main")},
    {label:"SECONDARY & SPECIAL",items:stats.filter(a=>a.tier==="secondary"||a.tier==="special")},
    {label:"YOUR ADDITIONS",items:stats.filter(a=>a.tier==="added")},
  ];
  return(
    <div style={{minHeight:"100dvh",background:"#07070f"}}>
      <header style={{position:"sticky",top:0,zIndex:100,background:"rgba(7,7,15,0.97)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderBottom:"1px solid #1e1e35"}}>
        <div style={{maxWidth:860,margin:"0 auto",padding:".7rem 1rem",display:"flex",alignItems:"center",gap:".8rem"}}>
          <button onClick={onBack} className="btn-ghost" style={{color:"#6b6b90",borderRadius:8,padding:".35rem .55rem",fontSize:".74rem",display:"flex",alignItems:"center",gap:".3rem",whiteSpace:"nowrap"}}>← Dashboard</button>
          <span className="font-display" style={{fontWeight:600,fontSize:"1.02rem",color:"#e8e8f4",letterSpacing:"-.01em"}}>Artists</span>
          <span style={{marginLeft:"auto",fontSize:".7rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{rosterList.length} artists</span>
        </div>
      </header>
      <main style={{maxWidth:860,margin:"0 auto",padding:"1.2rem 1rem 3rem"}}>
        <p style={{fontSize:".74rem",color:"#6b6b90",marginBottom:"1.4rem",letterSpacing:".02em"}}>The illustrators in your vault.</p>

        {/* ── A-D2c: Find an illustrator ─────────────────────────────────────
            A quiet doorway for growing the archive — placed above the roster
            now that Add to Archive is live, but kept compact so the page
            stays a gallery, not a database search. Results come only from
            illustrator_directory; adding calls the add_artist_to_archive RPC.
            Untracked results are not tappable (no untracked Artist Page yet)
            and carry no intent/favorite/Force Owned actions. */}
        <section style={{marginBottom:"2.2rem"}}>
          <h3 style={{fontSize:".62rem",letterSpacing:".14em",color:"#6b6b90",fontWeight:700,marginBottom:".4rem"}}>FIND AN ILLUSTRATOR</h3>
          <div style={{display:"flex",gap:".5rem",maxWidth:420}}>
            <input
              type="search"
              placeholder="Illustrator name…"
              value={findQuery}
              onChange={e=>setFindQuery(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")runFind();}}
              style={{flex:1,minWidth:0,background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,color:"#e8e8f4",padding:".45rem .7rem",fontSize:".82rem"}}
            />
            <button onClick={runFind} disabled={findStatus==="searching"||!findQuery.trim()} className="btn-ghost" style={{borderRadius:8,padding:".45rem .8rem",fontSize:".74rem",fontWeight:600,color:"#8b6cd8",whiteSpace:"nowrap",opacity:(findStatus==="searching"||!findQuery.trim())?0.55:1}}>
              {findStatus==="searching"?<span style={{display:"flex",alignItems:"center",gap:5}}><IcoSpin/> Searching…</span>:"Search"}
            </button>
          </div>
          {findStatus==="error"&&(
            <p style={{fontSize:".72rem",color:"#f87171",marginTop:".7rem"}}>Search isn't available right now — try again in a moment.</p>
          )}
          {findStatus==="done"&&findResults&&findResults.length===0&&(
            <p style={{fontSize:".72rem",color:"#6b6b90",marginTop:".7rem"}}>No illustrators found for “{findQuery.trim()}”.</p>
          )}
          {findResults&&findResults.length>0&&(
            <div style={{marginTop:".85rem",display:"flex",flexDirection:"column",gap:"2px",maxWidth:520}}>
              {findResults.map(r=>{
                const name=r.illustrator;
                const st=addStatus[name];
                const count=Number(r.card_count)||0; // bigint counts can serialize as strings
                const inArchive=trackedNames.has(String(name).toLowerCase())||st==="added";
                return(
                  <div key={name} style={{border:"1px solid #1e1e35",borderRadius:10,background:"#0b0b16",padding:".5rem .75rem"}}>
                    <div style={{display:"flex",alignItems:"center",gap:".75rem"}}>
                      <div style={{minWidth:0,flex:1}}>
                        <span style={{fontSize:".82rem",fontWeight:600,color:"#e8e8f4"}}>{name}</span>
                        <span style={{fontSize:".68rem",color:"#6b6b90",marginLeft:".6rem",fontVariantNumeric:"tabular-nums"}}>{count} card{count===1?"":"s"}</span>
                      </div>
                      {inArchive?(
                        <span style={{fontSize:".66rem",color:"#22c55e",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>✓ In your archive</span>
                      ):st==="adding"?(
                        <span style={{fontSize:".66rem",color:"#6b6b90",display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap",flexShrink:0}}><IcoSpin/> Adding…</span>
                      ):st==="error"?(
                        <button onClick={()=>handleAdd(name)} className="btn-ghost" style={{borderRadius:8,padding:".3rem .6rem",fontSize:".66rem",fontWeight:600,color:"#f87171",whiteSpace:"nowrap",flexShrink:0}}>Couldn't add — retry</button>
                      ):(
                        <button onClick={()=>handleAdd(name)} className="btn-ghost" style={{borderRadius:8,padding:".3rem .6rem",fontSize:".66rem",fontWeight:600,color:"#8b6cd8",whiteSpace:"nowrap",flexShrink:0}}>Add to Archive</button>
                      )}
                    </div>
                    {st==="error"&&addErrors[name]&&(
                      <div style={{fontSize:".64rem",color:"#b06060",marginTop:".35rem",letterSpacing:".01em"}}>{addErrors[name]}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {sections.map(sec=>sec.items.length>0&&(
          <section key={sec.label} style={{marginBottom:"2rem"}}>
            <h3 style={{fontSize:".62rem",letterSpacing:".14em",color:"#6b6b90",fontWeight:700,marginBottom:".75rem",paddingBottom:".5rem",borderBottom:"1px solid #1e1e35"}}>{sec.label}</h3>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:".7rem"}}>
              {sec.items.map(a=>{
                const isLoading=loadingSet&&loadingSet.has(a.slug)&&a.total===0;
                const err=errors&&errors[a.slug];
                return(
                  <div key={a.slug} className="artist-row" onClick={()=>onOpenArtist(a.slug)} style={{border:"1px solid #1e1e35",borderLeft:`3px solid ${a.meta.accent||"#8b6cd8"}`,borderRadius:12,padding:".8rem .9rem",background:"#0b0b16",display:"flex",flexDirection:"column",gap:".55rem"}}>
                    <div style={{display:"flex",alignItems:"baseline",gap:".6rem"}}>
                      <div style={{fontSize:".9rem",fontWeight:700,color:a.pct===100&&a.total>0?"#22c55e":"#e8e8f4",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}{a.pct===100&&a.total>0?" ✓":""}</div>
                      <div style={{marginLeft:a.isDynamic?0:"auto",fontSize:".7rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums",flexShrink:0}}>{err?"—":isLoading?"…":`${a.owned}/${a.total}`}</div>
                      {/* A-D2d: Manage control — dynamic (user-added) artists only.
                          Curated tiles get no control at all. */}
                      {a.isDynamic&&(
                        <button
                          onClick={e=>{e.stopPropagation();setOpenManage(m=>m===a.artistId?null:a.artistId);setManageErrors(s=>{const n={...s};delete n[a.artistId];return n;});}}
                          className="btn-ghost"
                          style={{marginLeft:"auto",flexShrink:0,borderRadius:7,padding:".2rem .5rem",fontSize:".72rem",color:openManage===a.artistId?"#c0a0f8":"#6b6b90"}}
                          title="Manage artist"
                        >⋯</button>
                      )}
                    </div>
                    {a.isDynamic&&openManage===a.artistId&&(
                      <div onClick={e=>e.stopPropagation()} style={{border:"1px solid #2a2a45",borderRadius:9,background:"#0f0f1c",padding:".55rem .6rem",display:"flex",flexDirection:"column",gap:".4rem"}}>
                        <span style={{fontSize:".6rem",letterSpacing:".08em",color:"#6b6b90",fontWeight:700}}>MOVE TO</span>
                        <div style={{display:"flex",gap:".35rem",flexWrap:"wrap"}}>
                          {[["main","Main Artists"],["secondary","Secondary & Special"],["added","Your Additions"]].map(([tierVal,label])=>(
                            <button
                              key={tierVal}
                              disabled={!!manageBusy[a.artistId]||a.tier===tierVal}
                              onClick={()=>handleTierChange(a.artistId,tierVal)}
                              className="btn-ghost"
                              style={{borderRadius:7,padding:".28rem .55rem",fontSize:".66rem",fontWeight:600,color:a.tier===tierVal?"#22c55e":"#8b6cd8",opacity:manageBusy[a.artistId]?0.55:1,whiteSpace:"nowrap"}}
                            >{a.tier===tierVal?`✓ ${label}`:label}</button>
                          ))}
                        </div>
                        <button
                          disabled={!!manageBusy[a.artistId]}
                          onClick={()=>handleRemove(a.artistId)}
                          className="btn-ghost"
                          style={{alignSelf:"flex-start",borderRadius:7,padding:".28rem .55rem",fontSize:".66rem",fontWeight:600,color:"#f87171",opacity:manageBusy[a.artistId]?0.55:1}}
                        >{manageBusy[a.artistId]?<span style={{display:"flex",alignItems:"center",gap:4}}><IcoSpin/> Working…</span>:"Remove from Archive"}</button>
                        {manageErrors[a.artistId]&&(
                          <div style={{fontSize:".64rem",color:"#b06060",letterSpacing:".01em"}}>{manageErrors[a.artistId]}</div>
                        )}
                      </div>
                    )}
                    {a.meta.tags&&<div style={{fontSize:".64rem",color:"#6b6b90",letterSpacing:".02em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.meta.tags}</div>}
                    {a.picks.length>0&&(
                      <div style={{display:"flex",gap:".4rem"}}>
                        {a.picks.map(c=>{
                          const sm=imgSmall(c);
                          if(!sm)return null;
                          return<img key={c.id} src={sm} alt={c.name} loading="lazy" onError={e=>{e.currentTarget.style.display="none";}} style={{width:54,height:"auto",borderRadius:5,background:"#1a1a2e"}}/>;
                        })}
                      </div>
                    )}
                    {err?(
                      <div style={{fontSize:".66rem",color:"#f87171"}}>Couldn't load — open the binder to retry.</div>
                    ):isLoading?(
                      <div style={{fontSize:".66rem",color:"#6b6b90",display:"flex",alignItems:"center",gap:4}}><IcoSpin/> Loading…</div>
                    ):(
                      <div style={{height:3,background:"#1e1e35",borderRadius:2,overflow:"hidden"}}><div className="prog-fill" style={{width:`${a.pct}%`,height:"100%",borderRadius:2,background:a.pct===100?"#22c55e":(a.meta.accent||"#8b6cd8")}}/></div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

      </main>
    </div>
  );
}

// ── OWNED LIBRARY (OL-1) ─────────────────────────────────────────────────────
// Read-only visual archive of the cards confidently matched from the latest
// Collectr import snapshot, read through the OL-0D active-snapshot read model.
// Read-only throughout: never touches owned_keys recognition, manual overrides,
// intent, favorites, or binder state. See OWNED_LIBRARY_V0_SPEC_v2.md.
const OL_EMPTY_SET=new Set();

// Catalog-backed tile: interactive button, reuses the app-wide image fallback
// chain (TCGdex → pokemontcg.io → Limitless guess), quantity badge, and an
// accessible name that always includes quantity.
const OwnedLibraryCardButton=React.memo(function OwnedLibraryCardButton({card,quantity,onOpen}){
  const sm=imgSmall(card);
  const[fallback,setFallback]=useState(undefined);
  const[limitlessFailed,setLimitlessFailed]=useState(false);
  useEffect(()=>{
    if(sm||fallback!==undefined)return;
    let cancelled=false;
    fetchFallbackImage(card.id).then(r=>{if(!cancelled)setFallback(r);});
    return()=>{cancelled=true;};
  },[sm,card.id]);
  const limitlessGuess=fallback===false?buildLimitlessGuess(card):null;
  const displaySrc=sm||(fallback&&fallback.small)||(limitlessGuess&&!limitlessFailed?limitlessGuess.small:null);
  const isUnverified=!sm&&!(fallback&&fallback.small)&&!!displaySrc;
  const setName=(card.set&&card.set.name)||"";
  const number=card.localId||"";
  const label=`Open ${card.name}, ${setName||"unknown set"}, number ${number||"unknown"}, quantity ${quantity}`;
  return(
    <button type="button" className="ol-tile" aria-label={label} onClick={e=>onOpen(card,e.currentTarget)}>
      <div className="ol-frame">
        {displaySrc
          ?<img src={displaySrc} alt={card.name} loading="lazy" decoding="async" onError={isUnverified?()=>setLimitlessFailed(true):undefined}/>
          :<div className="ol-miss" aria-hidden="true">{fallback===undefined?<IcoSpin/>:<IcoNoImage/>}<span style={{fontSize:10,color:"#5a5a82",marginTop:4}}>{card.name}</span></div>}
        {quantity>1&&<span className="ol-badge" aria-hidden="true">×{quantity}</span>}
      </div>
      <div className="ol-cap">
        <div className="ol-cap-name">{card.name}</div>
        <div className="ol-cap-sub">{setName||"—"} · #{number||"—"}</div>
      </div>
    </button>
  );
});

// Dispatch tile: catalog-missing rows render as static, non-interactive content
// (article semantics, not in the tab order). Catalog-backed rows delegate to the
// interactive button above. No hooks run before this branch.
const OwnedLibraryTile=React.memo(function OwnedLibraryTile({item,onOpen}){
  const isMissing=item.catalogStatus==="missing"&&item.card===null;
  if(isMissing){
    const fb=item.fallback||{};
    const name=fb.productName||"Imported card";
    const setName=fb.setName||"Unknown set";
    const number=fb.cardNumber||"—";
    const quantity=item.quantity;
    return(
      <article className="ol-misstile" aria-label={`Catalog details unavailable. Imported match preserved: ${name}, ${setName}, number ${number}, quantity ${quantity}`} style={{display:"flex",flexDirection:"column",gap:5}}>
        <div className="ol-frame">
          <div className="ol-miss">
            <IcoNoImage/>
            <span style={{fontSize:11,fontWeight:600,color:"#c9bfe0",lineHeight:1.3,marginTop:4}}>Catalog details unavailable</span>
            <span style={{fontSize:10,color:"#8a8296",lineHeight:1.3}}>Imported match preserved.</span>
          </div>
          {quantity>1&&<span className="ol-badge" aria-hidden="true">×{quantity}</span>}
        </div>
        <div className="ol-cap">
          <div className="ol-cap-name">{name}</div>
          <div className="ol-cap-sub">{setName} · #{number}</div>
        </div>
      </article>
    );
  }
  return <OwnedLibraryCardButton card={item.card} quantity={item.quantity} onOpen={onOpen}/>;
});

function OwnedLibrary({onBack,onUploadCSV,importEpoch}){
  const PAGE=60;
  // ── controls ──
  const[searchInput,setSearchInput]=useState("");
  const[appliedSearch,setAppliedSearch]=useState("");
  const[sort,setSort]=useState("name_asc");
  const[catalogStatus,setCatalogStatus]=useState("all");
  // ── data / phase ──
  const[phase,setPhase]=useState("initial"); // initial | ready | no_active_batch | failure
  const[busy,setBusy]=useState(false);       // replacement loading after first load
  const[summary,setSummary]=useState(null);
  const[unresolved,setUnresolved]=useState(null);
  const[pageMeta,setPageMeta]=useState(null); // {limit,offset,totalItems,returnedItems}
  const[desktopItems,setDesktopItems]=useState([]);
  const[mobileItems,setMobileItems]=useState([]);
  const[page,setPage]=useState(0);           // desktop, 0-based
  const[mobileAppending,setMobileAppending]=useState(false);
  const[mobileAppendError,setMobileAppendError]=useState(false);
  const[snapshotChangedMsg,setSnapshotChangedMsg]=useState(false);
  const[manualReloadNeeded,setManualReloadNeeded]=useState(false);
  const[disclosureOpen,setDisclosureOpen]=useState(false);
  const[selected,setSelected]=useState(null);
  const[liveMsg,setLiveMsg]=useState("");
  const[req,setReq]=useState(()=>({kind:"primary",reason:"user",offset:0,search:"",sort:"name_asc",catalogStatus:"all",expected:"adopt",nonce:0}));
  // ── refs ──
  const tokenRef=useRef(0);
  const expectedBatchIdRef=useRef(null);
  const autoReloadCountRef=useRef(0);
  const firstLoadedRef=useRef(false);
  const originTileRef=useRef(null);
  const nonceRef=useRef(0);
  const searchTimerRef=useRef(null);
  const importEpochRef=useRef(importEpoch);
  // Post-import refresh coordination (OL-1.1): the reload triggered by a settled
  // import is tagged reason:"post-import" so a transient failure of THAT request
  // can be retried once (bounded) without surfacing the full failure panel.
  const postImportRetryRef=useRef(0);
  const postImportTimerRef=useRef(null);
  // Latest-value refs so a request built later (debounced search) never uses a
  // stale sort/catalog/search. Handlers set these synchronously; a backstop
  // effect keeps them in sync with state.
  const appliedSearchRef=useRef("");
  const sortRef=useRef("name_asc");
  const catalogStatusRef=useRef("all");
  // ── viewport (drives pagination mode; grid columns are CSS) ──
  const[isMobile,setIsMobile]=useState(()=>typeof window!=="undefined"&&window.matchMedia("(max-width: 767px)").matches);
  useEffect(()=>{
    if(typeof window==="undefined")return;
    const mq=window.matchMedia("(max-width: 767px)");
    const on=e=>setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener("change",on);
    return()=>mq.removeEventListener("change",on);
  },[]);

  // Backstop: keep latest-value refs aligned with state.
  useEffect(()=>{appliedSearchRef.current=appliedSearch;sortRef.current=sort;catalogStatusRef.current=catalogStatus;},[appliedSearch,sort,catalogStatus]);

  // Enter replacement loading SYNCHRONOUSLY (before the next paint) so stale
  // cards / stale counts can't flash beneath newly selected controls. Also
  // guarantees a superseded mobile append is fully torn down (never left busy).
  const enterReplacement=useCallback(()=>{
    // Invalidate any active primary/append request synchronously, BEFORE setReq,
    // so a response in flight can't write cards/errors/loading after it has been
    // superseded. The subsequent request effect increments the token again.
    tokenRef.current+=1;
    if(firstLoadedRef.current)setBusy(true);
    setMobileAppending(false);
    setMobileAppendError(false);
  },[]);

  // All primary requests read the LATEST search/sort/catalog from refs, so a
  // request queued earlier (debounced search) can't dispatch stale controls.
  const submitPrimary=useCallback((opts={})=>{
    const offset=opts.offset??0;
    const expected=opts.expected??"session";
    const reason=opts.reason??"user";
    enterReplacement();
    nonceRef.current+=1;
    const s=appliedSearchRef.current;
    setReq({kind:"primary",reason,offset,search:s&&s.length?s:"",sort:sortRef.current,catalogStatus:catalogStatusRef.current,expected,nonce:nonceRef.current});
  },[enterReplacement]);

  // Single request executor. Every request carries its own search/sort/catalog
  // so no stale closures; batch reconciliation uses a ref, never a dep.
  useEffect(()=>{
    if(!req)return;
    let cancelled=false;
    const token=++tokenRef.current;
    const isAppend=req.kind==="append";
    // Replacement loading for primary requests is entered SYNCHRONOUSLY at
    // dispatch time (see submitPrimary / snapshot_changed recovery), not here,
    // so no stale frame can paint. Append only flips its own append flag.
    if(isAppend){setMobileAppending(true);setMobileAppendError(false);}
    const expected=req.expected==="adopt"?null:expectedBatchIdRef.current;
    (async()=>{
      try{
        const res=await fetchActiveSnapshotReadModel({
          limit:PAGE,
          offset:req.offset,
          search:req.search&&req.search.length?req.search:null,
          sort:req.sort,
          catalogStatus:req.catalogStatus,
          expectedBatchId:expected,
        });
        if(cancelled||token!==tokenRef.current)return;
        if(res.state==="no_active_batch"){
          firstLoadedRef.current=true;expectedBatchIdRef.current=null;autoReloadCountRef.current=0;
          postImportRetryRef.current=0;
          setSummary(null);setUnresolved(null);setPageMeta(null);setDesktopItems([]);setMobileItems([]);
          setSnapshotChangedMsg(false);setManualReloadNeeded(false);
          setPhase("no_active_batch");
          return;
        }
        if(res.state==="snapshot_changed"){
          // Recovery reload adopts whatever is active (expected=null never itself
          // returns snapshot_changed); capped so a pathological loop can't spin.
          if(autoReloadCountRef.current>=1){
            setSnapshotChangedMsg(false);setManualReloadNeeded(true);
            setBusy(false);setMobileAppending(false);
            return;
          }
          autoReloadCountRef.current+=1;
          expectedBatchIdRef.current=null;
          setSnapshotChangedMsg(true);setManualReloadNeeded(false);
          setLiveMsg("A newer import is available. Refreshing your library.");
          setPage(0);setMobileItems([]);
          // submitPrimary → enterReplacement bumps the token synchronously, so
          // THIS request's finally (still token-valid until now) cannot clear the
          // replacement skeleton, and it enters replacement loading + adopts the
          // active batch while preserving search/sort/catalog.
          submitPrimary({offset:0,expected:"adopt"});
          return;
        }
        // ready
        expectedBatchIdRef.current=res.batch.id;
        autoReloadCountRef.current=0;
        postImportRetryRef.current=0;
        firstLoadedRef.current=true;
        setSummary(res.summary);setUnresolved(res.unresolved);setPageMeta(res.page);
        setSnapshotChangedMsg(false);setManualReloadNeeded(false);
        if(isAppend){
          setMobileItems(prev=>[...prev,...res.page.items]);
        }else{
          setDesktopItems(res.page.items);
          if(req.offset===0)setMobileItems(res.page.items);
        }
        setPhase("ready");
      }catch(err){
        if(cancelled||token!==tokenRef.current)return;
        console.error("[OwnedLibrary] load failed",err);
        if(isAppend){setMobileAppendError(true);setLiveMsg("Couldn't load more cards.");return;}
        // OL-1.2 diagnostics (POST-IMPORT PATH ONLY): the single 400ms retry does
        // not always cover the post-import read window, yet the cause could not be
        // proven statically (the retry state machine is correct — see the comment
        // below — and importEpoch only bumps AFTER createImportSnapshot resolves
        // "active", so the read runs against a committed active batch). Emit one
        // structured record per failed post-import attempt so the next deployed
        // reproduction reveals the real RPC error. Console-only; never shown to
        // users; does not alter control flow, retries, or failure surfacing.
        if(req.reason==="post-import"){
          const attempt=postImportRetryRef.current+1; // 1 = initial post-import read, 2 = bounded retry
          console.error("[OwnedLibrary][post-import] refresh read failed",{
            attempt,
            isBoundedRetry:postImportRetryRef.current>=1,
            expectedMode:req.expected,                 // "adopt" for the post-import refresh
            expectedBatchId:expected,                  // null when adopting the active batch
            search:req.search||"",
            sort:req.sort,
            catalogStatus:req.catalogStatus,
            rpcCode:(err&&err.rpcCode!==undefined)?err.rpcCode:null,
            rpcMessage:(err&&(err.rpcMessage||err.message))||String(err),
            rpcDetails:(err&&err.rpcDetails!==undefined)?err.rpcDetails:null,
            rpcHint:(err&&err.rpcHint!==undefined)?err.rpcHint:null,
          });
        }
        // POST-IMPORT REFRESH ONLY: the read can transiently throw in the brief
        // window right after a fresh snapshot is activated (DB contention/read
        // visibility immediately following the large import write). Retry ONCE
        // after a short bounded delay, keeping replacement skeletons up and NOT
        // surfacing the failure panel or discarding the existing library. A
        // normal user-initiated failure (reason "user") still shows failure
        // immediately, and a second post-import failure falls through to it.
        if(req.reason==="post-import"&&postImportRetryRef.current<1){
          postImportRetryRef.current+=1;
          tokenRef.current+=1;                       // invalidate self so finally can't clear busy
          if(firstLoadedRef.current)setBusy(true);   // hold skeletons through the delay
          setLiveMsg("Refreshing your library.");
          if(postImportTimerRef.current)clearTimeout(postImportTimerRef.current);
          postImportTimerRef.current=setTimeout(()=>{
            postImportTimerRef.current=null;
            submitPrimary({offset:0,expected:"adopt",reason:"post-import"});
          },400);
          return;
        }
        setPhase("failure");setLiveMsg("We couldn't load your owned library.");
        postImportRetryRef.current=0;
      }finally{
        if(!cancelled&&token===tokenRef.current){setBusy(false);setMobileAppending(false);}
      }
    })();
    return()=>{cancelled=true;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[req]);

  // Announce loaded ranges/counts politely once a ready page settles.
  useEffect(()=>{
    if(phase!=="ready"||!pageMeta)return;
    if(isMobile){
      setLiveMsg(`Showing ${mobileItems.length} of ${pageMeta.totalItems} cards`);
    }else{
      const start=pageMeta.totalItems===0?0:page*PAGE+1;
      const end=page*PAGE+desktopItems.length;
      setLiveMsg(`Showing ${start}\u2013${end} of ${pageMeta.totalItems} cards`);
    }
  },[phase,pageMeta,page,desktopItems.length,mobileItems.length,isMobile]);

  // Reload after a CSV-import attempt settles (importEpoch bumped by App). Adopts
  // whichever snapshot is active afterward; preserves search/sort/catalog.
  useEffect(()=>{
    if(importEpochRef.current===importEpoch)return; // skip mount
    importEpochRef.current=importEpoch;
    expectedBatchIdRef.current=null;autoReloadCountRef.current=0;
    postImportRetryRef.current=0;
    if(postImportTimerRef.current){clearTimeout(postImportTimerRef.current);postImportTimerRef.current=null;}
    setPage(0);setMobileItems([]);
    submitPrimary({offset:0,expected:"adopt",reason:"post-import"});
  },[importEpoch,submitPrimary]);

  // Clear any pending debounce / post-import retry timers on unmount.
  useEffect(()=>()=>{
    if(searchTimerRef.current)clearTimeout(searchTimerRef.current);
    if(postImportTimerRef.current)clearTimeout(postImportTimerRef.current);
  },[]);

  // ── control handlers ── (each updates state AND its latest-value ref
  // synchronously, then submits a primary request that reads from the refs)
  const onSearchChange=v=>{
    setSearchInput(v);
    if(searchTimerRef.current)clearTimeout(searchTimerRef.current);
    searchTimerRef.current=setTimeout(()=>{
      const t=v.trim();
      setAppliedSearch(t);appliedSearchRef.current=t;
      setPage(0);setMobileItems([]);
      submitPrimary({offset:0,expected:"session"}); // uses latest sort/catalog via refs
    },300);
  };
  const onSearchEnter=()=>{
    if(searchTimerRef.current)clearTimeout(searchTimerRef.current);
    const t=searchInput.trim();
    setAppliedSearch(t);appliedSearchRef.current=t;
    setPage(0);setMobileItems([]);
    submitPrimary({offset:0,expected:"session"});
  };
  const onSearchClear=()=>{
    if(searchTimerRef.current)clearTimeout(searchTimerRef.current);
    setSearchInput("");setAppliedSearch("");appliedSearchRef.current="";
    setPage(0);setMobileItems([]);
    submitPrimary({offset:0,expected:"session"});
  };
  const onSortChange=v=>{setSort(v);sortRef.current=v;setPage(0);setMobileItems([]);submitPrimary({offset:0,expected:"session"});};
  const onCatalogChange=v=>{setCatalogStatus(v);catalogStatusRef.current=v;setPage(0);setMobileItems([]);submitPrimary({offset:0,expected:"session"});};
  const resetView=()=>{
    if(searchTimerRef.current)clearTimeout(searchTimerRef.current);
    setSearchInput("");setAppliedSearch("");appliedSearchRef.current="";
    setSort("name_asc");sortRef.current="name_asc";
    setCatalogStatus("all");catalogStatusRef.current="all";
    setPage(0);setMobileItems([]);
    submitPrimary({offset:0,expected:"session"});
  };
  const goToPage=n=>{setPage(n);submitPrimary({offset:n*PAGE,expected:"session"});};
  const loadMore=()=>{
    setMobileAppendError(false);
    nonceRef.current+=1;
    setReq({kind:"append",offset:mobileItems.length,search:appliedSearchRef.current&&appliedSearchRef.current.length?appliedSearchRef.current:"",sort:sortRef.current,catalogStatus:catalogStatusRef.current,expected:"session",nonce:nonceRef.current});
  };
  const retryInitial=()=>{setPhase("initial");firstLoadedRef.current=false;setPage(0);setMobileItems([]);submitPrimary({offset:0,expected:"adopt"});};
  const reloadManual=()=>{setManualReloadNeeded(false);autoReloadCountRef.current=0;setPage(0);setMobileItems([]);submitPrimary({offset:0,expected:"adopt"});};

  const openCard=useCallback((card,el)=>{originTileRef.current=el||null;setSelected(card);},[]);
  const closeCard=useCallback(()=>{
    setSelected(null);
    const el=originTileRef.current;originTileRef.current=null;
    if(el&&typeof el.focus==="function")requestAnimationFrame(()=>{try{el.focus();}catch(_){/*tile unmounted*/}});
  },[]);

  // ── derived ──
  const total=pageMeta?pageMeta.totalItems:0;
  const pageCount=Math.max(1,Math.ceil(total/PAGE));
  const items=isMobile?mobileItems:desktopItems;
  const filterActive=(appliedSearch.trim()!=="")||catalogStatus!=="all";
  const emptyResult=phase==="ready"&&total===0&&!busy;
  const showSkeleton=phase==="initial"||(phase==="ready"&&busy);
  const skelCount=isMobile?9:12;
  const controlsDisabled=busy||phase==="initial";
  const selSt={background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,color:"#e8e8f4",padding:".5rem .6rem",fontSize:".78rem",minHeight:44};

  const header=(
    <div className="ol-header">
      <button onClick={onBack} className="btn-ghost ol-header-btn" aria-label="Back to Dashboard" style={{borderRadius:8,padding:".45rem .7rem",fontSize:".72rem",fontWeight:600,minHeight:44,display:"flex",alignItems:"center",gap:".3rem"}}><span aria-hidden="true">←</span><span className="ol-hlabel">Dashboard</span></button>
      <span className="font-display ol-header-title" style={{fontWeight:600,fontSize:"1.15rem",color:"#f4f0ea",letterSpacing:"-.01em"}}>Owned Library</span>
      <button onClick={onUploadCSV} className="btn-ghost ol-header-btn" aria-label="Import new CSV" style={{borderRadius:8,padding:".45rem .7rem",fontSize:".72rem",fontWeight:600,color:"#8b6cd8",minHeight:44,display:"flex",alignItems:"center",gap:".35rem"}}><IcoUpload/><span className="ol-hlabel">Import new CSV</span></button>
    </div>
  );

  const wrap=children=>(
    <div style={{minHeight:"100dvh",background:"#07070f"}}>
      <div style={{maxWidth:1120,margin:"0 auto",padding:"0 1rem 3rem"}}>
        {header}
        <div className="ol-sr" aria-live="polite" role="status">{liveMsg}</div>
        {children}
      </div>
      {selected&&<CardModal card={selected} owned={true} manualOwned={OL_EMPTY_SET} manualMissing={OL_EMPTY_SET} isFavorite={false} priceHistory={{}} onToggleManual={()=>{}} onToggleFavorite={()=>{}} onRecordPrice={()=>{}} onClose={closeCard} readOnly/>}
    </div>
  );

  if(phase==="failure"){
    return wrap(
      <div style={{textAlign:"center",padding:"3rem 1rem",border:"1px solid #1e1e35",borderRadius:14,background:"#0d0d1a"}}>
        <div style={{fontSize:".95rem",fontWeight:600,color:"#e8e8f4",marginBottom:".4rem"}}>We couldn't load your owned library.</div>
        <div style={{fontSize:".8rem",color:"#8a8296",marginBottom:"1.1rem"}}>Your imported collection hasn't been changed.</div>
        <div style={{display:"flex",gap:".6rem",justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={retryInitial} className="btn-flame" style={{borderRadius:10,padding:".55rem 1.1rem",fontSize:".8rem",fontWeight:700,minHeight:44}}>Try again</button>
          <button onClick={onBack} className="btn-ghost" style={{borderRadius:10,padding:".55rem 1.1rem",fontSize:".8rem",fontWeight:600,minHeight:44}}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if(phase==="no_active_batch"){
    return wrap(
      <div style={{textAlign:"center",padding:"3rem 1rem",border:"1px solid #1e1e35",borderRadius:14,background:"#0d0d1a"}}>
        <div style={{fontSize:".95rem",fontWeight:600,color:"#e8e8f4",marginBottom:".4rem"}}>Your owned library starts with a Collectr CSV.</div>
        <div style={{fontSize:".8rem",color:"#8a8296",marginBottom:"1.1rem",lineHeight:1.5,maxWidth:420,marginLeft:"auto",marginRight:"auto"}}>Import a current Collectr export to build a detailed snapshot of your physical collection.</div>
        <div style={{display:"flex",gap:".6rem",justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={onUploadCSV} className="btn-flame" style={{borderRadius:10,padding:".55rem 1.1rem",fontSize:".8rem",fontWeight:700,minHeight:44}}>Import CSV</button>
          <button onClick={onBack} className="btn-ghost" style={{borderRadius:10,padding:".55rem 1.1rem",fontSize:".8rem",fontWeight:600,minHeight:44}}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  // initial | ready (with optional replacement busy)
  return wrap(
    <>
      <p className="ol-intro" style={{fontSize:".82rem",color:"#8a8296",lineHeight:1.5}}>A visual archive of the cards confidently matched from your latest Collectr import.</p>

      {summary&&(
        <div className="ol-counts" style={{display:"flex",alignItems:"baseline",gap:"1.4rem",flexWrap:"wrap"}}>
          <span><span style={{fontSize:"1.4rem",fontWeight:600,color:"#f4f0ea"}}>{summary.distinctCanonicalCards.toLocaleString()}</span> <span style={{fontSize:".76rem",color:"#8a8296"}}>distinct cards</span></span>
          <span><span style={{fontSize:"1.4rem",fontWeight:600,color:"#e8944a"}}>{summary.matchedQuantity.toLocaleString()}</span> <span style={{fontSize:".76rem",color:"#8a8296"}}>total copies</span></span>
        </div>
      )}

      {summary&&summary.unresolvedRows>0&&(
        <div className="ol-disc" style={{background:"#12101c",border:"1px solid #26203a",borderRadius:10,overflow:"hidden"}}>
          <button onClick={()=>setDisclosureOpen(o=>!o)} aria-expanded={disclosureOpen} aria-controls="ol-unresolved-detail" style={{width:"100%",textAlign:"left",background:"none",border:"none",cursor:"pointer",color:"#c9bfe0",padding:".7rem .85rem",fontSize:".76rem",lineHeight:1.5,minHeight:44,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:".6rem"}}>
            <span>{summary.unresolvedRows.toLocaleString()} imported rows couldn't be matched confidently and aren't included below. They remain preserved with your import.</span>
            <span aria-hidden="true" style={{color:"#9f8fd8",flexShrink:0}}>{disclosureOpen?"▲":"▼"}</span>
          </button>
          {disclosureOpen&&(
            <div id="ol-unresolved-detail" style={{padding:"0 .85rem .8rem",fontSize:".72rem",color:"#a79ec0",lineHeight:1.7}}>
              <div>{summary.ambiguousRows.toLocaleString()} ambiguous</div>
              <div>{summary.unmatchedRows.toLocaleString()} unmatched</div>
              <div>{summary.invalidRows.toLocaleString()} invalid</div>
              <div style={{marginTop:".3rem",color:"#8a8296"}}>These rows represent {summary.unresolvedQuantity.toLocaleString()} imported copies.</div>
            </div>
          )}
        </div>
      )}

      {/* controls */}
      <div className="ol-controls">
        <div className="ol-search" style={{display:"flex",alignItems:"center",gap:".5rem",background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,padding:"0 .6rem",minHeight:44}}>
          <span aria-hidden="true" style={{color:"#6f6880",display:"flex"}}><IcoSearch/></span>
          {/* OL-1.2 fix #1: the search input (and its clear button) must NEVER be
              disabled during replacement loading. A disabled form control is blurred
              by the browser, which is what dropped focus after every keystroke on
              mobile. Only the result region enters aria-busy / skeletons; typing stays
              live and safe because each submit supersedes in-flight requests via the
              existing token logic. Sort / catalog / pagination remain gated below. */}
          <input
            type="search"
            value={searchInput}
            onChange={e=>onSearchChange(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")onSearchEnter();}}
            placeholder="Search by card, set, number, or illustrator…"
            aria-label="Search your owned library"
            style={{flex:1,minWidth:0,background:"none",border:"none",color:"#e8e8f4",fontSize:".8rem",padding:".5rem 0",minHeight:44,outline:"none"}}
          />
          {searchInput&&<button onClick={onSearchClear} aria-label="Clear search" style={{background:"none",border:"none",color:"#6f6880",cursor:"pointer",opacity:1,fontSize:"1rem",padding:"0 .2rem",minWidth:44,minHeight:44,flexShrink:0}}>×</button>}
        </div>
        <div className="ol-selects">
          <label className="ol-field">
            <span>Sort</span>
            <select value={sort} disabled={controlsDisabled} onChange={e=>onSortChange(e.target.value)} aria-label="Sort owned library" style={selSt}>
              <option value="name_asc">Name A–Z</option>
              <option value="set_asc">Set A–Z</option>
              <option value="quantity_desc">Quantity: high to low</option>
            </select>
          </label>
          <label className="ol-field">
            <span>Catalog</span>
            <select value={catalogStatus} disabled={controlsDisabled} onChange={e=>onCatalogChange(e.target.value)} aria-label="Filter by catalog status" style={selSt}>
              <option value="all">All cards</option>
              <option value="available">Catalog details available</option>
              <option value="missing">Catalog details unavailable</option>
            </select>
          </label>
        </div>
      </div>

      {phase==="ready"&&filterActive&&!busy&&(
        <div className="ol-rescount" style={{fontSize:".72rem",color:"#8a8296"}}>{total.toLocaleString()} matching cards</div>
      )}
      {!(phase==="ready"&&filterActive&&!busy)&&<div style={{height:".35rem"}}/>}

      {snapshotChangedMsg&&(
        <div style={{margin:"0 0 .85rem",background:"#161020",border:"1px solid #33264a",borderRadius:9,padding:".6rem .85rem",fontSize:".74rem",color:"#c9bfe0"}}>A newer import is available. Refreshing your library…</div>
      )}
      {manualReloadNeeded&&(
        <div style={{margin:"0 0 .85rem",background:"#161020",border:"1px solid #33264a",borderRadius:9,padding:".6rem .85rem",fontSize:".74rem",color:"#c9bfe0",display:"flex",alignItems:"center",justifyContent:"space-between",gap:".6rem",flexWrap:"wrap"}}>
          <span>Your library couldn't refresh automatically.</span>
          <button onClick={reloadManual} className="btn-ghost" style={{borderRadius:8,padding:".35rem .7rem",fontSize:".72rem",fontWeight:600,minHeight:44}}>Reload</button>
        </div>
      )}

      {/* grid / skeleton / empty */}
      <div aria-busy={showSkeleton?"true":"false"}>
        {showSkeleton?(
          <div className="ol-grid" aria-hidden="true">
            {Array.from({length:skelCount}).map((_,i)=><div key={i} className="ol-skel"/>)}
          </div>
        ):emptyResult?(
          <div style={{textAlign:"center",padding:"2.5rem 1rem",border:"1px dashed #26203a",borderRadius:12,color:"#8a8296"}}>
            <div style={{fontSize:".9rem",fontWeight:600,color:"#e8e8f4",marginBottom:".3rem"}}>No cards match this view.</div>
            <div style={{fontSize:".78rem",marginBottom:"1rem"}}>Try a different search or reset the filters.</div>
            <button onClick={resetView} className="btn-ghost" style={{borderRadius:10,padding:".5rem 1rem",fontSize:".78rem",fontWeight:600,color:"#8b6cd8",minHeight:44}}>Reset view</button>
          </div>
        ):(
          <div className="ol-grid">
            {items.map(it=><OwnedLibraryTile key={it.cardId} item={it} onOpen={openCard}/>)}
          </div>
        )}
      </div>

      {/* pagination */}
      {phase==="ready"&&!emptyResult&&!showSkeleton&&(
        isMobile?(
          <div style={{textAlign:"center",padding:"1rem 0 0"}}>
            {mobileItems.length<total&&(
              <button onClick={loadMore} disabled={mobileAppending} className="btn-ghost" style={{width:"100%",borderRadius:10,padding:".7rem",fontSize:".8rem",fontWeight:600,color:"#cdc6da",minHeight:44,opacity:mobileAppending?.6:1}}>
                {mobileAppending?"Loading…":((total-mobileItems.length)>=PAGE?"Load 60 more":`Load remaining ${total-mobileItems.length}`)}
              </button>
            )}
            {mobileAppendError&&(
              <div style={{marginTop:".6rem",fontSize:".74rem",color:"#e0a0a0"}}>Couldn't load more cards. <button onClick={loadMore} style={{background:"none",border:"none",color:"#9f8fd8",cursor:"pointer",fontWeight:600,padding:0,minHeight:44}}>Try again</button></div>
            )}
            <div style={{marginTop:".6rem",fontSize:".7rem",color:"#6f6880"}}>Showing {mobileItems.length.toLocaleString()} of {total.toLocaleString()}</div>
          </div>
        ):(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:".75rem",padding:"1rem 0 0",marginTop:".5rem",borderTop:"1px solid #16162a",flexWrap:"wrap"}}>
            <span style={{fontSize:".72rem",color:"#7d7689"}}>Showing {(total===0?0:page*PAGE+1).toLocaleString()}–{(page*PAGE+desktopItems.length).toLocaleString()} of {total.toLocaleString()} cards</span>
            <div style={{display:"flex",alignItems:"center",gap:".6rem"}}>
              <button onClick={()=>goToPage(page-1)} disabled={page===0||busy} className="ol-pgbtn btn-ghost" style={{borderRadius:8,fontSize:".74rem",opacity:(page===0||busy)?.5:1}}>‹ Previous</button>
              <span style={{fontSize:".72rem",color:"#a79ec0"}}>Page {page+1} of {pageCount}</span>
              <button onClick={()=>goToPage(page+1)} disabled={page>=pageCount-1||busy} className="ol-pgbtn btn-ghost" style={{borderRadius:8,fontSize:".74rem",opacity:(page>=pageCount-1||busy)?.5:1}}>Next ›</button>
            </div>
          </div>
        )
      )}
    </>
  );
}

function App(){
  const[view,          setView]         =useState("checking-auth");
  const[artistSlug,    setArtistSlug]   =useState(null);
  const[user,          setUser]         =useState(null);
  const[cardData,      setCardData]     =useState({});
  const[loadingSet,    setLoadingSet]   =useState(new Set());
  const[errors,        setErrors]       =useState({});
  const[ownedKeySet,   setOwnedKeySet]  =useState(new Set());
  const[manualOwned,   setManualOwned]  =useState(new Set());
  const[manualMissing, setManualMissing]=useState(new Set());
  const[favorites,     setFavorites]    =useState(new Set());
  const[priceHistory,  setPriceHistory] =useState({});
  const[selectedCard,  setSelectedCard] =useState(null);
  const[search,        setSearch]       =useState("");
  const[filterSlug,    setFilterSlug]   =useState("all");
  const[sortBy,        setSortBy]       =useState("name");
  const[viewMode,      setViewMode]     =useState(null);
  const[showSettings,  setShowSettings] =useState(false);
  const[hideTcgPocket, setHideTcgPocket]=useState(()=>{const v=lsGet("pb_hide_tcgp");return v===null?true:v;});
  const[showAllColor, setShowAllColor] =useState(()=>{const v=lsGet("pb_show_all_color");return v===null?false:v;});
  const[csvStatus,     setCsvStatus]    =useState(null);
  const[syncStatus,    setSyncStatus]   =useState("idle");
  const[importEpoch,   setImportEpoch]  =useState(0);   // OL-1: bumps once per settled CSV-import attempt so a mounted Owned Library can reload against the now-active snapshot
  const[dynamicArtists,setDynamicArtists]=useState([]); // A-D2b0: user-tracked artists beyond the curated roster
  const[dynRefresh,    setDynRefresh]    =useState(0);  // A-D2c: bump to re-run the tracked-artist fetch after Add to Archive
  // V-C.3: lifted from Dashboard so the featured hero card and Vault Queue
  // page survive navigating to another view and back. Plain useState at the
  // App level only — no persistence — so a full browser refresh still resets
  // both to their defaults.
  const[heroPick,      setHeroPick]      =useState(null);
  const[queuePage,     setQueuePage]     =useState(0);
  const[planId,        setPlanId]        =useState(null); // BP-0A2: current planned binder (uuid); detail page self-fetches
  const fileRef=useRef(null),searchRef=useRef(null);
  // NAV-1A: the surface the URL asked for at first paint. Read once, at mount,
  // before any auth/data work; consumed once by the first successful load. Every
  // later loadData call (e.g. a fresh sign-in) falls back to "dashboard" exactly
  // as before.
  const pendingSurfaceRef=useRef(navReadSurface());

  const withSync=async fn=>{setSyncStatus("syncing");try{await fn();setSyncStatus("synced");setTimeout(()=>setSyncStatus("idle"),2000);}catch(e){console.error(e);setSyncStatus("error");setTimeout(()=>setSyncStatus("idle"),3000);}};

  const loadData=useCallback(async uid=>{
    setView("loading-data");
    try{
      const{ownedKeys,manualOwned:mo,manualMissing:mm,priceHistory:ph,favorites:fav}=await loadUserData(uid);
      setOwnedKeySet(ownedKeys);setManualOwned(mo);setManualMissing(mm);setPriceHistory(ph);setFavorites(fav);
    }catch(e){console.error("Load error:",e);}
    // NAV-1A: restore the URL-requested surface instead of hardcoding Dashboard.
    const restore=pendingSurfaceRef.current;
    pendingSurfaceRef.current=null;
    setView(restore&&NAV_SURFACES.has(restore)?restore:"dashboard");
  },[]);

  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{if(session?.user){setUser(session.user);loadData(session.user.id);}else setView("landing");});
    const{data:{subscription}}=supabase.auth.onAuthStateChange(async(event,session)=>{
      if((event==="SIGNED_IN"||event==="TOKEN_REFRESHED")&&session?.user){setUser(session.user);if(view==="landing"||view==="checking-auth")loadData(session.user.id);}
      else if(event==="SIGNED_OUT"){setUser(null);setOwnedKeySet(new Set());setManualOwned(new Set());setManualMissing(new Set());setFavorites(new Set());setPriceHistory({});setView("landing");}
    });
    return()=>subscription.unsubscribe();
  },[]);

  // ── NAV-1A: write side — surface → URL ───────────────────────────────────────
  // Whenever `view` settles on an addressable surface, push it into the URL.
  // Transient views (checking-auth / loading-data), "landing", and the
  // identifier-bearing views ("artist" / "plan") are never written: they inherit
  // whatever addressable URL they were opened from, so a refresh on an Artist
  // page returns to the surface it was reached from rather than 404-ing on an
  // un-restorable slug. navBuildUrl returns null when the URL already matches,
  // so restoring from ?v= on first load does NOT push a duplicate entry.
  useEffect(()=>{
    if(!NAV_SURFACES.has(view)||navHasShare())return;
    const url=navBuildUrl(view);
    if(url)window.history.pushState({[NAV_PARAM]:view},"",url);
  },[view]);

  // ── NAV-1A: read side — URL → surface (Back / Forward) ───────────────────────
  // Back/Forward walks the entries pushed above, so mirror the URL back into
  // `view`. Any open CardModal is dismissed, since a Back press that swaps the
  // surface underneath it would otherwise leave the modal floating over the
  // wrong screen. Modal state itself stays session-only and is deliberately NOT
  // in the URL. Auth-gated views (landing / checking-auth / loading-data) are
  // left alone — a signed-out user is never navigated into the app by a URL.
  useEffect(()=>{
    const onPop=()=>{
      if(navHasShare())return;
      setSelectedCard(null);
      setView(v=>(v==="landing"||v==="checking-auth"||v==="loading-data")?v:navReadSurface());
    };
    window.addEventListener("popstate",onPop);
    return()=>window.removeEventListener("popstate",onPop);
  },[]);

  // ── A-D2b0: dynamic tracked artists ──────────────────────────────────────────
  // Fetch the user's tracked roster and resolve only ids NOT already in the
  // curated ARTISTS constant. Every path soft-fails to []: missing tables,
  // RLS blocks, or network failures leave the app rendering curated-only.
  // ARTISTS remains the unconditional safety floor.
  useEffect(()=>{
    if(!user){setDynamicArtists([]);return;}
    let cancelled=false;
    (async()=>{
      try{
        // A-D2d: fetch per-user tier alongside tracked ids. New helper, not a
        // change to fetchTrackedArtistIds — that function is left untouched
        // and still exported for any other/future caller.
        const trackedTiers=await fetchTrackedArtistTiers(user.id);
        const trackedIds=new Set(trackedTiers.keys());
        // Curated ids: FK slugs where present, plus display-name slugs as a
        // defensive second key so a curated entry lacking artistId can never
        // be duplicated as a dynamic addition.
        const curatedIds=new Set();
        ARTISTS.forEach(a=>{if(a.artistId)curatedIds.add(a.artistId);curatedIds.add(toSlug(a.name));});
        const newIds=[...trackedIds].filter(id=>!curatedIds.has(id));
        if(!newIds.length){if(!cancelled)setDynamicArtists([]);return;}
        const identities=await fetchArtistIdentities(newIds);
        if(cancelled)return;
        setDynamicArtists(identities.map(r=>({
          name:(r.aliases&&r.aliases[0])||r.id, // display name: aliases[0] or id fallback
          tier:trackedTiers.get(r.id)||"added", // A-D2d: real per-user tier; "added" default/fallback
          isDynamic:true,
          artistId:r.id,
          aliases:r.aliases||[],
        })));
      }catch(e){
        console.warn("[App] dynamic artist load soft-fail:",(e&&e.message)||e);
        if(!cancelled)setDynamicArtists([]);
      }
    })();
    return()=>{cancelled=true;};
  },[user&&user.id,dynRefresh]); // A-D2c: dynRefresh re-runs this after Add to Archive

  // Curated ARTISTS in existing order + dynamic tracked artists appended.
  const effectiveRoster=useMemo(()=>[...ARTISTS,...dynamicArtists],[dynamicArtists]);
  // A-D2c: full refetch (rather than optimistic append) is deliberate — it
  // avoids stale state and duplicate roster entries; the incremental
  // dynamic-card effect + pb8 cache make the re-run cheap.
  const handleArtistAdded=useCallback(()=>setDynRefresh(n=>n+1),[]);
  // A-D2d: tier change / remove for dynamic (user-added) artists only.
  // Curated ARTISTS entries are never rows in user_tracked_artists, so these
  // handlers are inherently scoped to dynamic additions — there is no path
  // by which a curated artist's artistId could reach either function.
  // Same full-refetch-on-success pattern as handleArtistAdded: avoids
  // optimistic-state drift, and the pb8 cache keeps the re-run cheap.
  const handleChangeArtistTier=useCallback(async(artistId,tier)=>{
    if(!user)return{ok:false,error:"Not signed in."};
    const res=await updateArtistTier(user.id,artistId,tier);
    if(res.ok)setDynRefresh(n=>n+1);
    return res;
  },[user]);
  const handleRemoveArtist=useCallback(async artistId=>{
    if(!user)return{ok:false,error:"Not signed in."};
    const res=await removeArtistFromArchive(user.id,artistId);
    if(res.ok)setDynRefresh(n=>n+1);
    return res;
  },[user]);

  const handleSendLink=async email=>{const{error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:true}});if(error)throw error;};
  const handleVerifyCode=async(email,token)=>{const{error}=await supabase.auth.verifyOtp({email,token,type:"email"});if(error)throw error;};
  const handleSignOut=()=>supabase.auth.signOut();

  const loadEntry=useCallback(async entry=>{
    const slug=toSlug(entry.name);
    setLoadingSet(s=>new Set([...s,slug]));setErrors(e=>{const n={...e};delete n[slug];return n;});
    try{const cards=await fetchArtistCards(entry);setCardData(d=>({...d,[slug]:cards}));}
    catch(err){setErrors(e=>({...e,[slug]:err.message}));}
    finally{setLoadingSet(s=>{const n=new Set(s);n.delete(slug);return n;});}
  },[]);
  // Load artists in small concurrent groups rather than firing all 21 (and their
  // batched per-card fetches) at once — a full burst can spike to 150-200+
  // simultaneous Supabase queries and risks connection pool pressure.
  const ARTIST_CONCURRENCY=4;
  // A-D2b0: iterates effectiveRoster so full reloads (e.g. Clear card cache)
  // cover dynamic additions too. The mount effect below intentionally keeps
  // its [] deps: it captures the initial (curated-only) roster, so first load
  // is byte-identical to pre-B0 behavior. Dynamic entries arriving later are
  // loaded incrementally by the effect after it — never by re-running the
  // full loop mid-flight.
  const loadAllEntries=useCallback(async()=>{
    for(let i=0;i<effectiveRoster.length;i+=ARTIST_CONCURRENCY){
      const chunk=effectiveRoster.slice(i,i+ARTIST_CONCURRENCY);
      await Promise.all(chunk.map(loadEntry));
    }
  },[loadEntry,effectiveRoster]);
  useEffect(()=>{loadAllEntries();},[]);
  // A-D2b0: incremental card load for dynamic artists once they resolve.
  // loadEntry + the pb8 cache dedupe repeat fetches; empty roster is a no-op.
  useEffect(()=>{
    if(!dynamicArtists.length)return;
    let cancelled=false;
    (async()=>{
      for(let i=0;i<dynamicArtists.length;i+=ARTIST_CONCURRENCY){
        if(cancelled)return;
        await Promise.all(dynamicArtists.slice(i,i+ARTIST_CONCURRENCY).map(loadEntry));
      }
    })();
    return()=>{cancelled=true;};
  },[dynamicArtists,loadEntry]);

  // OL-0C: secondary import-snapshot path. Separate from owned_keys recognition;
  // a failure here leaves ownership recognition and the previous active snapshot
  // untouched. Does not read or write owned_keys / manual overrides.
  const buildImportSnapshot=useCallback(async(data,uid)=>{
    try{
      const{index}=await loadCatalogIndex();
      const classified=classifyCollectrRows(data,index);
      const result=await createImportSnapshot({userId:uid,matcherVersion:MATCHER_VERSION,classified});
      if(result.status==="active"){
        console.info("[OL-0C] import snapshot active",result.counts);
      }else{
        console.error("[OL-0C] import snapshot failed",result);
        alert("Your collection was updated. The detailed import snapshot couldn't be saved this time — re-import to retry. Ownership recognition is unaffected.");
      }
    }catch(e){
      console.error("[OL-0C] import snapshot error",e);
      alert("Your collection was updated. The detailed import snapshot couldn't be built this time — re-import to retry. Ownership recognition is unaffected.");
    }
  },[]);

  // OL-0C correction: dedicated CSV-import persistence sequencing.
  // Narrowly scoped to the CSV-import path only — does not change withSync or
  // any other caller of saveCollection/saveOverride. Awaits the owned_keys
  // write and explicitly inspects response.error (Supabase query errors do
  // not throw). The snapshot is built ONLY after owned_keys is confirmed
  // persisted. If owned_keys fails, no snapshot is created, the in-memory
  // ownedKeySet update is left as-is (not rolled back), and the user is shown
  // an explicit alert so the green CSV-count display can't be mistaken for a
  // saved import. If owned_keys succeeds but the snapshot fails,
  // buildImportSnapshot still surfaces its own accurate partial-success warning.
  const persistCsvImport=useCallback(async(uid,data,keys)=>{
    setSyncStatus("syncing");
    const warnNotSaved=()=>alert("Your CSV was read, but the collection could not be saved to your account. The cards may appear until you refresh, but this import was not persisted. Please try importing again.");
    try{
      let res;
      try{
        res=await saveCollection(uid,keys);
      }catch(e){
        console.error("[CSV import] saveCollection threw",e);
        setSyncStatus("error");setTimeout(()=>setSyncStatus("idle"),3000);
        warnNotSaved();
        return; // owned_keys write not confirmed — do not build a snapshot
      }
      if(res&&res.error){
        console.error("[CSV import] saveCollection returned an error",res.error);
        setSyncStatus("error");setTimeout(()=>setSyncStatus("idle"),3000);
        warnNotSaved();
        return; // owned_keys write not confirmed — do not build a snapshot
      }
      setSyncStatus("synced");setTimeout(()=>setSyncStatus("idle"),2000);
      // owned_keys write confirmed successful — now safe to build the secondary snapshot
      await buildImportSnapshot(data,uid);
    }finally{
      // OL-1: signal that a CSV-import attempt has SETTLED — whether snapshot
      // creation succeeded or the secondary snapshot failed (early returns above
      // run this too). A mounted Owned Library reloads page one against whichever
      // snapshot is active after the attempt. This does not alter importer
      // sequencing, owned_keys handling, warnings, partial-success messaging, or
      // snapshot lifecycle — it only advances a reload signal.
      setImportEpoch(e=>e+1);
    }
  },[buildImportSnapshot]);

  const handleCSV=useCallback(file=>{
    setCsvStatus("loading");
    Papa.parse(file,{header:true,skipEmptyLines:true,complete:async({data})=>{
      // ── PRIMARY: owned_keys recognition (unchanged — do not modify) ─────────
      const pokemon=data.filter(r=>(r["Category"]||"").trim()==="Pokemon");
      const keys=new Set();pokemon.forEach(r=>makeKeys(r["Product Name"]||"",r["Card Number"]||"",r["Set"]||"").forEach(k=>keys.add(k)));
      setOwnedKeySet(keys);setCsvStatus({count:pokemon.length});setTimeout(()=>setCsvStatus(null),5000);
      // ── SECONDARY (OL-0C), strictly sequenced after PRIMARY: owned_keys is
      // persisted and its response.error is confirmed clean before any snapshot
      // is attempted. Non-atomic — a snapshot failure never rolls back
      // owned_keys, and an owned_keys failure never creates a snapshot.
      if(user)await persistCsvImport(user.id,data,keys);
    },error:()=>{setCsvStatus(null);alert("Could not read CSV.");}});
  },[user,persistCsvImport]);

  const handleToggleManual=useCallback((cardId,action)=>{
    let fa=action;
    setManualOwned(prev=>{const n=new Set(prev);if(action==="owned"){n.has(cardId)?n.delete(cardId):n.add(cardId);fa=n.has(cardId)?"owned":"reset";}else if(action==="reset")n.delete(cardId);return n;});
    setManualMissing(prev=>{const n=new Set(prev);if(action==="missing"){n.has(cardId)?n.delete(cardId):n.add(cardId);fa=n.has(cardId)?"missing":"reset";}else if(action==="reset")n.delete(cardId);return n;});
    if(user)withSync(()=>saveOverride(user.id,cardId,fa));
  },[user]);

  const handleToggleFavorite=useCallback(cardId=>{
    setFavorites(prev=>{
      const n=new Set(prev);const wasFav=n.has(cardId);
      wasFav?n.delete(cardId):n.add(cardId);
      if(user){wasFav?supabase.from("card_favorites").delete().eq("user_id",user.id).eq("card_id",cardId).then():supabase.from("card_favorites").insert({user_id:user.id,card_id:cardId}).then();}
      return n;
    });
  },[user]);

  const handleRecordPrice=useCallback((cardId,price,date)=>{
    setPriceHistory(prev=>{const n={...prev};if(!n[cardId])n[cardId]=[];if(!n[cardId].find(h=>h.date===date)){n[cardId]=[...n[cardId],{date,price}].slice(-180);if(user)savePricePoint(user.id,cardId,price,date).catch(console.error);}return n;});
  },[user]);

  const clearCache=()=>{
    // A-D2b0: iterates effectiveRoster so dynamic-artist caches clear too, and
    // adds the pb8 key (Gate 3D bumped pb7→pb8 in cardService; without this
    // line "Clear card cache" silently no-ops on the live caches).
    effectiveRoster.forEach(e=>{
      lsDel(`pb6_cards_${toSlug(e.name)}`);            // old TCGdex cache
      lsDel(`pb7_supa_${toSlug(e.name)}`);             // stale Gate 2 ILIKE cache
      lsDel(`pb8_supa_${e.artistId??toSlug(e.name)}`); // current Supabase cache (Gate 3D key)
    });
    // Purge per-card fallback image cache so stale "not found" results
    // don't persist after TCGdex gains images for previously imageless cards.
    Object.keys(localStorage).filter(k=>k.startsWith("pb_fallback_img_")).forEach(k=>lsDel(k));
    setCardData({});setErrors({});loadAllEntries();
  };
  const clearManual=async()=>{setManualOwned(new Set());setManualMissing(new Set());if(user)withSync(async()=>{await supabase.from("card_overrides").delete().eq("user_id",user.id);});};
  const toggleHideTcgPocket=()=>setHideTcgPocket(v=>{const n=!v;lsSet("pb_hide_tcgp",n);return n;});
  const toggleShowAllColor=()=>setShowAllColor(v=>{const n=!v;lsSet("pb_show_all_color",n);return n;});

  const[intentMap,setIntentMap]=useState(new Map());
  useEffect(()=>{
    if(!user){setIntentMap(new Map());return;}
    fetchUserIntent(user.id).then(m=>setIntentMap(m)).catch(console.error);
  },[user&&user.id]);

  const handleSetIntent=useCallback(async(card,status)=>{
    if(!user)return;
    const prev=intentMap.get(card.id);
    setIntentMap(m=>{const n=new Map(m);n.set(card.id,status);return n;});
    try{await setCardIntent(user.id,card.id,status);}
    catch(err){setIntentMap(m=>{const n=new Map(m);prev===undefined?n.delete(card.id):n.set(card.id,prev);return n;});console.error('setIntent failed:',err);}
  },[user,intentMap]);

  const handleClearIntent=useCallback(async(cardId)=>{
    if(!user)return;
    const prev=intentMap.get(cardId);
    setIntentMap(m=>{const n=new Map(m);n.delete(cardId);return n;});
    try{await clearCardIntent(user.id,cardId);}
    catch(err){setIntentMap(m=>{const n=new Map(m);prev!==undefined&&n.set(cardId,prev);return n;});console.error('clearIntent failed:',err);}
  },[user,intentMap]);

  // The raw cardData (used for caching, CSV matching, etc.) stays untouched —
  // this is only the display/stat layer, so toggling never affects ownership data.
  const visibleCardData=useMemo(()=>{
    if(!hideTcgPocket)return cardData;
    const out={};
    Object.keys(cardData).forEach(slug=>{out[slug]=cardData[slug].filter(c=>!isTcgPocketCard(c));});
    return out;
  },[cardData,hideTcgPocket]);

  const checkOwned=useCallback(card=>isCardOwned(card,ownedKeySet,manualOwned,manualMissing),[ownedKeySet,manualOwned,manualMissing]);

  const goTo=useCallback((target)=>{
    if(target==="landing"){setView("landing");return;}
    if(target==="dashboard"){setView("dashboard");return;}
    if(target==="binder"){setView("binder");return;}
    if(target==="artists"){setView("artists");return;}
    if(target==="plans"){setView("plans");return;} // BP-0A2
    if(target.startsWith("plan:")){const id=target.replace("plan:","");setPlanId(id);setView("plan");return;} // BP-0A2
    if(target.startsWith("artist:")){const slug=target.replace("artist:","");setArtistSlug(slug);setView("artist");return;}
    if(effectiveRoster.some(a=>toSlug(a.name)===target)){setFilterSlug(target);setView("binder");return;}
    setView(target);
  },[effectiveRoster]);

  if(view==="checking-auth")return<div style={{position:"fixed",inset:0,background:"#030100",display:"flex",alignItems:"center",justifyContent:"center"}}><IcoSpin/></div>;

  if(view==="loading-data")return(
    <div style={{position:"fixed",inset:0,background:"radial-gradient(ellipse at 50% 110%,#3d0f00 0%,#1a0500 40%,#030100 100%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1rem",overflow:"hidden"}}>
      <FlameBackground dim/>
      <div style={{position:"relative",zIndex:10,textAlign:"center"}}><BlazLogo size={52} glow/><p style={{color:"#ff9944",fontSize:".875rem",marginTop:".75rem"}}>Loading your collection…</p></div>
    </div>
  );

  if(view==="landing")return<LandingPage user={user} onEnter={()=>setView("dashboard")} onSendLink={handleSendLink} onVerifyCode={handleVerifyCode} onSignOut={handleSignOut}/>;

  if(view==="dashboard")return(
    <>
      <Dashboard cardData={visibleCardData} checkOwned={checkOwned} favorites={favorites} user={user} intentMap={intentMap} csvStatus={csvStatus} syncStatus={syncStatus} onGoBinder={goTo} onUploadCSV={()=>fileRef.current&&fileRef.current.click()} loadingSet={loadingSet} errors={errors} onCardClick={setSelectedCard} roster={effectiveRoster} heroPick={heroPick} setHeroPick={setHeroPick} queuePage={queuePage} setQueuePage={setQueuePage}/>
      {selectedCard&&<CardModal card={selectedCard} owned={checkOwned(selectedCard)} manualOwned={manualOwned} manualMissing={manualMissing} isFavorite={favorites.has(selectedCard.id)} priceHistory={priceHistory} onToggleManual={handleToggleManual} onToggleFavorite={handleToggleFavorite} onRecordPrice={handleRecordPrice} onClose={()=>setSelectedCard(null)} intentStatus={intentMap.get(selectedCard.id)} onSetIntent={handleSetIntent} onClearIntent={handleClearIntent}/>}
      <input ref={fileRef} type="file" accept=".csv" onChange={e=>{const f=e.target.files&&e.target.files[0];if(f)handleCSV(f);e.target.value="";}} style={{display:"none"}}/>
    </>
  );

  if(view==="artist"&&artistSlug){
    const entry=effectiveRoster.find(a=>toSlug(a.name)===artistSlug);
    const cards=visibleCardData[artistSlug]||[];
    return(<>
      <ArtistPage slug={artistSlug} entry={entry} cards={cards} checkOwned={checkOwned} manualOwned={manualOwned} manualMissing={manualMissing} favorites={favorites} onCardClick={setSelectedCard} onToggleFavorite={handleToggleFavorite} intentMap={intentMap} showAllColor={showAllColor} toggleShowAllColor={toggleShowAllColor} onBack={()=>setView("dashboard")}/>
      {selectedCard&&<CardModal card={selectedCard} owned={checkOwned(selectedCard)} manualOwned={manualOwned} manualMissing={manualMissing} isFavorite={favorites.has(selectedCard.id)} priceHistory={priceHistory} onToggleManual={handleToggleManual} onToggleFavorite={handleToggleFavorite} onRecordPrice={handleRecordPrice} onClose={()=>setSelectedCard(null)} intentStatus={intentMap.get(selectedCard.id)} onSetIntent={handleSetIntent} onClearIntent={handleClearIntent}/>}
      <input ref={fileRef} type="file" accept=".csv" onChange={e=>{const f=e.target.files&&e.target.files[0];if(f)handleCSV(f);e.target.value="";}} style={{display:"none"}}/>
    </>);
  }

  if(view==="hunt")return(<>
    <HuntBoard visibleCardData={visibleCardData} intentMap={intentMap} checkOwned={checkOwned} onCardClick={setSelectedCard} onBack={()=>setView("dashboard")} roster={effectiveRoster}/>
    {selectedCard&&<CardModal card={selectedCard} owned={checkOwned(selectedCard)} manualOwned={manualOwned} manualMissing={manualMissing} isFavorite={favorites.has(selectedCard.id)} priceHistory={priceHistory} onToggleManual={handleToggleManual} onToggleFavorite={handleToggleFavorite} onRecordPrice={handleRecordPrice} onClose={()=>setSelectedCard(null)} intentStatus={intentMap.get(selectedCard.id)} onSetIntent={handleSetIntent} onClearIntent={handleClearIntent}/>}
  </>);

  if(view==="hunt-show")return(<>
    <HuntShow visibleCardData={visibleCardData} intentMap={intentMap} checkOwned={checkOwned} onCardClick={setSelectedCard} onBack={()=>setView("dashboard")} roster={effectiveRoster}/>
    {selectedCard&&<CardModal card={selectedCard} owned={checkOwned(selectedCard)} manualOwned={manualOwned} manualMissing={manualMissing} isFavorite={favorites.has(selectedCard.id)} priceHistory={priceHistory} onToggleManual={handleToggleManual} onToggleFavorite={handleToggleFavorite} onRecordPrice={handleRecordPrice} onClose={()=>setSelectedCard(null)} intentStatus={intentMap.get(selectedCard.id)} onSetIntent={handleSetIntent} onClearIntent={handleClearIntent}/>}
  </>);

  if(view==="artists")return(
    <ArtistDirectory visibleCardData={visibleCardData} checkOwned={checkOwned} loadingSet={loadingSet} errors={errors} onOpenArtist={slug=>goTo("artist:"+slug)} onBack={()=>setView("dashboard")} roster={effectiveRoster} onArtistAdded={handleArtistAdded} onChangeTier={handleChangeArtistTier} onRemoveArtist={handleRemoveArtist}/>
  );

  if(view==="plans")return(
    <BinderPlansIndex user={user} onOpenPlan={id=>goTo("plan:"+id)} onBack={()=>setView("binder")}/>
  );

  if(view==="plan"&&planId)return(<>
    <BinderPlanPage planId={planId} user={user} onBack={()=>setView("plans")} checkOwned={checkOwned} onCardClick={setSelectedCard}/>
    {selectedCard&&<CardModal card={selectedCard} owned={checkOwned(selectedCard)} manualOwned={manualOwned} manualMissing={manualMissing} isFavorite={favorites.has(selectedCard.id)} priceHistory={priceHistory} onToggleManual={handleToggleManual} onToggleFavorite={handleToggleFavorite} onRecordPrice={handleRecordPrice} onClose={()=>setSelectedCard(null)} intentStatus={intentMap.get(selectedCard.id)} onSetIntent={handleSetIntent} onClearIntent={handleClearIntent}/>}
  </>);

  if(view==="owned-library")return(<>
    <OwnedLibrary onBack={()=>setView("dashboard")} onUploadCSV={()=>fileRef.current&&fileRef.current.click()} importEpoch={importEpoch}/>
    <input ref={fileRef} type="file" accept=".csv" onChange={e=>{const f=e.target.files&&e.target.files[0];if(f)handleCSV(f);e.target.value="";}} style={{display:"none"}}/>
  </>);

  const visibleArtists=filterSlug==="all"?effectiveRoster:effectiveRoster.filter(a=>toSlug(a.name)===filterSlug); // A-D2b0
  const totalCards=Object.values(visibleCardData).reduce((s,a)=>s+a.length,0);
  const totalOwned=Object.values(visibleCardData).reduce((s,cards)=>s+cards.filter(checkOwned).length,0);
  const totalPct=totalCards?Math.round((totalOwned/totalCards)*100):0;
  const manualCount=manualOwned.size+manualMissing.size;
  const selSt={background:"#0f0f1c",border:"1px solid #1e1e35",borderRadius:8,color:"#e8e8f4",padding:".4rem .6rem",fontSize:".76rem"};
  const syncIcon=syncStatus==="syncing"?<IcoSpin/>:syncStatus==="synced"?<span style={{color:"#22c55e",fontSize:".65rem"}}>✓</span>:null;

  return(
    <div className={showAllColor?"color-mode":""} style={{minHeight:"100dvh",background:"#07070f"}}>
      <header style={{position:"sticky",top:0,zIndex:100,background:"rgba(7,7,15,0.97)",backdropFilter:"blur(18px)",WebkitBackdropFilter:"blur(18px)",borderBottom:"1px solid #1e1e35"}}>
        <div style={{maxWidth:860,margin:"0 auto",padding:".7rem 1rem"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".6rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:".5rem",cursor:"pointer"}} onClick={()=>setView("dashboard")}>
              <BlazLogo size={18}/>
              <div style={{display:"flex",alignItems:"baseline",gap:".5rem"}}>
                <span className="font-display" style={{fontWeight:600,fontSize:"1.02rem",color:"#e8e8f4",letterSpacing:"-.01em"}}>Illustrated</span>
                {totalCards>0&&<span style={{fontSize:".7rem",color:"#6b6b90",fontVariantNumeric:"tabular-nums"}}>{totalOwned}/{totalCards} · {totalPct}%</span>}
                {manualCount>0&&<span style={{fontSize:".62rem",color:"#60a5fa",background:"rgba(96,165,250,0.1)",padding:"1px 6px",borderRadius:4}}>{manualCount} manual</span>}
                {syncIcon&&<span style={{display:"flex",alignItems:"center",gap:3}}>{syncIcon}</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:".4rem",alignItems:"center"}}>
              {csvStatus==="loading"&&<span style={{fontSize:".7rem",color:"#6b6b90",display:"flex",alignItems:"center",gap:4}}><IcoSpin/>Reading…</span>}
              {csvStatus?.count&&<span style={{fontSize:".7rem",color:"#22c55e"}}>✓ {csvStatus.count}</span>}
              <button onClick={()=>setView("hunt")} className="btn-ghost" style={{color:"#9b7fe8",borderRadius:8,padding:".35rem .6rem",fontSize:".7rem",fontWeight:600,whiteSpace:"nowrap"}}>Hunt Board</button>
              <button onClick={toggleShowAllColor} className="btn-ghost" title={showAllColor?"Showing missing cards in color":"Showing missing cards grayed out"} style={{color:showAllColor?"#c0589e":"#6b6b90",borderRadius:8,padding:".38rem",display:"flex",background:showAllColor?"rgba(192,88,158,0.12)":undefined,border:showAllColor?"1px solid rgba(192,88,158,0.3)":undefined}}><IcoContrast/></button>
              <button onClick={()=>setShowSettings(true)} className="btn-ghost" style={{color:"#6b6b90",borderRadius:8,padding:".38rem",display:"flex"}}><IcoGear/></button>
              <input ref={fileRef} type="file" accept=".csv" onChange={e=>{const f=e.target.files&&e.target.files[0];if(f)handleCSV(f);e.target.value="";}} style={{display:"none"}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:".5rem",flexWrap:"wrap"}}>
            <div style={{flex:"1 1 160px",position:"relative",minWidth:0}}>
              <span style={{position:"absolute",left:".6rem",top:"50%",transform:"translateY(-50%)",color:"#6b6b90",display:"flex",pointerEvents:"none"}}><IcoSearch/></span>
              <input ref={searchRef} type="search" placeholder="Search cards…" value={search} onChange={e=>setSearch(e.target.value)} style={{...selSt,width:"100%",padding:".4rem 2rem .4rem 2rem",fontSize:".85rem"}}/>
              {search&&<button onClick={()=>{setSearch("");searchRef.current&&searchRef.current.focus();}} style={{position:"absolute",right:".4rem",top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#6b6b90",cursor:"pointer",display:"flex"}}><IcoX/></button>}
            </div>
            <select value={filterSlug} onChange={e=>setFilterSlug(e.target.value)} style={{...selSt,maxWidth:148}}>
              <option value="all">All Artists</option>
              {/* A-D2d: dynamic artists tiered "main"/"secondary" fold into the
                  matching curated optgroup; "added" (default) keeps its own
                  "Your additions" group. Purely additive — curated-only
                  ARTISTS filtering is unchanged when there are no dynamic
                  artists at a given tier. */}
              <optgroup label="Main">{[...ARTISTS.filter(a=>a.tier==="main"),...dynamicArtists.filter(a=>a.tier==="main")].map(a=><option key={a.artistId||a.name} value={toSlug(a.name)}>{a.name}</option>)}</optgroup>
              <optgroup label="Secondary">{[...ARTISTS.filter(a=>a.tier==="secondary"),...dynamicArtists.filter(a=>a.tier==="secondary")].map(a=><option key={a.artistId||a.name} value={toSlug(a.name)}>{a.name}</option>)}</optgroup>
              <optgroup label="Special">{ARTISTS.filter(a=>a.tier==="special").map(a=><option key={a.name} value={toSlug(a.name)}>{a.name}</option>)}</optgroup>
              {dynamicArtists.some(a=>a.tier==="added")&&<optgroup label="Your additions">{dynamicArtists.filter(a=>a.tier==="added").map(a=><option key={a.artistId||a.name} value={toSlug(a.name)}>{a.name}</option>)}</optgroup>}
            </select>
            <div style={{display:"flex",gap:".3rem",alignItems:"center",flexShrink:0}}>
              <button onClick={()=>setViewMode(viewMode==="missing"?null:"missing")} style={{background:viewMode==="missing"?"rgba(139,108,216,0.2)":"#0f0f1c",color:viewMode==="missing"?"#c0a0f8":"#6b6b90",border:`1px solid ${viewMode==="missing"?"#8b6cd8":"#1e1e35"}`,borderRadius:7,padding:".38rem .65rem",cursor:"pointer",fontSize:".74rem",fontWeight:viewMode==="missing"?700:500,transition:"all .15s",whiteSpace:"nowrap"}}>Missing</button>
              <button onClick={()=>setViewMode(viewMode==="owned"?null:"owned")} style={{background:viewMode==="owned"?"rgba(34,197,94,0.12)":"#0f0f1c",color:viewMode==="owned"?"#6ee7b7":"#6b6b90",border:`1px solid ${viewMode==="owned"?"#22c55e":"#1e1e35"}`,borderRadius:7,padding:".38rem .65rem",cursor:"pointer",fontSize:".74rem",fontWeight:viewMode==="owned"?700:500,transition:"all .15s",whiteSpace:"nowrap"}}>Owned</button>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...selSt,fontSize:".72rem",paddingLeft:".5rem",paddingRight:".5rem",maxWidth:80}}>
                <option value="name">A–Z</option>
                <option value="price-desc">$↓</option>
                <option value="price-asc">$↑</option>
                <option value="date-desc">New</option>
                <option value="date-asc">Old</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      <main style={{maxWidth:860,margin:"0 auto",padding:"1rem"}}>
        {totalCards>0&&<div style={{height:2,background:"#1e1e35",borderRadius:1,overflow:"hidden",marginBottom:"1.5rem"}}><div className="prog-fill" style={{width:`${totalPct}%`,height:"100%",background:"#8b6cd8",borderRadius:1}}/></div>}
        {/* BP-0A2: calm entry into the intentional-planning surface. */}
        <div style={{marginBottom:"1.5rem"}}>
          <button onClick={()=>goTo("plans")} className="btn-ghost" style={{width:"100%",borderRadius:12,padding:".7rem",fontSize:".78rem",fontWeight:600,color:"#8b6cd8",display:"flex",alignItems:"center",justifyContent:"center",gap:".4rem"}}>Planned binders →</button>
        </div>
        {visibleArtists.map(entry=>{
          const slug=toSlug(entry.name),cards=visibleCardData[slug]||[];
          const isLoading=loadingSet.has(slug),err=errors[slug];
          if(isLoading&&!cards.length)return<div key={entry.name} style={{display:"flex",alignItems:"center",gap:".5rem",padding:".6rem 0",color:"#6b6b90",fontSize:".8rem"}}><IcoSpin/> Loading {entry.name}…</div>;
          if(err)return<div key={entry.name} style={{padding:".6rem 0",fontSize:".78rem",color:"#f87171",display:"flex",alignItems:"center",gap:".5rem"}}><span>⚠ {entry.name}: {err}</span><button onClick={()=>loadEntry(entry)} style={{color:"#8b6cd8",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:3,fontSize:".75rem"}}><IcoRetry/> retry</button></div>;
          if(!cards.length)return null;
          return<ArtistSection key={entry.name} entry={entry} cards={cards} checkOwned={checkOwned} manualOwned={manualOwned} manualMissing={manualMissing} favorites={favorites} onCardClick={setSelectedCard} onToggleFavorite={handleToggleFavorite} searchQuery={search} sortBy={sortBy} viewMode={viewMode} startCollapsed/>;
        })}
        {search&&!visibleArtists.some(entry=>{const cards=visibleCardData[toSlug(entry.name)]||[];const q=search.toLowerCase();return cards.some(c=>(c.name||"").toLowerCase().includes(q));})&&(
          <div style={{textAlign:"center",padding:"3rem 1rem",color:"#6b6b90",fontSize:".875rem"}}>No cards matching "{search}"</div>
        )}
      </main>

      {selectedCard&&<CardModal card={selectedCard} owned={checkOwned(selectedCard)} manualOwned={manualOwned} manualMissing={manualMissing} isFavorite={favorites.has(selectedCard.id)} priceHistory={priceHistory} onToggleManual={handleToggleManual} onToggleFavorite={handleToggleFavorite} onRecordPrice={handleRecordPrice} onClose={()=>setSelectedCard(null)} intentStatus={intentMap.get(selectedCard.id)} onSetIntent={handleSetIntent} onClearIntent={handleClearIntent}/>}
      {showSettings&&<SettingsPanel onClose={()=>setShowSettings(false)} onClearCache={clearCache} onClearManual={clearManual} onSignOut={()=>{handleSignOut();setShowSettings(false);}} hideTcgPocket={hideTcgPocket} onToggleTcgPocket={toggleHideTcgPocket} user={user} onUploadCSV={()=>fileRef.current&&fileRef.current.click()}/>}
    </div>
  );
}


// ── Exports ───────────────────────────────────────────────────────────────────
export { App, SharedBinder, ErrorBoundary };

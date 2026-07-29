// src/constants/artistEditorial.js
// Artist Page 3.0 — source-governed editorial dossiers, keyed by artist slug.
//
// SCOPE
//   This file carries curated, sourced editorial content for artists that have
//   been researched. It is additive: an artist absent from ARTIST_EDITORIAL
//   still renders the full Artist Page 3.0 composition using the existing
//   ARTIST_FACTS / ARTIST_META content. Komiya is the content pilot, not a
//   separate route.
//
// SOURCE-INTEGRITY RULES (enforced by convention here, and by ArtistPage at runtime)
//   • No invented first-person quotes.
//   • No paraphrase presented inside quotation marks. The single quoted
//     fragment below is a short verbatim phrase from the primary source and is
//     attributed inline.
//   • No long source passages copied. All prose is original editorial writing
//     grounded in the listed sources.
//   • Claims sourced from secondary references are phrased as description
//     ("often described as…"), never as settled self-description.
//   • No source portraits, scans or non-catalog artwork are referenced or
//     hosted. Every image on the page comes from the existing card catalog.
//
// NOTABLE-CARD RESOLUTION CONTRACT
//   ArtistPage resolves notableCards by EXACT canonical id against the artist's
//   own loaded card array — never by name prefix, never "first matching card".
//   `expectName` is a mandatory integrity guard: if the id resolves to a card
//   whose name does not match, the entry is OMITTED (never substituted) and a
//   console diagnostic is emitted.
//
//   `basis` distinguishes evidence-backed selections from editorial ones:
//     "documented" — an attributable, sourced statement of significance.
//     "editorial"  — Illustrated Vault's own curatorial pick. These are never
//                    described as artist-selected or officially recognised.

const ARTIST_EDITORIAL = {
  "tomokazu-komiya": {
    // Replaces the previous "Active since 1998 — Neo Genesis" framing, which
    // conflated his first released card with a set he did not debut in.
    identityLine: "Working with the Pokémon TCG since 1996 · Early card work released in Japan in 1998",

    tags: "Acrylic Gouache · Loose Line · Distorted Form",

    thesis:
      "A freelance illustrator who has been with the Pokémon TCG almost from the beginning, and who has spent nearly three decades making the cards that look like nothing else in the binder.",

    // Short verbatim fragment from the primary source, attributed.
    pullQuote: {
      text: "those weird ones",
      attribution: "Tomokazu Komiya, on how collectors might remember his cards",
      sourceId: "official-conversation",
    },

    introduction: [
      "Tomokazu Komiya trained at the Toyo Institute of Art and Design and began working on the Pokémon Trading Card Game in 1996. One of his earliest released illustrations — a Weedle printed only in Japan — appeared in 1998. He has remained a freelance illustrator throughout.",
      "His cards are identifiable on sight: proportions pulled out of true, colour laid down loosely, outlines that wander where a tidier illustrator would close them. Writers on his work often reach for the term Primitivist. Komiya's own framing is considerably more self-deprecating.",
      "The approach has not aged out. Decades on, the same visual language turns up on modern expanded-canvas illustrations, on Pokémon Center merchandise, and in picture books.",
    ],

    notes: [
      {
        id: "style",
        title: "Style & practice",
        body:
          "Acrylic gouache is his main medium. Around it he brings in pencils, coloured pencils, ballpoint pens and markers — partly for the different marks each tool leaves, and partly, by his own account, to keep the process from settling into routine. The bold marker line is a practical decision as much as a stylistic one: on physical media it gets him a stronger black than paint alone will give. The result is the loosely coloured, gently distorted look the community recognises immediately, and which is frequently discussed in relation to Primitivism.",
      },
      {
        id: "career",
        title: "Career & milestones",
        body:
          "He studied at the Toyo Institute of Art and Design and started working with the Pokémon TCG in 1996. His earliest released card illustration was a Weedle issued only in Japan in 1998, and he has worked freelance since. Asked about his own work, he has named Ledyba from Neo Destiny as his favourite of his card illustrations. Fellow illustrator Kouki Saitou has separately named Komiya's Delibird from Neo Revelation as the one he likes best.",
      },
      {
        id: "beyond",
        title: "Beyond the cards",
        body:
          "Komiya's Pokémon work reaches well past the TCG: Pokémon Center merchandise, children's books and magazine illustration, including work on the Pokémon Tales picture-book series. For the 2023 Pokémon × Van Gogh collaboration he contributed Sunflora and Smeargle artwork responding to paintings in the Van Gogh Museum's collection.",
      },
    ],

    notableCards: [
      {
        id: "neo4-71",
        expectName: "Ledyba",
        label: "The artist's choice",
        basis: "documented",
        note: "Komiya has named this as his own favourite among his card illustrations.",
        sourceId: "official-conversation",
      },
      {
        id: "neo3-5",
        expectName: "Delibird",
        label: "Peer recognition",
        basis: "documented",
        note: "Illustrator Kouki Saitou has singled this out as his favourite Komiya piece.",
        sourceId: "official-conversation",
      },
      {
        id: "neo2-8",
        expectName: "Politoed",
        label: "Early signature",
        basis: "editorial",
        note: "An editorial pick: a Neo-era holo where the wandering line, lopsided expression and uneasy colour are already unmistakably Komiya.",
      },
      {
        id: "neo4-20",
        expectName: "Dark Slowking",
        label: "Neo-era signature",
        basis: "editorial",
        note: "An editorial pick for the strange, theatrical character work of the Neo era.",
      },
      {
        id: "sv01-210",
        expectName: "Drowzee",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick: the same visual language on a modern expanded canvas, decades later.",
      },
      {
        id: "sv04-207",
        expectName: "Brute Bonnet",
        label: "Contemporary range",
        basis: "editorial",
        note: "An editorial pick for texture, humour and compositional density in recent work.",
      },
    ],

    sources: [
      {
        id: "official-conversation",
        label: "Illustrator column: Tomokazu Komiya",
        publisher: "Pokémon TCG official championship site",
        url: "https://www.ptcgic-cr.com/2024/en/column/article-6/",
      },
      {
        id: "bulbapedia-komiya",
        label: "Tomokazu Komiya",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Tomokazu_Komiya",
      },
      {
        id: "bulbapedia-tales",
        label: "Pokémon Tales",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Tales",
      },
    ],
  },
};

export { ARTIST_EDITORIAL };

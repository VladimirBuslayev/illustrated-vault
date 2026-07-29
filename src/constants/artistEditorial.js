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

  // ── Yuka Morii ──────────────────────────────────────────────────────────────
  // Sourcing note: where Bulbapedia and the Japanese primary sources disagree on
  // the order of her education, the Japanese sources are followed — one of them
  // is the institution itself. The contradictory secondary version is not used.
  // No pull quote: every quotable line in the sources is Japanese, and setting a
  // translation inside quotation marks would present it as verbatim.
  "yuka-morii": {
    identityLine: "Working with the Pokémon TCG since 2000 · Debuted in Neo Discovery",

    tags: "Clay Sculpture · Miniature Worlds · Photographic",

    thesis:
      "Morii is one of the TCG's defining physical-media artists, specialising in hand-built resin-clay models — so her cards are not painted illusions of an object, but photographs of one that genuinely existed.",

    introduction: [
      "Yuka Morii is a professional three-dimensional modeller who has been making Pokémon for the Trading Card Game since around 2000, beginning with the Neo Discovery expansion. She has described her role among the game's official artists as the one handling the three-dimensional side of the work.",
      "The material is resin clay, hardened with heat. Colour is mixed, the form is sculpted, the piece is baked, and the cycle repeats until the model is finished — all of it by hand. The completed figure is then staged and photographed, sometimes against a built miniature set and sometimes against a real location.",
      "The practice reaches well past the cards: three-dimensional work for Pokémon print material, character design, product design and a long shelf of published books. Her physical models have since been exhibited.",
    ],

    notes: [
      {
        id: "material",
        title: "Material & process",
        body:
          "The medium is resin clay that hardens when baked. Colour-mixing, sculpting and heating are repeated in cycles until the model is complete, and every step is done by hand. Morii has described the official Pokémon artists as a large and varied group — some painting with a brush, some working on a computer — with herself handling the three-dimensional side. She builds to brief, working from a list of which Pokémon to make next, and by early 2020 she put her own count of finished figures at more than two hundred.",
      },
      {
        id: "worlds",
        title: "Miniature worlds",
        body:
          "The sculpture is only half of the card. The finished model is photographed against arranged scenery, or occasionally against an actual location, and the setting does as much work as the figure standing in it. This is why the cards read the way they do: the light is real light falling on a real surface, the depth of field is real, and the scale cues are physical rather than drawn. Nothing on a Morii card is simulating tactility, because nothing needs to.",
      },
      {
        id: "career",
        title: "Career & exhibitions",
        body:
          "Morii studied at the Kuwasawa Design School and went on to graduate study at Tokyo Zokei University. At the time of Kuwasawa's 2023 exhibition, she was also teaching there part-time. Her wider practice covers company mascots, product design — including the NenDo! clay play set — and a substantial run of published books. That exhibition, \"Pokémon Born from Hands 2\", presented twenty of her Pokémon models and drew visitors from outside Japan as well; the school put her card count at roughly two hundred in Japan alone.",
      },
    ],

    notableCards: [
      {
        id: "neo2-60",
        expectName: "Omanyte",
        label: "Debut set",
        basis: "documented",
        note: "From Neo Discovery, the expansion where her Pokémon TCG work first appeared in 2000 — one of the first group of Morii cards to reach print.",
        sourceId: "bulbapedia-morii",
      },
      {
        id: "neo2-37",
        expectName: "Corsola",
        label: "Miniature world",
        basis: "editorial",
        note: "An editorial pick: an early card where the built underwater setting carries as much of the image as the figure standing in it.",
      },
      {
        id: "ex11-63",
        expectName: "Ditto",
        label: "Shape made physical",
        basis: "editorial",
        note: "An editorial pick. Ditto is a documented favourite Pokémon of Morii's, but the choice of this EX Delta Species printing is Illustrated Vault's: a Pokémon defined by having no fixed shape, handed a real one you could pick up.",
      },
      {
        id: "sm12-97",
        expectName: "Mimikyu",
        label: "Photographic staging",
        basis: "editorial",
        note: "An editorial pick: a Pokémon that is itself a costume, sculpted and then lit so that cloth reads as cloth.",
      },
      {
        id: "sv04-211",
        expectName: "Aipom",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick: an expanded-canvas illustration where the miniature set finally gets the room it always wanted.",
      },
      {
        id: "sv07-102",
        expectName: "Meltan",
        label: "Contemporary range",
        basis: "editorial",
        note: "An editorial pick from the recent era, and a reminder that the process has not changed in twenty-five years.",
      },
    ],

    sources: [
      {
        id: "kuwasawa-exhibition",
        label: "Pokémon Born from Hands 2 — Yuka Morii Clay Art Exhibition",
        publisher: "Kuwasawa Design School (Japanese)",
        url: "https://www.kds.ac.jp/designnews/pokemon",
      },
      {
        id: "asanavi-interview",
        label: "Yuka Morii on Asa Navi",
        publisher: "Nippon Broadcasting, via radiko news (Japanese)",
        url: "https://news.radiko.jp/article/station/LFR/39469/",
      },
      {
        id: "bulbapedia-morii",
        label: "Yuka Morii",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Yuka_Morii",
      },
      {
        id: "artofpkm-morii",
        label: "Yuka Morii",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/44",
      },
      {
        id: "serebii-morii",
        label: "Cards illustrated by Yuka Morii",
        publisher: "Serebii",
        url: "https://www.serebii.net/card/dex/artist/yukamorii.shtml",
      },
    ],
  },

  // ── Asako Ito ───────────────────────────────────────────────────────────────
  // The first-assigned card (Goomy, per the Pen interview) and the first-released
  // card (Poliwag, per the card-history sources) are deliberately kept distinct
  // and never flattened into a single "debut".
  // No pull quote: the primary source is Japanese, and all prose below is
  // original English written from it rather than a translated line.
  "asako-ito": {
    identityLine: "Working with the Pokémon TCG since 2017 · Debuted in Sun & Moon",

    tags: "Amigurumi · Hand-built Sets · Textile Warmth",

    thesis:
      "Ito crochets the Pokémon and then builds the room it lives in — yarn, felt, props and scale assembled by hand until the character looks like it belongs there.",

    introduction: [
      "Asako Ito majored in oil painting at university and taught herself amigurumi alongside it, after seeing the teddy bear from Mr. Bean and wanting to make one for herself. She joined the Pokémon TCG in 2017; her first card to reach print was Poliwag, in the Sun & Moon expansion.",
      "She works without a written crochet pattern. She has said the chart symbols never stuck, so she assembles the construction in her head and goes by feel — knitting, unravelling and reknitting until the shape is right.",
      "The Pokémon is only half the job. Ito studies each species' form, character and habitat, then builds the background set herself, so a wetland or a cave arrives with the figure. Her stated aim is that the creature should look like it is living inside the card's world, and that the softness particular to yarn should survive the photograph.",
    ],

    notes: [
      {
        id: "form",
        title: "Form without a pattern",
        body:
          "Ito trained as an oil painter and came to amigurumi as a student, self-taught and without a crochet diagram. Because the chart symbols never stuck, she holds the construction in her head and relies on feel, repeating a cycle of knitting and unravelling until the form satisfies her. Yarn and felt are chosen for softness and warmth rather than convenience, and the material decisions run deep: for Altaria she used the same pale-blue yarn for the head plumage and tail as for the body, so the whole bird would read as one creature rather than assembled parts.",
      },
      {
        id: "world",
        title: "Building the world",
        body:
          "She works from the Pokédex and reference material to pin down a species' shape and characteristics, then builds the environment herself. Goomy got a wetland; Dunsparce got a cave, its opening sized with care and constructed from thick paper and felt so the burst of movement would land. Audino's card let her treat the whole surface as canvas, and she prepared her largest background to that point — a stream carrying the eye back toward distant mountains. Even the colour boundary between Audino's pink and cream was reproduced in the knitting itself rather than added afterwards.",
      },
      {
        id: "scale",
        title: "Career & evolving scale",
        body:
          "Born in Miyagi Prefecture, Ito debuted in the Sun & Moon era in 2017 and has worked through the Sword & Shield and Scarlet & Violet eras since. Goomy, in Guardians Rising, was the first card she was assigned and her first attempt at rendering a living creature in amigurumi; she has said she likes how the damp, slippery world of it came out. The scale of her sets has grown with the format — the expanded illustration canvases of the recent era gave her room for furniture, props and full landscape.",
      },
    ],

    notableCards: [
      {
        id: "sm2-94",
        expectName: "Goomy",
        label: "First assignment",
        basis: "documented",
        note: "The first card Ito was assigned, and her first attempt at a living creature in amigurumi. She has said she likes how the damp, slippery setting came out.",
        sourceId: "pen-interview",
      },
      {
        id: "sm1-30",
        expectName: "Poliwag",
        label: "First released card",
        basis: "documented",
        note: "Her first card to reach print — the released debut, as distinct from the first one she was given to make.",
        sourceId: "bulbapedia-ito",
      },
      {
        id: "swsh8-111",
        expectName: "Wigglytuff",
        label: "The medium itself",
        basis: "editorial",
        note: "An editorial pick: the case where the Pokémon and the material want exactly the same thing — soft, round and stuffed.",
      },
      {
        id: "swsh12.5-GG19",
        expectName: "Altaria",
        label: "Built from scratch",
        basis: "documented",
        note: "A background unlike anything she had attempted before: the furniture, cushions and other props were all made from scratch, and she has described a whole world expanding around Altaria as she built it.",
        sourceId: "pen-interview",
      },
      {
        id: "sv09-120",
        expectName: "Dunsparce",
        label: "Motion and form",
        basis: "documented",
        note: "A deceptively simple shape that made head size and overall balance difficult, staged bursting out of a cave built from thick paper and felt.",
        sourceId: "pen-interview",
      },
      {
        id: "sv10.5b-151",
        expectName: "Audino",
        label: "Largest set build",
        basis: "documented",
        note: "With the whole card usable as canvas, Ito prepared her largest background to date — a stream carrying the eye back to distant mountains.",
        sourceId: "pen-interview",
      },
    ],

    sources: [
      {
        id: "pen-interview",
        label: "Asako Ito: expressing the Pokémon TCG in amigurumi",
        publisher: "Pen Online (Japanese)",
        url: "https://www.pen-online.jp/article/021686.html",
      },
      {
        id: "bulbapedia-ito",
        label: "Asako Ito",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Asako_Ito",
      },
      {
        id: "artofpkm-ito",
        label: "Asako Ito",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/141",
      },
      {
        id: "serebii-ito",
        label: "Cards illustrated by Asako Ito",
        publisher: "Serebii",
        url: "https://www.serebii.net/card/dex/artist/asakoito.shtml",
      },
    ],
  },
};

export { ARTIST_EDITORIAL };

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

  // ══════════════════════════════════════════════════════════════════════════
  // AP-3.0D — Complete Artist Archive
  // The seventeen dossiers below complete editorial coverage for every tracked
  // artist. Keys are the exact output of toSlug(displayName) from
  // src/utils/slug.js — NOT artistId. Two diverge and are called out inline:
  //   Tetsu Kayama    artistId "kayama"  -> key "tetsu-kayama"
  //   Masakazu Fukuda artistId "fukuda"  -> key "masakazu-fukuda"
  //
  // Every notableCards id below is an exact canonical id validated against
  // cards_effective: image-backed, non-Pocket, correct artist, correct name,
  // set and local id. No altIds, no prefix matching, no sibling inference, no
  // substitution. Alternate printings surfaced during validation were rejected
  // and must not be swapped in.
  //
  // No pullQuote is set for any of these seventeen: every quotable line located
  // is Japanese, from a source that fails verification, or from a primary that
  // has not been read in full.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Shinji Kanda ────────────────────────────────────────────────────────────
  // No pull quote: his one substantive interview is Japanese, and setting a
  // translation inside quotation marks would present it as verbatim.
  // The previous ARTIST_FACTS framing described an ukiyo-e background. No
  // admitted source supports it; only retailer and SEO pages make that claim,
  // and it is removed rather than rephrased.
  // CATALOG NOTE: his documented first card (Magmar, Brilliant Stars) is absent
  // from cards_effective under artist_id 'shinji-kanda', and the Galarian
  // Moltres promo he has described in detail has no image. Both remain in the
  // prose as sourced facts and neither can be a notable card.
  "shinji-kanda": {
    identityLine: "First card: Magmar, Brilliant Stars · Born 1986, Kyoto Prefecture",

    tags: "Primarily Digital · Physical Experiments · Unsettling Composition",

    thesis:
      "Kanda's cards are mostly digital, but the exceptions are the tell: a sheet of plastic coloured with pencils and then shrunk with heat, a ball of aluminium foil flattened and scanned. He goes looking for a surface that will do something he cannot draw.",

    introduction: [
      "Shinji Kanda was born in 1986 in Kyoto Prefecture and entered the Pokémon Trading Card Game with Magmar in Brilliant Stars. His work is primarily digital, and within a few years of that first card he was illustrating some of the most closely watched cards in the modern game.",
      "For the Magmar he coloured on a plastic sheet with coloured pencils and then applied heat, shrinking the sheet so the colour concentrated. For a promo Magneton he crumpled aluminium foil, flattened it and scanned it into the artwork. Neither is a signature method he returns to. Both suggest an illustrator who treats material as a variable rather than a given.",
      "Where his cards are most recognisable is in mood. Asked by the official site about his Galarian Moltres Art Rare, he described working from the brief of an evil flame bleeding into a clear sky, and said he set out to make an illustration that unsettles the person looking at it — a bird held upside down in mid-air, a dark aura climbing from the bottom of the frame upward.",
    ],

    notes: [
      {
        id: "process",
        title: "Surface and method",
        body:
          "The default is digital. The departures are documented and specific: coloured pencil on a plastic sheet, heat-shrunk to intensify the colour, for his first card; scanned crumpled aluminium foil for a promo Magneton. What connects them is a willingness to let a physical surface contribute something the drawing hand cannot — a compression of colour, a random grain — and then build the illustration around it.",
      },
      {
        id: "mood",
        title: "Composition and unease",
        body:
          "In his own account of the Galarian Moltres Art Rare, the theme he was given was an evil flame bleeding into clear weather, and the effect he wanted was contrast: an unclouded blue sky against colour intense enough to read as malevolent. He describes the menace as a mixture of things — coolness, unapproachability, a shiver — and says he wanted the illustration to stir the viewer's feelings rather than settle them. The composition follows from that: an unnatural pose, as if the bird were suspended upside down, and a line of sight that pulls a dark aura upward through the frame.",
      },
      {
        id: "arc",
        title: "From common card to full canvas",
        body:
          "Kanda arrived just as the expanded illustration formats were becoming the place where illustrators are most visible, and his work reads as built for them: dense, layered, rewarding a second look. The progression across his run is less a change of style than a change of room size — the same instinct for atmosphere and hidden detail, given more surface each time. It is worth looking at the uncommons too. The care does not drop when the canvas does.",
      },
    ],

    notableCards: [
      {
        id: "svp-159",
        expectName: "Magneton",
        label: "Material experiment",
        basis: "documented",
        note: "The artwork was built from crumpled aluminium foil, flattened and scanned.",
        sourceId: "bulbapedia-kanda",
      },
      {
        id: "swsh11-186",
        expectName: "Giratina V",
        label: "Expanded canvas",
        basis: "editorial",
        note: "An editorial pick: the illustration most often used to stand for his work, and the earliest of his cards held here with an image.",
      },
      {
        id: "sv02-203",
        expectName: "Magikarp",
        label: "A small Pokémon, a whole world",
        basis: "editorial",
        note: "An editorial pick: the layered, hidden-detail approach applied to one of the game's least imposing Pokémon.",
      },
      {
        id: "sv05-043",
        expectName: "Sharpedo",
        label: "The ordinary register",
        basis: "editorial",
        note: "An editorial pick: an uncommon, to show the same care arrives on cards nobody chases.",
      },
      {
        id: "sv10.5b-105",
        expectName: "Seismitoad",
        label: "Density and depth",
        basis: "editorial",
        note: "An editorial pick for the crowded, wetland-thick composition his illustration rares are known for.",
      },
      {
        id: "sv08.5-162",
        expectName: "Roaring Moon ex",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick: the fullest canvas the current format offers, used for atmosphere rather than spectacle.",
      },
    ],

    sources: [
      {
        id: "official-ar-sar",
        label: "Interviews with 16 illustrators: the secrets of AR and SAR",
        publisher: "Pokémon Card Game official site (Japanese)",
        url: "https://www.pokemon-card.com/info/003695.html",
      },
      {
        id: "bulbapedia-kanda",
        label: "Shinji Kanda",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Shinji_Kanda",
      },
      {
        id: "artofpkm-kanda",
        label: "Shinji Kanda",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/53",
      },
      {
        id: "serebii-kanda",
        label: "Cards illustrated by Shinji Kanda",
        publisher: "Serebii",
        url: "https://www.serebii.net/card/dex/artist/shinjikanda.shtml",
      },
    ],
  },

  // ── Atsuko Nishida ──────────────────────────────────────────────────────────
  // Corrects three claims previously carried in ARTIST_FACTS: "Game Freak
  // character designer since 1996" (she was there before 1996 and is now
  // freelance), "responsible for Pikachu" (created by her, design finalised by
  // Ken Sugimori) and "responsible for … Eevee" (credited to Motofumi Fujiwara).
  // No pull quote, and no daifuku or squirrel origin details: those trace to a
  // 2018 Polygon interview that has not been read in full, so they are omitted
  // rather than carried on a second-hand citation.
  "atsuko-nishida": {
    identityLine: "Created Pikachu at GAME FREAK · Pokémon TCG illustrations since 1997",

    tags: "Character Designer · Small Pokémon · Long Service",

    thesis:
      "Nishida is a character designer first. She made Pikachu before there were cards to put it on, and her card work — several hundred illustrations across nearly three decades — is what happened afterwards.",

    introduction: [
      "Atsuko Nishida was working as a designer at a game company before joining GAME FREAK, where she was on Pulseman alongside art director Ken Sugimori before being brought onto the first Pokémon games. She created Pikachu, with the design finalised by Sugimori, along with the Kanto first partners and, later, several of Eevee's evolutions including Glaceon and Sylveon. She has since gone freelance and works as a character designer and illustrator across a range of games and genres.",
      "Her card illustrations begin in 1997 and have not stopped. The scale is the point — several hundred cards, most of them not chase cards, and most of them small Pokémon doing something ordinary.",
      "She is also extremely private. At a 2018 interview she stayed behind a large Pikachu plush for its entire length.",
    ],

    notes: [
      {
        id: "designer",
        title: "Designer before illustrator",
        body:
          "The distinction matters when you are collecting her. Nishida's franchise credits sit upstream of the TCG: Pikachu, the Kanto first partners, Glaceon and Sylveon, and — at Sugimori's request — contributions to Xerneas and Yveltal. Eevee itself is credited elsewhere, to Motofumi Fujiwara. So on some of her cards she is illustrating a creature she invented, and on many others she is not. Both are worth having, and they are not the same thing.",
      },
      {
        id: "register",
        title: "The register she works in",
        body:
          "Across hundreds of cards the through-line is scale and affection: small Pokémon, close in, usually mid-routine. It is not a dramatic body of work and does not try to be. The catalog bears this out — her modern presence runs to ultra rares and ordinary cards rather than the illustration-rare formats other artists have moved into. A Nishida binder fills out mostly from commons and uncommons, which makes it one of the more approachable artist collections in the game, and one of the largest.",
      },
      {
        id: "career",
        title: "1997 onward",
        body:
          "Her TCG illustrations date from 1997 and run through every era since, which puts her among the longest-serving illustrators in the game. Outside Pokémon she has worked with the studio TOYBOX, including on Hometown Story. She also illustrated the 1998 CoroCoro Pokémon Illustrator promo — a card with a circulation history entirely unlike the rest of her output, and one you will not meet at a show.",
      },
    ],

    notableCards: [
      {
        id: "g1-26",
        expectName: "Pikachu",
        label: "Her own character",
        basis: "editorial",
        note: "An editorial pick. That Nishida created Pikachu is documented; this printing is Illustrated Vault's choice, from the set marking the franchise's twentieth anniversary.",
      },
      {
        id: "dp5-5",
        expectName: "Glaceon",
        label: "Designer and illustrator",
        basis: "editorial",
        note: "An editorial pick: an Eeveelution she is credited with designing, drawn by her, in the generation that introduced it.",
      },
      {
        id: "sm10-205",
        expectName: "Gardevoir & Sylveon GX",
        label: "Two of her own, at full size",
        basis: "editorial",
        note: "An editorial pick: a tag-team card carrying two Pokémon she is credited with designing, on a full-art canvas.",
      },
      {
        id: "ex1-35",
        expectName: "Kirlia",
        label: "Early foundation",
        basis: "editorial",
        note: "An editorial pick from the early card work. Her TCG illustrations are documented from 1997; the choice of printing is ours.",
      },
      {
        id: "ex13-82",
        expectName: "Surskit",
        label: "The everyday register",
        basis: "editorial",
        note: "An editorial pick: a small Pokémon, close in, which is where most of this body of work actually lives.",
      },
      {
        id: "me03-027",
        expectName: "Luxio",
        label: "Still working",
        basis: "editorial",
        note: "An editorial pick from the current era, nearly thirty years after the first card.",
      },
    ],

    sources: [
      {
        id: "official-pikachu-creators",
        label: "Creator Profile: The Creators of Pikachu",
        publisher: "Pokémon",
        url: "https://www.pokemon.com/us/news/creator-profile-the-creators-of-pikachu",
      },
      {
        id: "artofpkm-nishida",
        label: "Atsuko Nishida",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/10",
      },
      {
        id: "artofpkm-fujiwara",
        label: "Motofumi Fujiwara",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/11",
      },
      {
        id: "bulbapedia-nishida",
        label: "Atsuko Nishida",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Atsuko_Nishida",
      },
    ],
  },

  // ── Sowsow ──────────────────────────────────────────────────────────────────
  // Written without pronouns: Bulbapedia uses "his", Bleeding Cool uses
  // "their", and no source settles it.
  // Every value-based claim previously carried in ARTIST_FACTS is removed,
  // including the assertion that a card "consistently sells for well above
  // market price". Price never informs selection or copy here.
  // Display casing follows the ARTISTS roster entry for this release; the
  // catalog credit string is lowercase "sowsow".
  "sowsow": {
    identityLine: "Born 1988 · First cards in Forbidden Light, 2018",

    tags: "Painterly · Environment as Narrative · Watercolour Inflection",

    thesis:
      "A sowsow card is usually a Pokémon somewhere specific, doing something you have arrived in the middle of. The environment is not backdrop — it is where the story is kept.",

    introduction: [
      "sowsow's first cards all arrived at once, in Forbidden Light in 2018: Avalugg, Inkay and Cubone. The Cubone set the terms. It shows the Pokémon looking upward while a cloud overhead takes the shape of the skull of its dead mother — the whole of the Pokédex entry, told without a word, in the weather.",
      "The handling is painterly and watercolour-inflected, and it scaled up unusually well. When the alternate-art formats gave illustrators the full card, sowsow used the space for habitat rather than spectacle: a Pokémon at home, mid-routine, the composition arranged so you read the place before you read the pose.",
      "In 2023 the Van Gogh Museum in Amsterdam commissioned six Pokémon paintings from three of the game's illustrators. sowsow made two of them.",
    ],

    notes: [
      {
        id: "debut",
        title: "Three cards at once",
        body:
          "Avalugg, Inkay and Cubone, all in Forbidden Light. Worth knowing if you are collecting by artist, because it is often only the Cubone that gets remembered, and the other two are the same debut. Between them they already show the range: an ice mass, a small squid in the dark, and a card built on a single piece of visual grief.",
      },
      {
        id: "scale",
        title: "What happened at full size",
        body:
          "The Sword & Shield era's alternate arts handed illustrators the entire card, and sowsow's response was to widen the world rather than enlarge the Pokémon. The Espeon and Gengar alternate arts are the clearest cases: both are essentially interiors — a place with weather and light and a floor — with a Pokémon inhabiting them rather than posing in front of them.",
      },
      {
        id: "beyond",
        title: "Outside the card game",
        body:
          "sowsow has illustrated for Pokémon Sleep. In 2023, for the collaboration marking the Van Gogh Museum's fiftieth anniversary, the museum commissioned six paintings from three Pokémon illustrators; sowsow contributed two — Munchlax and Snorlax in a room after The Bedroom, and an Eevee after Self-Portrait with Straw Hat. The museum gives sowsow's birth year as 1988. Neither painting is a card in this archive.",
      },
    ],

    notableCards: [
      {
        id: "sm6-57",
        expectName: "Cubone",
        label: "Debut, and the story in the sky",
        basis: "documented",
        note: "One of three first cards. Cubone looks up; the cloud above has taken the shape of its late mother's skull.",
        sourceId: "bleedingcool-sowsow",
      },
      {
        id: "sm6-30",
        expectName: "Avalugg",
        label: "Debut trio",
        basis: "documented",
        note: "Another of the three cards that arrived together in Forbidden Light — an ice mass where the Cubone was a piece of grief.",
        sourceId: "bulbapedia-sowsow",
      },
      {
        id: "swsh7-180",
        expectName: "Espeon V",
        label: "Signature composition",
        basis: "editorial",
        note: "An editorial pick: the alternate art where the environment does most of the work and the Pokémon simply lives in it.",
      },
      {
        id: "swsh8-271",
        expectName: "Gengar VMAX",
        label: "Tonal range",
        basis: "editorial",
        note: "An editorial pick: the same method turned toward something colder.",
      },
      {
        id: "sv02-198",
        expectName: "Bramblin",
        label: "Habitat at illustration-rare scale",
        basis: "editorial",
        note: "An editorial pick: a Pokémon placed in a specific, weathered somewhere rather than presented against it.",
      },
      {
        id: "me05-037",
        expectName: "Lampent",
        label: "Eight years on",
        basis: "editorial",
        note: "An editorial pick: an ordinary card from the current era, showing the instinct has not changed with the format.",
      },
    ],

    sources: [
      {
        id: "vangogh-museum",
        label: "Pokémon x Van Gogh Museum",
        publisher: "Van Gogh Museum",
        url: "https://www.vangoghmuseum.nl/en/about/collaborate/van-gogh-museum-brand-licenses/a-z/pokemon-x-van-gogh-museum",
      },
      {
        id: "bulbapedia-sowsow",
        label: "sowsow",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Sowsow",
      },
      {
        id: "bleedingcool-sowsow",
        label: "Artist Spotlight: sowsow",
        publisher: "Bleeding Cool",
        url: "https://bleedingcool.com/games/pokemon-trading-card-game-artist-spotlight-sowsow/",
      },
      {
        id: "sowsow-site",
        label: "sowsow koubou",
        publisher: "Artist's website",
        url: "https://www.sowsowkoubou.com/",
      },
      {
        id: "artofpkm-sowsow",
        label: "sowsow",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/33",
      },
    ],
  },

  // ── sui ─────────────────────────────────────────────────────────────────────
  // The previous ARTIST_FACTS entry claimed "over 200 Pokémon cards"; sources
  // disagree depending on how reprints and Japanese-only printings are counted,
  // so no total is stated here.
  // Catalog note: three of the four names in ARTIST_META.topCardNames for this
  // artist — Absol, Flygon and Gardevoir — do not resolve under artist_id 'sui'.
  // topCardNames is inert for any artist with an editorial entry and is left
  // unchanged; the finding is recorded rather than acted on.
  "sui": {
    identityLine: "Pokémon TCG illustrations since 2009 · Debuted in the Arceus expansion",

    tags: "Airbrush · Light and Motion · Fantasy Habitats",

    thesis:
      "sui works digitally in an airbrush register, at high saturation, with light doing most of the composing — and a stated preference for images that look like they are already moving.",

    introduction: [
      "sui — 彗 — is a freelance digital illustrator whose Pokémon card work begins in the Arceus expansion in 2009 and has continued steadily since. Alongside Pokémon she illustrates for other trading card games, browser games, magazines and CD covers, which is unusual in this roster and shows in the work: the visual habits are those of someone painting for many contexts.",
      "The method is documented. She works with a graphics tablet and image-editing software in an airbrush style, using areas of high saturation and luminosity, and light is emphasised in almost all of her original work. Her subjects are fantasy scenes and animals, and her environments reliably include both nature and living things. She has said she particularly likes making images that carry a sense of motion.",
    ],

    notes: [
      {
        id: "method",
        title: "Airbrush, saturation, light",
        body:
          "Digital, tablet-drawn, airbrushed: colour laid in soft gradients rather than marks, then pushed to high saturation, with the light source treated as a compositional element rather than a finishing touch. This is why sui cards tend to read from across a table — the value structure is doing the work before you can see any detail — and why they hold up at small print sizes.",
      },
      {
        id: "motion",
        title: "The preference for movement",
        body:
          "Among her stated interests is producing images with a sense of motion, and it is the most reliable thing to look for when identifying her work. Wings mid-beat, water displaced, a body caught between two positions. Even her still compositions are usually arranged so that something has just happened or is about to.",
      },
      {
        id: "range",
        title: "Across eras and industries",
        body:
          "Her Pokémon work runs from the Platinum era to the present, at a volume large enough that sources disagree on the total depending on how reprints and Japanese-only printings are counted. In parallel she has worked in other trading card games, browser-game character design, magazine illustration and CD jacket art. She lists animals and games among her own interests, which is legible in the choice of subject across all of it.",
      },
    ],

    notableCards: [
      {
        id: "pl4-55",
        expectName: "Buneary",
        label: "Debut expansion",
        basis: "documented",
        note: "From Arceus, the expansion in which her Pokémon card work first appeared — among the first group of sui cards to reach print.",
        sourceId: "bulbapedia-sui",
      },
      {
        id: "xy9-37",
        expectName: "Swanna",
        label: "A sense of movement",
        basis: "editorial",
        note: "An editorial pick for the quality she has named as a preference of her own: a bird caught mid-air rather than posed.",
      },
      {
        id: "swsh7-38",
        expectName: "Milotic",
        label: "Light as subject",
        basis: "editorial",
        note: "An editorial pick: saturation and luminosity carrying the whole illustration.",
      },
      {
        id: "swsh6-168",
        expectName: "Galarian Rapidash V",
        label: "Motion at full-art scale",
        basis: "editorial",
        note: "An editorial pick: the airbrush handling given the entire card, with the light source doing the composing.",
      },
      {
        id: "sv08.5-155",
        expectName: "Espeon ex",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick from the current expanded-canvas format.",
      },
      {
        id: "me02.5-242",
        expectName: "Carbink",
        label: "Contemporary range",
        basis: "editorial",
        note: "An editorial pick from recent work, over fifteen years after the Arceus expansion.",
      },
    ],

    sources: [
      {
        id: "bulbapedia-sui",
        label: "sui",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Sui",
      },
      {
        id: "artofpkm-sui",
        label: "sui",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/121",
      },
      {
        id: "serebii-sui",
        label: "Cards illustrated by sui",
        publisher: "Serebii",
        url: "https://www.serebii.net/card/dex/artist/sui.shtml",
      },
    ],
  },

  // ── Shibuzoh. ───────────────────────────────────────────────────────────────
  // Editorial key toSlug("Shibuzoh.") = "shibuzoh"; artistId is also "shibuzoh".
  // Written without pronouns: Bulbapedia's own pages are internally
  // inconsistent. The previous claims that the period "has never been publicly
  // explained" (an unsupported negative) and that Shibuzoh. "keeps an extremely
  // low public profile" (contradicted by an active public site) are removed.
  // The Crown Zenith Hisuian Samurott VSTAR is absent from Notable Works
  // because it carries no image in the catalog.
  "shibuzoh": {
    identityLine: "First card: Clefairy, Generations · Working with the Pokémon TCG since 2016",

    tags: "Character Warmth · Detail at Small Scale · Since 2016",

    thesis:
      "The period at the end of the name is part of the credit, on every card, for a decade. Nobody has explained it, and Shibuzoh. has never needed to — the work is identifiable without it.",

    introduction: [
      "Shibuzoh. — the period belongs to the name and appears in every card credit — entered the Pokémon Trading Card Game with Clefairy in Generations in 2016, and has illustrated steadily through the Sun & Moon, Sword & Shield and Scarlet & Violet eras since, along with a substantial run of cards in Pokémon Trading Card Game Pocket.",
      "The work is not restricted to the card game. Shibuzoh. has confirmed illustrating Pikachu and Morpeko artwork for Pokémon TCG merchandise, and involvement with Pokémon HOME. An active website and public accounts sit alongside all of it.",
    ],

    notes: [
      {
        id: "reading",
        title: "Reading a Shibuzoh. card",
        body:
          "No account of the working method has been published, so what follows is our reading rather than a statement of process. What holds across a decade is attention to expression and to the small incidental detail at the edge of the frame — the thing you find on the second look. The compositions are legible at thumbnail size and reward being seen at full size, which is a harder combination than it sounds.",
      },
      {
        id: "beyond",
        title: "Beyond the cards",
        body:
          "Shibuzoh. has confirmed illustrating Pikachu and Morpeko artwork for Pokémon TCG merchandise, and involvement with Pokémon HOME. Both come from Shibuzoh.'s own posts rather than from a published credit list, and are described here on that basis.",
      },
    ],

    notableCards: [
      {
        id: "g1-50",
        expectName: "Clefairy",
        label: "First card",
        basis: "documented",
        note: "The first Shibuzoh. card, and the earliest printing held in this archive.",
        sourceId: "bulbapedia-shibuzoh",
      },
      {
        id: "sm12-226",
        expectName: "Mega Lopunny & Jigglypuff GX",
        label: "Two-Pokémon staging",
        basis: "editorial",
        note: "An editorial pick: two characters sharing one full-art frame without either losing its own expression.",
      },
      {
        id: "swsh6-177",
        expectName: "Galarian Moltres V",
        label: "Collector favourite",
        basis: "editorial",
        note: "An editorial pick. No sourcing claim is attached to it.",
      },
      {
        id: "sv02-227",
        expectName: "Flamigo",
        label: "Expanded canvas",
        basis: "editorial",
        note: "An editorial pick: the small incidental detail at the edge of the frame, finally given room.",
      },
    ],

    sources: [
      {
        id: "bulbapedia-shibuzoh",
        label: "Shibuzoh.",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Shibuzoh.",
      },
      {
        id: "shibuzoh-site",
        label: "shibuzoh.com",
        publisher: "Artist's website",
        url: "https://shibuzoh.com",
      },
      {
        id: "artofpkm-shibuzoh",
        label: "Shibuzoh.",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/144",
      },
      {
        id: "serebii-shibuzoh",
        label: "Cards illustrated by Shibuzoh.",
        publisher: "Serebii",
        url: "https://www.serebii.net/card/dex/artist/shibuzoh..shtml",
      },
    ],
  },

  // ── Yukiko Baba ─────────────────────────────────────────────────────────────
  // "A printmaker by training" corrected to the sourced wording, "a printmaker
  // and illustrator". The muted-greens-and-purples palette claim is reframed as
  // an observation about the cards rather than a statement she has made.
  // Her documented first cards (Weepinbell and Tauros, JP Expansion Sheet
  // Series 3) are not in this catalog and therefore cannot be notable cards.
  // Expedition carries two Baba Gengar printings; ecard1-13 is the approved
  // selection and ecard1-48 must not be substituted for it.
  "yukiko-baba": {
    identityLine: "A printmaker and illustrator · Pokémon TCG illustrations since 1998",

    tags: "Printmaker · Planned Composition · Since 1998",

    thesis:
      "Baba came to the cards from printmaking, a discipline in which you commit to each layer before you can see the result. Decades of card illustrations later, the compositions still look decided rather than discovered.",

    introduction: [
      "Yukiko Baba is a printmaker and illustrator who has been making Pokémon card illustrations since 1998, which places her among the longest-serving contributors to the game. Her first cards — Weepinbell and Tauros — appeared in the Japanese Expansion Sheet Series 3; the first of her illustrations to be released in English was a Kakuna in Neo Discovery.",
      "The body of work is large and mostly quiet: commons, uncommons and rares across every era from the Neo period to the present, with a single expanded-canvas illustration at the recent end.",
    ],

    notes: [
      {
        id: "printmaker",
        title: "A printmaker's habits",
        body:
          "The training is the one biographical fact the sources support, and it is worth taking seriously as a way of looking. Printmaking requires the whole image to be planned in separable layers, because you cannot undo a cut block, and Baba's cards tend to resolve into a clear foreground, subject and ground rather than a continuous painted field. That is our reading of the work rather than a method she has described.",
      },
      {
        id: "span",
        title: "A long run",
        body:
          "First cards in the Japanese vending-sheet era, first English release in Neo Discovery, still illustrating now. Her modern work is often described as settling into muted greens and purples; that is an observation about the cards, not something she has said, and it is worth checking against the run yourself rather than taking on trust.",
      },
    ],

    notableCards: [
      {
        id: "neo2-41",
        expectName: "Kakuna",
        label: "First English release",
        basis: "documented",
        note: "Her first illustration to be released in English, and the earliest Baba printing held here.",
        sourceId: "bulbapedia-baba",
      },
      {
        id: "ecard1-13",
        expectName: "Gengar",
        label: "Signature composition",
        basis: "editorial",
        note: "An editorial pick from the e-Card era. Expedition carries two separate Baba Gengar illustrations; this is the one at the earlier position in the set.",
      },
      {
        id: "pl3-18",
        expectName: "Camerupt",
        label: "Mid-career",
        basis: "editorial",
        note: "An editorial pick from the middle of a twenty-five-year run.",
      },
      {
        id: "sv10.5b-115",
        expectName: "Eelektross",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick: her expanded-canvas work, decades after the first card.",
      },
    ],

    sources: [
      {
        id: "artofpkm-baba",
        label: "Yukiko Baba",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/55",
      },
      {
        id: "bulbapedia-baba",
        label: "Yukiko Baba",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Yukiko_Baba",
      },
    ],
  },

  // ── Kouki Saitou ────────────────────────────────────────────────────────────
  // Held at compact coverage pending a process source.
  // The Delibird cross-reference is prose only. That card is Komiya's; a
  // negative probe against the catalog confirmed it does not sit under this
  // artist_id, and it must never appear in this notableCards array.
  "kouki-saitou": {
    identityLine: "Pokémon TCG illustrations since 2002",

    tags: "Pokémon in Habitat · Long Run · Pokémon Center Artwork",

    thesis:
      "Saitou has been putting Pokémon into places they plausibly live for over twenty years, across one of the largest bodies of card art in the game.",

    introduction: [
      "Kouki Saitou has illustrated for the Pokémon Trading Card Game since 2002. The stated intent of the work is to convey the liveliness and appeal of Pokémon across a range of habitats, and the output is enormous — the largest single-illustrator run tracked in this archive. His Pokémon work extends beyond the cards to artwork for Pokémon Center products.",
      "He also appears in the archive from the other side. In an official illustrator column, Saitou named Tomokazu Komiya's Neo Revelation Delibird as his own favourite of Komiya's card illustrations — a small piece of evidence that the illustrators are looking at each other's cards as closely as collectors are.",
    ],

    notes: [
      {
        id: "habitat",
        title: "Habitat first",
        body:
          "The practical consequence for a collector is that Saitou cards reward attention to setting. The Pokémon is usually placed rather than presented: water depth, night light, snow, undergrowth. Sorting his run by environment rather than by set turns out to be a more revealing way through it than chronology.",
      },
      {
        id: "scale",
        title: "Scale and reach",
        body:
          "Illustrating since 2002 and still working, across every era this archive covers. His Pokémon work also covers artwork for products sold at the Pokémon Center. The Delibird he singled out is Komiya's card, not his — it is listed on Komiya's page, and it is worth seeing the two artists' work side by side.",
      },
    ],

    notableCards: [
      {
        id: "ecard2-26",
        expectName: "Octillery",
        label: "Early foundation",
        basis: "editorial",
        note: "An editorial pick from the early card work. His TCG illustrations are documented from 2002; the choice of printing is ours.",
      },
      {
        id: "dp3-23",
        expectName: "Banette",
        label: "Character and place",
        basis: "editorial",
        note: "An editorial pick: the Pokémon placed in a setting rather than presented in front of one.",
      },
      {
        id: "bw2-30",
        expectName: "Beartic",
        label: "Habitat",
        basis: "editorial",
        note: "An editorial pick: cold, weather and ground, which is the register he returns to most.",
      },
      {
        id: "sv02-256",
        expectName: "Meowscarada ex",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick: the same habitat instinct on the fullest canvas the format offers.",
      },
    ],

    sources: [
      {
        id: "artofpkm-saitou",
        label: "Kouki Saitou",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/14",
      },
      {
        id: "official-conversation",
        label: "Illustrator column: Tomokazu Komiya",
        publisher: "Pokémon TCG official championship site",
        url: "https://www.ptcgic-cr.com/2024/en/column/article-6/",
      },
    ],
  },

  // ── Masakazu Fukuda ─────────────────────────────────────────────────────────
  // Editorial key toSlug("Masakazu Fukuda") = "masakazu-fukuda"; artistId is
  // "fukuda". Both are correct — do not conflate them.
  // Catalog note: two 2011 cards are credited "Mosakazu Fukuda", a catalog
  // spelling variant rather than a second artist. Both carry artist_id 'fukuda'
  // and are reached correctly. The previously configured "Masayuki Fukuda"
  // alias returned no hits at all and has been replaced.
  "masakazu-fukuda": {
    identityLine: "Pokémon TCG illustrations since 2004 · Eleven years in games before going freelance",

    tags: "Character Design Background · Since 2004 · Trading Card Veteran",

    thesis:
      "Fukuda spent eleven years responsible for character design and main graphics at a game company before going freelance. The card work has the discipline of someone who used to be accountable for a whole game's look.",

    introduction: [
      "Masakazu Fukuda was in charge of character design and main graphics at a game production company for eleven years before beginning freelance work. His Pokémon card illustrations date from 2004, and he also works as an illustrator for other trading card games and on character design for social games.",
      "The Pokémon run is one of the largest here and spans every era from the EX series to the present, with a noticeable share of human trainer artwork alongside the Pokémon.",
    ],

    notes: [
      {
        id: "discipline",
        title: "From house style to freelance",
        body:
          "Owning a game's main graphics for over a decade tends to produce two habits: consistency, and a subject that reads clearly at any size. Both are visible across this run, and they are most obvious on the trainer cards, where a character-design background has somewhere specific to go. This is our reading of the work rather than a method he has described.",
      },
    ],

    notableCards: [
      {
        id: "dp3-81",
        expectName: "Carvanha",
        label: "Early foundation",
        basis: "editorial",
        note: "An editorial pick from the early card work. His TCG illustrations are documented from 2004; the choice of printing is ours.",
      },
      {
        id: "bw1-31",
        expectName: "Samurott",
        label: "Main graphics discipline",
        basis: "editorial",
        note: "An editorial pick: a starter's final evolution, the kind of subject his years owning a game's main graphics prepared him for.",
      },
      {
        id: "sm3-143",
        expectName: "Guzma",
        label: "Human character art",
        basis: "editorial",
        note: "An editorial pick: a trainer card, where a character-design background shows most clearly.",
      },
      {
        id: "sv05-031",
        expectName: "Heatmor",
        label: "Still working",
        basis: "editorial",
        note: "An editorial pick from the current era.",
      },
    ],

    sources: [
      {
        id: "artofpkm-fukuda",
        label: "Masakazu Fukuda",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/13",
      },
      {
        id: "bulbapedia-fukuda",
        label: "Masakazu Fukuda",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Masakazu_Fukuda",
      },
    ],
  },

  // ── Mizue ───────────────────────────────────────────────────────────────────
  "mizue": {
    identityLine: "Pokémon TCG illustrations since 2011 · Serialised comics since 2013",

    tags: "Cartoonist · Comics Serialisation · Since 2011",

    thesis:
      "Mizue is a working cartoonist as well as a card illustrator, and the card compositions carry a comics instinct: one clear beat, staged for immediate reading.",

    introduction: [
      "Mizue is a cartoonist and illustrator who began working freelance after a period as a designer at a game production company. Her Pokémon card illustrations date from 2011, and her comics have been serialised in a comic magazine since 2013.",
      "The card run spans the Black & White era to the present. The earliest printing held here is from 2011, which matches the documented start year exactly.",
    ],

    notes: [
      {
        id: "staging",
        title: "A cartoonist's staging",
        body:
          "A comics practice tends to prioritise the legibility of an action and an expression over surface finish, because a panel has to be read in a second. That is what these cards do: one clear beat per illustration, and faces that carry the whole mood. On the cards with several Pokémon in frame, each one is given its own reaction rather than filling space. This is our reading of the work rather than a method she has described.",
      },
    ],

    notableCards: [
      {
        id: "col1-26",
        expectName: "Granbull",
        label: "Early foundation",
        basis: "editorial",
        note: "An editorial pick from the start of the card work, which is documented from 2011.",
      },
      {
        id: "swsh4-47",
        expectName: "Jolteon",
        label: "One clear beat",
        basis: "editorial",
        note: "An editorial pick: a single legible action, staged the way a comics panel would stage it.",
      },
      {
        id: "sv02-226",
        expectName: "Maushold",
        label: "A cast, not a subject",
        basis: "editorial",
        note: "An editorial pick: a whole family in one frame, each member given its own expression.",
      },
      {
        id: "sv10.5b-117",
        expectName: "Musharna",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick from her recent expanded-canvas work.",
      },
    ],

    sources: [
      {
        id: "artofpkm-mizue",
        label: "Mizue",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/169",
      },
    ],
  },

  // ── AKIRA EGAWA ─────────────────────────────────────────────────────────────
  // Catalog note: one 2023 card is credited "Akira Egawa" rather than
  // "AKIRA EGAWA". Both carry artist_id 'akira-egawa'.
  "akira-egawa": {
    identityLine: "Official Pokémon TCG illustrator since 2019 · Previously a 3D modeler",

    tags: "3D Modelling Background · Since 2019 · Games, Books, Exhibitions",

    thesis:
      "Egawa came to the cards from 3D modelling and says she draws on that experience directly — a specific thing to bring to a flat illustration, and it shows in how her forms sit in space.",

    introduction: [
      "AKIRA EGAWA has been an official Pokémon Trading Card Game illustrator since 2019, and describes her illustration work as drawing on her earlier experience as a 3D modeler. Alongside the cards she works across games, books, exhibitions and product development.",
      "She has described her practice as an open-ended enquiry into a single question — what makes something cool — and has been playing the games since Gold, Silver and Crystal.",
    ],

    notes: [
      {
        id: "form",
        title: "A modeler's eye",
        body:
          "Her run reads as a sequence of increasingly large canvases given to the same problem: how a body occupies space. Volume, weight, the way a limb turns away from the viewer. It is most visible on the V, VMAX and ex cards, where there is room for a form to have a back as well as a front. The 3D modelling background is documented; this reading of what it produces on the cards is ours.",
      },
    ],

    notableCards: [
      {
        id: "sm11-116",
        expectName: "Riolu",
        label: "Early foundation",
        basis: "editorial",
        note: "An editorial pick from her first year. Her status as an official illustrator is documented from 2019; the choice of printing is ours.",
      },
      {
        id: "swsh3.5-27",
        expectName: "Lucario V",
        label: "Form in space",
        basis: "editorial",
        note: "An editorial pick: a full-art body given real volume, which is where a 3D-modelling background shows.",
      },
      {
        id: "swsh8-40",
        expectName: "Chandelure VMAX",
        label: "Scale and mass",
        basis: "editorial",
        note: "An editorial pick: the largest format of its era, used for weight rather than decoration.",
      },
      {
        id: "me01-181",
        expectName: "Mega Latias ex",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick: the fullest canvas currently available, and the clearest view of how she builds a form.",
      },
    ],

    sources: [
      {
        id: "artofpkm-egawa",
        label: "AKIRA EGAWA",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/62",
      },
    ],
  },

  // ── 0313 ────────────────────────────────────────────────────────────────────
  // Editorial key toSlug("0313") = "0313"; artistId is also "0313".
  // The documented first card (Lampent, Guardians Rising, sm2-12) was validated
  // separately from the main catalog discovery pass and anchors the notable set.
  "0313": {
    identityLine: "First card: Lampent, Guardians Rising · Kyushu-based freelance illustrator",

    tags: "Vector and Photoshop · Kyushu-based · Since 2017",

    thesis:
      "0313 builds cards in Photoshop and Illustrator — a vector-inflected toolset that is rare in this roster and gives the work a hard, deliberate edge.",

    introduction: [
      "0313 — read Zero San Ichi San — is a freelance illustrator based in Kyushu whose first Pokémon card was a Lampent in Guardians Rising, in 2017. The illustrations are made in Adobe Photoshop and Illustrator.",
      "The Pokémon work is not confined to the cards: 0313 has also illustrated for a Pokémon Center original-goods line.",
    ],

    notes: [
      {
        id: "toolset",
        title: "Photoshop and Illustrator",
        body:
          "A vector-capable toolset does specific things at card scale: clean edge definition, flat controlled colour areas, and shapes that survive being printed at thumbnail size. That is what to look for across this run, and it is why the illustration rares read as graphic rather than painterly. The toolset is documented; this account of what it produces is ours.",
      },
    ],

    notableCards: [
      {
        id: "sm2-12",
        expectName: "Lampent",
        label: "First card",
        basis: "documented",
        note: "The first Pokémon card credited to 0313, released in Guardians Rising.",
        sourceId: "bulbapedia-0313",
      },
      {
        id: "swsh4.5-12",
        expectName: "Thwackey",
        label: "Clean edge",
        basis: "editorial",
        note: "An editorial pick: flat, controlled colour areas and hard shape definition, which is what a vector-capable toolset gives at card scale.",
      },
      {
        id: "sv04-201",
        expectName: "Minior",
        label: "Shape at illustration-rare scale",
        basis: "editorial",
        note: "An editorial pick: the same graphic discipline with the whole card to work in.",
      },
      {
        id: "me01-146",
        expectName: "Marshadow",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick from recent work.",
      },
    ],

    sources: [
      {
        id: "bulbapedia-0313",
        label: "0313",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/0313",
      },
      {
        id: "pokewiki-0313",
        label: "0313",
        publisher: "Pokémon Wiki (Japanese)",
        url: "https://wiki.pokemonwiki.com/wiki/0313",
      },
      {
        id: "artofpkm-0313",
        label: "0313",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/501",
      },
    ],
  },

  // ── Saya Tsuruta ────────────────────────────────────────────────────────────
  // Curated fallback: no published biography meets the standard used here.
  // No process description, no invented biography, no quotation.
  // The ideographic-space alias "Saya<U+3000>Tsuruta" is a real catalog credit
  // string and is preserved in ARTISTS.
  "saya-tsuruta": {
    identityLine: "Illustrating Pokémon cards since the Diamond & Pearl era",

    tags: "Long Run · Mostly Everyday Cards",

    introduction: [
      "Public biographical information about Saya Tsuruta is limited. What the archive shows is a long, steady, unshowy run: cards in every era from Diamond & Pearl to the present, overwhelmingly commons and uncommons, with occasional full-art and illustration-rare work in the recent formats. The credit itself appears in two spellings across the catalog, which is a printing-history artefact rather than a second artist.",
    ],

    notableCards: [
      {
        id: "dp3-92",
        expectName: "Lotad",
        label: "Earliest held here",
        basis: "editorial",
        note: "An editorial pick: the earliest Saya Tsuruta printing in this archive.",
      },
      {
        id: "swsh6-183",
        expectName: "Blissey V",
        label: "Full-art work",
        basis: "editorial",
        note: "An editorial pick from the full-art formats.",
      },
      {
        id: "sv02-229",
        expectName: "Dudunsparce",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick from her expanded-canvas work.",
      },
    ],

    sources: [
      {
        id: "artofpkm-tsuruta",
        label: "Saya Tsuruta",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/19",
      },
    ],
  },

  // ── OKACHEKE ────────────────────────────────────────────────────────────────
  // Curated fallback: no published biography meets the standard used here.
  "okacheke": {
    identityLine: "Illustrating Pokémon cards since the Sword & Shield era",

    tags: "Since 2021 · Weighted Toward Expanded Canvases",

    introduction: [
      "This research pass did not locate a reliable public biography for OKACHEKE. What the archive shows is a run beginning in the Sword & Shield era with a noticeable concentration of illustration rares and special illustration rares.",
    ],

    notableCards: [
      {
        id: "swsh6-127",
        expectName: "Skwovet",
        label: "Earliest held here",
        basis: "editorial",
        note: "An editorial pick: the earliest OKACHEKE printing in this archive.",
      },
      {
        id: "sv03.5-179",
        expectName: "Mr. Mime",
        label: "Expanded canvas",
        basis: "editorial",
        note: "An editorial pick from the illustration-rare format.",
      },
      {
        id: "sv08-239",
        expectName: "Latias ex",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick from recent work on the fullest available canvas.",
      },
    ],

    sources: [
      {
        id: "artofpkm-okacheke",
        label: "OKACHEKE",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/45",
      },
    ],
  },

  // ── GOSSAN ──────────────────────────────────────────────────────────────────
  // Curated fallback: no published biography meets the standard used here.
  // The catalog's earliest GOSSAN printing carries no image, so the first
  // notable card is labelled "Earliest held here" rather than "first".
  "gossan": {
    identityLine: "Illustrating Pokémon cards since the Sword & Shield era",

    tags: "Since 2022 · Pokémon and Trainers",

    introduction: [
      "This research pass did not locate a reliable public biography for GOSSAN. What the archive shows is a run beginning in the late Sword & Shield era and clustering heavily in Scarlet & Violet, with a substantial line of trainer and character artwork alongside the Pokémon.",
    ],

    notableCards: [
      {
        id: "sv01-096",
        expectName: "Klefki",
        label: "Earliest held here",
        basis: "editorial",
        note: "An editorial pick: the earliest image-backed GOSSAN printing in this archive.",
      },
      {
        id: "sv08.5-138",
        expectName: "Giacomo",
        label: "Human character art",
        basis: "editorial",
        note: "An editorial pick: a trainer card, a register a good part of this catalog sits in.",
      },
      {
        id: "sv10.5b-128",
        expectName: "Throh",
        label: "Expanded canvas",
        basis: "editorial",
        note: "An editorial pick from the illustration-rare format.",
      },
    ],

    sources: [
      {
        id: "artofpkm-gossan",
        label: "GOSSAN",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/47",
      },
    ],
  },

  // ── Tetsu Kayama ────────────────────────────────────────────────────────────
  // Editorial key toSlug("Tetsu Kayama") = "tetsu-kayama"; artistId is "kayama".
  // Both are correct — do not conflate them.
  // Sources disagree on which set marks the debut: Bulbapedia records the
  // illustration-rare Machoke from 151, Serebii dates the start to Obsidian
  // Flames. Both are 2023. The disagreement is stated, not resolved.
  // 香山哲 is also the name of a published Japanese comics author. That identity
  // has NOT been verified and must not be asserted here.
  "tetsu-kayama": {
    identityLine: "First card: Machoke, 151",

    tags: "Since 2023 · Expanded-Canvas Heavy",

    introduction: [
      "Tetsu Kayama's Pokémon card work begins in 2023. The catalog is small and unusually weighted toward the expanded formats: a large proportion of a short run are illustration rares and special illustration rares. Sources disagree on which set marks the debut, though not on the first card itself.",
    ],

    notableCards: [
      {
        id: "sv03.5-177",
        expectName: "Machoke",
        label: "First card",
        basis: "documented",
        note: "Recorded as his first card. Sources disagree on which set marks the debut; the card itself is not disputed.",
        sourceId: "bulbapedia-kayama",
      },
      {
        id: "sv04-184",
        expectName: "Dottler",
        label: "Expanded canvas",
        basis: "editorial",
        note: "An editorial pick from the illustration-rare format.",
      },
      {
        id: "sv08.5-159",
        expectName: "Sandy Shocks ex",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick from recent work.",
      },
    ],

    sources: [
      {
        id: "bulbapedia-kayama",
        label: "Tetsu Kayama",
        publisher: "Bulbapedia",
        url: "https://bulbapedia.bulbagarden.net/wiki/Tetsu_Kayama",
      },
      {
        id: "serebii-kayama",
        label: "Cards illustrated by Tetsu Kayama",
        publisher: "Serebii",
        url: "https://www.serebii.net/card/dex/artist/tetsukayama.shtml",
      },
    ],
  },

  // ── Gapao ───────────────────────────────────────────────────────────────────
  // Curated fallback: no published biography meets the standard used here.
  // Smallest run in the tracked roster.
  "gapao": {
    identityLine: "Illustrating Pokémon cards since the Scarlet & Violet era",

    tags: "Since 2024 · Short Run",

    introduction: [
      "This research pass did not locate a reliable public biography for Gapao. The archive shows a short, recent run beginning in the Scarlet & Violet era, with several illustration rares among the cards held here.",
    ],

    notableCards: [
      {
        id: "sv05-009",
        expectName: "Roserade",
        label: "Earliest held here",
        basis: "editorial",
        note: "An editorial pick: the earliest Gapao printing in this archive.",
      },
      {
        id: "sv08-214",
        expectName: "Braviary",
        label: "Expanded canvas",
        basis: "editorial",
        note: "An editorial pick from the illustration-rare format.",
      },
      {
        id: "sv10.5w-141",
        expectName: "Garbodor",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick from recent work.",
      },
    ],

    sources: [
      {
        id: "artofpkm-gapao",
        label: "Gapao",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/34",
      },
    ],
  },

  // ── OKUBO ───────────────────────────────────────────────────────────────────
  // Curated fallback: the thinnest source picture of the seventeen.
  "okubo": {
    identityLine: "Illustrating Pokémon cards since the Scarlet & Violet era",

    tags: "Since 2023 · Pokémon and Trainers",

    introduction: [
      "This research pass did not locate a reliable public biography for OKUBO. What the archive shows is a run beginning in the Scarlet & Violet era, split between ordinary cards and expanded illustration formats, including trainer artwork.",
    ],

    notableCards: [
      {
        id: "sv04.5-044",
        expectName: "Gimmighoul",
        label: "Earliest held here",
        basis: "editorial",
        note: "An editorial pick from the early card work.",
      },
      {
        id: "sv05-176",
        expectName: "Arbok",
        label: "Expanded canvas",
        basis: "editorial",
        note: "An editorial pick from the illustration-rare format.",
      },
      {
        id: "me02.5-293",
        expectName: "Surfer",
        label: "Modern showcase",
        basis: "editorial",
        note: "An editorial pick: a trainer card on the fullest canvas the format offers.",
      },
    ],

    sources: [
      {
        id: "artofpkm-okubo",
        label: "OKUBO",
        publisher: "The Art of Pokémon",
        url: "https://www.artofpkm.com/illustrators/63",
      },
    ],
  },
};

export { ARTIST_EDITORIAL };

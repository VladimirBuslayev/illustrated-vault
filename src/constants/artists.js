// src/constants/artists.js
// Artist roster, per-artist facts, and per-artist page metadata.
// Source: index.legacy.html lines 106-212.
// ARTIST_FACTS keys are display names ("Yuka Morii").
// ARTIST_META  keys are slugs        ("yuka-morii").
//
// Gate 3D: artistId added to each ARTISTS entry.
// artistId is the Supabase artists.id slug confirmed in Gate 3B/3C.
// cardService.fetchArtistCards uses artistId for FK-based queries when present.
// aliases are retained as fallback metadata and for the ILIKE path on entries without artistId.

const ARTISTS=[
  {name:"Yuka Morii",      artistId:"yuka-morii",      tier:"main",      isSet:false},
  {name:"Asako Ito",       artistId:"asako-ito",        tier:"main",      isSet:false},
  {name:"Tomokazu Komiya", artistId:"tomokazu-komiya",  tier:"main",      isSet:false},
  {name:"Shinji Kanda",    artistId:"shinji-kanda",     tier:"main",      isSet:false},
  {name:"Atsuko Nishida",  artistId:"atsuko-nishida",   tier:"main",      isSet:false},
  {name:"Sowsow",          artistId:"sowsow",            tier:"main",      isSet:false},
  {name:"Shibuzoh.",       artistId:"shibuzoh",          tier:"main",      isSet:false, aliases:["Shibuzoh"]},
  {name:"Yukiko Baba",     artistId:"yukiko-baba",       tier:"main",      isSet:false},
  {name:"sui",             artistId:"sui",               tier:"main",      isSet:false},
  {name:"AKIRA EGAWA",     artistId:"akira-egawa",       tier:"secondary", isSet:false, aliases:["Akira Egawa"]},
  {name:"Kouki Saitou",    artistId:"kouki-saitou",      tier:"secondary", isSet:false},
  {name:"Saya Tsuruta",    artistId:"saya-tsuruta",      tier:"secondary", isSet:false, aliases:["Saya　Tsuruta"]},
  {name:"OKACHEKE",        artistId:"okacheke",           tier:"secondary", isSet:false},
  {name:"0313",            artistId:"0313",               tier:"secondary", isSet:false},
  {name:"GOSSAN",          artistId:"gossan",             tier:"secondary", isSet:false},
  {name:"Mizue",           artistId:"mizue",              tier:"secondary", isSet:false},
  {name:"Tetsu Kayama",    artistId:"kayama",             tier:"secondary", isSet:false},
  {name:"Gapao",           artistId:"gapao",              tier:"secondary", isSet:false},
  {name:"OKUBO",           artistId:"okubo",              tier:"secondary", isSet:false},
  {name:"Masakazu Fukuda", artistId:"fukuda",             tier:"secondary", isSet:false, aliases:["Mosakazu Fukuda"]},
];

const ARTIST_FACTS={
  "Yuka Morii":{
    since:"Working with the Pokémon TCG since 2000",
    fact:"She works in physical media: the Pokémon are modelled by hand in resin clay, hardened with heat, then staged and photographed for the card.",
    story:"Yuka Morii is one of the Pokémon TCG's defining physical-media artists, specialising in hand-built resin-clay models. Her card work began around 2000 with the Neo Discovery expansion and has continued since. The material is resin clay hardened by baking, with colour-mixing, sculpting and heating repeated by hand until the model is complete; the finished figure is then staged and photographed, sometimes against a built miniature set and sometimes against a real location. She studied at the Kuwasawa Design School and went on to graduate study at Tokyo Zokei University. At the time of a 2023 Kuwasawa exhibition of twenty of her Pokémon models, she was also teaching there part-time. Beyond the cards she works on character design, product design and books.",
  },
  "Asako Ito":{
    since:"Working with the Pokémon TCG since 2017",
    fact:"Her Pokémon are crocheted amigurumi, and she builds the background sets by hand too. She majored in oil painting and taught herself to crochet after seeing the teddy bear from Mr. Bean.",
    story:"Asako Ito majored in oil painting at university and taught herself amigurumi alongside it, after seeing the teddy bear from Mr. Bean and wanting to make one for herself. She joined the Pokémon TCG in 2017, her first released card being Poliwag in the Sun & Moon expansion. She works without a written crochet pattern, holding the construction in her head and repeating a cycle of knitting and unravelling until the form is right. The figure is only half the card: she studies each Pokémon's shape, character and habitat, then builds the background set herself from yarn, felt and paper, so that the creature reads as living inside the world of the card.",
  },
  "Tomokazu Komiya":{
    since:"Working with the Pokémon TCG since 1996",
    fact:"He mainly works in acrylic gouache, adding pencils, coloured pencils, ballpoint pens and markers to create the loose line, strong blacks and distorted forms that make his cards instantly recognisable.",
    story:"Tomokazu Komiya trained at the Toyo Institute of Art and Design and began working with the Pokémon TCG in 1996. One of his earliest released card illustrations was a Weedle issued only in Japan in 1998, and he has remained a freelance illustrator throughout. His loosely coloured, deliberately distorted work is often described in relation to Primitivism, but the materials are concrete and physical: acrylic gouache supported by pencils, coloured pencils, ballpoint pens and markers. Komiya has identified Ledyba from Neo Destiny as his own favourite card illustration, while fellow illustrator Kouki Saitou has singled out Delibird from Neo Revelation.",
  },
  "Shinji Kanda":{
    since:"First card: Magmar, Brilliant Stars",
    fact:"For his first card he coloured on a sheet of plastic with coloured pencils and then applied heat, shrinking the sheet so the colour concentrated. His work is otherwise primarily digital.",
    story:"Shinji Kanda was born in 1986 in Kyoto Prefecture and entered the Pokémon TCG with Magmar in Brilliant Stars. His work is primarily digital, but the exceptions are what he is known for: the plastic sheet coloured with pencils and heat-shrunk for that first card, and a promo Magneton whose artwork was built from crumpled aluminium foil, flattened and scanned. Neither is a method he returns to. Asked by the official site about his Galarian Moltres Art Rare, he described working from the brief of an evil flame bleeding into a clear sky, and said he wanted an illustration that unsettles the person looking at it.",
  },
  "Atsuko Nishida":{
    since:"Created Pikachu at GAME FREAK · Pokémon TCG illustrations since 1997",
    fact:"She created Pikachu before she ever illustrated a card; the design was finalised by Ken Sugimori. Her own card work begins in 1997.",
    story:"Atsuko Nishida isn't primarily a card illustrator — she is a character designer. She worked as a designer at a game company before joining GAME FREAK, where she was on Pulseman alongside art director Ken Sugimori before being brought onto the first Pokémon games. She created Pikachu, with the design finalised by Sugimori, along with the Kanto first partners and, later, several of Eevee's evolutions including Glaceon and Sylveon; Eevee itself is credited to Motofumi Fujiwara. She has since gone freelance and works across a range of games and genres. Her Pokémon TCG illustrations date from 1997 and run through every era since — several hundred cards, most of them small Pokémon rather than chase cards.",
  },
  "Sowsow":{
    since:"Born 1988 · First cards in Forbidden Light, 2018",
    fact:"The first cards were Avalugg, Inkay and Cubone, all in Forbidden Light. On the Cubone, a cloud overhead takes the shape of the skull of its late mother.",
    story:"sowsow's first cards all arrived at once, in Forbidden Light in 2018: Avalugg, Inkay and Cubone. The handling is painterly and watercolour-inflected, and it scaled up unusually well — when the alternate-art formats gave illustrators the full card, the space went to habitat rather than spectacle, so a Pokémon reads as living somewhere specific rather than posing in front of it. Outside the TCG, sowsow has illustrated for Pokémon Sleep. For the 2023 collaboration marking the Van Gogh Museum's fiftieth anniversary, the museum commissioned six paintings from three Pokémon illustrators; sowsow contributed two — Munchlax and Snorlax in a room after The Bedroom, and an Eevee after Self-Portrait with Straw Hat.",
  },
  "Shibuzoh.":{
    since:"First card: Clefairy, Generations · Working with the Pokémon TCG since 2016",
    fact:"Always credited with a period in the name — \"Shibuzoh.\" — a signature that has remained consistent across a decade of cards.",
    story:"Shibuzoh. — the period is part of the name, always, on every card credit — has been illustrating since 2016, entering the TCG with Clefairy in Generations, and has worked through the Sun & Moon, Sword & Shield and Scarlet & Violet eras since. What holds across the decade is attention to expression and to the small incidental detail at the edge of the frame, on compositions that stay legible at thumbnail size. The work is not restricted to the card game: Shibuzoh. has confirmed illustrating Pikachu and Morpeko artwork for Pokémon TCG merchandise, and involvement with Pokémon HOME.",
  },
  "Yukiko Baba":{
    since:"A printmaker and illustrator · Pokémon TCG illustrations since 1998",
    fact:"A printmaker and illustrator. Her first cards appeared in the Japanese Expansion Sheet Series 3; the first released in English was a Kakuna in Neo Discovery.",
    story:"Yukiko Baba is a printmaker and illustrator who has been making Pokémon card illustrations since 1998, which places her among the game's longest-serving contributors alongside Komiya. Printmaking asks you to plan every layer before committing, because you can't undo a cut block, and her compositions tend to resolve into a clear foreground, subject and ground rather than a continuous painted field. Her modern work is often described as settling into muted greens and purples; that is an observation about the cards rather than something she has said. She doesn't paint heroic Pokémon. She paints Pokémon in places, in light, in moments.",
  },
  "sui":{
    since:"Pokémon TCG illustrations since 2009 · Debuted in the Arceus expansion",
    fact:"Works across other trading card games, browser games, CD jacket art and magazines alongside the Pokémon TCG. One of the more prolific illustrators in the game.",
    story:"sui began illustrating for the Pokémon TCG in 2009, debuting in the Arceus expansion, and has worked steadily since; sources disagree on the total depending on how reprints and Japanese-only printings are counted. Her portfolio also takes in other trading card games, CD jacket illustrations, browser game character designs and magazine work. The method is documented: a graphics tablet and image-editing software in an airbrush style, areas of high saturation and luminosity, and light emphasised in almost all of her original work. She has said she particularly likes making images that carry a sense of motion.",
  },
};

const ARTIST_META={
  "yuka-morii":    {accent:"#C8876A",grad:"rgba(200,135,106,0.14)",tags:"Clay Sculpture · Miniature Worlds · Photographic",
    topCardNames:["Slowpoke","Eevee","Marill","Togepi","Clefairy","Azumarill","Swinub","Pichu","Smoochum"]},
  "asako-ito":     {accent:"#9A78D8",grad:"rgba(154,120,216,0.14)",tags:"Amigurumi · Hand-built Sets · Textile Warmth",
    topCardNames:["Jigglypuff","Clefairy","Chansey","Snubbull","Wigglytuff","Clefable","Blissey","Cleffa"]},
  "tomokazu-komiya":{accent:"#E8A030",grad:"rgba(232,160,48,0.14)",tags:"Acrylic Gouache · Loose Line · Distorted Form",
    topCardNames:["Sunflora","Rapidash","Arcanine","Ho-Oh","Typhlosion","Charizard","Growlithe","Entei"]},
  "shinji-kanda":   {accent:"#5A9ED4",grad:"rgba(90,158,212,0.14)",tags:"Primarily Digital · Physical Experiments · Unsettling Composition",
    topCardNames:["Magmar","Blastoise","Hitmonchan","Typhlosion","Scizor","Machamp","Hitmonlee","Kabutops"]},
  "atsuko-nishida": {accent:"#F4D042",grad:"rgba(244,208,66,0.14)",tags:"Original Game Designer · Pikachu's Creator · Iconic",
    topCardNames:["Pikachu","Eevee","Raichu","Jolteon","Vaporeon","Flareon","Espeon","Umbreon","Leafeon","Glaceon","Sylveon"]},
  "sowsow":         {accent:"#E06868",grad:"rgba(224,104,104,0.14)",tags:"Painterly · Environment as Narrative · Watercolour Inflection",
    topCardNames:["Espeon","Snorlax","Cubone","Umbreon","Sylveon","Mew","Gengar","Togekiss"]},
  "shibuzoh":       {accent:"#5ABFA0",grad:"rgba(90,191,160,0.14)",tags:"Illustrative · Atmospheric · Detailed",
    topCardNames:["Clefairy","Vulpix","Jigglypuff","Bulbasaur","Oddish","Paras","Psyduck","Golduck"]},
  "yukiko-baba":    {accent:"#C88AD0",grad:"rgba(200,138,208,0.14)",tags:"Printmaker · Hand-Painted · Expressive Palette",
    topCardNames:["Ekans","Paras","Diglett","Rapidash","Poliwag","Bellsprout","Slowpoke","Gastly"]},
  "sui":            {accent:"#68A8D8",grad:"rgba(104,168,216,0.14)",tags:"Prolific · Cross-Media · Luminous",
    topCardNames:["Absol","Flygon","Togekiss","Lucario","Gardevoir","Glaceon","Togetic","Milotic"]},
  "akira-egawa":   {accent:"#88D080",grad:"rgba(136,208,128,0.1)",tags:"Dynamic · Energetic"},
  "kouki-saitou":  {accent:"#8888D0",grad:"rgba(136,136,208,0.1)",tags:"Precise · Clean"},
  "saya-tsuruta":  {accent:"#D0A878",grad:"rgba(208,168,120,0.1)",tags:"Warm · Detailed"},
  "okacheke":      {accent:"#80C0C0",grad:"rgba(128,192,192,0.1)",tags:"Stylised · Bold"},
  "0313":          {accent:"#C080C8",grad:"rgba(192,128,200,0.1)",tags:"Contemporary · Graphic"},
  "gossan":        {accent:"#D08060",grad:"rgba(208,128,96,0.1)", tags:"Expressive · Warm"},
  "mizue":         {accent:"#88B0D0",grad:"rgba(136,176,208,0.1)",tags:"Soft · Painterly"},
  "tetsu-kayama":  {accent:"#A0D0A0",grad:"rgba(160,208,160,0.1)",tags:"Natural · Serene"},
  "gapao":         {accent:"#D0C060",grad:"rgba(208,192,96,0.1)", tags:"Vibrant · Playful"},
  "okubo":         {accent:"#C0A0E0",grad:"rgba(192,160,224,0.1)",tags:"Elegant · Refined"},
  "masakazu-fukuda":{accent:"#D07080",grad:"rgba(208,112,128,0.1)",tags:"Bold · Impactful"},
};

export { ARTISTS, ARTIST_FACTS, ARTIST_META };

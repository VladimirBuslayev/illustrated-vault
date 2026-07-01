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
  {name:"Shibuzoh.",       artistId:"shibuzoh",          tier:"main",      isSet:false, aliases:["Shibuzoh","Shibuzō"]},
  {name:"Yukiko Baba",     artistId:"yukiko-baba",       tier:"main",      isSet:false},
  {name:"sui",             artistId:"sui",               tier:"main",      isSet:false},
  {name:"AKIRA EGAWA",     artistId:"akira-egawa",       tier:"secondary", isSet:false},
  {name:"Kouki Saitou",    artistId:"kouki-saitou",      tier:"secondary", isSet:false},
  {name:"Saya Tsuruta",    artistId:"saya-tsuruta",      tier:"secondary", isSet:false, aliases:["Saya　Tsuruta"]},
  {name:"OKACHEKE",        artistId:"okacheke",           tier:"secondary", isSet:false},
  {name:"0313",            artistId:"0313",               tier:"secondary", isSet:false},
  {name:"GOSSAN",          artistId:"gossan",             tier:"secondary", isSet:false},
  {name:"Mizue",           artistId:"mizue",              tier:"secondary", isSet:false},
  {name:"Tetsu Kayama",    artistId:"kayama",             tier:"secondary", isSet:false},
  {name:"Gapao",           artistId:"gapao",              tier:"secondary", isSet:false},
  {name:"OKUBO",           artistId:"okubo",              tier:"secondary", isSet:false},
  {name:"Masakazu Fukuda", artistId:"fukuda",             tier:"secondary", isSet:false, aliases:["Masayuki Fukuda"]},
];

const ARTIST_FACTS={
  "Yuka Morii":{
    since:"Active since 2000 — Neo Discovery",
    fact:"She doesn't draw her Pokémon — she sculpts them in clay, builds a tiny diorama, then photographs it. Every card is a photo of a real object.",
    story:"Every Yuka Morii card begins as a physical object. She sculpts the Pokémon in clay — sometimes just a few centimetres tall — arranges props and a tiny landscape around it, then photographs the scene under natural light. The warmth in her cards isn't a digital effect; it falls on real clay. She has been doing this since the year 2000, making her one of the longest-tenured illustrators in the game, and her style is immediately recognisable: no painted or digital card has ever replicated that tactile softness. When you feel like you could reach into a Morii card and touch the Pokémon, that's because somewhere, you actually could.",
  },
  "Asako Ito":{
    since:"Active since 2017 — Sun & Moon base set",
    fact:"Every Pokémon in her cards is crocheted yarn. She trained in oil painting, but taught herself to knit after seeing the teddy bear from Mr. Bean.",
    story:"Asako Ito's route into card illustration is one of the most unexpected in the game. Trained as an oil painter, she encountered knitting through an unlikely source — Mr. Bean's beloved stuffed bear — and taught herself to crochet from scratch. By the time she joined the TCG in 2017, she had mastered the art of tiny yarn Pokémon, hand-stitching each one before setting it under careful lighting and photographing it. Like Morii's clay, Ito's cards are photographs of physical objects. Where Morii's clay has sculptural weight, Ito's yarn has warmth — the slight imperfections in the stitching, the softness of the focus, give her cards an irreplaceable handmade quality that no digital tool has come close to matching.",
  },
  "Tomokazu Komiya":{
    since:"Active since 1998 — Neo Genesis",
    fact:"His flat, lopsided style is a deliberate art historical choice — Primitivism. In 2023 he reimagined Sunflora as a tribute to Van Gogh's Sunflowers.",
    story:"Tomokazu Komiya has been illustrating Pokémon cards since 1998 — one of the game's original artists and still going more than 25 years later. His bold, flat, slightly off-kilter style is a deliberate reference to Primitivism, the early 20th-century art movement that looked to prehistoric cave paintings and tribal art as a counterpoint to European realism. The style has never gone out of fashion because it was never trying to be fashionable. It was always making an argument. In 2023, Komiya painted Sunflora in direct homage to Van Gogh's Sunflowers, placing a Pokémon inside the lineage of Post-Impressionism with complete naturalness. After 25 years, he's still thinking carefully about what painting means and why.",
  },
  "Shinji Kanda":{
    since:"Active since 2022 — Brilliant Stars",
    fact:"For his very first card (Magmar, Brilliant Stars) he colored on plastic with colored pencils, not digitally. His style draws on ukiyo-e woodblock print tradition.",
    story:"Shinji Kanda is the newest of the main artists tracked here, debuting with Magmar in Brilliant Stars in 2022. His background in ukiyo-e — the Japanese woodblock print tradition of Hokusai and Hiroshige — gives his cards an unusual graphic quality. Where other illustrators use digital tools to soften edges and blend colors, Kanda's compositions often feel like they have the clarity and intentionality of a carved and printed block. His debut card was colored on a sheet of plastic with colored pencils, a deliberate analogue choice in an era of fully digital illustration. That tactile, process-aware instinct has carried through his work ever since.",
  },
  "Atsuko Nishida":{
    since:"Game Freak character designer since 1996",
    fact:"She designed Pikachu before she ever illustrated a card. The first sketch looked like a daifuku rice cake with ears — the electric cheek pouches came from watching squirrels store food.",
    story:"Atsuko Nishida isn't primarily a card illustrator — she's a character designer at Game Freak, the studio that made Pokémon. She has been there since 1996 and is responsible for Pikachu, Eevee, and dozens of the franchise's most beloved original creatures. The origin details are specific and well-documented: the first Pikachu sketch looked like a round daifuku rice cake with ears, and the electric cheek pouches were inspired by watching squirrels stuff food into their cheeks. When Nishida illustrates a card, it isn't interpretation — it's the original designer returning to her own characters. That's why her cards often feel like they capture something essential about the Pokémon that other artists reach for and don't quite find.",
  },
  "Sowsow":{
    since:"Active since 2018 — Forbidden Light (debut: Cubone)",
    fact:"His Espeon V from Evolving Skies is widely considered one of the most beautiful cards ever printed. In 2023 he reimagined Snorlax in the style of Van Gogh's The Bedroom.",
    story:"Sowsow debuted in 2018 with Cubone in Forbidden Light and within a few years became responsible for some of the most coveted cards in the modern era. His Espeon V from Evolving Skies is a full-art card of unusual painterly ambition — loose expressive brushwork, impressionistic color, a Pokémon that feels genuinely alive and present on the card. It consistently sells for well above market price because collectors respond to the ambition. In 2023, Sowsow entered the Van Gogh tribute wave with a Snorlax rendered in the style of The Bedroom — a sharp conceptual choice, the sleeping Snorlax and the quiet domestic interior making immediate visual and emotional sense together. He keeps finding the right image.",
  },
  "Shibuzoh.":{
    since:"Active since 2016 — Generations (debut: Clefairy)",
    fact:"Always credited with a period in the name — \"Shibuzoh.\" — a quiet signature that has remained consistent across nearly a decade of cards.",
    story:"Shibuzoh. — the period is part of the name, always, on every card credit — has been illustrating since 2016, when the TCG was in its XY era. The period has never been publicly explained, which gives it the quality of a signature rather than a style choice: something that identifies the work without explaining it. Their illustrations span a decade of sets and a wide tonal range, from atmospheric nature scenes to dynamic compositions with real graphic tension. Like many Japanese illustrators in the TCG world, Shibuzoh. keeps an extremely low public profile. The work speaks; the period at the end of the name is the only personal detail reliably offered.",
  },
  "Yukiko Baba":{
    since:"Active since 1998",
    fact:"A printmaker by training. Her modern work has settled into a distinctive signature palette of muted greens and purples — earthy, quiet, immediately recognisable.",
    story:"Yukiko Baba has been illustrating Pokémon cards since 1998, making her one of the game's longest-serving contributors alongside Komiya. Her training in printmaking — a discipline that demands you plan every layer before committing, because you can't undo a cut block — shows in her compositions. They always feel considered rather than accidental. Her modern work has settled into a distinctive palette of muted greens and purples, earthy and slightly melancholic, that makes a Baba card instantly identifiable across a table at a card show. She doesn't paint heroic Pokémon. She paints Pokémon in places, in light, in moments — and it's the specificity of those moments that makes the cards memorable.",
  },
  "sui":{
    since:"Active since 2009 — Arceus",
    fact:"Over 200 Pokémon cards, alongside work in other trading card games, browser games, CD jacket art, and magazines. One of the most prolific illustrators in the TCG.",
    story:"sui began illustrating for the Pokémon TCG in 2009 and has since produced more than 200 cards — a remarkable output that becomes more interesting when you know she has never worked exclusively for Pokémon. Her portfolio includes other trading card games, CD jacket illustrations, browser game character designs, and magazine work. That cross-media practice matters: it keeps her style from calcifying around a single context. She brings the same attention and care to a common card as to a full-art rare, which is why her more ambitious recent work feels polished without feeling effortful. The care just shows.",
  },
};

const ARTIST_META={
  "yuka-morii":    {accent:"#C8876A",grad:"rgba(200,135,106,0.14)",quote:"I sculpt each Pokémon by hand — so every card is a photograph of something real.",tags:"Clay Sculpture · Handcrafted · Tactile",
    topCardNames:["Slowpoke","Eevee","Marill","Togepi","Clefairy","Azumarill","Swinub","Pichu","Smoochum"]},
  "asako-ito":     {accent:"#9A78D8",grad:"rgba(154,120,216,0.14)",quote:"I pick up the needles, and the Pokémon starts to take shape.",tags:"Yarn & Textile Art · Warm · Handcrafted",
    topCardNames:["Jigglypuff","Clefairy","Chansey","Snubbull","Wigglytuff","Clefable","Blissey","Cleffa"]},
  "tomokazu-komiya":{accent:"#E8A030",grad:"rgba(232,160,48,0.14)",quote:"Primitivism taught me that feeling matters more than precision.",tags:"Primitivism · Bold Colour · Dramatic",
    topCardNames:["Sunflora","Rapidash","Arcanine","Ho-Oh","Typhlosion","Charizard","Growlithe","Entei"]},
  "shinji-kanda":   {accent:"#5A9ED4",grad:"rgba(90,158,212,0.14)",quote:"I think about woodblock printing every time I plan a composition.",tags:"Ukiyo-e Influence · Clean Lines · Dynamic",
    topCardNames:["Magmar","Blastoise","Hitmonchan","Typhlosion","Scizor","Machamp","Hitmonlee","Kabutops"]},
  "atsuko-nishida": {accent:"#F4D042",grad:"rgba(244,208,66,0.14)",quote:"The first Pikachu looked like a rice cake with ears. I kept sketching.",tags:"Original Game Designer · Pikachu's Creator · Iconic",
    topCardNames:["Pikachu","Eevee","Raichu","Jolteon","Vaporeon","Flareon","Espeon","Umbreon","Leafeon","Glaceon","Sylveon"]},
  "sowsow":         {accent:"#E06868",grad:"rgba(224,104,104,0.14)",quote:"I want the card to feel like it could be hanging on a gallery wall.",tags:"Alternate Art · Chase Cards · Expressive",
    topCardNames:["Espeon","Snorlax","Cubone","Umbreon","Sylveon","Mew","Gengar","Togekiss"]},
  "shibuzoh":       {accent:"#5ABFA0",grad:"rgba(90,191,160,0.14)",quote:"The period is part of the name. It marks a pause, a breath, a signature.",tags:"Illustrative · Atmospheric · Detailed",
    topCardNames:["Clefairy","Vulpix","Jigglypuff","Bulbasaur","Oddish","Paras","Psyduck","Golduck"]},
  "yukiko-baba":    {accent:"#C88AD0",grad:"rgba(200,138,208,0.14)",quote:"Green and purple — that's just where my instincts go.",tags:"Printmaker · Hand-Painted · Expressive Palette",
    topCardNames:["Ekans","Paras","Diglett","Rapidash","Poliwag","Bellsprout","Slowpoke","Gastly"]},
  "sui":            {accent:"#68A8D8",grad:"rgba(104,168,216,0.14)",quote:"A card, a game sprite, a CD cover — the medium changes. The care doesn't.",tags:"Prolific · Cross-Media · Luminous",
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

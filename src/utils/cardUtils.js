// src/utils/cardUtils.js
// Card classification helpers.
// Source: index.legacy.html line 262.

const isTcgPocketCard=card=>!!(card&&card.image&&card.image.includes("/tcgp/"));

export { isTcgPocketCard };

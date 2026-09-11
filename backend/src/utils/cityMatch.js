// Canonical city matching for the pharmacy-facing warehouse list.
//
// Why this exists rather than a plain `warehouse.city === pharmacy.city`:
// the two sides of that comparison are populated by completely different
// mechanisms, and neither one is controlled.
//
//  - A pharmacy's city is never collected. auth.service.js's register
//    hardcodes 'Latakia' for every self-registration (the form only asks for
//    name/pharmacyName/phone/address), and no route anywhere updates it
//    afterwards - so the left-hand side is always that exact ASCII string.
//  - A warehouse's city is free text an admin types into a plain <input>
//    (web/src/pages/AccountsPage.jsx), which admin.service.js's
//    createWarehouseAccount only trims - so the right-hand side can be
//    'Latakia', 'latakia', 'Lattakia', ' اللاذقية ', or anything else.
//
// A `===` between those two would hand a pharmacy an empty warehouse list,
// hiding every catalog on the platform behind a filter it never asked for
// and cannot see. So both sides go through canonicalCity() first.

// Arabic marks that carry no identity for a city name: the harakat block,
// the superscript alef, and tatweel (the decorative letter-stretching
// character, which can appear anywhere inside a word).
const ARABIC_MARKS = /[\u064B-\u0652\u0670\u0640]/g;

// Everything that isn't a letter or a digit: spaces, hyphens, apostrophes
// ("Dara'a"), and the hamza-on-the-line that some spellings carry.
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]/gu;

// The Arabic definite article, stripped only from the start of the whole
// (already space-free) string so 'اللاذقية' and 'لاذقية' converge. Note this
// is deliberately Arabic-only: stripping a Latin leading "al" would turn
// 'aleppo' into 'eppo'. Latin transliterations are handled by the alias
// table below instead.
const ARABIC_ARTICLE = /^ال/;

function normalizeCity(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(ARABIC_MARKS, '')
    // Unify the letter forms that differ only by orthographic convention, so
    // the same city typed by two different admins converges: every alef
    // variant to bare alef, ta marbuta to ha, alef maksura to ya.
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(NON_ALPHANUMERIC, '')
    .replace(ARABIC_ARTICLE, '');
}

// Every spelling of a city we expect to actually meet, grouped under one
// canonical key. Written in natural form and normalized at load, so adding a
// spelling here never requires hand-applying the rules above.
//
// The keys are arbitrary internal ids - they are never displayed. What the
// pharmacist sees is always the warehouse's own `city` string, untouched.
const CITY_ALIASES = {
  latakia: ['Latakia', 'Lattakia', 'Lattaquie', 'Ladhiqiyah', 'Al-Ladhiqiyah', 'اللاذقية', 'لاذقية'],
  damascus: ['Damascus', 'Damas', 'Dimashq', 'دمشق', 'الشام'],
  rif_dimashq: ['Rif Dimashq', 'Rural Damascus', 'Damascus Countryside', 'ريف دمشق'],
  aleppo: ['Aleppo', 'Alep', 'Halab', 'حلب'],
  homs: ['Homs', 'Hims', 'حمص'],
  hama: ['Hama', 'Hamah', 'حماة'],
  tartus: ['Tartus', 'Tartous', 'طرطوس'],
  idlib: ['Idlib', 'Idleb', 'إدلب'],
  deir_ez_zor: ['Deir ez-Zor', 'Deir Ezzor', 'Deir el-Zor', 'Dayr az-Zawr', 'دير الزور'],
  raqqa: ['Raqqa', 'Al-Raqqah', 'Rakka', 'الرقة'],
  hasakah: ['Hasakah', 'Al-Hasakah', 'Hassakeh', 'الحسكة'],
  daraa: ['Daraa', "Dara'a", 'Deraa', 'درعا'],
  sweida: ['Sweida', 'Suwayda', 'As-Suwayda', 'Swaida', 'السويداء'],
  quneitra: ['Quneitra', 'Qunaytirah', 'Kuneitra', 'القنيطرة'],
};

const ALIAS_TO_CANONICAL = new Map();
for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(normalizeCity(alias), canonical);
  }
}

// The comparable form of a city string. A city that isn't in the table above
// falls back to its own normalized form rather than to a catch-all bucket -
// so a city nobody anticipated still matches itself across differences of
// case, spacing and diacritics, and still never matches a different city.
function canonicalCity(value) {
  const normalized = normalizeCity(value);
  if (!normalized) return '';
  return ALIAS_TO_CANONICAL.get(normalized) || normalized;
}

// Whether two city strings name the same place. An empty/unusable value on
// either side matches nothing at all: callers must decide what to do about a
// pharmacy with no usable city (warehouse.service.js falls back to the
// unfiltered list), and silently grouping every blank city together would
// make that decision for them, wrongly.
function citiesMatch(a, b) {
  const canonicalA = canonicalCity(a);
  if (!canonicalA) return false;
  return canonicalA === canonicalCity(b);
}

module.exports = { normalizeCity, canonicalCity, citiesMatch };

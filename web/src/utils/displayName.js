// Section 14: products/orders linked to the central (Arabic-first) catalog
// often have no English name/manufacturer set - Excel import only captures
// Arabic (see backend/src/services/productCatalog.service.js). Falls back
// to the Arabic value rather than rendering blank.
export function withArFallback(en, ar) {
  return en || ar || '-';
}

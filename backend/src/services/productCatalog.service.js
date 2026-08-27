const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const { ApiError } = require('../utils/ApiError');
const ProductCatalog = require('../models/productCatalog.model');
const Category = require('../models/category.model');
const { getRate } = require('./exchangeRate.service');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Identity resolution (Section 14 Part 2)
// ---------------------------------------------------------------------------

// A catalog-linked product's name/manufacturer live on the ProductCatalog
// entry, not on the Product itself - this resolves the display value from
// whichever place actually has it. `product.masterProductId` must already
// be `.populate()`d by the caller; a legacy product (masterProductId never
// set) falls back to its own stored fields.
function resolveProductIdentity(product) {
  const catalogItem = product.masterProductId;
  if (catalogItem && typeof catalogItem === 'object') {
    return {
      nameAr: catalogItem.nameAr,
      nameEn: catalogItem.nameEn,
      manufacturerAr: catalogItem.manufacturerAr,
      manufacturerEn: catalogItem.manufacturerEn,
    };
  }
  return {
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    manufacturerAr: product.manufacturerAr,
    manufacturerEn: product.manufacturerEn,
  };
}

// Overwrites the product doc's own name/manufacturer fields in place with
// the resolved values - presentation-only (the doc is never `.save()`d
// afterward), so every existing viewmodel that reads `product.nameAr` etc.
// keeps working unchanged regardless of whether this product is
// catalog-linked or legacy.
function applyResolvedIdentity(product) {
  const identity = resolveProductIdentity(product);
  product.nameAr = identity.nameAr;
  product.nameEn = identity.nameEn;
  product.manufacturerAr = identity.manufacturerAr;
  product.manufacturerEn = identity.manufacturerEn;
  return product;
}

// ---------------------------------------------------------------------------
// List / search
// ---------------------------------------------------------------------------

const DEFAULT_CATALOG_LIMIT = 30;

// Section 14: the admin's full list, every item regardless of isActive (a
// disabled entry still needs to show up so it can be re-enabled) - matches
// adminProduct.service.js's listAllProducts, which does the same for the
// per-warehouse catalog.
//
// Cursor pagination: sorted by `_id` ascending (replacing the previous
// manufacturerAr/nameAr sort - a stable, unique cursor field is required for
// pagination to work correctly, see pagination.js).
async function listCatalog({ search, limit = DEFAULT_CATALOG_LIMIT, after = null } = {}) {
  const filter = {};
  if (search && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), 'i');
    filter.$or = [
      { nameAr: pattern },
      { nameEn: pattern },
      { manufacturerAr: pattern },
      { manufacturerEn: pattern },
    ];
  }
  if (after) {
    filter._id = { $gt: after };
  }

  const results = await ProductCatalog.find(filter).sort({ _id: 1 }).limit(limit + 1);
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const nextCursor = page.length > 0 ? page[page.length - 1]._id.toString() : null;

  return { items: page, hasMore, nextCursor };
}

// Section 14 Part 1 item 5: for the warehouse's own (not-yet-built) "search
// the master list" flow - active entries only, name-only search, capped so
// it's usable as a type-ahead.
async function searchActiveForWarehouse(search) {
  const filter = { isActive: true };
  if (search && search.trim()) {
    filter.nameAr = new RegExp(escapeRegex(search.trim()), 'i');
  }
  return ProductCatalog.find(filter).sort({ nameAr: 1 }).limit(50);
}

// ---------------------------------------------------------------------------
// Edit / soft-delete (no direct create - see importFromExcel below)
// ---------------------------------------------------------------------------

async function findCatalogItemOrThrow(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.notFound('Catalog item not found.', 'CATALOG_ITEM_NOT_FOUND');
  }
  const item = await ProductCatalog.findById(id);
  if (!item) {
    throw ApiError.notFound('Catalog item not found.', 'CATALOG_ITEM_NOT_FOUND');
  }
  return item;
}

async function validateCategoryId(categoryId) {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) {
    throw ApiError.badRequest('Invalid category.', undefined, 'INVALID_CATEGORY');
  }
  const exists = await Category.exists({ _id: categoryId });
  if (!exists) {
    throw ApiError.badRequest('Invalid category.', undefined, 'INVALID_CATEGORY');
  }
}

// name/unit/category only (Section 14 Part 1) - isActive also accepted here
// so the panel's single toggle button can re-enable via PATCH, symmetric
// with DELETE for disabling (see deactivateCatalogItem).
async function updateCatalogItem(id, changes) {
  const item = await findCatalogItemOrThrow(id);

  if (changes.nameAr !== undefined) {
    if (typeof changes.nameAr !== 'string' || !changes.nameAr.trim()) {
      throw ApiError.badRequest('Invalid name.', undefined, 'INVALID_PRODUCT_NAME');
    }
    item.nameAr = changes.nameAr.trim();
  }

  if (changes.unitAr !== undefined) {
    item.unitAr =
      typeof changes.unitAr === 'string' && changes.unitAr.trim() ? changes.unitAr.trim() : null;
  }

  if (changes.categoryId !== undefined) {
    if (changes.categoryId === null) {
      item.categoryId = null;
    } else {
      await validateCategoryId(changes.categoryId);
      item.categoryId = changes.categoryId;
    }
  }

  if (changes.isActive !== undefined) {
    item.isActive = changes.isActive === true;
  }

  await item.save();
  return item;
}

async function deactivateCatalogItem(id) {
  const item = await findCatalogItemOrThrow(id);
  item.isActive = false;
  await item.save();
  return item;
}

// ---------------------------------------------------------------------------
// Excel template
// ---------------------------------------------------------------------------

const HEADER_TEXT = 'اسم الدواء';
const WAREHOUSE_HEADER_TEXT = 'اسم الدواء (من القائمة)';
const PRICE_HEADER_TEXT = 'السعر';
const CURRENCY_HEADER_TEXT = 'العملة';
const NOTE_TEXT =
  'صف بخلفية صفراء = اسم الشركة، الصفوف التالية = أدويتها، صف فاضي = فاصل';
const WAREHOUSE_NOTE_TEXT =
  'صف بخلفية صفراء = اسم الشركة، الصفوف التالية = أدويتها، صف فاضي = فاصل. الأسماء لازم تطابق القائمة المركزية بالضبط.';
// Appended (on its own line) below NOTE_TEXT inside the single merged
// instruction row - see buildTemplateWorkbook. Kept a separate constant so
// KNOWN_NOTE_TEXTS can also match an older template that put it on its own
// row.
const CURRENCY_NOTE_TEXT =
  'العملة: SYP = ليرة سورية (يتحوّل تلقائياً للدولار حسب سعر الصرف الحالي)\nUSD = دولار أمريكي (يُخزَّن مباشرة)';
const MANUFACTURER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const CURRENCY_VALIDATION_LAST_ROW = 1000;

// Shared by both templates below (admin's master-list template and the
// warehouse's own import template, Section 14 Part 1 vs Part 2) - same
// three-column/company-row shape, only the header/note text and example
// rows differ.
async function buildTemplateWorkbook({ nameHeader, noteText, examples }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catalog', { views: [{ rightToLeft: true }] });

  sheet.columns = [{ width: 42 }, { width: 14 }, { width: 12 }];

  // Row 1: a single merged instruction row - the company/medicine/separator
  // legend and the currency explanation, each on its own line. Row 2 is the
  // column header; data starts at row 3. That's exactly LEADING_ROWS_TO_SKIP
  // (= 2, see parseWorkbookRows) rows before the first real manufacturer row.
  sheet.mergeCells('A1:C1');
  const noteCell = sheet.getCell('A1');
  noteCell.value = `${noteText}\n${CURRENCY_NOTE_TEXT}`;
  noteCell.font = { italic: true, color: { argb: 'FF5A6B87' } };
  noteCell.alignment = { wrapText: true, horizontal: 'right', readingOrder: 'rtl' };
  sheet.getRow(1).height = 64;

  const headerRow = sheet.addRow([nameHeader, PRICE_HEADER_TEXT, CURRENCY_HEADER_TEXT]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.alignment = { horizontal: 'right', readingOrder: 'rtl' };
  });

  // Merges *after* adding the row, using the row's own actual number -
  // merging a predicted "next row" beforehand causes exceljs to reserve
  // that row itself, so the subsequent addRow lands one row further down
  // than intended (an unwanted extra blank row).
  function addManufacturerRow(nameAr) {
    const row = sheet.addRow([`[${nameAr}]`]);
    sheet.mergeCells(`A${row.number}:C${row.number}`);
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.fill = MANUFACTURER_FILL;
      cell.alignment = { horizontal: 'right', readingOrder: 'rtl' };
    });
  }

  function addProductRow(nameAr, price, currency) {
    const row = sheet.addRow([nameAr, price, currency]);
    row.getCell(1).alignment = { horizontal: 'right', readingOrder: 'rtl' };
  }

  for (const group of examples) {
    addManufacturerRow(group.manufacturerAr);
    for (const product of group.products) {
      addProductRow(product.nameAr, product.price, product.currency);
    }
    if (group !== examples[examples.length - 1]) {
      sheet.addRow([]);
    }
  }

  // Dropdown restricted to USD/SYP, from the first real data row (row 3)
  // onward - a generous range so rows the admin/warehouse types in below
  // the examples still get it, not just the pre-filled ones.
  sheet.dataValidations.add(`C3:C${CURRENCY_VALIDATION_LAST_ROW}`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"USD,SYP"'],
    showErrorMessage: true,
    errorStyle: 'error',
    errorTitle: 'عملة غير صالحة',
    error: 'الرجاء اختيار USD أو SYP فقط.',
  });

  return workbook;
}

const ADMIN_EXAMPLES = [
  {
    manufacturerAr: 'شركة الشرق للأدوية',
    products: [
      { nameAr: 'باراسيتامول 500 ملغ', price: 13000, currency: 'SYP' },
      { nameAr: 'أموكسيسيلين 250 ملغ', price: 2.5, currency: 'USD' },
    ],
  },
  { manufacturerAr: 'شركة سوريا فارم', products: [{ nameAr: 'فولتارين 50 ملغ', price: 15000, currency: 'SYP' }] },
];

async function generateTemplateBuffer() {
  const workbook = await buildTemplateWorkbook({
    nameHeader: HEADER_TEXT,
    noteText: NOTE_TEXT,
    examples: ADMIN_EXAMPLES,
  });
  return workbook.xlsx.writeBuffer();
}

// Section 14 Part 2: the warehouse's own import template - same shape, but
// the names typed in here must match an active central-catalog entry
// exactly (case-insensitive) or the row is rejected at import time, see
// warehouseProduct.service.js's importProductsFromExcel. The example rows
// intentionally reuse the admin template's own examples, since those are
// guaranteed to exist once an admin has imported that file.
async function generateWarehouseTemplateBuffer() {
  const workbook = await buildTemplateWorkbook({
    nameHeader: WAREHOUSE_HEADER_TEXT,
    noteText: WAREHOUSE_NOTE_TEXT,
    examples: ADMIN_EXAMPLES,
  });
  return workbook.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// Excel import
// ---------------------------------------------------------------------------

function cellText(cell) {
  if (cell.value == null) return '';
  return cell.text != null ? cell.text.toString().trim() : cell.value.toString().trim();
}

function isYellowFill(cell) {
  const fill = cell.fill;
  return !!(fill && fill.type === 'pattern' && fill.fgColor && fill.fgColor.argb === 'FFFFFF00');
}

function isManufacturerRow(nameText, nameCell) {
  if (nameText.startsWith('[') && nameText.endsWith(']')) return true;
  return isYellowFill(nameCell);
}

function manufacturerNameFrom(nameText) {
  return nameText.replace(/^\[/, '').replace(/\]$/, '').trim();
}

// Both templates' header/note text (admin's and the warehouse's, see
// buildTemplateWorkbook above) - a warehouse importing its own template
// needs its header/note rows recognized just as reliably as the admin's.
const KNOWN_HEADER_TEXTS = new Set([HEADER_TEXT, WAREHOUSE_HEADER_TEXT]);
// Both the standalone note strings (older templates that put the currency
// explanation on its own row) and the combined single-cell form the current
// template writes - so a note row that lands past LEADING_ROWS_TO_SKIP (a
// file with an extra hand-added title row on top) is still recognized.
const KNOWN_NOTE_TEXTS = new Set([
  NOTE_TEXT,
  WAREHOUSE_NOTE_TEXT,
  CURRENCY_NOTE_TEXT,
  `${NOTE_TEXT}\n${CURRENCY_NOTE_TEXT}`,
  `${WAREHOUSE_NOTE_TEXT}\n${CURRENCY_NOTE_TEXT}`,
]);

// The generated template has two rows before any data: one merged
// instruction row, then the column header (see buildTemplateWorkbook). Both
// are skipped by position. A real uploaded file sometimes carries an extra
// hand-added title row on top, pushing the column header down to row 3 -
// it's still caught there by content (KNOWN_HEADER_TEXTS above), so parsing
// survives that too. Only a file with two or more unrecognized rows stacked
// above the data misreads the first of them, and that costs a single
// row-level error, never the whole import.
const LEADING_ROWS_TO_SKIP = 2;

// Parses an uploaded workbook against either template's shape, but by
// content rather than fixed row positions (Section 14): a manufacturer row
// is recognized by its yellow fill OR its [bracket] text, a blank row is
// always a separator, and the note/header rows are recognized by their
// known exact text - so filling in the template (inserting/reordering rows)
// doesn't break parsing.
//
// `requirePrice` (default true, used by the warehouse products import)
// rejects a row with a missing/invalid price into `errors`. The central
// catalog import (Section 14 Part 1) passes `requirePrice: false`: the
// project owner's decision is that a priceless medicine is still worth
// having in the master list (a warehouse fills the price in later), so
// those rows become candidates with `rawPrice: null` instead of errors.
//
// Candidates carry `rawPrice`/`currency` here, not yet a converted
// `priceUsd` - the SYP-to-USD conversion needs the current exchange rate,
// an async lookup that only needs to happen once for the whole file (and
// must be able to abort the entire import before anything is written if
// the rate is missing, see resolvePricesInUsd) rather than once per row.
const MIN_SYP_PRICE = 1;
const MIN_USD_PRICE = 0.01;

function parseWorkbookRows(sheet, { requirePrice = true } = {}) {
  const candidates = [];
  const errors = [];
  const manufacturers = new Set();
  let currentManufacturer = null;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= LEADING_ROWS_TO_SKIP) return; // file title / instructions / column header

    const nameCell = row.getCell(1);
    const nameText = cellText(nameCell);

    if (!nameText) return; // blank/separator row
    if (KNOWN_HEADER_TEXTS.has(nameText)) return; // header row, wherever it lands
    if (KNOWN_NOTE_TEXTS.has(nameText)) return; // instruction row

    if (isManufacturerRow(nameText, nameCell)) {
      currentManufacturer = manufacturerNameFrom(nameText);
      // Every manufacturer row recognized while parsing, regardless of
      // whether any of its medicines end up as a valid candidate below -
      // the warehouse import (warehouseProduct.service.js) uses this to
      // register the manufacturer even on a file where every price
      // happened to be invalid.
      manufacturers.add(currentManufacturer);
      return;
    }

    if (!currentManufacturer) {
      errors.push({ row: rowNumber, reason: 'No manufacturer row found above this medicine yet.' });
      return;
    }

    // Currency column (row[2]). A blank cell - an old two-column file, or a
    // cleared cell in the new template - is SYP with no complaint (the
    // project owner's call: most Syrian warehouses price in lira). A value
    // that isn't USD/SYP is still handled as SYP, but recorded so the
    // importer knows it was guessed.
    const currencyText = cellText(row.getCell(3)).toUpperCase();
    let currency = 'SYP';
    if (currencyText === 'USD' || currencyText === 'SYP') {
      currency = currencyText;
    } else if (currencyText) {
      errors.push({
        row: rowNumber,
        reason: `عملة غير معروفة "${currencyText}" — تم التعامل معها كـ SYP`,
        code: 'UNKNOWN_CURRENCY',
      });
    }

    // Price column (row[1]). parseFloat (not Number) so a stray unit like
    // "13000 ل.س" still reads as 13000; a number-typed cell is taken as-is.
    const priceCell = row.getCell(2);
    const priceText = cellText(priceCell);
    const rawPrice = typeof priceCell.value === 'number' ? priceCell.value : parseFloat(priceText);

    if (priceText === '') {
      // No price at all. The warehouse import requires one; the central
      // catalog keeps the row as a priceless entry (a warehouse fills the
      // price in later - project owner's call).
      if (requirePrice) {
        errors.push({ row: rowNumber, reason: 'Missing or invalid price.', code: 'INVALID_PRICE' });
        return;
      }
      candidates.push({
        rowNumber,
        nameAr: nameText,
        manufacturerAr: currentManufacturer,
        rawPrice: null,
        currency,
      });
      return;
    }

    // Not a number (NaN), or under the floor for its currency (SYP < 1,
    // USD < 0.01). Row-level - never aborts the whole import.
    const minPrice = currency === 'USD' ? MIN_USD_PRICE : MIN_SYP_PRICE;
    if (!Number.isFinite(rawPrice) || rawPrice < minPrice) {
      errors.push({ row: rowNumber, reason: 'Invalid price.', code: 'INVALID_PRICE' });
      return;
    }

    candidates.push({
      rowNumber,
      nameAr: nameText,
      manufacturerAr: currentManufacturer,
      rawPrice,
      currency,
    });
  });

  return { candidates, errors, manufacturers: [...manufacturers] };
}

// Turns every candidate's rawPrice (in that row's own currency) into a USD
// priceUsd, fetching the exchange rate at most once for the whole file and
// only when a row actually needs it - an all-USD file imports fine with no
// rate configured at all.
//
// The rate lookup, and the EXCHANGE_RATE_UNAVAILABLE abort it can raise,
// happen here: after the (side-effect-free) row parse but before either
// import function writes a single product. A file with any SYP row and no
// usable rate fails whole, up front - never partway through.
//
// A row whose converted price rounds below the USD floor is dropped into
// `errors` and left out of the returned candidates (row-level, same as a
// bad price caught during parsing).
async function resolvePricesInUsd(candidates, errors) {
  const needsConversion = candidates.some((c) => c.rawPrice !== null && c.currency === 'SYP');

  let usdToSyp = null;
  if (needsConversion) {
    const rate = await getRate();
    if (!(rate?.usdToSyp > 0)) {
      throw ApiError.badRequest(
        'سعر الصرف غير متوفر — أضف سعر الصرف من لوحة الأدمن أولاً',
        undefined,
        'EXCHANGE_RATE_UNAVAILABLE'
      );
    }
    usdToSyp = rate.usdToSyp;
  }

  const priced = [];
  let convertedFromSyp = 0;

  for (const candidate of candidates) {
    if (candidate.rawPrice === null) {
      candidate.priceUsd = null; // priceless central-catalog entry, kept as-is
      priced.push(candidate);
      continue;
    }

    let priceUsd;
    if (candidate.currency === 'SYP') {
      // e.g. 13000 SYP ÷ 130 = $100.00
      priceUsd = Math.round((candidate.rawPrice / usdToSyp) * 100) / 100;
    } else {
      priceUsd = Math.round(candidate.rawPrice * 100) / 100;
    }

    if (priceUsd < MIN_USD_PRICE) {
      // A tiny SYP amount can round down to $0.00 once converted - reject it
      // with the same floor a directly-entered USD price gets.
      errors.push({ row: candidate.rowNumber, reason: 'Invalid price.', code: 'INVALID_PRICE' });
      continue;
    }

    candidate.priceUsd = priceUsd;
    if (candidate.currency === 'SYP') convertedFromSyp += 1;
    priced.push(candidate);
  }

  return { candidates: priced, exchangeRateUsed: usdToSyp, convertedFromSyp };
}

// Shared by both import endpoints (admin's catalog import and the
// warehouse's own, see warehouseProduct.service.js) - loads the uploaded
// buffer as a workbook and hands back its first sheet, already row-parsed.
// `requirePrice` is forwarded to parseWorkbookRows - see its comment above.
async function loadAndParseUpload(file, { requirePrice = true } = {}) {
  if (!file) {
    throw ApiError.badRequest('No file uploaded.', undefined, 'NO_IMPORT_FILE');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file.buffer);
  } catch {
    throw ApiError.badRequest('This file is not a valid Excel workbook.', undefined, 'INVALID_IMPORT_FILE');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw ApiError.badRequest('The uploaded file has no worksheet.', undefined, 'INVALID_IMPORT_FILE');
  }

  const { candidates, errors, manufacturers } = parseWorkbookRows(sheet, { requirePrice });
  // Pricing + the EXCHANGE_RATE_UNAVAILABLE check, both before either import
  // function below writes anything (see resolvePricesInUsd). Post-conversion
  // price failures are appended to `errors` and their rows dropped from the
  // returned candidates.
  const { candidates: pricedCandidates, exchangeRateUsed, convertedFromSyp } =
    await resolvePricesInUsd(candidates, errors);

  return {
    candidates: pricedCandidates,
    errors,
    manufacturers,
    exchangeRateUsed,
    convertedFromSyp,
  };
}

async function importFromExcel(file) {
  const { candidates, errors, exchangeRateUsed, convertedFromSyp } = await loadAndParseUpload(file, {
    requirePrice: false,
  });

  let added = 0;
  let updated = 0;

  for (const candidate of candidates) {
    try {
      // Upsert on (nameAr, manufacturerAr) - re-importing the same drug just
      // refreshes its price (and reactivates it) instead of duplicating. A
      // plain findOneAndUpdate({upsert:true, new:true, rawResult:true})
      // can't tell added from updated here - Mongoose returns the bare
      // document (not the {value, lastErrorObject} wrapper) once `new` is
      // combined with `rawResult`, so the two steps are kept explicit.
      const existing = await ProductCatalog.findOne({
        nameAr: candidate.nameAr,
        manufacturerAr: candidate.manufacturerAr,
      });
      if (existing) {
        // A blank price on the file never erases a price the item already
        // has - only a real number (re)sets it. Leaves the field untouched
        // rather than nulling out a price a warehouse already filled in.
        if (candidate.priceUsd !== null) {
          existing.priceUsd = candidate.priceUsd;
        }
        existing.isActive = true;
        await existing.save();
        updated += 1;
      } else {
        await ProductCatalog.create({
          nameAr: candidate.nameAr,
          manufacturerAr: candidate.manufacturerAr,
          priceUsd: candidate.priceUsd, // may be null - project owner's call, see parseWorkbookRows
        });
        added += 1;
      }
    } catch (err) {
      errors.push({ row: candidate.rowNumber, reason: 'Failed to save this row.' });
    }
  }

  return { added, updated, errors, exchangeRateUsed, convertedFromSyp };
}

module.exports = {
  listCatalog,
  searchActiveForWarehouse,
  updateCatalogItem,
  deactivateCatalogItem,
  generateTemplateBuffer,
  generateWarehouseTemplateBuffer,
  importFromExcel,
  // Reused by warehouseProduct.service.js for its own import (Section 14
  // Part 2) and by every service that reads Product docs for display.
  loadAndParseUpload,
  resolveProductIdentity,
  applyResolvedIdentity,
  escapeRegex,
};

const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const { ApiError } = require('../utils/ApiError');
const ProductCatalog = require('../models/productCatalog.model');
const Category = require('../models/category.model');

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
const PRICE_HEADER_TEXT = 'السعر (دولار)';
const NOTE_TEXT =
  'صف بخلفية صفراء = اسم الشركة، الصفوف التالية = أدويتها، صف فاضي = فاصل';
const WAREHOUSE_NOTE_TEXT =
  'صف بخلفية صفراء = اسم الشركة، الصفوف التالية = أدويتها، صف فاضي = فاصل. الأسماء لازم تطابق القائمة المركزية بالضبط.';
const MANUFACTURER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

// Shared by both templates below (admin's master-list template and the
// warehouse's own import template, Section 14 Part 1 vs Part 2) - same
// two-column/company-row shape, only the header/note text and example rows
// differ.
async function buildTemplateWorkbook({ nameHeader, noteText, examples }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catalog', { views: [{ rightToLeft: true }] });

  sheet.columns = [{ width: 42 }, { width: 18 }];

  sheet.mergeCells('A1:B1');
  const noteCell = sheet.getCell('A1');
  noteCell.value = noteText;
  noteCell.font = { italic: true, color: { argb: 'FF5A6B87' } };
  noteCell.alignment = { wrapText: true, horizontal: 'right', readingOrder: 'rtl' };
  sheet.getRow(1).height = 30;

  const headerRow = sheet.addRow([nameHeader, PRICE_HEADER_TEXT]);
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
    sheet.mergeCells(`A${row.number}:B${row.number}`);
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.fill = MANUFACTURER_FILL;
      cell.alignment = { horizontal: 'right', readingOrder: 'rtl' };
    });
  }

  function addProductRow(nameAr, priceUsd) {
    const row = sheet.addRow([nameAr, priceUsd]);
    row.getCell(1).alignment = { horizontal: 'right', readingOrder: 'rtl' };
  }

  for (const group of examples) {
    addManufacturerRow(group.manufacturerAr);
    for (const product of group.products) {
      addProductRow(product.nameAr, product.priceUsd);
    }
    if (group !== examples[examples.length - 1]) {
      sheet.addRow([]);
    }
  }

  return workbook;
}

const ADMIN_EXAMPLES = [
  {
    manufacturerAr: 'شركة الشرق للأدوية',
    products: [
      { nameAr: 'باراسيتامول 500 ملغ', priceUsd: 2.5 },
      { nameAr: 'أموكسيسيلين 250 ملغ', priceUsd: 4.8 },
    ],
  },
  { manufacturerAr: 'شركة سوريا فارم', products: [{ nameAr: 'فولتارين 50 ملغ', priceUsd: 3.2 }] },
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
const KNOWN_NOTE_TEXTS = new Set([NOTE_TEXT, WAREHOUSE_NOTE_TEXT]);

// Real-world uploaded files (as opposed to our own generated template) have
// been seen with a leading file-title row on top of the note/header rows -
// three header-ish rows total before any real data. Content-based matching
// alone (KNOWN_HEADER_TEXTS/KNOWN_NOTE_TEXTS below) only catches rows whose
// text matches one of our own template's exact strings, so a hand-edited
// title row slips through and gets misread as a medicine with no
// manufacturer above it. Rows 1-3 are always skipped outright, regardless of
// content, before any interpretation happens.
const LEADING_ROWS_TO_SKIP = 3;

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
// those rows become candidates with `priceUsd: null` instead of errors.
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

    const priceCell = row.getCell(2);
    const priceRaw = priceCell.value;
    const priceUsd = typeof priceRaw === 'number' ? priceRaw : Number(cellText(priceCell));
    const hasValidPrice = Number.isFinite(priceUsd) && priceUsd > 0;

    if (!hasValidPrice && requirePrice) {
      errors.push({ row: rowNumber, reason: 'Missing or invalid price.' });
      return;
    }

    candidates.push({
      rowNumber,
      nameAr: nameText,
      manufacturerAr: currentManufacturer,
      priceUsd: hasValidPrice ? priceUsd : null,
    });
  });

  return { candidates, errors, manufacturers: [...manufacturers] };
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

  return parseWorkbookRows(sheet, { requirePrice });
}

async function importFromExcel(file) {
  const { candidates, errors } = await loadAndParseUpload(file, { requirePrice: false });

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

  return { added, updated, errors };
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

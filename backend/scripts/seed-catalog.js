// Creates a demo warehouse (active/approved) plus categories and products so
// the catalog screen has something real to show. There's no warehouse
// self-registration or product-management endpoint yet, so this is the only
// way to get testable data in right now - same idea as create-admin.js.
//
// TODO(seed-images): every product below has image: null on purpose. The
// project owner hasn't picked an image API yet (Unsplash/Pexels/Pixabay -
// Section 14), so this script deliberately does not call any external image
// service. Once a provider + API key are chosen, swap the `image: null`
// lines below for real URLs (or extend this script to fetch them) - no
// other code needs to change, the client already renders a placeholder for
// a null image.
//
// Usage: npm run seed-catalog -- 0900000001 <password>
// <password> is optional - when given (or when the account has none yet),
// it's set/updated so the warehouse can log in with phone + password
// (Section 6-2/3 - OTP is temporarily disabled, see auth.service.js).
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');
const Category = require('../src/models/category.model');
const Product = require('../src/models/product.model');
const Offer = require('../src/models/offer.model');

const CATEGORIES = [
  { nameAr: 'مسكنات', nameEn: 'Pain Relief', sortOrder: 1 },
  { nameAr: 'مضادات حيوية', nameEn: 'Antibiotics', sortOrder: 2 },
  { nameAr: 'فيتامينات', nameEn: 'Vitamins', sortOrder: 3 },
  { nameAr: 'عناية بالبشرة', nameEn: 'Skin Care', sortOrder: 4 },
];

async function findOrCreateCategory(data) {
  const existing = await Category.findOne({ nameEn: data.nameEn });
  if (existing) return existing;
  return Category.create({ ...data, icon: null });
}

async function findOrCreateProduct(data) {
  const existing = await Product.findOne({ warehouseId: data.warehouseId, nameEn: data.nameEn });
  if (existing) return existing;
  return Product.create(data);
}

async function main() {
  const phone = process.argv[2] || '0900000001';
  const password = process.argv[3];

  await mongoose.connect(env.mongodbUri);

  let user = await User.findOne({ phone }).select('+password');
  if (!user) {
    if (!password) {
      console.error('No account exists for this phone yet - a password is required to create one.');
      console.error('Usage: npm run seed-catalog -- <phone> <password>');
      process.exitCode = 1;
      return;
    }
    user = await User.create({
      name: 'Al-Najah Warehouse Owner',
      phone,
      role: 'warehouse',
      status: 'active',
      password: await bcrypt.hash(password, 10),
    });
  } else {
    user.role = 'warehouse';
    user.status = 'active';
    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }
    await user.save();
  }

  let warehouse = await Warehouse.findOne({ userId: user._id });
  if (!warehouse) {
    warehouse = await Warehouse.create({
      userId: user._id,
      nameAr: 'مستودع النجاح',
      nameEn: 'Al-Najah Warehouse',
      address: 'Main Street',
      city: 'Latakia',
      phone,
      logo: null, // TODO(seed-images): same placeholder note as products above.
      isActive: true,
    });
  }

  const categories = {};
  for (const c of CATEGORIES) {
    categories[c.nameEn] = await findOrCreateCategory(c);
  }

  // Section: USD-first catalog pricing - `price` below is USD (see
  // product.model.js), not the old SYP figures this script used to seed.
  const products = [
    {
      categoryId: categories['Pain Relief']._id,
      nameAr: 'باراسيتامول 500 ملغ', nameEn: 'Paracetamol 500mg',
      manufacturerAr: 'شركة الأدوية الوطنية', manufacturerEn: 'National Pharma',
      unitAr: 'علبة', unitEn: 'Box',
      price: 3.5, manuallyDisabled: false,
    },
    {
      categoryId: categories['Pain Relief']._id,
      nameAr: 'إيبوبروفين 400 ملغ', nameEn: 'Ibuprofen 400mg',
      manufacturerAr: 'شركة الشرق للأدوية', manufacturerEn: 'Al-Sharq Pharma',
      unitAr: 'علبة', unitEn: 'Box',
      price: 4.5, manuallyDisabled: false,
    },
    {
      categoryId: categories['Antibiotics']._id,
      nameAr: 'أموكسيسيلين 500 ملغ', nameEn: 'Amoxicillin 500mg',
      manufacturerAr: 'شركة الأدوية الوطنية', manufacturerEn: 'National Pharma',
      unitAr: 'علبة', unitEn: 'Box',
      price: 6, manuallyDisabled: false,
    },
    {
      categoryId: categories['Antibiotics']._id,
      nameAr: 'أزيثروميسين 250 ملغ', nameEn: 'Azithromycin 250mg',
      manufacturerAr: 'شركة الفا للأدوية', manufacturerEn: 'Alpha Pharma',
      unitAr: 'علبة', unitEn: 'Box',
      price: 8, manuallyDisabled: false,
    },
    {
      categoryId: categories['Vitamins']._id,
      nameAr: 'فيتامين د 1000 وحدة', nameEn: 'Vitamin D 1000 IU',
      manufacturerAr: 'شركة الحياة للأدوية', manufacturerEn: 'Al-Hayat Pharma',
      unitAr: 'علبة', unitEn: 'Box',
      price: 5, manuallyDisabled: false,
    },
    {
      categoryId: categories['Vitamins']._id,
      nameAr: 'فيتامين سي 500 ملغ', nameEn: 'Vitamin C 500mg',
      manufacturerAr: 'شركة الحياة للأدوية', manufacturerEn: 'Al-Hayat Pharma',
      unitAr: 'علبة', unitEn: 'Box',
      price: 3, manuallyDisabled: true, // manually paused -> dimmed, stays unavailable
    },
    {
      categoryId: categories['Skin Care']._id,
      nameAr: 'كريم مرطب', nameEn: 'Moisturizing Cream',
      manufacturerAr: 'شركة الشرق للأدوية', manufacturerEn: 'Al-Sharq Pharma',
      unitAr: 'أنبوب', unitEn: 'Tube',
      price: 5.5, manuallyDisabled: false,
    },
    {
      categoryId: categories['Skin Care']._id,
      nameAr: 'واقي شمس SPF 50', nameEn: 'Sunscreen SPF 50',
      manufacturerAr: 'شركة الفا للأدوية', manufacturerEn: 'Alpha Pharma',
      unitAr: 'أنبوب', unitEn: 'Tube',
      price: 7.5, manuallyDisabled: false,
    },
  ];

  const createdProducts = [];
  for (const p of products) {
    const isAvailable = !p.manuallyDisabled;
    const product = await findOrCreateProduct({
      ...p,
      warehouseId: warehouse._id,
      image: null, // TODO(seed-images): see note at the top of this file.
      isAvailable,
    });
    createdProducts.push(product);
  }

  // One active, approved offer so the catalog's struck-through pricing is
  // actually visible in the demo data (Section 6.5 / Section 7).
  const offerTarget = createdProducts.find((p) => p.nameEn === 'Paracetamol 500mg');
  if (offerTarget) {
    const existingOffer = await Offer.findOne({ productId: offerTarget._id, status: 'approved' });
    if (!existingOffer) {
      const now = new Date();
      await Offer.create({
        warehouseId: warehouse._id,
        productId: offerTarget._id,
        titleAr: 'خصم افتتاحي',
        titleEn: 'Launch discount',
        discountPercentage: 15,
        startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        status: 'approved',
        approvedAt: now,
      });
    }
  }

  console.log(`Seeded warehouse "${warehouse.nameEn}" (${phone}) with ${categories.length ?? CATEGORIES.length} categories and ${createdProducts.length} products.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

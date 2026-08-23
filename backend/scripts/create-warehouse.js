// One-off bootstrap script: there's no self-service way to create a
// warehouse account (by design, same as admin - see create-admin.js).
// Run once per real warehouse to create its login + profile.
//
// Usage: npm run create-warehouse -- "Name (EN)" "الاسم (عربي)" <phone> <password> "Address" "City"
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const User = require('../src/models/user.model');
const Warehouse = require('../src/models/warehouse.model');

const BCRYPT_SALT_ROUNDS = 10;

function usage() {
  console.error(
    'Usage: npm run create-warehouse -- "Name (EN)" "الاسم (عربي)" <phone> <password> "Address" "City"'
  );
}

async function main() {
  const [nameEn, nameAr, phone, password, address, city] = process.argv.slice(2);
  if (!nameEn || !nameAr || !phone || !password || !address || !city) {
    usage();
    process.exitCode = 1;
    return;
  }
  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(env.mongodbUri);

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  let user = await User.findOne({ phone });
  if (user) {
    user.name = nameEn;
    user.role = 'warehouse';
    user.status = 'active';
    user.password = hashedPassword;
    await user.save();
    console.log(`Updated existing account for ${phone} to warehouse/active with the given password.`);
  } else {
    user = await User.create({
      name: nameEn,
      phone,
      role: 'warehouse',
      status: 'active',
      password: hashedPassword,
    });
    console.log(`Created warehouse login "${nameEn}" (${phone}).`);
  }

  let warehouse = await Warehouse.findOne({ userId: user._id });
  if (warehouse) {
    warehouse.nameAr = nameAr;
    warehouse.nameEn = nameEn;
    warehouse.address = address;
    warehouse.city = city;
    warehouse.phone = phone;
    warehouse.isActive = true;
    await warehouse.save();
    console.log('Updated existing warehouse profile.');
  } else {
    await Warehouse.create({
      userId: user._id,
      nameAr,
      nameEn,
      address,
      city,
      phone,
      isActive: true,
    });
    console.log('Created warehouse profile.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

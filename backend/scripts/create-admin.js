// One-off bootstrap script: there's no self-service way to create an admin
// account (by design - Section 15's authorization model requires admin be
// provisioned out-of-band). Run once to create the first admin, who can then
// log into the React panel with phone + password (Section 6-2/3 - OTP is
// temporarily disabled, see auth.service.js).
//
// Usage: npm run create-admin -- "Dr. Owner" 0944000000 <password>
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const User = require('../src/models/user.model');

const BCRYPT_SALT_ROUNDS = 10;

async function main() {
  const [name, phone, password] = process.argv.slice(2);
  if (!name || !phone || !password) {
    console.error('Usage: npm run create-admin -- "<name>" <phone> <password>');
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

  const existing = await User.findOne({ phone });
  if (existing) {
    existing.name = name;
    existing.role = 'admin';
    existing.status = 'active';
    existing.password = hashedPassword;
    await existing.save();
    console.log(`Updated existing account for ${phone} to admin/active with the given password.`);
  } else {
    await User.create({ name, phone, role: 'admin', status: 'active', password: hashedPassword });
    console.log(`Created admin account "${name}" (${phone}).`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

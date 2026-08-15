// One-off bootstrap script: there's no self-service way to create an admin
// account (by design - Section 15's authorization model requires admin be
// provisioned out-of-band). Run once to create the first admin, who can then
// log into the React panel with the same phone/OTP mechanism as everyone else.
//
// Usage: npm run create-admin -- "Dr. Owner" 0944000000
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/user.model');

async function main() {
  const [name, phone] = process.argv.slice(2);
  if (!name || !phone) {
    console.error('Usage: npm run create-admin -- "<name>" <phone>');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(env.mongodbUri);

  const existing = await User.findOne({ phone });
  if (existing) {
    existing.name = name;
    existing.role = 'admin';
    existing.status = 'active';
    await existing.save();
    console.log(`Updated existing account for ${phone} to admin/active.`);
  } else {
    await User.create({ name, phone, role: 'admin', status: 'active' });
    console.log(`Created admin account "${name}" (${phone}).`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

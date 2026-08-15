// Normalizes to a consistent storage format and accepts Syrian mobile numbers
// in either local (09XXXXXXXX) or international (+9639XXXXXXXX) form.
const PHONE_REGEX = /^(?:\+963|0)9\d{8}$/;

function normalizePhone(phone) {
  if (typeof phone !== 'string') {
    return '';
  }
  return phone.replace(/[\s-]/g, '');
}

function isValidPhone(phone) {
  return typeof phone === 'string' && PHONE_REGEX.test(phone);
}

module.exports = { normalizePhone, isValidPhone };

// The one shape every SMS transport must implement.
//
// Why this exists as an interface rather than an `if` in otp.service.js:
// reaching Syrian numbers is still an open question (commercial gateways
// route there poorly under sanctions, a self-hosted android-sms-gateway is
// on the table, and the official WhatsApp Business API is not available for
// the market). Whichever one is eventually chosen, it must not require
// touching the OTP logic - the code that mints, expires and verifies a
// verification code has nothing to do with how the text is carried.
//
// Adding a provider is: subclass this, implement `name` and `send`, register
// it in ./index.js, and set SMS_PROVIDER in the environment. Nothing else in
// the application changes.
class SmsProvider {
  // Matches the SMS_PROVIDER env value that selects this provider.
  get name() {
    throw new Error(`${this.constructor.name} must define a \`name\` getter.`);
  }

  // Delivers `message` to `phone`. Resolves on success, rejects on failure.
  //
  // The contract is deliberately fire-and-confirm, not fire-and-forget: the
  // caller (otp.service.js) awaits it and lets a rejection propagate, so a
  // dead gateway surfaces as a failed request rather than as a user waiting
  // forever for a code that was never sent.
  //
  // `phone` arrives already normalised and validated (utils/phone.js) - a
  // provider must not re-parse or reformat it beyond whatever its own wire
  // format demands.
  // eslint-disable-next-line no-unused-vars
  async send(phone, message) {
    throw new Error(`${this.constructor.name} must implement send(phone, message).`);
  }
}

module.exports = { SmsProvider };

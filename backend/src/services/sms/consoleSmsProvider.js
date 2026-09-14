const { SmsProvider } = require('./smsProvider');

// The development transport, and the default: it prints the message instead
// of sending it, so the whole OTP flow (forgot password -> code -> reset) is
// exercisable end to end with no gateway account and no cost.
//
// This is the behaviour otp.service.js had inline before the provider
// interface existed - moved here unchanged, including the log format, so
// existing local workflows that read the code off the server log keep working.
class ConsoleSmsProvider extends SmsProvider {
  get name() {
    return 'console';
  }

  async send(phone, message) {
    // eslint-disable-next-line no-console
    console.log(`[SMS -> ${phone}] ${message}`);
  }
}

module.exports = { ConsoleSmsProvider };

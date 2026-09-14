const env = require('../../config/env');
const { SmsProvider } = require('./smsProvider');
const { ConsoleSmsProvider } = require('./consoleSmsProvider');

// Resolves the configured SMS transport. One registry, one env switch.
//
// No real gateway is wired up yet - that decision is still open (see
// smsProvider.js). `console` is the only registered provider and the default,
// which means the OTP flow works end to end in development and is a no-op in
// production until a provider is both written and selected.
//
// To add one later:
//   1. class UnimatrixProvider extends SmsProvider { get name() {...} send() {...} }
//   2. registerSmsProvider('unimatrix', () => new UnimatrixProvider(env.sms));
//   3. SMS_PROVIDER=unimatrix
// Nothing in otp.service.js or the auth layer changes.
const factories = new Map();

function registerSmsProvider(name, factory) {
  factories.set(name, factory);
}

registerSmsProvider('console', () => new ConsoleSmsProvider());

// Memoised per provider name rather than globally, so a test that re-registers
// a provider and re-reads env isn't served a stale instance from a previous
// configuration.
const instances = new Map();

function getSmsProvider(name = env.sms.provider) {
  const key = name || 'console';
  if (instances.has(key)) return instances.get(key);

  const factory = factories.get(key);
  if (!factory) {
    // A server error, not a user error: the deployment named a transport that
    // does not exist. Thrown at resolve time (i.e. on the first send attempt)
    // rather than at boot so a misconfigured SMS_PROVIDER cannot take down
    // routes that never send a message.
    throw new Error(
      `SMS provider "${key}" is not registered. Known providers: ${[...factories.keys()].join(', ')}. ` +
        'Add one in services/sms/ and register it in services/sms/index.js, or set SMS_PROVIDER=console.'
    );
  }

  const instance = factory();
  instances.set(key, instance);
  return instance;
}

// Exported for tests, which swap in a recording provider rather than asserting
// against console output.
function _resetSmsProviders() {
  instances.clear();
}

module.exports = { SmsProvider, getSmsProvider, registerSmsProvider, _resetSmsProviders };

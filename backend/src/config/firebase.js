const fs = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const config = require('./env');

// Two ways to get a credential (see .env.example): a downloaded service
// account JSON (local dev - path only, the file itself never enters this
// repo) or the three fields set directly as env vars (hosts with no
// persistent filesystem to point a path at, e.g. Railway/Heroku). Neither
// present, or the path doesn't resolve to a real file, means notifications
// are a no-op app-wide - nothing else in the app depends on Firebase being
// configured, so this must never throw and take the whole server down with
// it (see notification.service.js).
function loadCredential() {
  const { serviceAccountPath, projectId, privateKey, clientEmail } = config.firebase;

  if (serviceAccountPath) {
    // TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task) - no secrets, just presence.
    // eslint-disable-next-line no-console
    console.log('FIREBASE_DEBUG: service account path configured');
    const serviceAccountFileExists = fs.existsSync(serviceAccountPath);
    // eslint-disable-next-line no-console
    console.log(`FIREBASE_DEBUG: service account file exists = ${serviceAccountFileExists}`);
    if (!serviceAccountFileExists) {
      // eslint-disable-next-line no-console
      console.warn(
        `FIREBASE_SERVICE_ACCOUNT_PATH is set to "${serviceAccountPath}" but that file doesn't exist - push notifications are disabled until it's in place.`
      );
      return null;
    }
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    return cert(serviceAccount);
  }

  if (projectId && privateKey && clientEmail) {
    return cert({ projectId, privateKey, clientEmail });
  }

  // eslint-disable-next-line no-console
  console.warn(
    'No Firebase credential configured (FIREBASE_SERVICE_ACCOUNT_PATH or the FIREBASE_PROJECT_ID/PRIVATE_KEY/CLIENT_EMAIL trio) - push notifications are disabled.'
  );
  return null;
}

const credential = loadCredential();
const firebaseApp = credential ? initializeApp({ credential }) : null;

// null when Firebase isn't configured - callers must check this rather than
// assume it's always available (see notification.service.js).
const messaging = firebaseApp ? getMessaging(firebaseApp) : null;

// TEMP DIAGNOSTIC LOGS (see FCM_DEBUG task) - no secrets, just booleans.
// eslint-disable-next-line no-console
console.log(`FIREBASE_DEBUG: Firebase Admin initialized = ${Boolean(firebaseApp)}`);
// eslint-disable-next-line no-console
console.log(`FIREBASE_DEBUG: Messaging initialized = ${Boolean(messaging)}`);

module.exports = { messaging };

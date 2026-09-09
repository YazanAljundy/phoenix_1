require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 4000,
  mongodbUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  // 24h, down from 7d (audit F-03). A stolen access token is now useful for
  // a day rather than a week; clients ride over the expiry with the refresh
  // token instead of bouncing the user to the login screen.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  // How long a refresh token stays valid. Rotated on every use, so this is
  // the cap on an idle session, not on a live one.
  refreshTokenTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS, 10) || 30,
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  sms: {
    provider: process.env.SMS_PROVIDER || 'console',
    apiKey: process.env.SMS_PROVIDER_API_KEY || '',
    senderId: process.env.SMS_PROVIDER_SENDER_ID || '',
  },
  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
  },
  r2: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || '',
    endpoint: process.env.R2_ENDPOINT || '',
  },
  // Cloudinary is where every user-uploaded image actually lives (banner
  // images, return photos) - the server itself keeps nothing on disk. See
  // config/cloudinary.js and services/upload.service.js.
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  imageApiKey: process.env.IMAGE_API_KEY || '',
  exchangeRateApiKey: process.env.EXCHANGE_RATE_API_KEY || '',
};

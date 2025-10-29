require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = {
  project_id: process.env.GOOGLE_PROJECT_ID,
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firestore = admin.firestore();

module.exports = { admin, firestore };

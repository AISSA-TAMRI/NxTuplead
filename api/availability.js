export default async function handler(req, res) {
  return res.status(200).json({
    project: process.env.GOOGLE_PROJECT_ID || null,
    email: process.env.GOOGLE_CLIENT_EMAIL || null,
    privateKeyExists: !!process.env.GOOGLE_PRIVATE_KEY
  });
}

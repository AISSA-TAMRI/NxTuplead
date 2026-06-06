import { google } from 'googleapis';

export default async function handler(req, res) {
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });

    const token = await auth.authorize();

    res.status(200).json({
      success: true,
      token: !!token.access_token
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
}

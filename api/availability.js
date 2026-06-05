import { google } from 'googleapis';

export default async function handler(req, res) {
  try {

    const key = process.env.GOOGLE_PRIVATE_KEY;

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: key,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });

    const token = await auth.authorize();

    return res.status(200).json({
      success: true,
      tokenExists: !!token.access_token
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      stack: error.stack
    });
  }
}

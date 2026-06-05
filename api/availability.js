import { google } from 'googleapis';

export default async function handler(req, res) {
  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY,
      ['https://www.googleapis.com/auth/calendar']
    );

    const token = await auth.authorize();

    return res.status(200).json({
      success: true,
      tokenExists: !!token.access_token
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      details: error.response?.data || null
    });
  }
}

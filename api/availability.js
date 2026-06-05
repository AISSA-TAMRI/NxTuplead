import { google } from 'googleapis';

export default async function handler(req, res) {
  try {
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/calendar']
    );

    await auth.authorize();

    const calendar = google.calendar({
      version: 'v3',
      auth
    });

    const result = await calendar.calendars.get({
      calendarId: 'primary'
    });

    return res.status(200).json(result.data);

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      details: error.response?.data
    });
  }
}

import { google } from 'googleapis';

export default async function handler(req, res) {
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });

    const calendar = google.calendar({
      version: 'v3',
      auth
    });

    const events = await calendar.events.list({
      calendarId: 'primary',
      maxResults: 10
    });

    return res.status(200).json({
      success: true,
      events: events.data.items
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

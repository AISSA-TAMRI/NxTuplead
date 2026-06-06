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
      calendarId: '75537187f4967e4d458c22654a730f09a9a58c2d1709d271f40134274a96fb9b@group.calendar.google.com',
      singleEvents: true,
      orderBy: 'startTime',
      timeMin: '2026-06-02T00:00:00Z',
      timeMax: '2026-06-03T00:00:00Z'
    });

    return res.status(200).json({
      success: true,
      count: events.data.items.length,
      events: events.data.items
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

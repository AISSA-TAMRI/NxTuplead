import { google } from 'googleapis';

const CALENDAR_ID =
'75537187f4967e4d458c22654a730f09a9a58c2d1709d271f40134274a96fb9b@group.calendar.google.com';

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

const event = await calendar.events.insert({
  calendarId: CALENDAR_ID,
  requestBody: {
    summary: 'TEST BOOKING',
    start: {
      dateTime: '2026-06-10T10:00:00+01:00',
      timeZone: 'Africa/Algiers'
    },
    end: {
      dateTime: '2026-06-10T11:00:00+01:00',
      timeZone: 'Africa/Algiers'
    }
  }
});

return res.status(200).json({
  success: true,
  eventId: event.data.id
});

} catch (error) {
return res.status(500).json({
success: false,
error: error.message
});
}
}

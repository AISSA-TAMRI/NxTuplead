import { google } from 'googleapis';

export default async function handler(req, res) {
try {
const { date } = req.query;

if (!date) {
  return res.status(400).json({
    success: false,
    message: 'date parameter is required'
  });
}

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY,
  scopes: ['https://www.googleapis.com/auth/calendar']
});

const calendar = google.calendar({
  version: 'v3',
  auth
});

const startOfDay = new Date(`${date}T00:00:00`);
const endOfDay = new Date(`${date}T23:59:59`);

const events = await calendar.events.list({
  calendarId: '75537187f4967e4d458c22654a730f09a9a58c2d1709d271f40134274a96fb9b@group.calendar.google.com',
  singleEvents: true,
  orderBy: 'startTime',
  timeMin: startOfDay.toISOString(),
  timeMax: endOfDay.toISOString()
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

import { google } from 'googleapis';

const CALENDAR_ID = 'issatamri1999@gmail.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      company_name,
      startTime,
      endTime
    } = req.body;

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY,
      scopes: [
        'https://www.googleapis.com/auth/calendar'
      ]
    });

    const calendar = google.calendar({
      version: 'v3',
      auth
    });

    const event = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      conferenceDataVersion: 1,

      requestBody: {
        summary: `Strategy Call - ${first_name} ${last_name}`,

        description: `
Name: ${first_name} ${last_name}
Email: ${email}
Phone: ${phone}
Company: ${company_name}
`,

        start: {
          dateTime: startTime,
          timeZone: 'Africa/Algiers'
        },

        end: {
          dateTime: endTime,
          timeZone: 'Africa/Algiers'
        },

        conferenceData: {
          createRequest: {
            requestId: `strategy-${Date.now()}`,
            conferenceSolutionKey: {
              type: 'hangoutsMeet'
            }
          }
        }
      }
    });

    return res.status(200).json({
      success: true,
      eventId: event.data.id,
      meetLink: event.data.hangoutLink,
      calendarLink: event.data.htmlLink
    });

  } catch (error) {
  console.error('FULL ERROR:', error);

  return res.status(500).json({
    success: false,
    message: error.message,
    details: error.response?.data || null,
    stack: error.stack
  });
}
}

  }

}

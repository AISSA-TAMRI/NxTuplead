export default async function handler(req, res) {
  // Ensure only POST requests are allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Forward the incoming request body to the n8n webhook
    const response = await fetch(
      'https://n8n.upleaddigital.com/webhook/216f9e34-e437-4c51-a44b-c14051108fb6',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      }
    );

    // Get the response text from the n8n webhook
   const response = await fetch(
  'https://n8n.upleaddigital.com/webhook/216f9e34-e437-4c51-a44b-c14051108fb6',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(req.body)
  }
);

const data = await response.text();

if (!response.ok) {
  return res.status(response.status).json({
    success: false,
    error: data
  });
}

return res.status(200).json({
  success: true,
  response: data
});

  } catch (error) {
    // Handle any errors during the fetch operation
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

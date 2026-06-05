return res.status(200).json({
  keyLength: process.env.GOOGLE_PRIVATE_KEY?.length,
  firstChars: process.env.GOOGLE_PRIVATE_KEY?.substring(0, 30)
});

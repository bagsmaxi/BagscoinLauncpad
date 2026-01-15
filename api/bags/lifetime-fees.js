const https = require('https');

const BAGS_API_KEY = process.env.BAGS_API_KEY;

function proxyRequest(targetUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-key': BAGS_API_KEY
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });

    req.on('error', reject);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { tokenMint } = req.query;

  if (!tokenMint) {
    return res.status(400).json({ error: 'Missing tokenMint parameter' });
  }

  try {
    const targetUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/lifetime-fees?tokenMint=${tokenMint}`;
    const result = await proxyRequest(targetUrl);
    res.status(result.statusCode).send(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

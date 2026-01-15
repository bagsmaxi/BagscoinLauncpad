const https = require('https');

const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL;

function proxyRequest(targetUrl, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = JSON.stringify(req.body);
    const result = await proxyRequest(HELIUS_RPC_URL, body);
    res.status(result.statusCode).send(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

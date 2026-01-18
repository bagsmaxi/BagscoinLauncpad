/**
 * Simple local development server for Bags Index
 * Run: node server.js
 * Then open: http://localhost:3001
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { BagsSDK } = require('@bagsfm/bags-sdk');
const { Connection, PublicKey } = require('@solana/web3.js');

// Load environment variables (for production)
require('dotenv').config();

const PORT = process.env.PORT || 3001;

// API Configuration from environment variables
const BAGS_API_KEY = process.env.BAGS_API_KEY || 'bags_prod_bk_8fBgAJgIsm7T2sXFxi8aYWLIgKfwcWHfuAf0ld3s';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=0d709c4e-dfbf-4bcd-bffb-1080188c2a14';
// Partner config key for platform revenue (from dev.bags.fm)
const PARTNER_CONFIG_KEY = 'BoWTinLevvUkb8kRrcmfVnmqq8uKKetTwsc2eEJcrxZp';
// Fallback config key (dynamically created per launch)
const DEFAULT_CONFIG_KEY = null;
// Bags API URL (production - same API for all keys)
const BAGS_API_BASE_URL = process.env.BAGS_API_BASE_URL || 'https://public-api-v2.bags.fm/api/v1';

// Initialize Bags SDK
let bagsSDK = null;
let solanaConnection = null;
async function initBagsSDK() {
    try {
        solanaConnection = new Connection(HELIUS_RPC_URL);
        bagsSDK = new BagsSDK(BAGS_API_KEY, solanaConnection);
        console.log('Bags SDK initialized successfully');
    } catch (error) {
        console.error('Failed to initialize Bags SDK:', error.message);
    }
}
initBagsSDK();

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

/**
 * Parse multipart form data
 */
function parseMultipartForm(buffer, boundary) {
    const result = {};
    const parts = [];

    // Convert to string for easier parsing, but keep buffer for binary data
    const content = buffer.toString('binary');
    const boundaryStr = '--' + boundary;
    const segments = content.split(boundaryStr);

    for (let i = 1; i < segments.length; i++) {
        const segment = segments[i];
        if (segment.startsWith('--')) continue; // End boundary

        // Find the header/content separator
        const headerEndIdx = segment.indexOf('\r\n\r\n');
        if (headerEndIdx === -1) continue;

        const headerPart = segment.substring(0, headerEndIdx);
        const contentPart = segment.substring(headerEndIdx + 4);

        // Remove trailing \r\n
        const cleanContent = contentPart.replace(/\r\n$/, '');

        // Parse Content-Disposition header
        const nameMatch = headerPart.match(/name="([^"]+)"/);
        const filenameMatch = headerPart.match(/filename="([^"]+)"/);
        const contentTypeMatch = headerPart.match(/Content-Type:\s*([^\r\n]+)/i);

        if (nameMatch) {
            const fieldName = nameMatch[1];

            if (filenameMatch) {
                // File field - convert back to buffer
                const fileBuffer = Buffer.from(cleanContent, 'binary');
                result[fieldName] = {
                    filename: filenameMatch[1],
                    contentType: contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream',
                    data: fileBuffer
                };
            } else {
                // Regular text field
                result[fieldName] = cleanContent;
            }
        }
    }

    return result;
}

/**
 * Proxy request to external API
 */
function proxyRequest(targetUrl, req, res, method = 'GET', body = null) {
    const url = new URL(targetUrl);

    const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'BagscreenerApp/1.0'
        }
    };

    if (body) {
        options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const proxyReq = https.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
            res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(data);
        });
    });

    proxyReq.on('error', (err) => {
        console.error('Proxy error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    });

    if (body) {
        proxyReq.write(body);
    }
    proxyReq.end();
}

/**
 * Proxy request to Bags API with authentication
 */
function proxyRequestWithAuth(targetUrl, req, res, method = 'GET', body = null) {
    const url = new URL(targetUrl);

    const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'BagscreenerApp/1.0',
            'x-api-key': BAGS_API_KEY
        }
    };

    if (body) {
        options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const proxyReq = https.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
            res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(data);
        });
    });

    proxyReq.on('error', (err) => {
        console.error('Bags API proxy error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    });

    if (body) {
        proxyReq.write(body);
    }
    proxyReq.end();
}

const server = http.createServer(async (req, res) => {
    console.log(`${req.method} ${req.url}`);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // Jupiter API proxy - Quote (using lite-api.jup.ag - public endpoint)
    if (req.url.startsWith('/api/jupiter/quote')) {
        const queryString = req.url.split('?')[1] || '';
        const targetUrl = `https://lite-api.jup.ag/swap/v1/quote?${queryString}`;
        console.log('Proxying to Jupiter quote:', targetUrl);
        proxyRequest(targetUrl, req, res);
        return;
    }

    // Jupiter API proxy - Swap
    if (req.url === '/api/jupiter/swap' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            console.log('Proxying to Jupiter swap');
            proxyRequest('https://lite-api.jup.ag/swap/v1/swap', req, res, 'POST', body);
        });
        return;
    }

    // Bags API - Get Token Creator Info
    if (req.url.startsWith('/api/bags/creator')) {
        const urlParams = new URL(req.url, `http://localhost:${PORT}`);
        const tokenMint = urlParams.searchParams.get('tokenMint');

        if (!tokenMint) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing tokenMint parameter' }));
            return;
        }

        console.log('Fetching creator info for:', tokenMint);
        const targetUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/creator/v3?tokenMint=${tokenMint}`;
        proxyRequestWithAuth(targetUrl, req, res);
        return;
    }

    // Bags API - Get Token Claim Stats
    if (req.url.startsWith('/api/bags/claim-stats')) {
        const urlParams = new URL(req.url, `http://localhost:${PORT}`);
        const tokenMint = urlParams.searchParams.get('tokenMint');

        if (!tokenMint) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing tokenMint parameter' }));
            return;
        }

        console.log('Fetching claim stats for:', tokenMint);
        const targetUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/claim-stats?tokenMint=${tokenMint}`;
        proxyRequestWithAuth(targetUrl, req, res);
        return;
    }

    // Bags API - Get Token Lifetime Fees
    if (req.url.startsWith('/api/bags/lifetime-fees')) {
        const urlParams = new URL(req.url, `http://localhost:${PORT}`);
        const tokenMint = urlParams.searchParams.get('tokenMint');

        if (!tokenMint) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing tokenMint parameter' }));
            return;
        }

        console.log('Fetching lifetime fees for:', tokenMint);
        const targetUrl = `https://public-api-v2.bags.fm/api/v1/token-launch/lifetime-fees?tokenMint=${tokenMint}`;
        proxyRequestWithAuth(targetUrl, req, res);
        return;
    }

    // Helius RPC Proxy - for token discovery
    if (req.url === '/api/helius/rpc' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            console.log('Proxying Helius RPC request');
            proxyRequest(HELIUS_RPC_URL, req, res, 'POST', body);
        });
        return;
    }

    // Token Launch - Create Token Info (upload image + metadata)
    if (req.url === '/api/token/create-info' && req.method === 'POST') {
        console.log('Creating token info...');

        if (!bagsSDK) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Bags SDK not initialized' }));
            return;
        }

        // Collect multipart form data
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
            try {
                const buffer = Buffer.concat(chunks);
                const boundary = req.headers['content-type'].split('boundary=')[1];
                const formData = parseMultipartForm(buffer, boundary);

                if (!formData.image) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Image is required' }));
                    return;
                }

                console.log('Token info:', {
                    name: formData.name,
                    symbol: formData.symbol,
                    description: formData.description,
                    imageSize: formData.image?.data?.length
                });

                // Create token info via Bags SDK
                const tokenInfo = await bagsSDK.tokenLaunch.createTokenInfoAndMetadata({
                    name: formData.name,
                    symbol: formData.symbol,
                    description: formData.description,
                    image: formData.image.data,
                    twitter: formData.twitter || undefined,
                    telegram: formData.telegram || undefined,
                    website: formData.website || undefined
                });

                console.log('Token info created:', tokenInfo);

                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify(tokenInfo));
            } catch (error) {
                console.error('Token info creation error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message || 'Failed to create token info' }));
            }
        });
        return;
    }

    // Get Partner Config
    if (req.url.startsWith('/api/partner/config') && req.method === 'GET') {
        const urlParams = new URL(req.url, `http://${req.headers.host}`);
        const wallet = urlParams.searchParams.get('wallet');

        if (!wallet) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Wallet parameter required' }));
            return;
        }

        try {
            const partnerConfig = await bagsSDK.partner.getPartnerConfig(new PublicKey(wallet));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ config: partnerConfig }));
        } catch (error) {
            console.error('Get partner config error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message, needsSetup: true }));
        }
        return;
    }

    // Create Partner Config Transaction
    if (req.url === '/api/partner/create-config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { wallet } = JSON.parse(body);
                const result = await bagsSDK.partner.getPartnerConfigCreationTransaction(new PublicKey(wallet));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    transaction: Buffer.from(result.transaction.serialize()).toString('base64'),
                    blockhash: result.blockhash
                }));
            } catch (error) {
                console.error('Create partner config error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    // Create Fee Share Config - Get configKey for token launches
    if (req.url === '/api/fee-share/create-config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { payer, tokenMint, feeClaimers } = JSON.parse(body);

                // Default: creator gets all fees (100% = 10000 bps)
                const claimers = feeClaimers || [{ user: new PublicKey(payer), userBps: 10000 }];

                // Create fee share config without partner (partner requires wallet + config together)
                // Token creator gets full fee share, platform revenue comes from partner referral link
                const result = await bagsSDK.config.createBagsFeeShareConfig({
                    feeClaimers: claimers.map(c => ({
                        user: new PublicKey(c.user),
                        userBps: c.userBps
                    })),
                    payer: new PublicKey(payer),
                    baseMint: new PublicKey(tokenMint)
                });

                // Return transactions to sign and the config key
                const transactions = result.transactions?.map(tx =>
                    Buffer.from(tx.serialize()).toString('base64')
                ) || [];

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    transactions,
                    configKey: result.meteoraConfigKey.toBase58()
                }));
            } catch (error) {
                console.error('Create fee share config error:', error);
                // If config already exists, try to return existing
                if (error.message?.includes('already exists')) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ configKey: null, exists: true }));
                } else {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            }
        });
        return;
    }

    // Token Launch - Create Launch Transaction
    if (req.url === '/api/token/create-launch-tx' && req.method === 'POST') {
        console.log('Creating launch transaction...');

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { metadataUrl, tokenMint, launchWallet, initialBuyLamports, configKey } = data;

                // Use provided configKey (from fee share config creation)
                // Partner config key cannot be used directly - it requires full partner wallet setup
                const finalConfigKey = configKey;
                if (!finalConfigKey) {
                    throw new Error('Config key is required. Create fee share config first.');
                }
                console.log('Launch params:', {
                    metadataUrl,
                    tokenMint,
                    launchWallet,
                    initialBuyLamports,
                    configKey: finalConfigKey
                });

                // Create launch transaction via direct API call to dev endpoint
                const apiResponse = await new Promise((resolve, reject) => {
                    const postData = JSON.stringify({
                        ipfs: metadataUrl,
                        tokenMint: tokenMint,
                        wallet: launchWallet,
                        initialBuyLamports: initialBuyLamports || 0,
                        configKey: finalConfigKey
                    });

                    const apiUrl = new URL(`${BAGS_API_BASE_URL}/token-launch/create-launch-transaction`);
                    const options = {
                        hostname: apiUrl.hostname,
                        port: 443,
                        path: apiUrl.pathname,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': BAGS_API_KEY,
                            'Content-Length': Buffer.byteLength(postData)
                        }
                    };

                    const apiReq = https.request(options, (apiRes) => {
                        let responseData = '';
                        apiRes.on('data', chunk => responseData += chunk);
                        apiRes.on('end', () => {
                            try {
                                const parsed = JSON.parse(responseData);
                                if (parsed.success) {
                                    resolve(parsed.response);
                                } else {
                                    reject(new Error(parsed.response || parsed.error || 'API error'));
                                }
                            } catch (e) {
                                reject(new Error('Failed to parse API response'));
                            }
                        });
                    });

                    apiReq.on('error', reject);
                    apiReq.write(postData);
                    apiReq.end();
                });

                console.log('Launch transaction created via dev API');

                // Decode the base58 transaction from API and convert to base64
                const bs58Module = require('bs58');
                const bs58 = bs58Module.default || bs58Module;
                const txBuffer = bs58.decode(apiResponse);

                // Return the serialized transaction
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({
                    transaction: Buffer.from(txBuffer).toString('base64')
                }));
            } catch (error) {
                console.error('Launch transaction error:', error);
                // Extract detailed error message from Bags API response
                let errorMessage = error.message || 'Failed to create launch transaction';
                if (error.data && error.data.response) {
                    errorMessage = error.data.response;
                }
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: errorMessage }));
            }
        });
        return;
    }

    // Default to index.html
    let filePath = req.url.split('?')[0]; // Remove query string
    filePath = filePath === '/' ? '/index.html' : filePath;
    filePath = path.join(__dirname, filePath);

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   💰 Bagscreener - Local Development Server            ║
║                                                        ║
║   Server running at: http://localhost:${PORT}             ║
║                                                        ║
║   Press Ctrl+C to stop                                 ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
    `);
});

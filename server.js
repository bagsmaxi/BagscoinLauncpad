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
const { Connection } = require('@solana/web3.js');

// Load environment variables (for production)
require('dotenv').config();

const PORT = process.env.PORT || 3001;

// API Configuration from environment variables
const BAGS_API_KEY = process.env.BAGS_API_KEY || 'bags_prod_R_Mmm4H_aJnUK-dtZ_hGVjDqVqZm6uddQB78AHdjuYY';
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=0d709c4e-dfbf-4bcd-bffb-1080188c2a14';

// Initialize Bags SDK
let bagsSDK = null;
async function initBagsSDK() {
    try {
        const connection = new Connection(HELIUS_RPC_URL);
        bagsSDK = new BagsSDK({
            apiKey: BAGS_API_KEY,
            connection: connection
        });
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

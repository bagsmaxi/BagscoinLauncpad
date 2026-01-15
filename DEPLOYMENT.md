# Bagscreener Deployment Guide

## Quick Deploy Options

### Option 1: Railway (Recommended - Easy)

1. **Create account:** https://railway.app
2. **New Project** → **Deploy from GitHub repo**
3. **Add Environment Variables:**
   ```
   BAGS_API_KEY=your_bags_api_key
   HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key
   PORT=3001
   ```
4. **Deploy!**

Railway will auto-detect Node.js and run `npm start`.

### Option 2: Render

1. **Create account:** https://render.com
2. **New Web Service** → Connect GitHub
3. **Settings:**
   - Build Command: `npm install`
   - Start Command: `npm start`
4. **Add Environment Variables** (same as above)
5. **Deploy!**

### Option 3: Vercel (Requires Config)

Vercel is designed for serverless, so needs a bit more setup.

1. Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    { "src": "server.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "server.js" }
  ]
}
```

2. Deploy via Vercel CLI or GitHub integration

### Option 4: VPS (Full Control)

1. **Get a VPS:** DigitalOcean, Linode, Vultr (~$5/month)
2. **Install Node.js:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
3. **Clone and setup:**
   ```bash
   git clone your-repo
   cd bagscreener
   npm install
   cp .env.example .env
   # Edit .env with your API keys
   ```
4. **Run with PM2:**
   ```bash
   npm install -g pm2
   pm2 start server.js --name bagscreener
   pm2 save
   pm2 startup
   ```
5. **Setup Nginx + SSL** (optional but recommended)

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3001) | No |
| `BAGS_API_KEY` | Bags.fm API key | Yes |
| `HELIUS_RPC_URL` | Helius RPC endpoint | Yes |

---

## Get Your API Keys

### Bags.fm API Key
1. Go to https://dev.bags.fm
2. Sign in
3. Create new API key
4. Copy the key

### Helius RPC
1. Go to https://helius.dev
2. Create account
3. Get free RPC URL (includes API key)

---

## Post-Deployment Checklist

- [ ] App loads at your domain
- [ ] Tokens are displayed
- [ ] Token details modal works
- [ ] Creator info shows correctly
- [ ] Earnings/fee recipients display
- [ ] No console errors

---

## Custom Domain

Most platforms support custom domains:

1. Add domain in platform settings
2. Update DNS:
   - A record → Platform IP
   - Or CNAME → Platform subdomain
3. Enable SSL (usually automatic)

---

## Monitoring

- Railway/Render: Built-in logs
- VPS: Use `pm2 logs bagscreener`
- Add error tracking: Sentry (free tier available)

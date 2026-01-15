/**
 * BAGS INDEX - API Service Layer
 * Handles communication with DexScreener and Bags.fm APIs
 */

const API = {
    // API Configuration
    config: {
        dexScreener: {
            baseUrl: 'https://api.dexscreener.com',
            rateLimit: 300 // requests per minute
        },
        bagsFm: {
            // API calls go through server proxy for security
            baseUrl: '/api/bags'
        },
        helius: {
            // Uses server-side proxy for RPC calls
            rpcUrl: '/api/helius/rpc'
        },
        // Bags tokens end with "bags" (case insensitive)
        bagsTokenSuffix: 'bags',
        // Chain ID for Solana
        chainId: 'solana',
        // Meteora DEX ID
        dexId: 'meteora',
        // Bags creator program
        bagsCreatorProgram: 'BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv',
        // Meteora DBC program (where bonded tokens trade)
        meteoraDbcProgram: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'
    },

    // Cache for API responses
    cache: {
        tokens: new Map(),
        lastFetch: null,
        cacheDuration: 10000 // 10 seconds
    },

    /**
     * Fetch with error handling and timeout
     */
    async fetchWithTimeout(url, options = {}, timeout = 15000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                mode: 'cors'
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timeout');
            }
            // Handle CORS errors gracefully
            if (error.message.includes('Failed to fetch') || error.message.includes('CORS')) {
                console.warn('CORS error - API may not be accessible from browser:', url);
                throw new Error('API not accessible (CORS). Try using a local server.');
            }
            throw error;
        }
    },

    /**
     * Search for Bags tokens on DexScreener
     * Strategy: Search for tokens ending with "bags" on Solana/Meteora
     */
    async searchBagsTokens(query = 'bags') {
        const url = `${this.config.dexScreener.baseUrl}/latest/dex/search?q=${encodeURIComponent(query)}`;

        try {
            const data = await this.fetchWithTimeout(url);

            if (!data.pairs) {
                return [];
            }

            // Filter for Solana tokens that end with "bags" (case insensitive)
            const bagsTokens = data.pairs.filter(pair => {
                const isSolana = pair.chainId === this.config.chainId;
                const isBagsToken = pair.baseToken?.address?.toLowerCase().endsWith(this.config.bagsTokenSuffix);
                return isSolana && isBagsToken;
            });

            return bagsTokens;
        } catch (error) {
            console.error('Error searching Bags tokens:', error);
            throw error;
        }
    },

    /**
     * Get token pairs by addresses from DexScreener
     */
    async getTokensByAddresses(addresses) {
        if (!addresses || addresses.length === 0) {
            return [];
        }

        // DexScreener allows up to 30 addresses per request
        const chunks = [];
        for (let i = 0; i < addresses.length; i += 30) {
            chunks.push(addresses.slice(i, i + 30));
        }

        const allPairs = [];

        for (const chunk of chunks) {
            const addressList = chunk.join(',');
            const url = `${this.config.dexScreener.baseUrl}/tokens/v1/${this.config.chainId}/${addressList}`;

            try {
                const data = await this.fetchWithTimeout(url);
                if (Array.isArray(data)) {
                    allPairs.push(...data);
                }
            } catch (error) {
                console.error('Error fetching tokens by address:', error);
            }
        }

        return allPairs;
    },

    /**
     * Get all Bags tokens (bonded - graduated from bonding curve)
     * These are tokens trading on Meteora DEX
     */
    async getBondedTokens() {
        try {
            const allResults = [];
            const seenPairs = new Set();
            const seenTokenAddresses = new Set(); // Track by token address to prevent duplicates

            // Helper function to add tokens without duplicates
            const addTokens = (tokens) => {
                tokens.forEach(token => {
                    const tokenAddr = token.baseToken?.address || token.address;
                    // Check both pair address and token address to prevent duplicates
                    if (tokenAddr && !seenTokenAddresses.has(tokenAddr.toLowerCase())) {
                        seenTokenAddresses.add(tokenAddr.toLowerCase());
                        seenPairs.add(token.pairAddress);
                        allResults.push(token);
                    }
                });
            };

            // Strategy 1: Search with multiple query terms (parallel)
            const searchTerms = [
                'bags', 'BAGS', 'meteora bags', 'solana bags',
                'meme bags', 'token bags', 'coin bags'
            ];

            const searchPromises = searchTerms.map(term =>
                this.searchBagsTokens(term).catch(e => {
                    console.warn(`Search for "${term}" failed:`, e);
                    return [];
                })
            );

            const searchResultsArray = await Promise.all(searchPromises);
            searchResultsArray.forEach(results => addTokens(results));

            // Strategy 2: Fetch known token addresses directly
            const knownBagsTokens = await this.fetchKnownBagsTokens();
            addTokens(knownBagsTokens);

            // Strategy 3: Helius API discovery (parallel with trending search)
            const [heliusTokens, trendingTokens] = await Promise.all([
                this.discoverBagsTokensViaHelius().catch(() => []),
                this.searchTrendingTokenNames().catch(() => [])
            ]);

            addTokens(heliusTokens);
            addTokens(trendingTokens);

            console.log(`Found ${allResults.length} total unique Bags tokens`);

            // Process and normalize token data
            const tokens = this.normalizeTokenData(allResults);

            // Final deduplication by token address
            const uniqueTokens = [];
            const finalSeenAddresses = new Set();
            tokens.forEach(token => {
                const addr = token.address?.toLowerCase();
                if (addr && !finalSeenAddresses.has(addr)) {
                    finalSeenAddresses.add(addr);
                    uniqueTokens.push(token);
                }
            });

            // Sort by market cap descending
            uniqueTokens.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));

            return uniqueTokens;
        } catch (error) {
            console.error('Error getting bonded tokens:', error);
            throw error;
        }
    },

    /**
     * Fetch tokens by known addresses
     */
    async fetchKnownBagsTokens() {
        // Known popular Bags tokens - expanded list
        const knownAddresses = [
            // User provided tokens
            'CxWPdDBqxVo3fnTMRTvNuSrd4gkp78udSrFvkVDBAGS',
            'DEHoLKtoFGvLZeA29jsUHxS14MZhjokD52SABiMfBAGS',
            'BdzqtaLRenyWMntL6Mj5KLVuPehYFrK3PxiBsVnNBAGS',
            '5mwsQcoZVWMYEcG6HzC2jR8QRmyiPvHNzvMaVbQpBAGS',
            '7pskt3A1Zsjhngazam7vHWjWHnfgiRump916Xj7ABAGS',
            'Gj4TowizfdkRJNsTgBEkj2WpBZZmGE7o9nN8q6RhBAGS'
        ];

        try {
            // Also try to discover more tokens via Helius getProgramAccounts
            const discoveredAddresses = await this.discoverMoreTokensViaHelius();
            const allAddresses = [...new Set([...knownAddresses, ...discoveredAddresses])];

            console.log(`Fetching ${allAddresses.length} known token addresses...`);

            const pairs = await this.getTokensByAddresses(allAddresses);
            // Filter for bags tokens
            return pairs.filter(pair =>
                pair.baseToken?.address?.toLowerCase().endsWith(this.config.bagsTokenSuffix)
            );
        } catch (error) {
            console.warn('Error fetching known tokens:', error);
            return [];
        }
    },

    /**
     * Discover more token addresses using Helius
     */
    async discoverMoreTokensViaHelius() {
        try {
            // Use Helius to search for recent token mints ending with BAGS
            const response = await this.fetchWithTimeout(this.config.helius.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'discover-tokens',
                    method: 'searchAssets',
                    params: {
                        page: 1,
                        limit: 1000,
                        tokenType: 'fungible',
                        displayOptions: {
                            showFungible: true
                        }
                    }
                })
            });

            if (response.result?.items) {
                const bagsTokens = response.result.items
                    .filter(item => item.id?.toUpperCase().endsWith('BAGS'))
                    .map(item => item.id);
                console.log(`Helius searchAssets found ${bagsTokens.length} potential bags tokens`);
                return bagsTokens;
            }
            return [];
        } catch (error) {
            console.warn('Helius token discovery failed:', error);
            return [];
        }
    },

    /**
     * Discover bags tokens using Helius API
     * Searches for tokens created by the Bags program
     */
    async discoverBagsTokensViaHelius() {
        const tokenAddresses = new Set();

        try {
            // Strategy 1: Get signatures from Bags creator program
            const sigResponse = await this.fetchWithTimeout(this.config.helius.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'bags-sigs',
                    method: 'getSignaturesForAddress',
                    params: [
                        this.config.bagsCreatorProgram,
                        { limit: 1000 }
                    ]
                })
            });

            if (sigResponse.result?.length > 0) {
                // Get transaction details to find token mints
                const batchSize = 50;
                for (let i = 0; i < Math.min(sigResponse.result.length, 200); i += batchSize) {
                    const batch = sigResponse.result.slice(i, i + batchSize);
                    const txPromises = batch.map(sig =>
                        this.getTransactionTokens(sig.signature).catch(() => [])
                    );

                    const results = await Promise.all(txPromises);
                    results.flat().forEach(addr => {
                        if (addr && addr.toUpperCase().endsWith('BAGS')) {
                            tokenAddresses.add(addr);
                        }
                    });
                }
            }

            // Strategy 2: Get signatures from Meteora DBC program
            const meteoraSigs = await this.fetchWithTimeout(this.config.helius.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'meteora-sigs',
                    method: 'getSignaturesForAddress',
                    params: [
                        this.config.meteoraDbcProgram,
                        { limit: 1000 }
                    ]
                })
            });

            if (meteoraSigs.result?.length > 0) {
                const batchSize = 50;
                for (let i = 0; i < Math.min(meteoraSigs.result.length, 300); i += batchSize) {
                    const batch = meteoraSigs.result.slice(i, i + batchSize);
                    const txPromises = batch.map(sig =>
                        this.getTransactionTokens(sig.signature).catch(() => [])
                    );

                    const results = await Promise.all(txPromises);
                    results.flat().forEach(addr => {
                        if (addr && addr.toUpperCase().endsWith('BAGS')) {
                            tokenAddresses.add(addr);
                        }
                    });
                }
            }

            console.log(`Helius discovered ${tokenAddresses.size} bags token addresses`);

            // Fetch token data from DexScreener
            if (tokenAddresses.size > 0) {
                return await this.getTokensByAddresses([...tokenAddresses]);
            }

            return [];
        } catch (error) {
            console.warn('Helius discovery failed:', error);
            return [];
        }
    },

    /**
     * Get token addresses from a transaction
     */
    async getTransactionTokens(signature) {
        try {
            const response = await this.fetchWithTimeout(this.config.helius.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'tx-' + signature.slice(0, 8),
                    method: 'getTransaction',
                    params: [
                        signature,
                        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
                    ]
                })
            });

            if (!response.result?.meta?.postTokenBalances) {
                return [];
            }

            // Extract token mints from the transaction
            const mints = response.result.meta.postTokenBalances
                .map(b => b.mint)
                .filter(m => m && m.toLowerCase().endsWith('bags'));

            return mints;
        } catch (error) {
            return [];
        }
    },

    /**
     * Use Helius DAS API to search for assets
     */
    async searchBagsAssetsViaHelius() {
        try {
            // Search for fungible tokens with specific authority
            const response = await this.fetchWithTimeout(this.config.helius.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'das-search',
                    method: 'searchAssets',
                    params: {
                        ownerAddress: this.config.bagsCreatorProgram,
                        tokenType: 'fungible',
                        limit: 1000
                    }
                })
            });

            if (!response.result?.items) {
                return [];
            }

            // Filter for bags tokens
            const bagsTokens = response.result.items
                .filter(item => item.id?.toLowerCase().endsWith('bags'))
                .map(item => item.id);

            console.log(`DAS API found ${bagsTokens.length} bags tokens`);

            if (bagsTokens.length > 0) {
                return await this.getTokensByAddresses(bagsTokens);
            }

            return [];
        } catch (error) {
            console.warn('Helius DAS search failed:', error);
            return [];
        }
    },

    /**
     * Search for trending token names
     */
    async searchTrendingTokenNames() {
        // Common memecoin/token name patterns that might be on Bags
        const commonNames = [
            'pepe', 'doge', 'shib', 'wojak', 'chad', 'mog',
            'cat', 'dog', 'frog', 'moon', 'ai', 'gpt', 'elon',
            'trump', 'biden', 'based', 'degen', 'ape', 'monkey'
        ];

        const allResults = [];
        const seenPairs = new Set();

        // Search a subset to avoid too many requests
        const searchSubset = commonNames.slice(0, 10);

        for (const name of searchSubset) {
            try {
                const results = await this.searchBagsTokens(name);
                results.forEach(token => {
                    if (!seenPairs.has(token.pairAddress)) {
                        seenPairs.add(token.pairAddress);
                        allResults.push(token);
                    }
                });
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (e) {
                // Ignore individual search failures
            }
        }

        return allResults;
    },

    /**
     * Get trending tokens (sorted by 24h volume)
     */
    async getTrendingTokens() {
        try {
            const bondedTokens = await this.getBondedTokens();

            // Sort by 24h volume descending
            const trending = [...bondedTokens].sort((a, b) =>
                (b.volume24h || 0) - (a.volume24h || 0)
            );

            return trending;
        } catch (error) {
            console.error('Error getting trending tokens:', error);
            throw error;
        }
    },

    /**
     * Get newest tokens (sorted by creation date)
     */
    async getNewTokens() {
        try {
            const bondedTokens = await this.getBondedTokens();

            // Sort by creation date descending (newest first)
            const newTokens = [...bondedTokens].sort((a, b) =>
                (b.createdAt || 0) - (a.createdAt || 0)
            );

            return newTokens;
        } catch (error) {
            console.error('Error getting new tokens:', error);
            throw error;
        }
    },

    /**
     * Normalize token data from DexScreener format
     */
    normalizeTokenData(pairs) {
        return pairs.map((pair, index) => {
            const createdAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : null;
            const age = createdAt ? this.calculateAge(createdAt) : 'Unknown';

            return {
                id: pair.pairAddress,
                rank: index + 1,
                name: pair.baseToken?.name || 'Unknown',
                symbol: pair.baseToken?.symbol || '???',
                address: pair.baseToken?.address || '',
                pairAddress: pair.pairAddress,
                price: parseFloat(pair.priceUsd) || 0,
                priceNative: parseFloat(pair.priceNative) || 0,
                priceChange24h: pair.priceChange?.h24 || 0,
                priceChange1h: pair.priceChange?.h1 || 0,
                marketCap: pair.marketCap || pair.fdv || 0,
                fdv: pair.fdv || 0,
                volume24h: pair.volume?.h24 || 0,
                volume1h: pair.volume?.h1 || 0,
                liquidity: pair.liquidity?.usd || 0,
                holders: pair.holders || 0, // Note: DexScreener may not provide this
                txns24h: pair.txns?.h24 || { buys: 0, sells: 0 },
                createdAt: createdAt ? createdAt.getTime() : null,
                age: age,
                dex: pair.dexId || 'Unknown',
                chainId: pair.chainId,
                url: pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`,
                image: pair.info?.imageUrl || null,
                websites: pair.info?.websites || [],
                socials: pair.info?.socials || [],
                labels: pair.labels || []
            };
        });
    },

    /**
     * Calculate age string from date
     */
    calculateAge(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 60) {
            return `${diffMins}m`;
        } else if (diffHours < 24) {
            return `${diffHours}h`;
        } else if (diffDays < 30) {
            return `${diffDays}d`;
        } else {
            const diffMonths = Math.floor(diffDays / 30);
            return `${diffMonths}mo`;
        }
    },

    /**
     * Get lifetime fees for a token from Bags.fm API (via local proxy)
     * Returns fees in lamports (need to divide by 1e9 for SOL)
     */
    async getTokenLifetimeFees(tokenMint) {
        const url = `/api/bags/lifetime-fees?tokenMint=${tokenMint}`;

        try {
            const data = await this.fetchWithTimeout(url);
            // API returns {success: true, response: "amount_in_lamports"}
            if (data.success && data.response) {
                const lamports = parseInt(data.response);
                return {
                    lamports: lamports,
                    sol: lamports / 1e9
                };
            }
            return null;
        } catch (error) {
            console.warn('Error fetching lifetime fees:', error);
            return null;
        }
    },

    /**
     * Get token creator info from Bags.fm API (via local proxy)
     * Returns array of creators/fee recipients
     */
    async getTokenCreator(tokenMint) {
        const url = `/api/bags/creator?tokenMint=${tokenMint}`;

        try {
            const data = await this.fetchWithTimeout(url);
            // API returns {success: true, response: [{creator objects}]}
            if (data.success && data.response) {
                return data.response;
            }
            return null;
        } catch (error) {
            console.warn('Error fetching token creator:', error);
            return null;
        }
    },

    /**
     * Get token claim stats from Bags.fm API (via local proxy)
     */
    async getTokenClaimStats(tokenMint) {
        const url = `/api/bags/claim-stats?tokenMint=${tokenMint}`;

        try {
            const data = await this.fetchWithTimeout(url);
            // API returns {success: true, response: [{claim objects}]}
            if (data.success && data.response) {
                return data.response;
            }
            return null;
        } catch (error) {
            console.warn('Error fetching claim stats:', error);
            return null;
        }
    },

    /**
     * Find the actual creator from the creators array (isCreator: true)
     */
    findCreator(creators) {
        if (!creators || !Array.isArray(creators)) return null;
        return creators.find(c => c.isCreator === true) || creators[0];
    },

    /**
     * Format creator display name (prefer provider username)
     */
    formatCreatorName(creator) {
        if (!creator) return 'Unknown';

        // Prefer providerUsername or twitterUsername
        const username = creator.providerUsername || creator.twitterUsername;
        if (username) {
            const provider = creator.provider || '';
            const icon = provider === 'twitter' ? '𝕏' : provider === 'telegram' ? '📱' : '';
            return `${icon} @${username}`.trim();
        }

        // Fallback to wallet address
        if (creator.wallet) {
            return this.truncateAddress(creator.wallet, 4, 4);
        }

        return 'Unknown';
    },

    /**
     * Format fee recipients for display (combines creator data with claim stats)
     */
    formatFeeRecipients(creators, claimStats) {
        if (!creators || !Array.isArray(creators)) return [];

        // Create a map of claim stats by wallet
        const claimMap = new Map();
        if (claimStats && Array.isArray(claimStats)) {
            claimStats.forEach(stat => {
                claimMap.set(stat.wallet, {
                    totalClaimed: parseInt(stat.totalClaimed || 0)
                });
            });
        }

        return creators.map(recipient => {
            const claimData = claimMap.get(recipient.wallet) || { totalClaimed: 0 };
            const username = recipient.providerUsername || recipient.twitterUsername;

            return {
                wallet: recipient.wallet,
                displayName: username ? `@${username}` : this.truncateAddress(recipient.wallet, 4, 4),
                pfp: recipient.pfp,
                provider: recipient.provider || 'wallet',
                royaltyBps: recipient.royaltyBps || 0,
                percentage: (recipient.royaltyBps || 0) / 100,
                isCreator: recipient.isCreator || false,
                totalClaimed: claimData.totalClaimed,
                totalClaimedSol: claimData.totalClaimed / 1e9
            };
        });
    },

    /**
     * Get detailed token info (combines DexScreener + Bags.fm data)
     */
    async getTokenDetails(token) {
        const details = { ...token };

        // Fetch Bags.fm specific data in parallel
        try {
            const [lifetimeFees, creator, claimStats] = await Promise.all([
                this.getTokenLifetimeFees(token.address),
                this.getTokenCreator(token.address),
                this.getTokenClaimStats(token.address)
            ]);

            details.lifetimeFees = lifetimeFees;
            details.creator = creator;
            details.claimStats = claimStats;
        } catch (error) {
            console.warn('Error fetching Bags.fm details:', error);
        }

        return details;
    },

    /**
     * Get OHLCV data for charts (from DexScreener)
     * Note: DexScreener doesn't have a direct OHLCV endpoint in their free API
     * We'll generate approximate data based on current price and price changes
     */
    async getOHLCVData(pairAddress, timeframe = '1H') {
        // Since DexScreener free API doesn't provide historical OHLCV,
        // we'll create approximate data based on available info
        // In production, you'd want to use a proper data provider

        const url = `${this.config.dexScreener.baseUrl}/latest/dex/pairs/${this.config.chainId}/${pairAddress}`;

        try {
            const data = await this.fetchWithTimeout(url);

            if (!data.pairs || data.pairs.length === 0) {
                return [];
            }

            const pair = data.pairs[0];
            const currentPrice = parseFloat(pair.priceUsd) || 0;

            // Timeframe configuration: { points, intervalMs, priceChangeSource }
            const timeframeConfig = {
                '1M': { points: 12, intervalMs: 5000, priceChange: (pair.priceChange?.m5 || pair.priceChange?.h1 || 0) / 12 },
                '5M': { points: 15, intervalMs: 20000, priceChange: (pair.priceChange?.m5 || pair.priceChange?.h1 || 0) / 3 },
                '15M': { points: 15, intervalMs: 60000, priceChange: pair.priceChange?.m5 || pair.priceChange?.h1 || 0 },
                '1H': { points: 12, intervalMs: 300000, priceChange: pair.priceChange?.h1 || 0 },
                '4H': { points: 16, intervalMs: 900000, priceChange: pair.priceChange?.h6 || pair.priceChange?.h24 / 4 || 0 },
                '1D': { points: 24, intervalMs: 3600000, priceChange: pair.priceChange?.h24 || 0 }
            };

            const config = timeframeConfig[timeframe] || timeframeConfig['1H'];
            const { points, intervalMs, priceChange } = config;

            // Generate approximate chart data
            const chartData = [];
            const startPrice = currentPrice / (1 + priceChange / 100);

            for (let i = 0; i < points; i++) {
                const progress = i / (points - 1);
                // Add some realistic variation
                const noise = (Math.random() - 0.5) * 0.03; // 3% random variation
                const trend = startPrice + (currentPrice - startPrice) * progress;
                const price = trend * (1 + noise);

                const timestamp = Date.now() - (points - i - 1) * intervalMs;

                chartData.push({
                    time: timestamp,
                    price: Math.max(price, 0)
                });
            }

            // Ensure last point is current price
            if (chartData.length > 0) {
                chartData[chartData.length - 1].price = currentPrice;
            }

            return chartData;
        } catch (error) {
            console.error('Error fetching OHLCV data:', error);
            return [];
        }
    },

    /**
     * Get trade quote from Jupiter API (via local proxy)
     */
    async getTradeQuote(tokenMint, amount, side = 'buy') {
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const inputMint = side === 'buy' ? SOL_MINT : tokenMint;
        const outputMint = side === 'buy' ? tokenMint : SOL_MINT;
        const amountLamports = Math.floor(amount * 1e9);

        // Use local proxy to avoid CORS
        const url = `/api/jupiter/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=100`;

        console.log('Jupiter quote URL (via proxy):', url);

        try {
            const data = await this.fetchWithTimeout(url);
            console.log('Jupiter quote response:', data);

            if (data.error) {
                throw new Error(data.error);
            }

            return data;
        } catch (error) {
            console.error('Error getting trade quote:', error);
            throw error;
        }
    },

    /**
     * Get swap transaction from Jupiter API (via local proxy)
     */
    async getSwapTransaction(tokenMint, amount, walletAddress, side = 'buy') {
        console.log('Getting swap transaction:', { tokenMint, amount, walletAddress, side });

        try {
            // First get the quote
            const quote = await this.getTradeQuote(tokenMint, amount, side);

            if (!quote || quote.error) {
                throw new Error(quote?.error || 'Failed to get quote from Jupiter');
            }

            if (!quote.routePlan || quote.routePlan.length === 0) {
                throw new Error('No route found for this swap. The token may not have liquidity on Jupiter.');
            }

            console.log('Got quote, requesting swap transaction...');

            // Use local proxy to avoid CORS
            const swapUrl = '/api/jupiter/swap';
            const swapBody = {
                quoteResponse: quote,
                userPublicKey: walletAddress,
                wrapAndUnwrapSol: true,
                dynamicComputeUnitLimit: true,
                prioritizationFeeLamports: 'auto'
            };

            console.log('Swap request body:', swapBody);

            const response = await this.fetchWithTimeout(swapUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(swapBody)
            });

            console.log('Swap response:', response);

            if (!response || !response.swapTransaction) {
                throw new Error(response?.error || 'Failed to get swap transaction from Jupiter');
            }

            return {
                transaction: response.swapTransaction,
                quote: quote
            };
        } catch (error) {
            console.error('Error getting swap transaction:', error);
            throw error;
        }
    },

    /**
     * Format price for display
     */
    formatPrice(price) {
        if (price === 0) return '$0.00';

        if (price < 0.00000001) {
            return '$' + price.toExponential(2);
        } else if (price < 0.0001) {
            return '$' + price.toFixed(8);
        } else if (price < 0.01) {
            return '$' + price.toFixed(6);
        } else if (price < 1) {
            return '$' + price.toFixed(4);
        } else if (price < 1000) {
            return '$' + price.toFixed(2);
        } else {
            return '$' + price.toLocaleString(undefined, { maximumFractionDigits: 2 });
        }
    },

    /**
     * Format large numbers (market cap, volume, etc.)
     */
    formatNumber(num) {
        if (num === 0 || num === null || num === undefined) return '$0';

        if (num >= 1000000000) {
            return '$' + (num / 1000000000).toFixed(2) + 'B';
        } else if (num >= 1000000) {
            return '$' + (num / 1000000).toFixed(2) + 'M';
        } else if (num >= 1000) {
            return '$' + (num / 1000).toFixed(2) + 'K';
        } else {
            return '$' + num.toFixed(2);
        }
    },

    /**
     * Format percentage change
     */
    formatPercentage(pct) {
        if (pct === 0 || pct === null || pct === undefined) return '0%';
        const sign = pct >= 0 ? '+' : '';
        return sign + pct.toFixed(2) + '%';
    },

    /**
     * Truncate address for display
     */
    truncateAddress(address, startChars = 4, endChars = 4) {
        if (!address) return '';
        if (address.length <= startChars + endChars) return address;
        return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
    }
};

// Export for use in app.js
window.API = API;

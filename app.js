/**
 * BAGS INDEX - Main Application
 * Windows 98 styled crypto token explorer
 */

const App = {
    // Application state
    state: {
        currentTab: 'bonded',
        tokens: {
            bonded: [],
            trending: [],
            new: []
        },
        selectedToken: null,
        searchQuery: '',
        sortBy: 'marketCap',
        sortDirection: 'desc', // 'asc' or 'desc'
        showSortIndicator: false, // Don't show sort indicator until user clicks
        isLoading: false,
        isInitialLoad: true, // Track if this is the first load
        error: null,
        refreshInterval: null,
        chart: null,
        // Pagination
        currentPage: 1,
        tokensPerPage: 100,
        // Wallet
        wallet: null,
        walletAddress: null,
        tradeSide: 'buy' // 'buy' or 'sell'
    },

    // Configuration
    config: {
        refreshInterval: 15000, // 15 seconds
        animateProgress: true
    },

    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing Bags Index...');

        // Set up event listeners
        this.setupEventListeners();

        // Update taskbar time
        this.updateTrayTime();
        setInterval(() => this.updateTrayTime(), 1000);

        // Initial data load
        await this.loadAllData();

        // Start auto-refresh
        this.startAutoRefresh();

        console.log('Bags Index initialized!');
    },

    /**
     * Set up all event listeners
     */
    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('[role="tab"]').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                const tabName = tab.getAttribute('data-tab');
                this.switchTab(tabName);
            });
        });

        // Search input
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', (e) => {
            this.state.searchQuery = e.target.value;
            this.renderTokenTable();
        });

        // Sort select
        const sortSelect = document.getElementById('sortSelect');
        sortSelect.addEventListener('change', (e) => {
            this.state.sortBy = e.target.value;
            this.state.sortDirection = 'desc'; // Reset to desc when changing sort field
            this.state.showSortIndicator = true; // Show indicator when user selects
            this.renderTokenTable();
            this.updateSortIndicators();
        });

        // Clickable column headers for sorting
        this.setupColumnSorting();

        // Reset filters button (# column)
        document.getElementById('resetFiltersBtn').addEventListener('click', () => {
            this.resetFilters();
        });

        // Pagination buttons
        document.getElementById('prevPage').addEventListener('click', () => {
            if (this.state.currentPage > 1) {
                this.state.currentPage--;
                this.renderTokenTable();
            }
        });

        document.getElementById('nextPage').addEventListener('click', () => {
            const tokens = this.getFilteredTokens();
            const totalPages = Math.ceil(tokens.length / this.state.tokensPerPage);
            if (this.state.currentPage < totalPages) {
                this.state.currentPage++;
                this.renderTokenTable();
            }
        });

        // Refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        refreshBtn.addEventListener('click', () => {
            this.loadCurrentTabData();
        });

        // Add Token button and modal
        document.getElementById('addTokenBtn').addEventListener('click', () => {
            const modal = document.getElementById('addTokenModal');
            modal.style.display = modal.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('cancelAddToken').addEventListener('click', () => {
            document.getElementById('addTokenModal').style.display = 'none';
            document.getElementById('tokenAddressInput').value = '';
        });

        document.getElementById('confirmAddToken').addEventListener('click', () => {
            this.addCustomTokens();
        });

        document.getElementById('tokenAddressInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addCustomTokens();
            }
        });

        // Modal close buttons
        document.getElementById('closeModal').addEventListener('click', () => this.closeModal());
        document.getElementById('closModalBtn').addEventListener('click', () => this.closeModal());
        document.getElementById('modalOverlay').addEventListener('click', () => this.closeModal());

        // Copy contract button
        document.getElementById('copyContract').addEventListener('click', () => {
            this.copyToClipboard(document.getElementById('modalContract').value);
        });

        // Copy creator wallet button
        document.getElementById('copyCreatorWallet').addEventListener('click', () => {
            const wallet = document.getElementById('modalCreatorWallet').getAttribute('data-wallet');
            if (wallet) {
                this.copyToClipboard(wallet, document.getElementById('copyCreatorWallet'));
            }
        });

        // Copy ticker contract button
        document.getElementById('copyTickerContract').addEventListener('click', () => {
            const contract = document.getElementById('tickerContract').textContent;
            this.copyToClipboard(contract, document.getElementById('copyTickerContract'));
        });

        // Also allow clicking on the contract code itself to copy
        document.getElementById('tickerContract').addEventListener('click', () => {
            const contract = document.getElementById('tickerContract').textContent;
            this.copyToClipboard(contract, document.getElementById('copyTickerContract'));
        });

        // Chart timeframe tabs
        document.querySelectorAll('.chart-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const timeframe = e.target.getAttribute('data-timeframe');
                this.switchChartTimeframe(timeframe);
            });
        });

        // DexScreener button
        document.getElementById('openDexScreener').addEventListener('click', () => {
            if (this.state.selectedToken?.url) {
                window.open(this.state.selectedToken.url, '_blank');
            }
        });

        // Bags.fm button
        document.getElementById('openBagsFm').addEventListener('click', () => {
            if (this.state.selectedToken?.address) {
                window.open(`https://bags.fm/token/${this.state.selectedToken.address}`, '_blank');
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });

        // Wallet connection
        document.getElementById('connectWalletBtn').addEventListener('click', () => {
            this.connectWallet();
        });

        document.getElementById('disconnectWalletBtn').addEventListener('click', () => {
            this.disconnectWallet();
        });

        document.getElementById('modalConnectWallet').addEventListener('click', () => {
            this.connectWallet();
        });

        // Trade tabs
        document.querySelectorAll('.trade-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchTradeSide(e.target.getAttribute('data-side'));
            });
        });

        // Trade amount input
        document.getElementById('tradeAmount').addEventListener('input', (e) => {
            this.updateTradeEstimate(e.target.value);
        });

        // Execute trade button
        document.getElementById('executeTradeBtn').addEventListener('click', () => {
            this.executeTrade();
        });

        // Check if wallet is already connected
        this.checkExistingWallet();
    },

    /**
     * Check if wallet is already connected
     */
    async checkExistingWallet() {
        if (window.solana && window.solana.isPhantom) {
            try {
                const response = await window.solana.connect({ onlyIfTrusted: true });
                this.state.wallet = window.solana;
                this.state.walletAddress = response.publicKey.toString();
                this.updateWalletUI();
            } catch (error) {
                // Not connected, that's fine
            }
        }
    },

    /**
     * Connect wallet (Phantom)
     */
    async connectWallet() {
        try {
            // Check if Phantom is installed
            if (!window.solana || !window.solana.isPhantom) {
                alert('Please install Phantom wallet!\n\nhttps://phantom.app/');
                window.open('https://phantom.app/', '_blank');
                return;
            }

            const response = await window.solana.connect();
            this.state.wallet = window.solana;
            this.state.walletAddress = response.publicKey.toString();
            this.updateWalletUI();

            console.log('Wallet connected:', this.state.walletAddress);
        } catch (error) {
            console.error('Wallet connection failed:', error);
            alert('Failed to connect wallet: ' + error.message);
        }
    },

    /**
     * Disconnect wallet
     */
    async disconnectWallet() {
        try {
            if (window.solana) {
                await window.solana.disconnect();
            }
            this.state.wallet = null;
            this.state.walletAddress = null;
            this.updateWalletUI();
        } catch (error) {
            console.error('Wallet disconnect failed:', error);
        }
    },

    /**
     * Update wallet UI
     */
    updateWalletUI() {
        const connectBtn = document.getElementById('connectWalletBtn');
        const connectedDiv = document.getElementById('walletConnected');
        const addressSpan = document.getElementById('walletAddress');
        const tradeNotConnected = document.getElementById('tradeNotConnected');
        const tradeConnected = document.getElementById('tradeConnected');

        if (this.state.walletAddress) {
            connectBtn.style.display = 'none';
            connectedDiv.style.display = 'flex';
            addressSpan.textContent = API.truncateAddress(this.state.walletAddress, 4, 4);
            addressSpan.title = this.state.walletAddress;

            if (tradeNotConnected) tradeNotConnected.style.display = 'none';
            if (tradeConnected) tradeConnected.style.display = 'block';
        } else {
            connectBtn.style.display = 'block';
            connectedDiv.style.display = 'none';

            if (tradeNotConnected) tradeNotConnected.style.display = 'block';
            if (tradeConnected) tradeConnected.style.display = 'none';
        }
    },

    /**
     * Switch trade side (buy/sell)
     */
    switchTradeSide(side) {
        this.state.tradeSide = side;

        // Update tabs
        document.querySelectorAll('.trade-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-side') === side);
        });

        // Update button
        const btn = document.getElementById('executeTradeBtn');
        btn.textContent = side === 'buy' ? 'Buy Token' : 'Sell Token';
        btn.classList.toggle('sell', side === 'sell');

        // Update estimate
        this.updateTradeEstimate(document.getElementById('tradeAmount').value);
    },

    /**
     * Update trade estimate (with debounce for API calls)
     */
    updateTradeEstimate(amount) {
        const token = this.state.selectedToken;
        const estimatedEl = document.getElementById('estimatedTokens');

        if (!token || !amount || isNaN(amount) || parseFloat(amount) <= 0) {
            estimatedEl.textContent = '0';
            return;
        }

        const solAmount = parseFloat(amount);

        // Show quick estimate first (based on current price)
        const solPrice = 200; // Approximate SOL price in USD
        const tokenPrice = token.price || 0.000001;
        let quickEstimate;
        if (this.state.tradeSide === 'buy') {
            quickEstimate = (solAmount * solPrice) / tokenPrice;
        } else {
            quickEstimate = solAmount * tokenPrice / solPrice;
        }

        estimatedEl.textContent = this.formatTokenAmount(quickEstimate) + ' (est)';

        // Debounce the API call
        clearTimeout(this.quoteTimeout);
        this.quoteTimeout = setTimeout(async () => {
            try {
                const quote = await API.getTradeQuote(token.address, solAmount, this.state.tradeSide);
                if (quote && quote.outAmount) {
                    // Jupiter returns amount in smallest unit, convert based on decimals
                    const decimals = quote.outputMint === 'So11111111111111111111111111111111111111112' ? 9 : 6;
                    const actualAmount = parseInt(quote.outAmount) / Math.pow(10, decimals);
                    estimatedEl.textContent = this.formatTokenAmount(actualAmount);
                }
            } catch (error) {
                // Keep the quick estimate if API fails
                console.warn('Quote fetch failed, using estimate');
            }
        }, 500);
    },

    /**
     * Format token amount for display
     */
    formatTokenAmount(amount) {
        if (amount > 1000000000) return (amount / 1000000000).toFixed(2) + 'B';
        if (amount > 1000000) return (amount / 1000000).toFixed(2) + 'M';
        if (amount > 1000) return (amount / 1000).toFixed(2) + 'K';
        return amount.toFixed(2);
    },

    /**
     * Execute trade directly via Phantom wallet
     */
    async executeTrade() {
        if (!this.state.walletAddress) {
            alert('Please connect your wallet first');
            return;
        }

        const phantom = window.solana;
        if (!phantom || !phantom.isPhantom) {
            alert('Phantom wallet not found. Please install Phantom.');
            return;
        }

        const token = this.state.selectedToken;
        if (!token) {
            alert('No token selected');
            return;
        }

        const amount = parseFloat(document.getElementById('tradeAmount').value);
        if (!amount || amount <= 0) {
            alert('Please enter a valid amount');
            return;
        }

        const side = this.state.tradeSide;
        const executeBtn = document.getElementById('executeTradeBtn');
        const originalBtnText = executeBtn.textContent;

        try {
            // Update button to show loading
            executeBtn.disabled = true;
            executeBtn.textContent = 'Getting quote...';

            // Get swap transaction from Jupiter API
            const swapResponse = await API.getSwapTransaction(
                token.address,
                amount,
                this.state.walletAddress,
                side
            );

            if (!swapResponse || !swapResponse.transaction) {
                throw new Error('Failed to get swap transaction');
            }

            executeBtn.textContent = 'Opening Phantom...';

            // Decode the base64 transaction
            const transactionBuffer = Uint8Array.from(
                atob(swapResponse.transaction),
                c => c.charCodeAt(0)
            );

            // Deserialize the versioned transaction
            const transaction = solanaWeb3.VersionedTransaction.deserialize(transactionBuffer);

            // Sign and send with Phantom - this opens Phantom popup
            const { signature } = await phantom.signAndSendTransaction(transaction);

            // Success!
            executeBtn.textContent = 'Success!';

            const explorerUrl = `https://solscan.io/tx/${signature}`;
            setTimeout(() => {
                const viewTx = confirm(
                    `Transaction submitted!\n\n` +
                    `Signature: ${signature.slice(0, 20)}...\n\n` +
                    `View on Solscan?`
                );

                if (viewTx) {
                    window.open(explorerUrl, '_blank');
                }
            }, 100);

            // Reset form
            document.getElementById('tradeAmount').value = '';
            document.getElementById('estimatedTokens').textContent = '0';

        } catch (error) {
            console.error('Trade execution failed:', error);

            let errorMessage = error.message || 'Unknown error';

            // Handle common errors
            if (error.code === 4001 || errorMessage.includes('User rejected')) {
                errorMessage = 'Transaction cancelled';
            } else if (errorMessage.includes('insufficient')) {
                errorMessage = 'Insufficient balance';
            } else if (errorMessage.includes('No route found') || errorMessage.includes('Could not find any route')) {
                errorMessage = 'No liquidity available for this trade. Try a smaller amount.';
            }

            alert(`Trade failed: ${errorMessage}`);
        } finally {
            executeBtn.disabled = false;
            executeBtn.textContent = originalBtnText;
        }
    },

    /**
     * Setup clickable column headers for sorting
     */
    setupColumnSorting() {
        const columnMap = {
            'col-price': 'price',
            'col-change': 'priceChange',
            'col-mcap': 'marketCap',
            'col-volume': 'volume',
            'col-liquidity': 'liquidity',
            'col-age': 'age'
        };

        Object.entries(columnMap).forEach(([className, sortField]) => {
            const th = document.querySelector(`.${className}`);
            if (th) {
                th.style.cursor = 'pointer';
                th.addEventListener('click', () => {
                    this.toggleSort(sortField);
                });
            }
        });
    },

    /**
     * Toggle sort direction or change sort field
     */
    toggleSort(field) {
        if (this.state.sortBy === field && this.state.showSortIndicator) {
            // Toggle direction if already sorting by this field
            this.state.sortDirection = this.state.sortDirection === 'desc' ? 'asc' : 'desc';
        } else {
            // New field, default to desc
            this.state.sortBy = field;
            this.state.sortDirection = 'desc';
        }

        // Show sort indicator when user explicitly clicks
        this.state.showSortIndicator = true;

        // Update the select dropdown to match
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect.querySelector(`option[value="${field}"]`)) {
            sortSelect.value = field;
        }

        this.renderTokenTable();
        this.updateSortIndicators();
    },

    /**
     * Add custom token addresses
     */
    async addCustomTokens() {
        const input = document.getElementById('tokenAddressInput');
        const addresses = input.value.split(',').map(a => a.trim()).filter(a => a.length > 0);

        if (addresses.length === 0) {
            alert('Please enter at least one token address');
            return;
        }

        // Validate addresses end with BAGS
        const validAddresses = addresses.filter(a => a.toUpperCase().endsWith('BAGS'));
        if (validAddresses.length === 0) {
            alert('Token addresses must end with BAGS');
            return;
        }

        // Close modal and clear input
        document.getElementById('addTokenModal').style.display = 'none';
        input.value = '';

        // Show loading
        this.setLoading(true);
        this.state.isInitialLoad = true;

        try {
            // Fetch token data from DexScreener
            const pairs = await API.getTokensByAddresses(validAddresses);

            if (pairs.length === 0) {
                alert('No tokens found for the provided addresses. They may not be trading on DexScreener yet.');
                return;
            }

            // Normalize and add to existing tokens
            const newTokens = API.normalizeTokenData(pairs);

            // Add to bonded tokens (avoid duplicates)
            const existingAddresses = new Set(this.state.tokens.bonded.map(t => t.address.toLowerCase()));
            let addedCount = 0;

            newTokens.forEach(token => {
                if (!existingAddresses.has(token.address.toLowerCase())) {
                    this.state.tokens.bonded.push(token);
                    existingAddresses.add(token.address.toLowerCase());
                    addedCount++;
                }
            });

            // Re-sort and update other tabs
            this.state.tokens.bonded.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
            this.state.tokens.trending = [...this.state.tokens.bonded].sort((a, b) =>
                (b.volume24h || 0) - (a.volume24h || 0)
            );
            this.state.tokens.new = [...this.state.tokens.bonded].sort((a, b) =>
                (b.createdAt || 0) - (a.createdAt || 0)
            );

            this.renderTokenTable();
            this.updateStatus();

            if (addedCount > 0) {
                console.log(`Added ${addedCount} new token(s)`);
            } else {
                alert('Token(s) already in the list');
            }
        } catch (error) {
            console.error('Error adding tokens:', error);
            alert('Error fetching token data: ' + error.message);
        } finally {
            this.state.isInitialLoad = false;
            this.setLoading(false);
        }
    },

    /**
     * Reset all filters to default
     */
    resetFilters() {
        this.state.searchQuery = '';
        this.state.sortBy = 'marketCap';
        this.state.sortDirection = 'desc';
        this.state.showSortIndicator = false; // Hide sort indicator
        this.state.currentPage = 1;

        // Update UI
        document.getElementById('searchInput').value = '';
        document.getElementById('sortSelect').value = 'marketCap';

        // Clear all sort indicators from headers
        this.clearSortIndicators();

        this.renderTokenTable();
    },

    /**
     * Clear all sort indicators from table headers
     */
    clearSortIndicators() {
        document.querySelectorAll('.token-table th').forEach(th => {
            th.classList.remove('sorted');
            // Remove arrow indicators
            th.textContent = th.textContent.replace(/ [▲▼]$/, '');
        });
    },

    /**
     * Get filtered and sorted tokens for current tab
     */
    getFilteredTokens() {
        let tokens = this.state.tokens[this.state.currentTab] || [];

        // Apply search filter
        if (this.state.searchQuery) {
            const query = this.state.searchQuery.toLowerCase();
            tokens = tokens.filter(token =>
                token.name.toLowerCase().includes(query) ||
                token.symbol.toLowerCase().includes(query) ||
                token.address.toLowerCase().includes(query)
            );
        }

        // Apply sorting
        tokens = this.sortTokens(tokens, this.state.sortBy);

        return tokens;
    },

    /**
     * Update sort indicators in table headers
     */
    updateSortIndicators() {
        // Don't show indicators if showSortIndicator is false
        if (!this.state.showSortIndicator) {
            this.clearSortIndicators();
            return;
        }

        const columnMap = {
            'col-price': 'price',
            'col-change': 'priceChange',
            'col-mcap': 'marketCap',
            'col-volume': 'volume',
            'col-liquidity': 'liquidity',
            'col-age': 'age'
        };

        const arrow = this.state.sortDirection === 'desc' ? ' ▼' : ' ▲';

        Object.entries(columnMap).forEach(([className, sortField]) => {
            const th = document.querySelector(`.${className}`);
            if (th) {
                // Get base text (without any existing arrows)
                let baseText = th.textContent.replace(/ [▲▼]$/, '');

                if (this.state.sortBy === sortField) {
                    th.textContent = baseText + arrow;
                    th.classList.add('sorted');
                } else {
                    th.textContent = baseText;
                    th.classList.remove('sorted');
                }
            }
        });
    },

    /**
     * Switch between tabs
     */
    switchTab(tabName) {
        this.state.currentTab = tabName;
        this.state.currentPage = 1; // Reset to page 1

        // Set default sorting based on tab
        const tabDefaults = {
            bonded: { sortBy: 'marketCap', sortDirection: 'desc' },
            trending: { sortBy: 'volume', sortDirection: 'desc' },
            new: { sortBy: 'age', sortDirection: 'desc' }
        };

        const defaults = tabDefaults[tabName] || tabDefaults.bonded;
        this.state.sortBy = defaults.sortBy;
        this.state.sortDirection = defaults.sortDirection;
        this.state.showSortIndicator = false; // Don't show indicator on tab switch

        // Update dropdown to match
        document.getElementById('sortSelect').value = defaults.sortBy;

        // Update tab UI
        document.querySelectorAll('[role="tab"]').forEach(tab => {
            tab.setAttribute('aria-selected', tab.getAttribute('data-tab') === tabName);
        });

        // Clear sort indicators
        this.clearSortIndicators();

        // Render the appropriate token list
        this.renderTokenTable();

        // Load data if not already loaded
        if (this.state.tokens[tabName].length === 0) {
            this.loadCurrentTabData();
        }
    },

    /**
     * Load data for current tab
     */
    async loadCurrentTabData() {
        this.setLoading(true);

        try {
            let tokens;
            switch (this.state.currentTab) {
                case 'trending':
                    tokens = await API.getTrendingTokens();
                    break;
                case 'new':
                    tokens = await API.getNewTokens();
                    break;
                case 'bonded':
                default:
                    tokens = await API.getBondedTokens();
                    break;
            }

            this.state.tokens[this.state.currentTab] = tokens;
            this.state.error = null;
            this.renderTokenTable();
            this.updateStatus();
        } catch (error) {
            console.error('Error loading data:', error);
            this.state.error = error.message;
            this.showError(error.message);
        } finally {
            this.setLoading(false);
        }
    },

    /**
     * Load all tab data
     * @param {boolean} showLoading - Whether to show loading indicator (false for background refresh)
     */
    async loadAllData(showLoading = true) {
        const isFirstLoad = this.state.isInitialLoad;

        // Only show loading on initial load
        if (showLoading && isFirstLoad) {
            this.setLoading(true);
        }

        try {
            // Load bonded tokens first (main data source)
            const bondedTokens = await API.getBondedTokens();
            this.state.tokens.bonded = bondedTokens;

            // Derive trending and new from bonded
            this.state.tokens.trending = [...bondedTokens].sort((a, b) =>
                (b.volume24h || 0) - (a.volume24h || 0)
            );

            this.state.tokens.new = [...bondedTokens].sort((a, b) =>
                (b.createdAt || 0) - (a.createdAt || 0)
            );

            this.state.error = null;
            this.state.isInitialLoad = false;
            this.hideError();
            this.renderTokenTable();
            this.updateStatus();
        } catch (error) {
            console.error('Error loading all data:', error);
            // Only show error on initial load
            if (isFirstLoad) {
                this.state.error = error.message;
                this.showError(error.message);
            }
        } finally {
            // Always hide loading after first load completes
            if (isFirstLoad) {
                this.setLoading(false);
            }
        }
    },

    /**
     * Start auto-refresh
     */
    startAutoRefresh() {
        if (this.state.refreshInterval) {
            clearInterval(this.state.refreshInterval);
        }

        this.state.refreshInterval = setInterval(() => {
            // Background refresh - don't show loading indicator
            this.loadAllData(false);
        }, this.config.refreshInterval);

        // Update refresh indicator
        document.getElementById('refreshStatus').textContent = 'Live';
    },

    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.state.refreshInterval) {
            clearInterval(this.state.refreshInterval);
            this.state.refreshInterval = null;
        }

        document.getElementById('refreshStatus').textContent = 'Paused';
    },

    /**
     * Set loading state
     */
    setLoading(isLoading) {
        this.state.isLoading = isLoading;

        const loadingIndicator = document.getElementById('loadingIndicator');
        const tableContainer = document.getElementById('tableContainer');
        const progressBar = document.getElementById('progressBar');

        if (isLoading) {
            loadingIndicator.style.display = 'flex';
            tableContainer.style.display = 'none';

            // Animate progress bar
            if (this.config.animateProgress) {
                let progress = 0;
                const interval = setInterval(() => {
                    progress += Math.random() * 20;
                    if (progress > 90) progress = 90;
                    progressBar.style.width = progress + '%';

                    if (!this.state.isLoading) {
                        progressBar.style.width = '100%';
                        clearInterval(interval);
                    }
                }, 200);
            }
        } else {
            progressBar.style.width = '100%';
            setTimeout(() => {
                loadingIndicator.style.display = 'none';
                tableContainer.style.display = 'block';
                progressBar.style.width = '0%';
            }, 300);
        }
    },

    /**
     * Render the token table
     */
    renderTokenTable() {
        const tbody = document.getElementById('tokenTableBody');
        const noResults = document.getElementById('noResults');
        const tableContainer = document.getElementById('tableContainer');
        const pagination = document.getElementById('pagination');

        // Get filtered and sorted tokens
        let tokens = this.getFilteredTokens();

        // Update ranks after sorting (before pagination)
        tokens = tokens.map((token, index) => ({ ...token, rank: index + 1 }));

        const totalTokens = tokens.length;
        const totalPages = Math.ceil(totalTokens / this.state.tokensPerPage);

        // Ensure current page is valid
        if (this.state.currentPage > totalPages) {
            this.state.currentPage = Math.max(1, totalPages);
        }

        if (tokens.length === 0) {
            tbody.innerHTML = '';
            tableContainer.style.display = 'none';
            pagination.style.display = 'none';
            noResults.style.display = 'block';
            return;
        }

        noResults.style.display = 'none';
        tableContainer.style.display = 'block';

        // Apply pagination
        const startIndex = (this.state.currentPage - 1) * this.state.tokensPerPage;
        const endIndex = startIndex + this.state.tokensPerPage;
        const paginatedTokens = tokens.slice(startIndex, endIndex);

        // Update pagination UI
        if (totalPages > 1) {
            pagination.style.display = 'flex';
            document.getElementById('currentPage').textContent = this.state.currentPage;
            document.getElementById('totalPages').textContent = totalPages;
            document.getElementById('totalTokens').textContent = totalTokens;
            document.getElementById('prevPage').disabled = this.state.currentPage <= 1;
            document.getElementById('nextPage').disabled = this.state.currentPage >= totalPages;
        } else {
            pagination.style.display = 'none';
        }

        // Render table rows
        tbody.innerHTML = paginatedTokens.map(token => this.renderTokenRow(token)).join('');

        // Add click handlers to rows
        tbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', () => {
                const address = row.getAttribute('data-address');
                const token = tokens.find(t => t.address === address);
                if (token) {
                    this.openTokenModal(token);
                }
            });
        });

        // Add click handlers to copy buttons
        tbody.querySelectorAll('.copy-btn-small').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const address = btn.getAttribute('data-address');
                this.copyToClipboard(address, btn);
            });
        });

        // Add click handlers for chart action buttons
        tbody.querySelectorAll('[data-action="chart"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const address = btn.getAttribute('data-address');
                const token = tokens.find(t => t.address === address);
                if (token && token.url) {
                    window.open(token.url, '_blank');
                }
            });
        });

        // Render sparklines after DOM is updated
        this.renderSparklines(paginatedTokens);

        // Update sort indicators
        this.updateSortIndicators();
    },

    /**
     * Render mini sparkline charts for each token
     */
    renderSparklines(tokens) {
        tokens.forEach(token => {
            const container = document.querySelector(`.sparkline-container[data-address="${token.address}"]`);
            if (!container) return;

            const canvas = container.querySelector('canvas');
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            const color = container.getAttribute('data-color') || '#16C784';

            // Generate simple sparkline data based on price change
            // In a real app, you'd fetch actual historical data
            const points = this.generateSparklineData(token.priceChange24h);

            this.drawSparkline(ctx, points, color, canvas.width, canvas.height);
        });
    },

    /**
     * Generate sparkline data points based on price change
     */
    generateSparklineData(priceChange) {
        const points = [];
        const numPoints = 20;
        const trend = priceChange >= 0 ? 1 : -1;
        const volatility = Math.min(Math.abs(priceChange) / 10, 5) + 1;

        let value = 50;
        for (let i = 0; i < numPoints; i++) {
            // Add some randomness but maintain overall trend
            const random = (Math.random() - 0.5) * volatility * 2;
            const trendPush = trend * (i / numPoints) * volatility;
            value = Math.max(10, Math.min(90, value + random + trendPush * 0.5));
            points.push(value);
        }

        // Ensure end point reflects the trend
        points[points.length - 1] = priceChange >= 0 ? Math.max(60, points[points.length - 1]) : Math.min(40, points[points.length - 1]);

        return points;
    },

    /**
     * Draw a sparkline on canvas
     */
    drawSparkline(ctx, points, color, width, height) {
        ctx.clearRect(0, 0, width, height);

        if (points.length < 2) return;

        const padding = 2;
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 2;

        const min = Math.min(...points);
        const max = Math.max(...points);
        const range = max - min || 1;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        points.forEach((point, index) => {
            const x = padding + (index / (points.length - 1)) * chartWidth;
            const y = padding + chartHeight - ((point - min) / range) * chartHeight;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Add subtle gradient fill
        ctx.lineTo(padding + chartWidth, padding + chartHeight);
        ctx.lineTo(padding, padding + chartHeight);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, color + '30');
        gradient.addColorStop(1, color + '05');
        ctx.fillStyle = gradient;
        ctx.fill();
    },

    /**
     * Render a single token row
     */
    renderTokenRow(token) {
        const priceChangeClass = token.priceChange24h >= 0 ? 'price-up' : 'price-down';
        const sparklineColor = token.priceChange24h >= 0 ? '#16C784' : '#EA3943';

        // Rank badge for top 3
        let rankDisplay = token.rank;
        if (token.rank <= 3) {
            rankDisplay = `<span class="rank-badge rank-${token.rank}">${token.rank}</span>`;
        }

        return `
            <tr data-address="${token.address}" data-pair="${token.pairAddress || ''}">
                <td class="col-rank">${rankDisplay}</td>
                <td class="col-token">
                    <div class="token-cell">
                        ${token.image
                ? `<img src="${token.image}" alt="${token.symbol}" class="token-image" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22><rect fill=%22%23c0c0c0%22 width=%2232%22 height=%2232%22 rx=%2216%22/><text x=%2216%22 y=%2220%22 text-anchor=%22middle%22 fill=%22%23666%22 font-size=%2212%22>?</text></svg>'">`
                : '<div class="token-image" style="background:#c0c0c0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#666;">?</div>'
            }
                        <div class="token-info">
                            <span class="token-name">${this.escapeHtml(token.name)}</span>
                            <span class="token-symbol-small">${this.escapeHtml(token.symbol)}</span>
                        </div>
                    </div>
                </td>
                <td class="col-price">${API.formatPrice(token.price)}</td>
                <td class="col-change">
                    <span class="${priceChangeClass}">${API.formatPercentage(token.priceChange24h)}</span>
                </td>
                <td class="col-mcap">${API.formatNumber(token.marketCap)}</td>
                <td class="col-volume">${API.formatNumber(token.volume24h)}</td>
                <td class="col-chart">
                    <div class="sparkline-container" data-address="${token.address}" data-color="${sparklineColor}">
                        <canvas width="80" height="32"></canvas>
                    </div>
                </td>
                <td class="col-liquidity">${API.formatNumber(token.liquidity)}</td>
                <td class="col-age">${token.age}</td>
                <td class="col-actions">
                    <div class="action-buttons">
                        <button class="action-btn-mini" data-address="${token.address}" data-action="chart" title="View Chart">📊</button>
                        <button class="action-btn-mini copy-btn-small" data-address="${token.address}" title="Copy Address">📋</button>
                    </div>
                </td>
            </tr>
        `;
    },

    /**
     * Sort tokens by specified field
     */
    sortTokens(tokens, sortBy) {
        const direction = this.state.sortDirection === 'asc' ? 1 : -1;

        return [...tokens].sort((a, b) => {
            let comparison = 0;
            switch (sortBy) {
                case 'marketCap':
                    comparison = (b.marketCap || 0) - (a.marketCap || 0);
                    break;
                case 'volume':
                    comparison = (b.volume24h || 0) - (a.volume24h || 0);
                    break;
                case 'price':
                    comparison = (b.price || 0) - (a.price || 0);
                    break;
                case 'priceChange':
                    comparison = (b.priceChange24h || 0) - (a.priceChange24h || 0);
                    break;
                case 'age':
                    comparison = (b.createdAt || 0) - (a.createdAt || 0);
                    break;
                case 'liquidity':
                    comparison = (b.liquidity || 0) - (a.liquidity || 0);
                    break;
                default:
                    comparison = 0;
            }
            // Apply direction (desc is default, so multiply by -1 for asc)
            return direction === 1 ? -comparison : comparison;
        });
    },

    /**
     * Open token detail modal
     */
    async openTokenModal(token) {
        this.state.selectedToken = token;

        // Update modal content
        document.getElementById('modalTitle').textContent = `${token.name} - Details`;
        document.getElementById('modalTokenName').textContent = token.name;
        document.getElementById('modalTokenSymbol').textContent = token.symbol;
        document.getElementById('modalPrice').textContent = API.formatPrice(token.price);

        const priceChangeEl = document.getElementById('modalPriceChange');
        priceChangeEl.textContent = API.formatPercentage(token.priceChange24h);
        priceChangeEl.className = 'price-change ' + (token.priceChange24h >= 0 ? 'price-up' : 'price-down');

        // Token image
        const imgEl = document.getElementById('modalTokenImage');
        if (token.image) {
            imgEl.src = token.image;
            imgEl.style.display = 'block';
        } else {
            imgEl.style.display = 'none';
        }

        // Stats
        document.getElementById('modalMarketCap').textContent = API.formatNumber(token.marketCap);
        document.getElementById('modalVolume').textContent = API.formatNumber(token.volume24h);
        document.getElementById('modalLiquidity').textContent = API.formatNumber(token.liquidity);
        document.getElementById('modalAge').textContent = token.age;
        document.getElementById('modalDex').textContent = token.dex || 'Meteora';

        // Contract
        document.getElementById('modalContract').value = token.address;

        // Social links
        this.renderSocialLinks(token);

        // Show modal
        document.getElementById('tokenModal').style.display = 'block';
        document.getElementById('modalOverlay').style.display = 'block';

        // Update wallet UI in modal
        this.updateWalletUI();

        // Reset trade form
        document.getElementById('tradeAmount').value = '';
        document.getElementById('estimatedTokens').textContent = '0';
        this.switchTradeSide('buy');

        // Load chart
        await this.loadChart(token, '1H');

        // Load Bags.fm rewards data
        this.loadRewardsData(token);
    },

    /**
     * Render social links
     */
    renderSocialLinks(token) {
        const container = document.getElementById('socialLinks');
        let links = [];

        // Add websites
        if (token.websites && token.websites.length > 0) {
            token.websites.forEach(site => {
                links.push(`<a href="${site.url}" target="_blank" class="social-link">🌐 Website</a>`);
            });
        }

        // Add socials
        if (token.socials && token.socials.length > 0) {
            token.socials.forEach(social => {
                let icon = '🔗';
                if (social.type === 'twitter') icon = '🐦';
                else if (social.type === 'telegram') icon = '💬';
                else if (social.type === 'discord') icon = '💭';

                links.push(`<a href="${social.url}" target="_blank" class="social-link">${icon} ${social.type}</a>`);
            });
        }

        if (links.length === 0) {
            links.push('<span style="color:#666;">No social links available</span>');
        }

        container.innerHTML = links.join('');
    },

    /**
     * Load rewards data from Bags.fm
     */
    async loadRewardsData(token) {
        const feesEl = document.getElementById('modalLifetimeFees');
        const creatorEl = document.getElementById('modalCreator');
        const creatorWalletEl = document.getElementById('modalCreatorWallet');
        const claimStatsEl = document.getElementById('modalClaimStats');

        // Reset loading states
        feesEl.textContent = 'Loading...';
        creatorEl.textContent = 'Loading...';
        creatorWalletEl.textContent = '--';
        creatorWalletEl.removeAttribute('data-wallet');
        claimStatsEl.innerHTML = '<p class="loading-text">Loading fee recipients...</p>';

        // Fetch all data in parallel
        const [fees, creators, claimStats] = await Promise.all([
            API.getTokenLifetimeFees(token.address).catch(() => null),
            API.getTokenCreator(token.address).catch(() => null),
            API.getTokenClaimStats(token.address).catch(() => null)
        ]);

        // Display lifetime fees (earnings)
        if (fees && fees.sol !== undefined) {
            feesEl.textContent = `${fees.sol.toFixed(4)} SOL`;
        } else {
            feesEl.textContent = '--';
        }

        // Find and display the actual creator (isCreator: true)
        const actualCreator = API.findCreator(creators);
        if (actualCreator) {
            creatorEl.textContent = API.formatCreatorName(actualCreator);
            if (actualCreator.wallet) {
                creatorWalletEl.textContent = API.truncateAddress(actualCreator.wallet, 6, 6);
                creatorWalletEl.setAttribute('data-wallet', actualCreator.wallet);
                creatorWalletEl.title = actualCreator.wallet;
            }
        } else {
            creatorEl.textContent = 'Unknown';
            creatorWalletEl.textContent = '--';
        }

        // Display fee recipients (combines creator data with claim stats)
        this.renderFeeRecipients(creators, claimStats);
    },

    /**
     * Render fee recipients table
     */
    renderFeeRecipients(creators, claimStats) {
        const container = document.getElementById('modalClaimStats');

        if (!creators || creators.length === 0) {
            container.innerHTML = '<p class="no-data">No fee recipients found</p>';
            return;
        }

        const recipients = API.formatFeeRecipients(creators, claimStats);

        if (!recipients || recipients.length === 0) {
            container.innerHTML = '<p class="no-data">No fee recipients found</p>';
            return;
        }

        let html = `
            <table class="claim-stats-table">
                <thead>
                    <tr>
                        <th>Recipient</th>
                        <th>Share</th>
                        <th>Earned</th>
                    </tr>
                </thead>
                <tbody>
        `;

        recipients.forEach(recipient => {
            const providerIcon = recipient.provider === 'twitter' ? '𝕏' :
                recipient.provider === 'telegram' ? '📱' : '👛';
            const creatorBadge = recipient.isCreator ? ' <span class="creator-badge">Creator</span>' : '';
            const earnedDisplay = recipient.totalClaimedSol > 0
                ? `${recipient.totalClaimedSol.toFixed(4)} SOL`
                : '--';

            html += `
                <tr>
                    <td class="claimer-name">
                        ${recipient.pfp ? `<img src="${recipient.pfp}" class="recipient-pfp" alt="">` : `<span class="provider-icon">${providerIcon}</span>`}
                        <span title="${recipient.wallet}">${recipient.displayName}${creatorBadge}</span>
                    </td>
                    <td class="claimer-share">${recipient.percentage.toFixed(2)}%</td>
                    <td class="claimer-claimed">${earnedDisplay}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    /**
     * Load and render price chart
     */
    async loadChart(token, timeframe) {
        const canvas = document.getElementById('priceChart');
        const ctx = canvas.getContext('2d');

        // Destroy existing chart
        if (this.state.chart) {
            this.state.chart.destroy();
        }

        // Get chart data
        const chartData = await API.getOHLCVData(token.pairAddress, timeframe);

        if (chartData.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No chart data available', canvas.width / 2, canvas.height / 2);
            return;
        }

        // Determine chart color based on price change
        const isPositive = chartData[chartData.length - 1].price >= chartData[0].price;
        const lineColor = isPositive ? '#00aa00' : '#cc0000';
        const bgColor = isPositive ? 'rgba(0, 170, 0, 0.1)' : 'rgba(204, 0, 0, 0.1)';

        // Format time labels based on timeframe
        const formatTimeLabel = (timestamp) => {
            const date = new Date(timestamp);
            switch (timeframe) {
                case '1M':
                case '5M':
                case '15M':
                    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                case '1H':
                case '4H':
                    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                case '1D':
                    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' });
                default:
                    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
        };

        // Create chart
        this.state.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.map(d => formatTimeLabel(d.time)),
                datasets: [{
                    data: chartData.map(d => d.price),
                    borderColor: lineColor,
                    backgroundColor: bgColor,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => API.formatPrice(context.raw)
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            display: false
                        },
                        ticks: {
                            maxTicksLimit: 6,
                            font: {
                                size: 10
                            }
                        }
                    },
                    y: {
                        display: true,
                        grid: {
                            color: '#e0e0e0'
                        },
                        ticks: {
                            callback: (value) => API.formatPrice(value),
                            font: {
                                size: 10
                            }
                        }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
    },

    /**
     * Switch chart timeframe
     */
    async switchChartTimeframe(timeframe) {
        // Update active tab
        document.querySelectorAll('.chart-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-timeframe') === timeframe);
        });

        // Reload chart
        if (this.state.selectedToken) {
            await this.loadChart(this.state.selectedToken, timeframe);
        }
    },

    /**
     * Close modal
     */
    closeModal() {
        document.getElementById('tokenModal').style.display = 'none';
        document.getElementById('modalOverlay').style.display = 'none';
        this.state.selectedToken = null;

        // Destroy chart
        if (this.state.chart) {
            this.state.chart.destroy();
            this.state.chart = null;
        }
    },

    /**
     * Copy to clipboard
     */
    async copyToClipboard(text, buttonEl = null) {
        try {
            await navigator.clipboard.writeText(text);

            if (buttonEl) {
                const originalText = buttonEl.textContent;
                buttonEl.textContent = '✓';
                buttonEl.classList.add('copy-success');

                setTimeout(() => {
                    buttonEl.textContent = originalText;
                    buttonEl.classList.remove('copy-success');
                }, 1000);
            }
        } catch (error) {
            console.error('Failed to copy:', error);

            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    },

    /**
     * Update status bar
     */
    updateStatus() {
        const tokens = this.state.tokens[this.state.currentTab] || [];
        document.getElementById('statusTotal').textContent = `Tokens: ${tokens.length}`;
        document.getElementById('statusLastUpdate').textContent = `Last update: ${new Date().toLocaleTimeString()}`;
    },

    /**
     * Update taskbar tray time
     */
    updateTrayTime() {
        const now = new Date();
        document.getElementById('trayTime').textContent = now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /**
     * Show error message
     */
    showError(message) {
        const errorDisplay = document.getElementById('errorDisplay');
        const errorMessage = document.getElementById('errorMessage');
        const tableContainer = document.getElementById('tableContainer');

        errorMessage.textContent = message;
        errorDisplay.style.display = 'block';
        tableContainer.style.display = 'none';

        // Update connection status
        document.getElementById('connectionStatus').textContent = '🔴';
    },

    /**
     * Hide error message
     */
    hideError() {
        document.getElementById('errorDisplay').style.display = 'none';
        document.getElementById('connectionStatus').textContent = '🟢';
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Export for console debugging
window.App = App;

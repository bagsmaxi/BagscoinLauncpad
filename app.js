/**
 * Bagscreener - pump.fun style with animations
 */

const App = {
    state: {
        currentTab: 'trending',
        tokens: { trending: [], new: [] },
        previousTokens: {}, // Track previous values for bump animations
        athValues: {}, // Track ATH market cap for each token
        selectedToken: null,
        searchQuery: '',
        isLoading: false,
        isInitialLoad: true,
        refreshInterval: null,
        chart: null,
        wallet: null,
        walletAddress: null,
        tokenImage: null,
        isLaunching: false,
        feeShareUser: null // { handle, name, avatar, wallet }
    },

    config: {
        refreshInterval: 5000, // Faster refresh for more animations
        // Partner config key - platform earns revenue from all launches
        partnerConfigKey: 'BoWTinLevvUkb8kRrcmfVnmqq8uKKetTwsc2eEJcrxZp'
    },

    async init() {
        console.log('Bagscreener loading...');
        this.setupEventListeners();
        await this.loadAllData();
        this.startAutoRefresh();
        console.log('Bagscreener ready');
    },

    setupEventListeners() {
        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.getAttribute('data-tab');
                this.switchTab(tabName);
            });
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.state.searchQuery = e.target.value;
            this.renderTokens();
        });

        // Wallet
        document.getElementById('connectWalletBtn').addEventListener('click', () => this.connectWallet());
        document.getElementById('disconnectWalletBtn').addEventListener('click', () => this.disconnectWallet());

        // Token modal
        document.getElementById('closeModal').addEventListener('click', () => this.closeModal());
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'modalOverlay') this.closeModal();
        });
        document.getElementById('copyContract').addEventListener('click', () => {
            this.copyToClipboard(document.getElementById('modalContract').value);
        });
        document.getElementById('openBagsFm').addEventListener('click', () => {
            if (this.state.selectedToken) {
                window.open(`https://bags.fm/${this.state.selectedToken.address}`, '_blank');
            }
        });
        document.getElementById('openDexScreener').addEventListener('click', () => {
            if (this.state.selectedToken?.url) {
                window.open(this.state.selectedToken.url, '_blank');
            }
        });

        // Create token
        document.getElementById('createTokenBtn').addEventListener('click', () => this.openCreateModal());
        document.getElementById('closeCreateToken').addEventListener('click', () => this.closeCreateModal());
        document.getElementById('createTokenOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'createTokenOverlay') this.closeCreateModal();
        });

        // Image upload
        const imageUpload = document.getElementById('imageUpload');
        const imageInput = document.getElementById('tokenImageInput');
        imageUpload.addEventListener('click', () => imageInput.click());
        imageUpload.addEventListener('dragover', (e) => { e.preventDefault(); imageUpload.style.borderColor = 'var(--green)'; });
        imageUpload.addEventListener('dragleave', () => { imageUpload.style.borderColor = 'var(--border)'; });
        imageUpload.addEventListener('drop', (e) => {
            e.preventDefault();
            imageUpload.style.borderColor = 'var(--border)';
            if (e.dataTransfer.files[0]?.type.startsWith('image/')) {
                this.handleImageUpload(e.dataTransfer.files[0]);
            }
        });
        imageInput.addEventListener('change', (e) => {
            if (e.target.files[0]) this.handleImageUpload(e.target.files[0]);
        });

        // Create form
        document.getElementById('createTokenForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.launchToken();
        });

        // Fee share lookup
        document.getElementById('lookupHandleBtn').addEventListener('click', () => this.lookupTwitterHandle());
        document.getElementById('feeShareHandle').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.lookupTwitterHandle();
            }
        });
        document.getElementById('removeFeeShare').addEventListener('click', () => this.removeFeeShare());

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
                this.closeCreateModal();
            }
        });

        this.checkExistingWallet();

        // Banner CA copy
        const bannerCa = document.querySelector('.banner-ca');
        if (bannerCa) {
            bannerCa.addEventListener('click', () => {
                this.copyToClipboard('Bm5ZikphdvZBW57bvrNs4njLkYFuQtBuPccamhxQBAGS');
            });
        }
    },

    handleImageUpload(file) {
        if (file.size > 5 * 1024 * 1024) {
            this.showToast('Image must be less than 5MB');
            return;
        }
        this.state.tokenImage = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            const upload = document.getElementById('imageUpload');
            upload.innerHTML = `<img src="${e.target.result}" alt="preview">`;
            upload.classList.add('has-image');
        };
        reader.readAsDataURL(file);
    },

    openCreateModal() {
        if (!this.state.walletAddress) {
            this.showToast('Connect wallet first');
            this.connectWallet();
            return;
        }
        document.getElementById('createTokenOverlay').style.display = 'flex';
    },

    closeCreateModal() {
        document.getElementById('createTokenOverlay').style.display = 'none';
        document.getElementById('createTokenForm').reset();
        const upload = document.getElementById('imageUpload');
        upload.innerHTML = '<span>📷</span><span>drag and drop or click</span>';
        upload.classList.remove('has-image');
        this.state.tokenImage = null;
        this.removeFeeShare();
    },

    async lookupTwitterHandle() {
        const handleInput = document.getElementById('feeShareHandle');
        const handle = handleInput.value.trim();

        if (!handle) {
            this.showToast('Enter a Twitter handle');
            return;
        }

        const btn = document.getElementById('lookupHandleBtn');
        btn.textContent = 'looking...';
        btn.disabled = true;

        try {
            const res = await fetch(`/api/twitter/lookup?handle=${encodeURIComponent(handle)}`);
            const data = await res.json();

            if (data.error) {
                throw new Error(data.error);
            }

            // Store the fee share user with wallet from Bags.fm
            this.state.feeShareUser = {
                handle: data.handle,
                name: data.name,
                avatar: data.avatar,
                wallet: data.wallet // Wallet from Bags.fm (may be null if not registered)
            };

            // Store wallet in hidden input
            document.getElementById('feeShareWalletInput').value = data.wallet || '';

            // Show preview
            document.getElementById('feeShareAvatar').src = data.avatar;
            document.getElementById('feeShareName').textContent = data.name;
            document.getElementById('feeShareUsername').textContent = `@${data.handle}`;
            document.getElementById('feeSharePreview').style.display = 'flex';
            document.getElementById('feeShareWallet').style.display = 'block';
            document.getElementById('feeSharePercent').style.display = 'flex';

            // Hide input
            handleInput.parentElement.style.display = 'none';

            if (data.wallet) {
                this.showToast('Profile found with Bags.fm wallet!');
            } else {
                this.showToast('Profile found! They can claim on bags.fm');
            }
        } catch (error) {
            console.error('Lookup error:', error);
            this.showToast('Could not find profile');
        } finally {
            btn.textContent = 'lookup';
            btn.disabled = false;
        }
    },

    removeFeeShare() {
        this.state.feeShareUser = null;
        document.getElementById('feeShareHandle').value = '';
        document.getElementById('feeShareWalletInput').value = '';
        document.getElementById('feeShareHandle').parentElement.style.display = 'flex';
        document.getElementById('feeSharePreview').style.display = 'none';
        document.getElementById('feeShareWallet').style.display = 'none';
        document.getElementById('feeSharePercent').style.display = 'none';
    },

    async initializePartnerConfig() {
        // Check if partner config needs to be created on-chain
        try {
            const res = await fetch(`/api/partner/config?wallet=${this.state.walletAddress}`);
            const data = await res.json();

            if (data.needsSetup || data.error) {
                this.showToast('Initializing partner config...');

                // Get the creation transaction
                const createRes = await fetch('/api/partner/create-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ wallet: this.state.walletAddress })
                });

                if (!createRes.ok) {
                    const err = await createRes.json();
                    throw new Error(err.error || 'Failed to create partner config');
                }

                const { transaction } = await createRes.json();
                const txBuffer = Uint8Array.from(atob(transaction), c => c.charCodeAt(0));
                const versionedTx = solanaWeb3.VersionedTransaction.deserialize(txBuffer);
                await window.solana.signAndSendTransaction(versionedTx);

                this.showToast('Partner config initialized!');
                return true;
            }
            return true;
        } catch (error) {
            console.error('Partner config check failed:', error);
            // Continue anyway - the config might already exist
            return true;
        }
    },

    async launchToken() {
        if (this.state.isLaunching) return;
        if (!this.state.walletAddress) {
            this.showToast('Connect wallet first');
            return;
        }

        const name = document.getElementById('tokenName').value.trim();
        const symbol = document.getElementById('tokenSymbol').value.trim();
        const description = document.getElementById('tokenDescription').value.trim();
        const twitter = document.getElementById('tokenTwitter').value.trim();
        const telegram = document.getElementById('tokenTelegram').value.trim();
        const website = document.getElementById('tokenWebsite').value.trim();
        const initialBuy = parseFloat(document.getElementById('initialBuy').value) || 0;

        if (!name || !symbol || !description || !this.state.tokenImage) {
            this.showToast('Fill in all required fields');
            return;
        }

        const btn = document.getElementById('launchTokenBtn');
        this.state.isLaunching = true;
        btn.disabled = true;
        btn.textContent = 'checking partner...';

        try {
            btn.textContent = 'creating token...';
            const formData = new FormData();
            formData.append('image', this.state.tokenImage);
            formData.append('name', name);
            formData.append('symbol', symbol);
            formData.append('description', description);
            if (twitter) formData.append('twitter', twitter);
            if (telegram) formData.append('telegram', telegram);
            if (website) formData.append('website', website);

            // Step 1: Create token info
            const infoRes = await fetch('/api/token/create-info', { method: 'POST', body: formData });
            if (!infoRes.ok) throw new Error((await infoRes.json()).error || 'Failed to create token info');
            const tokenInfo = await infoRes.json();

            btn.textContent = 'setting up fees...';

            // Build fee claimers list
            let feeClaimers = [];
            const feeShareWallet = this.state.feeShareUser?.wallet || document.getElementById('feeShareWalletInput').value.trim();
            const feeShareBps = parseInt(document.getElementById('feeShareBps').value) || 50;

            if (this.state.feeShareUser && feeShareWallet) {
                // Split fees between creator and fee share recipient
                const recipientBps = feeShareBps * 100; // Convert % to basis points
                const creatorBps = 10000 - recipientBps;
                feeClaimers = [
                    { user: this.state.walletAddress, userBps: creatorBps },
                    { user: feeShareWallet, userBps: recipientBps }
                ];
                console.log('Fee share with:', this.state.feeShareUser.handle, feeShareWallet, `${feeShareBps}%`);
            } else if (this.state.feeShareUser && !feeShareWallet) {
                // User selected fee share but wallet not found - show warning
                this.showToast('Fee share skipped - recipient has no bags.fm wallet yet');
                feeClaimers = [{ user: this.state.walletAddress, userBps: 10000 }];
            } else {
                // Creator gets all fees
                feeClaimers = [{ user: this.state.walletAddress, userBps: 10000 }];
            }

            // Step 2: Create fee share config (includes partner config for platform revenue)
            let configKey = null;
            let feeConfigTransactions = [];

            const feeConfigRes = await fetch('/api/fee-share/create-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payer: this.state.walletAddress,
                    tokenMint: tokenInfo.tokenMint,
                    feeClaimers: feeClaimers
                })
            });

            if (feeConfigRes.ok) {
                const feeConfig = await feeConfigRes.json();
                if (feeConfig.configKey) {
                    configKey = feeConfig.configKey;
                    // Store transactions for batch signing
                    if (feeConfig.transactions && feeConfig.transactions.length > 0) {
                        feeConfigTransactions = feeConfig.transactions;
                    }
                }
            }

            btn.textContent = 'preparing launch...';

            // Step 3: Create launch transaction
            const txRes = await fetch('/api/token/create-launch-tx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    metadataUrl: tokenInfo.tokenMetadata,
                    tokenMint: tokenInfo.tokenMint,
                    launchWallet: this.state.walletAddress,
                    initialBuyLamports: Math.floor(initialBuy * 1e9),
                    configKey: configKey
                })
            });
            if (!txRes.ok) throw new Error((await txRes.json()).error || 'Failed to create tx');
            const { transaction } = await txRes.json();

            // Step 4: Batch sign all transactions at once (single confirmation)
            btn.textContent = 'confirm in wallet...';

            // Collect all transactions
            const allTransactions = [];

            // Add fee config transactions first
            for (const txBase64 of feeConfigTransactions) {
                const txBuffer = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
                allTransactions.push(solanaWeb3.VersionedTransaction.deserialize(txBuffer));
            }

            // Add launch transaction
            const launchTxBuffer = Uint8Array.from(atob(transaction), c => c.charCodeAt(0));
            allTransactions.push(solanaWeb3.VersionedTransaction.deserialize(launchTxBuffer));

            // Sign all at once (single wallet popup)
            if (allTransactions.length > 1) {
                // Batch sign - single confirmation popup
                const signedTransactions = await window.solana.signAllTransactions(allTransactions);

                btn.textContent = 'launching...';

                // Send transactions in order via RPC
                for (const signedTx of signedTransactions) {
                    const serialized = signedTx.serialize();
                    const base64Tx = btoa(String.fromCharCode(...serialized));

                    // Send via our RPC proxy
                    const rpcRes = await fetch('/api/helius/rpc', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            jsonrpc: '2.0',
                            id: 1,
                            method: 'sendTransaction',
                            params: [base64Tx, { encoding: 'base64', skipPreflight: false }]
                        })
                    });
                    const rpcResult = await rpcRes.json();
                    if (rpcResult.error) {
                        throw new Error(rpcResult.error.message || 'Transaction failed');
                    }
                }
            } else {
                // Single transaction - use signAndSend for simplicity
                await window.solana.signAndSendTransaction(allTransactions[0]);
            }

            this.showToast('Token launched!');
            this.closeCreateModal();
            this.loadAllData();

        } catch (error) {
            console.error('Launch failed:', error);
            this.showToast(error.message.includes('User rejected') ? 'Cancelled' : error.message);
        } finally {
            this.state.isLaunching = false;
            btn.disabled = false;
            btn.textContent = 'create coin';
        }
    },

    showToast(message) {
        const toast = document.getElementById('toast');
        document.getElementById('toastMessage').textContent = message;
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 3000);
    },

    async checkExistingWallet() {
        if (window.solana?.isPhantom) {
            try {
                const res = await window.solana.connect({ onlyIfTrusted: true });
                this.state.wallet = window.solana;
                this.state.walletAddress = res.publicKey.toString();
                this.updateWalletUI();
            } catch {}
        }
    },

    async connectWallet() {
        if (!window.solana?.isPhantom) {
            this.showToast('Install Phantom wallet');
            window.open('https://phantom.app/', '_blank');
            return;
        }
        try {
            const res = await window.solana.connect();
            this.state.wallet = window.solana;
            this.state.walletAddress = res.publicKey.toString();
            this.updateWalletUI();
            this.showToast('Wallet connected');
        } catch (err) {
            this.showToast('Connection failed');
        }
    },

    async disconnectWallet() {
        try {
            if (window.solana) await window.solana.disconnect();
            this.state.wallet = null;
            this.state.walletAddress = null;
            this.updateWalletUI();
        } catch {}
    },

    updateWalletUI() {
        const btn = document.getElementById('connectWalletBtn');
        const info = document.getElementById('walletConnected');
        const addr = document.getElementById('walletAddress');
        if (this.state.walletAddress) {
            btn.style.display = 'none';
            info.style.display = 'flex';
            addr.textContent = this.state.walletAddress.slice(0, 4) + '...' + this.state.walletAddress.slice(-4);
        } else {
            btn.style.display = 'block';
            info.style.display = 'none';
        }
    },

    getFilteredTokens() {
        let tokens = this.state.tokens[this.state.currentTab] || [];
        if (this.state.searchQuery) {
            const q = this.state.searchQuery.toLowerCase();
            tokens = tokens.filter(t =>
                t.name.toLowerCase().includes(q) ||
                t.symbol.toLowerCase().includes(q) ||
                t.address.toLowerCase().includes(q)
            );
        }
        // Tokens are already sorted per tab, just return them
        return tokens;
    },

    switchTab(tabName) {
        this.state.currentTab = tabName;
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        this.renderTokens();
        if (!this.state.tokens[tabName].length) this.loadAllData();
    },

    async loadAllData() {
        if (this.state.isInitialLoad) this.setLoading(true);
        try {
            const tokens = await API.getBondedTokens();

            // Track changes for animations
            this.detectChanges(tokens);

            // Trending: sort by volume high to low
            this.state.tokens.trending = [...tokens].sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
            // New: sort by age newest to oldest
            this.state.tokens.new = [...tokens].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            this.state.isInitialLoad = false;
            this.renderTokens();
        } catch (err) {
            console.error('Load failed:', err);
        } finally {
            this.setLoading(false);
        }
    },

    detectChanges(newTokens) {
        const changes = [];

        newTokens.forEach(token => {
            const prev = this.state.previousTokens[token.address];
            const currentMcap = token.marketCap || 0;

            // Initialize or update ATH
            if (!this.state.athValues[token.address]) {
                this.state.athValues[token.address] = currentMcap;
            }

            if (prev) {
                const prevMcap = prev.marketCap || 0;
                const prevVolume = prev.volume24h || 0;
                const currentVolume = token.volume24h || 0;

                // Detect transaction (volume or mcap change)
                if (currentMcap !== prevMcap || currentVolume !== prevVolume) {
                    changes.push({ address: token.address, type: 'transaction' });
                }

                // Detect new ATH
                if (currentMcap > this.state.athValues[token.address]) {
                    changes.push({ address: token.address, type: 'ath' });
                    this.state.athValues[token.address] = currentMcap;
                }
            }

            // Store current values for next comparison
            this.state.previousTokens[token.address] = { ...token };
        });

        // Schedule animations
        setTimeout(() => this.applyAnimations(changes), 100);
    },

    applyAnimations(changes) {
        changes.forEach(change => {
            const card = document.querySelector(`.token-card[data-address="${change.address}"]`);
            if (!card) return;

            if (change.type === 'transaction') {
                // Bump animation
                card.classList.remove('bump');
                void card.offsetWidth; // Force reflow
                card.classList.add('bump');
                card.classList.add('active-trading');

                setTimeout(() => {
                    card.classList.remove('bump');
                    card.classList.remove('active-trading');
                }, 2000);
            }

            if (change.type === 'ath') {
                // ATH burst animation
                card.classList.add('ath-burst');
                this.createBurstParticles(card);

                setTimeout(() => {
                    card.classList.remove('ath-burst');
                }, 1000);
            }
        });
    },

    createBurstParticles(card) {
        const container = document.createElement('div');
        container.className = 'burst-particles';

        // Create 12 particles
        for (let i = 0; i < 12; i++) {
            const particle = document.createElement('div');
            particle.className = 'burst-particle';

            // Random direction
            const angle = (i / 12) * 360;
            const distance = 50 + Math.random() * 30;
            const tx = Math.cos(angle * Math.PI / 180) * distance;
            const ty = Math.sin(angle * Math.PI / 180) * distance;

            particle.style.setProperty('--tx', tx + 'px');
            particle.style.setProperty('--ty', ty + 'px');
            particle.style.left = '50%';
            particle.style.top = '50%';

            container.appendChild(particle);
        }

        card.appendChild(container);

        // Remove after animation
        setTimeout(() => container.remove(), 1000);
    },

    startAutoRefresh() {
        if (this.state.refreshInterval) clearInterval(this.state.refreshInterval);
        this.state.refreshInterval = setInterval(() => this.loadAllData(), this.config.refreshInterval);
    },

    setLoading(loading) {
        this.state.isLoading = loading;
        document.getElementById('loadingIndicator').style.display = loading ? 'flex' : 'none';
        document.getElementById('tokenGrid').style.display = loading ? 'none' : 'grid';
    },

    renderTokens() {
        const grid = document.getElementById('tokenGrid');
        const noResults = document.getElementById('noResults');
        const tokens = this.getFilteredTokens();

        if (!tokens.length) {
            grid.style.display = 'none';
            noResults.style.display = 'block';
            return;
        }

        noResults.style.display = 'none';
        grid.style.display = 'grid';
        grid.innerHTML = tokens.map(token => this.renderCard(token)).join('');

        grid.querySelectorAll('.token-card').forEach(card => {
            card.addEventListener('click', () => {
                const token = tokens.find(t => t.address === card.dataset.address);
                if (token) this.openModal(token);
            });
        });
    },

    renderCard(token) {
        const changeClass = (token.priceChange24h || 0) >= 0 ? 'green' : 'red';
        const changeText = API.formatPercentage(token.priceChange24h);
        const fallbackImg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PHJlY3QgZmlsbD0iIzIyMiIgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iMjQiLz48dGV4dCB4PSIyNCIgeT0iMzAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM1NTUiIGZvbnQtc2l6ZT0iMTYiPj88L3RleHQ+PC9zdmc+';
        const imgSrc = token.image || fallbackImg;

        // Calculate ATH progress
        const currentMcap = token.marketCap || 0;
        const athMcap = this.state.athValues[token.address] || currentMcap;
        const athProgress = athMcap > 0 ? Math.min((currentMcap / athMcap) * 100, 100) : 0;
        const isAtAth = athProgress >= 99;

        const progressClass = isAtAth ? 'at-ath' : '';
        const crownHtml = isAtAth ? '<span class="ath-crown">👑</span>' : '';

        return `
            <div class="token-card" data-address="${token.address}">
                ${crownHtml}
                <div class="card-header">
                    <img src="${imgSrc}" alt="${token.symbol}" class="card-img" onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCI+PHJlY3QgZmlsbD0iIzIyMiIgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iMjQiLz48dGV4dCB4PSIyNCIgeT0iMzAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM1NTUiIGZvbnQtc2l6ZT0iMTYiPj88L3RleHQ+PC9zdmc+'">
                    <div class="card-info">
                        <div class="card-name">${this.escapeHtml(token.name)}</div>
                        <div class="card-ticker">${this.escapeHtml(token.symbol)}</div>
                    </div>
                </div>
                <div class="card-desc">${this.escapeHtml(token.description || 'No description')}</div>
                <div class="ath-progress">
                    <div class="ath-progress-header">
                        <span class="ath-progress-label">mcap to ath</span>
                        <span class="ath-progress-value">${isAtAth ? '<span class="ath-badge">🔥 ATH</span>' : athProgress.toFixed(0) + '%'}</span>
                    </div>
                    <div class="ath-progress-bar">
                        <div class="ath-progress-fill ${progressClass}" style="width: ${athProgress}%"></div>
                    </div>
                </div>
                <div class="card-stats">
                    <div class="card-stat">
                        <span class="card-stat-label">mcap</span>
                        <span class="card-stat-value">${API.formatNumber(token.marketCap)}</span>
                    </div>
                    <div class="card-stat">
                        <span class="card-stat-label">24h</span>
                        <span class="card-stat-value ${changeClass}">${changeText}</span>
                    </div>
                    <div class="card-stat">
                        <span class="card-stat-label">age</span>
                        <span class="card-stat-value">${token.age || '--'}</span>
                    </div>
                </div>
            </div>
        `;
    },

    async openModal(token) {
        this.state.selectedToken = token;

        document.getElementById('modalTokenName').textContent = token.name;
        document.getElementById('modalTokenSymbol').textContent = token.symbol;
        document.getElementById('modalPrice').textContent = API.formatPrice(token.price);

        const changeEl = document.getElementById('modalPriceChange');
        changeEl.textContent = API.formatPercentage(token.priceChange24h);
        changeEl.className = 'modal-change ' + ((token.priceChange24h || 0) >= 0 ? 'green' : 'red');

        const img = document.getElementById('modalTokenImage');
        img.src = token.image || '';
        img.style.display = token.image ? 'block' : 'none';

        document.getElementById('modalMarketCap').textContent = API.formatNumber(token.marketCap);
        document.getElementById('modalVolume').textContent = API.formatNumber(token.volume24h);
        document.getElementById('modalLiquidity').textContent = API.formatNumber(token.liquidity);
        document.getElementById('modalContract').value = token.address;

        // Social links
        const linksEl = document.getElementById('socialLinks');
        let links = [];
        if (token.websites?.length) {
            links.push(...token.websites.map(w => `<a href="${w.url}" target="_blank" class="modal-link">🌐 website</a>`));
        }
        if (token.socials?.length) {
            links.push(...token.socials.map(s => {
                const icon = s.type === 'twitter' ? '𝕏' : s.type === 'telegram' ? '💬' : '🔗';
                return `<a href="${s.url}" target="_blank" class="modal-link">${icon} ${s.type}</a>`;
            }));
        }
        linksEl.innerHTML = links.join('');

        document.getElementById('openBagsFm').href = `https://bags.fm/${token.address}`;
        document.getElementById('openDexScreener').href = token.url || '#';

        document.getElementById('modalOverlay').style.display = 'flex';

        await this.loadChart(token);
        await this.loadCreatorInfo(token);
    },

    async loadCreatorInfo(token) {
        const creatorInfo = document.getElementById('creatorInfo');
        const creatorAddress = document.getElementById('creatorAddress');
        const royaltyRecipients = document.getElementById('royaltyRecipients');
        const lifetimeEarnings = document.getElementById('lifetimeEarnings');

        // Reset
        creatorInfo.style.display = 'none';
        creatorAddress.textContent = '--';
        royaltyRecipients.innerHTML = '';
        lifetimeEarnings.textContent = '$0';

        try {
            // Fetch creator info from Bags API
            const [creatorRes, feesRes] = await Promise.all([
                fetch(`/api/bags/creator?tokenMint=${token.address}`),
                fetch(`/api/bags/lifetime-fees?tokenMint=${token.address}`)
            ]);

            let creatorData = null;
            let feesData = null;

            if (creatorRes.ok) {
                creatorData = await creatorRes.json();
            }

            if (feesRes.ok) {
                feesData = await feesRes.json();
            }

            // Show creator wallet
            if (creatorData?.creator) {
                const wallet = creatorData.creator;
                creatorAddress.textContent = wallet.slice(0, 4) + '...' + wallet.slice(-4);
                creatorInfo.style.display = 'block';
            }

            // Show royalty recipients
            if (creatorData?.feeClaimers && creatorData.feeClaimers.length > 0) {
                royaltyRecipients.innerHTML = creatorData.feeClaimers.map(claimer => {
                    const addr = claimer.user || claimer.wallet;
                    const shortAddr = addr ? (addr.slice(0, 4) + '...' + addr.slice(-4)) : '--';
                    const share = claimer.userBps ? (claimer.userBps / 100).toFixed(0) + '%' : '--';
                    return `
                        <div class="royalty-recipient">
                            <div class="recipient-info">
                                <span class="recipient-address">${shortAddr}</span>
                            </div>
                            <span class="recipient-share">${share}</span>
                        </div>
                    `;
                }).join('');
                creatorInfo.style.display = 'block';
            }

            // Show lifetime earnings
            if (feesData?.totalFeesUsd !== undefined) {
                lifetimeEarnings.textContent = '$' + API.formatNumber(feesData.totalFeesUsd).replace('$', '');
                creatorInfo.style.display = 'block';
            } else if (feesData?.totalFeesSol !== undefined) {
                lifetimeEarnings.textContent = feesData.totalFeesSol.toFixed(4) + ' SOL';
                creatorInfo.style.display = 'block';
            }
        } catch (error) {
            console.error('Failed to load creator info:', error);
            // Hide section if we couldn't load data
            creatorInfo.style.display = 'none';
        }
    },

    closeModal() {
        document.getElementById('modalOverlay').style.display = 'none';
        this.state.selectedToken = null;
        if (this.state.chart) {
            this.state.chart.destroy();
            this.state.chart = null;
        }
    },

    async loadChart(token) {
        const canvas = document.getElementById('priceChart');
        const ctx = canvas.getContext('2d');

        if (this.state.chart) this.state.chart.destroy();

        const data = await API.getOHLCVData(token.pairAddress, '1H');
        if (!data.length) {
            ctx.fillStyle = '#555';
            ctx.textAlign = 'center';
            ctx.fillText('No data', canvas.width / 2, canvas.height / 2);
            return;
        }

        const isUp = data[data.length - 1].price >= data[0].price;
        const color = isUp ? '#4ade80' : '#f87171';

        this.state.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
                datasets: [{
                    data: data.map(d => d.price),
                    borderColor: color,
                    backgroundColor: color + '20',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: {
                        display: true,
                        grid: { color: '#222' },
                        ticks: { color: '#555', font: { size: 10 }, callback: v => API.formatPrice(v) }
                    }
                }
            }
        });
    },

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Copied');
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;

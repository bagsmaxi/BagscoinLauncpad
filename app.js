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
        isLaunching: false
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

            // Step 2: Create fee share config (includes partner config for platform revenue)
            let configKey = null;
            const feeConfigRes = await fetch('/api/fee-share/create-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    payer: this.state.walletAddress,
                    tokenMint: tokenInfo.tokenMint,
                    feeClaimers: [{ user: this.state.walletAddress, userBps: 10000 }]
                })
            });

            if (feeConfigRes.ok) {
                const feeConfig = await feeConfigRes.json();
                if (feeConfig.configKey) {
                    configKey = feeConfig.configKey;

                    // Sign fee share config transactions if any
                    if (feeConfig.transactions && feeConfig.transactions.length > 0) {
                        btn.textContent = 'confirm fee setup...';
                        for (const txBase64 of feeConfig.transactions) {
                            const txBuffer = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));
                            const versionedTx = solanaWeb3.VersionedTransaction.deserialize(txBuffer);
                            await window.solana.signAndSendTransaction(versionedTx);
                        }
                    }
                }
            }

            btn.textContent = 'getting launch tx...';

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

            btn.textContent = 'confirm launch...';

            // Step 4: Sign and send launch transaction
            const txBuffer = Uint8Array.from(atob(transaction), c => c.charCodeAt(0));
            const versionedTx = solanaWeb3.VersionedTransaction.deserialize(txBuffer);
            await window.solana.signAndSendTransaction(versionedTx);

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

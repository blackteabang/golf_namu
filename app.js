const app = {
    players: [],
    rooms: [],
    history: [],

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.loadFromStorage();
        this.loadFromServer(); // Sync with server on load
        this.renderPlayerList();
    },

    cacheDOM() {
        this.playerNameInput = document.getElementById('player-name');
        this.playerHandyInput = document.getElementById('player-handy');
        this.addPlayerBtn = document.getElementById('add-player-btn');
        this.playerList = document.getElementById('player-list');
        this.playerCountEl = document.getElementById('player-count');
        this.assignRoomsBtn = document.getElementById('assign-rooms-btn');
        
        this.roomsContainer = document.getElementById('rooms-container');
        this.viewResultsBtn = document.getElementById('view-results-btn');
        
        this.resultsBody = document.getElementById('results-body');
        this.restartBtn = document.getElementById('restart-btn');
        this.showHistoryBtn = document.getElementById('show-history-btn');
        this.historyContainer = document.getElementById('history-container');

        this.steps = {
            players: document.getElementById('step-players'),
            rooms: document.getElementById('step-rooms'),
            results: document.getElementById('step-results'),
            history: document.getElementById('step-history')
        };
    },

    bindEvents() {
        this.addPlayerBtn.addEventListener('click', () => this.addPlayer());
        this.assignRoomsBtn.addEventListener('click', () => this.assignRooms());
        this.viewResultsBtn.addEventListener('click', () => this.calculateRanking());
        this.restartBtn.addEventListener('click', () => this.restart());
        this.showHistoryBtn.addEventListener('click', () => this.showHistory());
        
        // Enter key support for input
        this.playerHandyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPlayer();
        });
    },

    addPlayer() {
        const name = this.playerNameInput.value.trim();
        const handy = parseInt(this.playerHandyInput.value);

        if (!name) return alert('이름을 입력해주세요.');
        if (isNaN(handy)) return alert('핸디를 숫자로 입력해주세요.');
        if (this.players.length >= 12) return alert('최대 12명까지 등록 가능합니다.');

        const newPlayer = {
            id: Date.now(),
            name,
            handy,
            score: 0,
            isActive: true
        };

        this.players.push(newPlayer);
        this.saveToStorage();
        this.renderPlayerList();
        
        this.playerNameInput.value = '';
        this.playerHandyInput.value = '';
        this.playerNameInput.focus();
    },

    toggleParticipation(id) {
        const player = this.players.find(p => p.id === id);
        if (player) {
            if (!player.isActive && this.players.filter(p => p.isActive).length >= 12) {
                return alert('최대 12명까지 참여 가능합니다.');
            }
            player.isActive = !player.isActive;
            this.saveToStorage();
            this.renderPlayerList();
        }
    },

    removePlayer(id) {
        this.players = this.players.filter(p => p.id !== id);
        this.saveToStorage();
        this.renderPlayerList();
    },

    renderPlayerList() {
        this.playerList.innerHTML = '';
        this.players.forEach(player => {
            const li = document.createElement('li');
            li.className = `player-item ${player.isActive ? '' : 'inactive'}`;
            li.innerHTML = `
                <div class="player-info">
                    <span class="player-name">${player.name}</span>
                    <span class="player-handy">HDCP: ${player.handy}</span>
                </div>
                <div class="player-actions">
                    <button class="btn-toggle ${player.isActive ? 'active' : ''}" 
                            onclick="app.toggleParticipation(${player.id})">
                        ${player.isActive ? '참여' : '제외'}
                    </button>
                    <button class="btn-remove" onclick="app.removePlayer(${player.id})">×</button>
                </div>
            `;
            this.playerList.appendChild(li);
        });

        const activeCount = this.players.filter(p => p.isActive).length;
        this.playerCountEl.textContent = activeCount;
        this.assignRoomsBtn.disabled = activeCount < 2; // Need at least 2 active players
    },

    assignRooms() {
        const activePlayers = this.players.filter(p => p.isActive);
        
        // Reset all active player scores for a new game
        activePlayers.forEach(p => p.score = 0);
        
        // Shuffle active players
        const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
        this.rooms = [];
        
        // Split into rooms of 3
        for (let i = 0; i < shuffled.length; i += 3) {
            this.rooms.push(shuffled.slice(i, i + 3));
        }

        this.renderRooms();
        this.showStep('rooms');
    },

    renderRooms() {
        this.roomsContainer.innerHTML = '';
        this.rooms.forEach((room, index) => {
            const roomDiv = document.createElement('div');
            roomDiv.className = 'room-card';
            
            let playersHTML = '';
            room.forEach(player => {
                playersHTML += `
                    <div class="room-player">
                        <span class="player-name">${player.name}</span>
                        <div class="player-input-group">
                            <span class="player-handy-badge">H: ${player.handy}</span>
                            <input type="number" 
                                   class="score-input" 
                                   placeholder="타수" 
                                   value="0"
                                   onfocus="if(this.value=='0')this.value=''"
                                   onblur="if(this.value=='')this.value='0'"
                                   onchange="app.updateScore(${player.id}, this.value)">
                        </div>
                    </div>
                `;
            });

            roomDiv.innerHTML = `
                <div class="room-title">Room ${index + 1}</div>
                ${playersHTML}
            `;
            this.roomsContainer.appendChild(roomDiv);
        });
    },

    updateScore(playerId, score) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.score = parseInt(score) || 0;
            this.saveToStorage();
        }
    },

    calculateRanking() {
        const activePlayers = this.players.filter(p => p.isActive);
        
        // Validate all active scores entered
        const missingScores = activePlayers.some(p => p.score === 0);
        if (missingScores && !confirm('입력되지 않은 스코어가 있습니다. 그대로 진행할까요?')) return;

        // Sort active players by Net Score (Gross - Handy)
        const rankedPlayers = [...activePlayers].sort((a, b) => {
            const netA = a.score - a.handy;
            const netB = b.score - b.handy;
            
            if (netA !== netB) return netA - netB;
            return a.score - b.score; // Tie-breaker: original score
        });

        this.saveToHistory(rankedPlayers);
        this.renderResults(rankedPlayers);
        this.showStep('results');
    },

    saveToHistory(rankedPlayers) {
        const today = new Date().toISOString().split('T')[0];
        const todayGames = this.history.filter(h => h.date === today);
        const round = todayGames.length + 1;

        const record = {
            id: Date.now(),
            date: today,
            round: round,
            players: rankedPlayers.map(p => ({
                name: p.name,
                score: p.score,
                handy: p.handy,
                net: p.score - p.handy
            }))
        };

        this.history.unshift(record); // Add to beginning
        this.saveHistoryToStorage();
    },

    showHistory() {
        this.renderHistory();
        this.showStep('history');
    },

    renderHistory() {
        this.historyContainer.innerHTML = '';
        if (this.history.length === 0) {
            this.historyContainer.innerHTML = '<p style="text-align:center; padding: 20px; color: var(--text-muted);">저장된 기록이 없습니다.</p>';
            return;
        }

        this.history.forEach(record => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.onclick = () => div.classList.toggle('expanded');
            
            const winner = record.players[0];
            const others = record.players.slice(1).map((p, i) => `
                <div class="history-player-row">
                    <span class="rank">${i + 2}위</span>
                    <span class="name">${p.name}</span>
                    <span class="stats">G: ${p.score} | H: ${p.handy} | <span class="net">N: ${p.net}</span></span>
                </div>
            `).join('');

            div.innerHTML = `
                <div class="history-date-header">
                    <span class="history-date">${record.date}</span>
                    <span class="history-round">${record.round}경기</span>
                </div>
                <div class="history-winner-preview">
                    🏆 우승: <span>${winner.name}</span> (${winner.net}타)
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="history-players-list">
                    <div class="history-player-row winner">
                        <span class="rank">1위</span>
                        <span class="name">${winner.name}</span>
                        <span class="stats">G: ${winner.score} | H: ${winner.handy} | <span class="net">N: ${winner.net}</span></span>
                    </div>
                    ${others}
                </div>
            `;
            this.historyContainer.appendChild(div);
        });
    },

    renderResults(rankedPlayers) {
        this.resultsBody.innerHTML = '';
        rankedPlayers.forEach((player, index) => {
            const net = player.score - player.handy;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${player.name}</td>
                <td>${player.score}</td>
                <td>${player.handy}</td>
                <td style="font-weight: 700; color: var(--primary-light)">${net}</td>
            `;
            this.resultsBody.appendChild(tr);
        });
    },

    showStep(stepName) {
        Object.values(this.steps).forEach(step => step.classList.remove('active'));
        this.steps[stepName].classList.add('active');
        window.scrollTo(0, 0);
    },

    saveToStorage() {
        localStorage.setItem('golf_bet_players', JSON.stringify(this.players));
        this.syncWithServer();
    },

    saveHistoryToStorage() {
        localStorage.setItem('golf_bet_history', JSON.stringify(this.history));
        this.syncWithServer();
    },

    async syncWithServer() {
        try {
            await fetch('/api/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    players: this.players,
                    history: this.history
                })
            });
        } catch (error) {
            console.error('Server sync failed:', error);
        }
    },

    async loadFromServer() {
        try {
            const response = await fetch('/api/history');
            const data = await response.json();
            
            if (data.players && data.players.length > 0) {
                this.players = data.players;
                localStorage.setItem('golf_bet_players', JSON.stringify(this.players));
            }
            
            if (data.history && data.history.length > 0) {
                this.history = data.history;
                localStorage.setItem('golf_bet_history', JSON.stringify(this.history));
            }

            this.renderPlayerList();
        } catch (error) {
            console.error('Fetch from server failed:', error);
        }
    },

    loadFromStorage() {
        const savedPlayers = localStorage.getItem('golf_bet_players');
        if (savedPlayers) {
            this.players = JSON.parse(savedPlayers);
        }
        
        const savedHistory = localStorage.getItem('golf_bet_history');
        if (savedHistory) {
            this.history = JSON.parse(savedHistory);
        }
    },

    restart() {
        if (confirm('현재 게임 결과를 기록하고 새로운 게임을 시작하시겠습니까? (등록된 인원은 유지됩니다)')) {
            // Reset scores for all players but keep the player list
            this.players.forEach(p => p.score = 0);
            this.saveToStorage();
            this.renderPlayerList();
            this.showStep('players');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());

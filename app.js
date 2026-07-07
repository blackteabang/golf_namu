const app = {
    // 👥 선수들의 정보(이름, 핸디캡 등)를 담아둘 빈 바구니(배열)예요.
    players: [],
    // 🎲 3명씩 짜여진 조들을 담아둘 바구니예요.
    rooms: [],
    // 🏆 과거의 경기 우승자 기록들을 담아둘 바구니예요.
    history: [],

    // 🚀 프로그램이 처음 켜질 때 가장 먼저 실행되는 '준비 운동' 단계예요!
    init() {
        this.cacheDOM(); // 화면에 있는 버튼들을 자바스크립트가 기억하게 해요.
        this.bindEvents(); // 버튼을 눌렀을 때 어떤 행동을 할지 귀를 달아줘요.
        this.loadFromStorage(); // 컴퓨터 비밀창고(로컬 스토리지)에서 예전 기록을 불러와요.
        this.loadFromServer(); // 서버라는 큰 창고에서도 정보를 가져와요.
        this.renderPlayerList(); // 화면에 선수들 이름을 예쁘게 그려줘요.
        
        // 3초마다 서버에서 다른 사람들의 입력을 불러와 내 화면에 적용해요.
        setInterval(() => this.loadFromServer(), 3000);
        
        // 만약 조가 이미 짜여져 있다면 (인터넷 창을 실수로 껐다 켰을 때)
        if (this.rooms && this.rooms.length > 0) {
            this.renderRooms(); // 짜여진 조를 다시 보여주고
            this.showStep('rooms'); // 점수 입력 화면으로 바로 넘어가요!
        } else {
            this.showStep('players'); // 처음 온 거면 선수 등록 화면을 보여줘요.
        }
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
        this.resetRoomsBtn = document.getElementById('reset-rooms-btn');
        
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
        
        if (this.resetRoomsBtn) {
            this.resetRoomsBtn.addEventListener('click', () => {
                if (confirm('조 편성을 초기화하고 처음부터 다시 시작하시겠습니까?')) {
                    this.rooms = [];
                    this.saveCurrentGameToStorage();
                    this.showStep('players');
                }
            });
        }
        
        // Enter key support for input
        this.playerHandyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addPlayer();
        });
    },

    // ✏️ 새로운 선수를 바구니(players)에 추가하는 기능이에요.
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

    // 🔘 특정 선수를 오늘 경기에 참여시킬지 말지(참여/제외) 스위치를 껐다 켜는 기능이에요.
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

    // 🎩 참가하는 사람들을 마구 섞어서 3명씩 무작위로 조를 짜는 마법의 기능이에요!
    assignRooms() {
        const activePlayers = this.players.filter(p => p.isActive);
        
        // 새 게임을 시작하니까 모든 사람의 점수를 0점으로 초기화해요.
        activePlayers.forEach(p => p.score = 0);
        
        // 사람들을 무작위로 마구마구 섞어요! (Shuffle)
        const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
        this.rooms = [];
        
        // 섞인 사람들을 3명씩 끊어서 새로운 방(조)에 넣어줘요.
        for (let i = 0; i < shuffled.length; i += 3) {
            this.rooms.push(shuffled.slice(i, i + 3).map(p => p.id));
        }

        // 창을 꺼도 조가 날아가지 않게 로컬 스토리지에 저장해요.
        this.saveCurrentGameToStorage();
        this.saveToStorage();
        this.renderRooms();
        this.showStep('rooms');
    },

    renderRooms() {
        this.roomsContainer.innerHTML = '';
        this.rooms.forEach((roomIds, index) => {
            const roomDiv = document.createElement('div');
            roomDiv.className = 'room-card';
            
            let playersHTML = '';
            roomIds.forEach(playerId => {
                const id = typeof playerId === 'object' ? playerId.id : playerId;
                const player = this.players.find(p => p.id === id);
                if (!player) return;

                playersHTML += `
                    <div class="room-player">
                        <span class="player-name">${player.name}</span>
                        <div class="player-input-group">
                            <span class="player-handy-badge">H: ${player.handy}</span>
                            <input type="number" 
                                   class="score-input" 
                                   placeholder="타수" 
                                   value="${player.score || 0}"
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

    // 📝 선수가 골프공을 친 횟수(타수)를 적었을 때, 그 숫자를 저장하는 기능이에요.
    updateScore(playerId, score) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.score = parseInt(score) || 0; // 숫자가 아니면 0으로 저장해요
            this.saveToStorage(); // 점수가 바뀔 때마다 잃어버리지 않게 몰래 저장해둬요!
        }
    },

    // 🥇 최종 점수를 계산해서 1등부터 꼴찌까지 순위를 매기는 기능이에요.
    calculateRanking() {
        const activePlayers = this.players.filter(p => p.isActive);
        
        // 아직 점수를 안 적은 사람이 있는지 검사해요.
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

    // 📸 경기가 완전히 끝나면 오늘의 결과를 영원히 기억하도록 '과거 기록'에 저장해요.
    saveToHistory(rankedPlayers) {
        const today = new Date().toISOString().split('T')[0];
        const todayGames = this.history.filter(h => h.date === today);
        const round = todayGames.length + 1; // 오늘 몇 번째 경기인지 세어요.

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

    // 💾 우리의 정보를 인터넷 브라우저의 '비밀 창고(로컬 스토리지)'에 저장하는 기능들이에요.
    saveToStorage() {
        localStorage.setItem('golf_bet_players', JSON.stringify(this.players));
        this.syncWithServer();
    },

    saveCurrentGameToStorage() {
        localStorage.setItem('golf_bet_current_rooms', JSON.stringify(this.rooms));
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
                    history: this.history,
                    rooms: this.rooms
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
            
            let changedPlayers = false;
            let changedRooms = false;
            let changedHistory = false;

            if (data.players && data.players.length > 0) {
                if (JSON.stringify(this.players) !== JSON.stringify(data.players)) {
                    this.players = data.players;
                    localStorage.setItem('golf_bet_players', JSON.stringify(this.players));
                    changedPlayers = true;
                }
            }
            
            if (data.history && data.history.length > 0) {
                if (JSON.stringify(this.history) !== JSON.stringify(data.history)) {
                    this.history = data.history;
                    localStorage.setItem('golf_bet_history', JSON.stringify(this.history));
                    changedHistory = true;
                }
            }

            if (data.rooms && data.rooms.length > 0) {
                if (JSON.stringify(this.rooms) !== JSON.stringify(data.rooms)) {
                    this.rooms = data.rooms;
                    localStorage.setItem('golf_bet_current_rooms', JSON.stringify(this.rooms));
                    changedRooms = true;
                }
            } else if (data.rooms && data.rooms.length === 0 && this.rooms.length > 0) {
                // If rooms were reset on server by another user
                this.rooms = [];
                localStorage.setItem('golf_bet_current_rooms', JSON.stringify(this.rooms));
                changedRooms = true;
            }

            if (changedPlayers) {
                // Only re-render if not currently typing in a name or handy input
                if (document.activeElement !== this.playerNameInput && document.activeElement !== this.playerHandyInput) {
                    this.renderPlayerList();
                }
            }

            if (changedRooms && this.rooms.length > 0) {
                // Only re-render if not currently typing a score
                if (!document.activeElement.classList.contains('score-input')) {
                    this.renderRooms();
                }
            } else if (changedRooms && this.rooms.length === 0) {
                // Return to players step if rooms reset
                this.showStep('players');
            }

            if (changedHistory) {
                // Only update history view if not already focused on something
                this.renderHistory();
            }

        } catch (error) {
            console.error('Fetch from server failed:', error);
        }
    },

    // 🧲 컴퓨터 비밀 창고(로컬 스토리지)에 예전에 저장해뒀던 정보를 다시 쏙쏙 뽑아오는 기능이에요.
    loadFromStorage() {
        const savedPlayers = localStorage.getItem('golf_bet_players');
        if (savedPlayers) {
            this.players = JSON.parse(savedPlayers);
        }
        
        const savedHistory = localStorage.getItem('golf_bet_history');
        if (savedHistory) {
            this.history = JSON.parse(savedHistory);
        }

        const savedRooms = localStorage.getItem('golf_bet_current_rooms');
        if (savedRooms) {
            this.rooms = JSON.parse(savedRooms);
            // 옛날 버전과 호환되도록 아이디(ID)만 깔끔하게 빼와요.
            this.rooms = this.rooms.map(room => room.map(p => typeof p === 'object' ? p.id : p));
        }
    },

    // 🔄 모든 걸 지우고 완전히 처음부터 새 게임을 시작하는 버튼이에요!
    restart() {
        if (confirm('현재 게임 결과를 기록하고 새로운 게임을 시작하시겠습니까? (등록된 인원은 유지됩니다)')) {
            // 선수들 명단은 놔두고, 점수랑 조 편성만 백지상태로 만들어요.
            this.players.forEach(p => p.score = 0);
            this.rooms = [];
            this.saveCurrentGameToStorage();
            this.saveToStorage();
            this.renderPlayerList();
            this.showStep('players'); // 다시 선수 등록 화면으로 출발!
        }
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());

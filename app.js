const app = {
    // 👥 선수들의 정보(이름, 핸디캡 등)를 담아둘 빈 바구니(배열)예요.
    players: [],
    // 🎲 3명씩 짜여진 조들을 담아둘 바구니예요.
    rooms: [],
    // 🏆 과거의 경기 우승자 기록들을 담아둘 바구니예요.
    history: [],

    // ☁️ 서버 (Firebase Realtime Database) 상태
    server: {
        dbUrl: '',
        isConnected: false,
        dbRef: null
    },

    // 🚀 프로그램이 처음 켜질 때 가장 먼저 실행되는 '준비 운동' 단계예요!
    init() {
        this.cacheDOM(); // 화면에 있는 버튼들을 자바스크립트가 기억하게 해요.
        this.bindEvents(); // 버튼을 눌렀을 때 어떤 행동을 할지 귀를 달아줘요.
        this.loadFromStorage(); // 컴퓨터 비밀창고(로컬 스토리지)에서 예전 기록을 불러와요.
        this.initServer(); // 클라우드 서버와 연결하고 최신 데이터를 불러와요.
        this.renderPlayerList(); // 화면에 선수들 이름을 예쁘게 그려줘요.
        
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
        this.playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.openHandyKeypad();
            }
        });
    },

    // ✏️ 새로운 선수를 바구니(players)에 추가하는 기능이에요.
    addPlayer() {
        const name = this.playerNameInput.value.trim();
        const handyRaw = this.playerHandyInput.value.trim();
        const handy = parseInt(handyRaw, 10);

        if (!name) return alert('이름을 입력해주세요.');
        if (isNaN(handy)) return alert('핸디를 숫자로 입력해주세요. (예: 18 또는 -5)');
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
        if (!this.rooms || this.rooms.length === 0) return;

        this.rooms.forEach((roomIds, index) => {
            const roomDiv = document.createElement('div');
            roomDiv.className = 'room-card';
            roomDiv.dataset.roomIdx = index;
            
            let playersHTML = '';
            const validPlayerIds = roomIds.map(p => typeof p === 'object' ? p.id : p);

            validPlayerIds.forEach(id => {
                const player = this.players.find(p => p.id === id);
                if (!player) return;

                playersHTML += `
                    <div class="room-player" 
                         draggable="true" 
                         data-player-id="${player.id}" 
                         data-room-idx="${index}">
                        <div class="drag-handle" title="드래그하여 다른 방으로 이동">
                            <span>⠿</span>
                        </div>
                        <span class="player-name">${player.name}</span>
                        <div class="player-input-group">
                            <span class="player-handy-badge">H: ${player.handy}</span>
                            <input type="text" 
                                   class="score-input" 
                                   placeholder="타수" 
                                   value="${player.score || 0}"
                                   readonly
                                   onclick="app.openKeypad(${player.id}, this)">
                        </div>
                    </div>
                `;
            });

            if (validPlayerIds.length === 0) {
                playersHTML = `
                    <div class="room-empty-placeholder">
                        선수를 여기로 드래그하세요
                    </div>
                `;
            }

            const deleteRoomBtnHTML = (validPlayerIds.length === 0 && this.rooms.length > 1)
                ? `<button class="btn-delete-room" title="빈 방 삭제" onclick="app.removeRoom(${index})">삭제</button>`
                : '';

            roomDiv.innerHTML = `
                <div class="room-header">
                    <div class="room-header-left">
                        <span class="room-title">Room ${index + 1}</span>
                        <span class="room-player-badge">${validPlayerIds.length}명</span>
                    </div>
                    ${deleteRoomBtnHTML}
                </div>
                <div class="room-players-list">
                    ${playersHTML}
                </div>
            `;
            this.roomsContainer.appendChild(roomDiv);
        });

        this.initRoomDragAndDrop();
    },

    addRoom() {
        this.rooms.push([]);
        this.saveCurrentGameToStorage();
        this.renderRooms();
    },

    removeRoom(roomIdx) {
        if (this.rooms[roomIdx] && this.rooms[roomIdx].length === 0) {
            this.rooms.splice(roomIdx, 1);
            this.saveCurrentGameToStorage();
            this.renderRooms();
        }
    },

    movePlayerToRoom(playerId, targetRoomIdx) {
        targetRoomIdx = parseInt(targetRoomIdx);
        playerId = parseInt(playerId);

        if (isNaN(targetRoomIdx) || targetRoomIdx < 0 || targetRoomIdx >= this.rooms.length) return;

        let sourceRoomIdx = -1;
        for (let i = 0; i < this.rooms.length; i++) {
            const idx = this.rooms[i].findIndex(p => (typeof p === 'object' ? p.id : p) === playerId);
            if (idx !== -1) {
                sourceRoomIdx = i;
                this.rooms[i].splice(idx, 1);
                break;
            }
        }

        if (sourceRoomIdx === -1) return;

        // 타겟 방에 선수 추가
        this.rooms[targetRoomIdx].push(playerId);

        this.saveCurrentGameToStorage();
        this.renderRooms();
    },

    initRoomDragAndDrop() {
        const roomCards = this.roomsContainer.querySelectorAll('.room-card');
        const playerItems = this.roomsContainer.querySelectorAll('.room-player');

        // 1. 데스크톱 HTML5 드래그 앤 드롭
        playerItems.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                const playerId = item.dataset.playerId;
                const roomIdx = item.dataset.roomIdx;
                e.dataTransfer.setData('text/plain', JSON.stringify({ playerId, fromRoomIdx: roomIdx }));
                e.dataTransfer.effectAllowed = 'move';
                item.classList.add('dragging');
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                roomCards.forEach(card => card.classList.remove('drag-over'));
            });
        });

        roomCards.forEach(card => {
            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                card.classList.add('drag-over');
            });

            card.addEventListener('dragleave', (e) => {
                if (!card.contains(e.relatedTarget)) {
                    card.classList.remove('drag-over');
                }
            });

            card.addEventListener('drop', (e) => {
                e.preventDefault();
                card.classList.remove('drag-over');
                try {
                    const raw = e.dataTransfer.getData('text/plain');
                    if (raw) {
                        const data = JSON.parse(raw);
                        const targetRoomIdx = parseInt(card.dataset.roomIdx);
                        if (data && data.playerId !== undefined) {
                            app.movePlayerToRoom(data.playerId, targetRoomIdx);
                        }
                    }
                } catch (err) {
                    console.error('Drop error:', err);
                }
            });
        });

        // 2. 모바일 터치 드래그 앤 드롭
        let touchDragState = null;

        playerItems.forEach(item => {
            const handle = item.querySelector('.drag-handle') || item;

            handle.addEventListener('touchstart', (e) => {
                if (e.target.closest('.score-input') || e.target.closest('.player-handy-badge')) return;

                const touch = e.touches[0];
                const playerId = parseInt(item.dataset.playerId);
                const player = this.players.find(p => p.id === playerId);
                const playerName = player ? player.name : '';
                const handy = player ? player.handy : 0;

                touchDragState = {
                    item,
                    playerId,
                    playerName,
                    handy,
                    startX: touch.clientX,
                    startY: touch.clientY,
                    isDragging: false,
                    avatar: null,
                    currentTargetCard: null
                };
            }, { passive: true });

            handle.addEventListener('touchmove', (e) => {
                if (!touchDragState) return;

                const touch = e.touches[0];
                const deltaX = Math.abs(touch.clientX - touchDragState.startX);
                const deltaY = Math.abs(touch.clientY - touchDragState.startY);

                if (!touchDragState.isDragging && (deltaX > 6 || deltaY > 6)) {
                    touchDragState.isDragging = true;
                    touchDragState.item.classList.add('dragging');

                    const avatar = document.createElement('div');
                    avatar.className = 'touch-drag-avatar';
                    avatar.innerHTML = `<span>⠿</span> <strong>${touchDragState.playerName}</strong> <small>H:${touchDragState.handy}</small>`;
                    document.body.appendChild(avatar);
                    touchDragState.avatar = avatar;
                }

                if (touchDragState.isDragging) {
                    e.preventDefault();

                    if (touchDragState.avatar) {
                        touchDragState.avatar.style.left = `${touch.clientX}px`;
                        touchDragState.avatar.style.top = `${touch.clientY}px`;
                    }

                    if (touchDragState.avatar) touchDragState.avatar.style.display = 'none';
                    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
                    if (touchDragState.avatar) touchDragState.avatar.style.display = '';

                    const targetCard = elemBelow ? elemBelow.closest('.room-card') : null;

                    roomCards.forEach(c => {
                        if (c === targetCard) {
                            c.classList.add('drag-over');
                        } else {
                            c.classList.remove('drag-over');
                        }
                    });

                    touchDragState.currentTargetCard = targetCard;
                }
            }, { passive: false });

            const endTouchDrag = () => {
                if (!touchDragState) return;

                if (touchDragState.avatar) {
                    touchDragState.avatar.remove();
                }

                touchDragState.item.classList.remove('dragging');
                roomCards.forEach(c => c.classList.remove('drag-over'));

                if (touchDragState.isDragging && touchDragState.currentTargetCard) {
                    const targetRoomIdx = parseInt(touchDragState.currentTargetCard.dataset.roomIdx);
                    if (!isNaN(targetRoomIdx)) {
                        app.movePlayerToRoom(touchDragState.playerId, targetRoomIdx);
                    }
                }

                touchDragState = null;
            };

            handle.addEventListener('touchend', endTouchDrag);
            handle.addEventListener('touchcancel', endTouchDrag);
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

    // 🔢 커스텀 숫자 키패드: 스코어 및 핸디캡 입력을 위한 통합 키패드예요!
    _keypadState: {
        type: 'score', // 'score' 또는 'handy'
        playerId: null,
        inputEl: null,
        title: '스코어 입력',
        value: '',
        onConfirm: null
    },

    openKeypad(options, inputElParam) {
        this.closeKeypad();

        // 기존 openKeypad(playerId, inputEl) 호출과 새 openKeypad({ ... }) 호출 모두 지원
        if (typeof options === 'number' || (typeof options === 'string' && !isNaN(Number(options)))) {
            const playerId = parseInt(options);
            const inputEl = inputElParam;
            this._keypadState = {
                type: 'score',
                playerId: playerId,
                inputEl: inputEl,
                title: '스코어 입력',
                value: (inputEl && inputEl.value !== '0' && inputEl.value !== '') ? inputEl.value : '',
                onConfirm: (val) => {
                    const score = parseInt(val) || 0;
                    if (inputEl) inputEl.value = score;
                    this.updateScore(playerId, score);
                }
            };
        } else {
            const opts = options || {};
            this._keypadState = {
                type: opts.type || 'handy',
                playerId: opts.playerId || null,
                inputEl: opts.inputEl || null,
                title: opts.title || '숫자 입력',
                value: (opts.value !== undefined && opts.value !== null && opts.value !== '') ? String(opts.value) : '',
                onConfirm: opts.onConfirm || null
            };
        }

        const overlay = document.createElement('div');
        overlay.id = 'keypad-overlay';
        overlay.innerHTML = `
            <div class="keypad-modal">
                <div class="keypad-header">
                    <span class="keypad-title">${this._keypadState.title}</span>
                    <button class="keypad-close" onclick="app.closeKeypad()">✕</button>
                </div>
                <div class="keypad-display">
                    <span id="keypad-value" class="${this._keypadState.value.startsWith('-') ? 'negative' : ''}">${this._keypadState.value || '0'}</span>
                </div>
                <div class="keypad-grid">
                    <button class="keypad-btn" onclick="app.keypadInput('1')">1</button>
                    <button class="keypad-btn" onclick="app.keypadInput('2')">2</button>
                    <button class="keypad-btn" onclick="app.keypadInput('3')">3</button>
                    <button class="keypad-btn" onclick="app.keypadInput('4')">4</button>
                    <button class="keypad-btn" onclick="app.keypadInput('5')">5</button>
                    <button class="keypad-btn" onclick="app.keypadInput('6')">6</button>
                    <button class="keypad-btn" onclick="app.keypadInput('7')">7</button>
                    <button class="keypad-btn" onclick="app.keypadInput('8')">8</button>
                    <button class="keypad-btn" onclick="app.keypadInput('9')">9</button>
                    <button class="keypad-btn keypad-minus" onclick="app.keypadToggleMinus()">−</button>
                    <button class="keypad-btn" onclick="app.keypadInput('0')">0</button>
                    <button class="keypad-btn keypad-delete" onclick="app.keypadDelete()">⌫</button>
                </div>
                <button class="keypad-confirm" onclick="app.keypadConfirm()">확인</button>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) app.closeKeypad();
        });

        requestAnimationFrame(() => overlay.classList.add('active'));
    },

    // 🎯 참여자 등록 시 핸디캡 입력 키패드 열기
    openHandyKeypad(inputEl) {
        const el = inputEl || this.playerHandyInput;
        this.openKeypad({
            type: 'handy',
            inputEl: el,
            title: '핸디캡 입력',
            value: el ? el.value : '',
            onConfirm: (val) => {
                if (el) {
                    el.value = val === '' ? '' : (parseInt(val) || 0);
                }
            }
        });
    },

    keypadInput(num) {
        let val = this._keypadState.value;
        const isNegative = val.startsWith('-');
        const digits = isNegative ? val.slice(1) : val;

        // 최대 3자리까지만 입력 가능 (예: 999, -999)
        if (digits.length >= 3) return;

        const newDigits = digits + num;
        this._keypadState.value = (isNegative ? '-' : '') + newDigits;
        this._updateKeypadDisplay();
    },

    keypadToggleMinus() {
        let val = this._keypadState.value;
        if (val.startsWith('-')) {
            this._keypadState.value = val.slice(1);
        } else {
            this._keypadState.value = '-' + val;
        }
        this._updateKeypadDisplay();
    },

    keypadDelete() {
        let val = this._keypadState.value;
        if (val.length <= 1 || (val.length === 2 && val.startsWith('-'))) {
            this._keypadState.value = '';
        } else {
            this._keypadState.value = val.slice(0, -1);
        }
        this._updateKeypadDisplay();
    },

    keypadConfirm() {
        const val = this._keypadState.value;
        if (this._keypadState.onConfirm) {
            this._keypadState.onConfirm(val);
        } else {
            const score = parseInt(val) || 0;
            const inputEl = this._keypadState.inputEl;

            if (inputEl) {
                inputEl.value = score;
            }

            if (this._keypadState.playerId) {
                this.updateScore(this._keypadState.playerId, score);
            }
        }
        this.closeKeypad();
    },

    closeKeypad() {
        const overlay = document.getElementById('keypad-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 200);
        }
    },

    _updateKeypadDisplay() {
        const display = document.getElementById('keypad-value');
        if (display) {
            display.textContent = this._keypadState.value || '0';
            display.className = this._keypadState.value.startsWith('-') ? 'negative' : '';
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

    // ☁️ Firebase Realtime Database 서버 초기화 및 실시간 동기화
    initServer() {
        const savedUrl = localStorage.getItem('golf_firebase_db_url') || (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) || '';
        this.setServerUrl(savedUrl);
    },

    setServerUrl(url) {
        url = (url || '').trim().replace(/\/+$/, '');
        if (url.endsWith('.json')) url = url.replace(/\.json$/, '');
        
        if (!url) {
            this.server.dbUrl = '';
            this.server.isConnected = false;
            this.server.dbRef = null;
            this.updateServerStatusUI('offline', '로컬 모드');
            return;
        }

        this.server.dbUrl = url;

        // Firebase SDK 초기화 시도
        try {
            if (typeof firebase !== 'undefined' && firebase.initializeApp) {
                let appInstance;
                if (!firebase.apps || firebase.apps.length === 0) {
                    appInstance = firebase.initializeApp({ databaseURL: url });
                } else {
                    appInstance = firebase.apps[0];
                }
                const db = firebase.database(appInstance);
                this.server.dbRef = db.ref('golf_namu');

                // ⚡ Firebase 실시간 데이터 변경 감지 (어떤 폰/PC에서 변경하든 즉시 자동 반영)
                this.server.dbRef.on('value', (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        this.handleServerData(data);
                        this.server.isConnected = true;
                        this.updateServerStatusUI('online', '실시간 동기화');
                    }
                }, (error) => {
                    console.warn('Firebase SDK listener warning, using REST polling:', error);
                    this.startRestSync();
                });

                this.server.isConnected = true;
                this.updateServerStatusUI('online', '실시간 동기화');
                return;
            }
        } catch (e) {
            console.warn('Firebase SDK init warning:', e);
        }

        this.startRestSync();
    },

    startRestSync() {
        if (!this.server.dbUrl) return;
        this.loadFromServer();
        if (this._restInterval) clearInterval(this._restInterval);
        this._restInterval = setInterval(() => this.loadFromServer(), 3000);
    },

    updateServerStatusUI(status, text) {
        const dot = document.getElementById('server-status-dot');
        const label = document.getElementById('server-status-text');
        if (dot) {
            dot.className = `status-dot ${status}`;
        }
        if (label) {
            label.textContent = text || (status === 'online' ? '동기화' : '서버');
        }
    },

    handleServerData(data) {
        if (!data) return;
        let changedPlayers = false;
        let changedRooms = false;
        let changedHistory = false;

        if (data.players && Array.isArray(data.players)) {
            if (JSON.stringify(this.players) !== JSON.stringify(data.players)) {
                this.players = data.players;
                localStorage.setItem('golf_bet_players', JSON.stringify(this.players));
                changedPlayers = true;
            }
        }

        if (data.history && Array.isArray(data.history)) {
            if (JSON.stringify(this.history) !== JSON.stringify(data.history)) {
                this.history = data.history;
                localStorage.setItem('golf_bet_history', JSON.stringify(this.history));
                changedHistory = true;
            }
        }

        if (data.rooms && Array.isArray(data.rooms)) {
            if (JSON.stringify(this.rooms) !== JSON.stringify(data.rooms)) {
                this.rooms = data.rooms;
                localStorage.setItem('golf_bet_current_rooms', JSON.stringify(this.rooms));
                changedRooms = true;
            }
        } else if (data.rooms && data.rooms.length === 0 && this.rooms.length > 0) {
            this.rooms = [];
            localStorage.setItem('golf_bet_current_rooms', JSON.stringify(this.rooms));
            changedRooms = true;
        }

        if (changedPlayers) {
            if (document.activeElement !== this.playerNameInput && document.activeElement !== this.playerHandyInput) {
                this.renderPlayerList();
            }
        }

        if (changedRooms && this.rooms.length > 0) {
            const isKeypadOpen = !!document.getElementById('keypad-overlay');
            const isDragging = !!document.querySelector('.touch-drag-avatar') || !!document.querySelector('.room-player.dragging');
            if (!isKeypadOpen && !isDragging) {
                this.renderRooms();
            }
        } else if (changedRooms && this.rooms.length === 0) {
            this.showStep('players');
        }

        if (changedHistory) {
            this.renderHistory();
        }
    },

    async syncWithServer() {
        const payload = {
            players: this.players,
            history: this.history,
            rooms: this.rooms,
            updatedAt: Date.now()
        };

        if (this.server.dbRef) {
            try {
                await this.server.dbRef.set(payload);
                this.server.isConnected = true;
                this.updateServerStatusUI('online', '실시간 동기화');
                return;
            } catch (err) {
                console.warn('Firebase DB sync error:', err);
            }
        }

        if (this.server.dbUrl) {
            try {
                const res = await fetch(`${this.server.dbUrl}/golf_namu.json`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    this.server.isConnected = true;
                    this.updateServerStatusUI('online', '실시간 동기화');
                }
            } catch (err) {
                console.warn('REST server sync error:', err);
            }
        }
    },

    async loadFromServer() {
        if (!this.server.dbUrl) return;

        try {
            const response = await fetch(`${this.server.dbUrl}/golf_namu.json`);
            if (!response.ok) return;
            const data = await response.json();
            if (data) {
                this.handleServerData(data);
                this.server.isConnected = true;
                this.updateServerStatusUI('online', '실시간 동기화');
            }
        } catch (error) {
            console.warn('Load from server failed:', error);
        }
    },

    openServerModal() {
        const modal = document.getElementById('server-modal');
        const input = document.getElementById('firebase-db-url');
        const alertBox = document.getElementById('server-status-alert');

        if (input) {
            input.value = this.server.dbUrl || localStorage.getItem('golf_firebase_db_url') || (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) || '';
        }

        if (alertBox) {
            if (this.server.isConnected) {
                alertBox.className = 'server-status-box success';
                alertBox.innerHTML = '🟢 현재 클라우드 서버와 실시간으로 연결되어 있습니다.';
            } else if (this.server.dbUrl) {
                alertBox.className = 'server-status-box warning';
                alertBox.innerHTML = '🟡 서버 주소가 설정되었습니다. [연결 테스트]로 상태를 확인하세요.';
            } else {
                alertBox.className = 'server-status-box info';
                alertBox.innerHTML = '💡 Firebase Realtime Database URL을 등록하면 모든 사람의 기기에서 데이터가 실시간 공유됩니다.';
            }
        }

        if (modal) {
            modal.style.display = 'flex';
        }
    },

    closeServerModal() {
        const modal = document.getElementById('server-modal');
        if (modal) modal.style.display = 'none';
    },

    async saveServerConfig() {
        const input = document.getElementById('firebase-db-url');
        const alertBox = document.getElementById('server-status-alert');
        let url = (input ? input.value : '').trim();

        if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        localStorage.setItem('golf_firebase_db_url', url);
        if (window.FIREBASE_CONFIG) window.FIREBASE_CONFIG.databaseURL = url;

        if (alertBox) {
            alertBox.className = 'server-status-box info';
            alertBox.textContent = '연결 중...';
        }

        this.setServerUrl(url);

        if (url) {
            try {
                await this.syncWithServer();
                await this.loadFromServer();
                if (alertBox) {
                    alertBox.className = 'server-status-box success';
                    alertBox.textContent = '✅ 서버 연결 및 데이터 저장이 성공했습니다!';
                }
                setTimeout(() => this.closeServerModal(), 1200);
            } catch (err) {
                if (alertBox) {
                    alertBox.className = 'server-status-box error';
                    alertBox.textContent = '❌ 연결 실패: URL 및 Firebase 보안 규칙(테스트 모드)을 확인해주세요.';
                }
            }
        } else {
            if (alertBox) {
                alertBox.className = 'server-status-box info';
                alertBox.textContent = '로컬 모드로 전환되었습니다.';
            }
            setTimeout(() => this.closeServerModal(), 800);
        }
    },

    async testServerConnection() {
        const input = document.getElementById('firebase-db-url');
        const alertBox = document.getElementById('server-status-alert');
        let url = (input ? input.value : '').trim().replace(/\/+$/, '');
        if (url.endsWith('.json')) url = url.replace(/\.json$/, '');

        if (!url) {
            if (alertBox) {
                alertBox.className = 'server-status-box error';
                alertBox.textContent = 'Firebase Database URL을 입력해주세요.';
            }
            return;
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        if (alertBox) {
            alertBox.className = 'server-status-box info';
            alertBox.textContent = '연결 테스트 중...';
        }

        try {
            const res = await fetch(`${url}/golf_namu.json`);
            if (res.ok) {
                if (alertBox) {
                    alertBox.className = 'server-status-box success';
                    alertBox.textContent = '✅ 연결 성공! 읽기 및 쓰기가 정상 작동합니다.';
                }
            } else {
                if (alertBox) {
                    alertBox.className = 'server-status-box error';
                    alertBox.textContent = `❌ 응답 오류 (${res.status}): Firebase Database 보안 규칙에서 읽기/쓰기 권한을 확인해주세요.`;
                }
            }
        } catch (err) {
            if (alertBox) {
                alertBox.className = 'server-status-box error';
                alertBox.textContent = '❌ 서버에 연결할 수 없습니다. URL 주소를 다시 확인해주세요.';
            }
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

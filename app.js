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

    // 브라우저 비밀 창고 키. 두 창 테스트(?mock=1&client=a)만 접두어를 붙여 캐시를 나눈다.
    lsGet(key) {
        return localStorage.getItem((this._storagePrefix || '') + key);
    },

    lsSet(key, value) {
        localStorage.setItem((this._storagePrefix || '') + key, value);
    },

    lsRemove(key) {
        localStorage.removeItem((this._storagePrefix || '') + key);
    },

    // 🚀 프로그램이 처음 켜질 때 가장 먼저 실행되는 '준비 운동' 단계예요!
    init() {
        this.sync = (typeof GolfSync !== 'undefined') ? GolfSync.createSyncClient() : null;
        this._storagePrefix = '';
        this._announceNext = false;
        this._needsSync = false;
        this._connKnown = false;
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('mock') === '1') {
                this._mockMode = true;
                const clientId = (params.get('client') || '').replace(/[^a-zA-Z0-9_-]/g, '');
                if (clientId) this._storagePrefix = 'mock_' + clientId + ':';
            }
        } catch (e) {
            this._mockMode = false;
        }
        this.cacheDOM(); // 화면에 있는 버튼들을 자바스크립트가 기억하게 해요.
        this.bindEvents(); // 버튼을 눌렀을 때 어떤 행동을 할지 귀를 달아줘요.
        this.loadFromStorage(); // 컴퓨터 비밀창고(로컬 스토리지)에서 예전 기록을 불러와요.
        this.migrateHistory(); // 기존 기록을 최신 스코어/순위 기준으로 업데이트해요.
        this.initServer(); // 클라우드 서버와 연결하고 최신 데이터를 불러와요.
        this.renderPlayerList(); // 화면에 선수들 이름을 예쁘게 그려줘요.
        window.addEventListener('pagehide', () => {
            if (this._syncTimer) this.flushSync({ announce: false });
        });
        
        const savedStep = this.lsGet('golf_bet_current_step');
        
        // ⛳ 게임 중(조가 배정된 상태)일 때는 '최종 순위 보기'를 누르기 전까지 '지금 게임중' 화면을 유지해요!
        if (this.rooms && this.rooms.length > 0) {
            this.renderRooms();
            if (savedStep === 'results') {
                this.calculateRanking(false);
            } else {
                this.showStep('rooms'); // 게임 중 화면으로 유지!
            }
        } else {
            this.showStep('players'); // 처음 온 거면 선수 등록 화면을 보여줘요.
        }
    },

    // 🔄 예전에 저장된 기록들이 예전 계산법(Net Score)으로 되어 있다면, 새로운 스코어 계산법으로 모두 바꿔주는 마법의 기능이에요.
    historyStorageKey(record) {
        if (typeof GolfSync !== 'undefined' && GolfSync.historyKey) return GolfSync.historyKey(record);
        if (record && record.sessionId) return String(record.sessionId);
        return 'id_' + (record && record.id != null ? record.id : 0);
    },

    migrateHistory() {
        let migrated = false;
        const beforeKeys = (this.history || []).map(record => this.historyStorageKey(record));
        if (this.history && this.history.length > 0) {
            // 9월 1일 데이터 일괄 삭제 요청 처리
            const oldLen = this.history.length;
            this.history = this.history.filter(record => record.date !== '2026-09-01');
            if (oldLen !== this.history.length) migrated = true;

            this.history.forEach(record => {
                let needsSort = false;
                record.players.forEach(p => {
                    const newScore = this.getNetScore(p.score, p.handy);
                    if (p.net !== newScore) {
                        p.net = newScore;
                        needsSort = true;
                    }
                });

                const oldOrder = JSON.stringify(record.players.map(p => p.name));
                record.players.sort((a, b) => {
                    if (a.net !== b.net) return a.net - b.net; // 점수가 낮은 순
                    return this.parseHandicap(a.handy) - this.parseHandicap(b.handy); // 동점일 땐 핸디가 낮은 사람이 승리
                });
                const newOrder = JSON.stringify(record.players.map(p => p.name));
                
                if (needsSort || oldOrder !== newOrder) {
                    migrated = true;
                }
            });

            // 같은 날·같은 참가자·4시간 안의 중복(점수가 달라도)은 가장 최근 한 줄만 남긴다.
            if (typeof GolfHistory !== 'undefined' && GolfHistory.collapseStoredDuplicates) {
                const collapsed = GolfHistory.collapseStoredDuplicates(this.history);
                if (collapsed.changed) {
                    this.history = collapsed.history;
                    migrated = true;
                }
            }

            if (migrated) {
                // 시작/수신 때는 내용이 실제로 바뀐 경우에만 로컬에 반영한다.
                // 여기서 서버로 바로 쓰면 첫 스냅샷을 놓치거나 쓰기 루프가 생긴다.
                const afterKeys = new Set((this.history || []).map(record => this.historyStorageKey(record)));
                const now = Date.now();
                beforeKeys.forEach(key => {
                    if (!afterKeys.has(key) && this.sync) this.sync.tombstoneHistory(key, now);
                });
                this.lsSet('golf_bet_history', JSON.stringify(this.history));
                this.persistSyncMeta();
                console.log("기존 경기 기록이 새로운 스코어 및 랭킹 기준으로 업데이트되었습니다.");
            }
        }
        return migrated;
    },

    cacheDOM() {
        this.playerNameInput = document.getElementById('player-name');
        this.playerHandyInput = document.getElementById('player-handy');
        this.addPlayerBtn = document.getElementById('add-player-btn');
        this.playerList = document.getElementById('player-list');
        this.playerCountEl = document.getElementById('player-count');
        this.assignRoomsBtn = document.getElementById('assign-rooms-btn');
        
        this.roomsContainer = document.getElementById('rooms-container');
        this.viewMidResultsBtn = document.getElementById('view-mid-results-btn');
        this.viewResultsBtn = document.getElementById('view-results-btn');
        this.saveGameBtn = document.getElementById('save-game-btn');
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
        if (this.viewMidResultsBtn) this.viewMidResultsBtn.addEventListener('click', () => this.calculateRanking(false, true));
        this.viewResultsBtn.addEventListener('click', () => this.calculateRanking());
        this.restartBtn.addEventListener('click', () => this.restart());
        this.showHistoryBtn.addEventListener('click', () => this.showHistory());

        if (this.saveGameBtn) {
            this.saveGameBtn.addEventListener('click', () => {
                this.saveToStorage();
                this.saveCurrentGameToStorage();
                this.flushSync({ explicit: true, announce: true });
            });
        }

        if (this.resetRoomsBtn) {
            this.resetRoomsBtn.addEventListener('click', () => {
                if (confirm('조 편성을 초기화하고 처음부터 다시 시작하시겠습니까?')) {
                    this.rooms = [];
                    this.clearGameSession();
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

    // 같은 순간에 두 명을 등록해도 선수별 경로가 겹치지 않게 아이디를 나눈다.
    allocateId() {
        let id = Date.now();
        if (this._lastAllocatedId && id <= this._lastAllocatedId) id = this._lastAllocatedId + 1;
        const taken = new Set((this.players || []).map(player => player.id));
        while (taken.has(id)) id += 1;
        this._lastAllocatedId = id;
        return id;
    },

    // ✏️ 새로운 선수를 바구니(players)에 추가하는 기능이에요.
    addPlayer() {
        const name = this.playerNameInput.value.trim();
        const handyRaw = this.playerHandyInput.value.trim();
        const handy = parseInt(handyRaw, 10);

        if (!name) return alert('이름을 입력해주세요.');
        if (isNaN(handy)) return alert('핸디를 숫자로 입력해주세요. (예: 18 또는 -5)');

        const newPlayer = {
            id: this.allocateId(),
            name,
            handy,
            score: null,
            isActive: true,
            updatedAt: Date.now(),
            scoreUpdatedAt: 0
        };

        this.players.push(newPlayer);
        this.saveToStorage();
        this.renderPlayerList();
        
        this.playerNameInput.value = '';
        this.playerHandyInput.value = '';
        this.playerNameInput.focus();
    },

    // 🔘 특정 선수를 오늘 경기에 참여시킬지(참여/비참여) 설정하는 기능이에요.
    setParticipation(id, isActive) {
        const player = this.players.find(p => p.id === id);
        if (player) {
            player.isActive = isActive;
            player.updatedAt = Date.now();
            this.saveToStorage();
            this.renderPlayerList();
        }
    },

    toggleParticipation(id) {
        const player = this.players.find(p => p.id === id);
        if (player) {
            this.setParticipation(id, !player.isActive);
        }
    },

    removePlayer(id) {
        if (this.sync) this.sync.tombstonePlayer(id, Date.now());
        this.players = this.players.filter(p => p.id !== id);
        this.persistSyncMeta();
        this.saveToStorage();
        this.renderPlayerList();
    },

    // ✏️ 등록된 선수의 핸디를 수정하는 기능이에요.
    editPlayerHandy(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;

        this.openKeypad({
            type: 'handy',
            playerId: player.id,
            title: `${player.name} 핸디 수정`,
            value: '',
            onConfirm: (val) => {
                const handy = parseInt(val);
                player.handy = isNaN(handy) ? 0 : handy;
                player.updatedAt = Date.now();
                this.saveToStorage();
                this.renderPlayerList();
                if (this.rooms && this.rooms.length > 0) {
                    this.renderRooms();
                }
            }
        });
    },

    renderPlayerList() {
        this.playerList.innerHTML = '';

        // 참여자를 상단에, 비참여자를 하단에 정렬 (기존 등록 순서 유지)
        const sortedPlayers = [...this.players].sort((a, b) => {
            if (a.isActive === b.isActive) return 0;
            return a.isActive ? -1 : 1;
        });

        let activeIndex = 0;
        sortedPlayers.forEach(player => {
            const displayName = player.isActive 
                ? `${++activeIndex}. ${player.name}` 
                : player.name;

            const li = document.createElement('li');
            li.className = `player-item ${player.isActive ? '' : 'inactive'}`;
            li.innerHTML = `
                <div class="player-info">
                    <span class="player-name">${displayName}</span>
                    <span class="player-handy-btn" title="클릭하여 핸디 수정" onclick="app.editPlayerHandy(${player.id})">
                        핸디: ${player.handy} <small>✏️</small>
                    </span>
                </div>
                <div class="player-actions">
                    <div class="participation-toggle-group">
                        <button type="button" 
                                class="btn-part ${player.isActive ? 'active' : ''}" 
                                onclick="app.setParticipation(${player.id}, true)">
                            참여
                        </button>
                        <button type="button" 
                                class="btn-part ${!player.isActive ? 'inactive' : ''}" 
                                onclick="app.setParticipation(${player.id}, false)">
                            비참여
                        </button>
                    </div>
                    <button class="btn-remove" title="선수 삭제" onclick="app.removePlayer(${player.id})">×</button>
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

        // 조를 새로 짜면 이전 경기와 다른 세션이다. 직전 기록을 덮어쓰지 않는다.
        this.startNewGameSession();
        
        // 새 게임을 시작하니까 모든 사람의 점수를 미입력(null) 상태로 초기화해요.
        const scoredAt = Date.now();
        activePlayers.forEach(p => {
            p.score = null;
            p.scoreUpdatedAt = scoredAt;
        });
        
        // 사람들을 무작위로 마구마구 섞어요! (Shuffle)
        const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
        this.rooms = [];
        
        // 섞인 사람들을 3명씩 끊어서 새로운 방(조)에 넣어줘요.
        for (let i = 0; i < shuffled.length; i += 3) {
            this.rooms.push(shuffled.slice(i, i + 3).map(p => p.id));
        }

        // 창을 꺼도 조가 날아가지 않게 로컬 스토리지에 저장해요.
        this.touchRooms();
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
                            <span class="player-handy-badge" title="클릭하여 핸디 수정" onclick="app.editPlayerHandy(${player.id})">
                                핸디: ${player.handy} <small>✏️</small>
                            </span>
                            <input type="text" 
                                   class="score-input" 
                                   placeholder="타수" 
                                   value="${this.hasScore(player) ? player.score : ''}"
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
        this.touchRooms();
        this.saveCurrentGameToStorage();
        this.renderRooms();
    },

    removeRoom(roomIdx) {
        if (this.rooms[roomIdx] && this.rooms[roomIdx].length === 0) {
            this.rooms.splice(roomIdx, 1);
            this.touchRooms();
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

        this.touchRooms();
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
            player.score = (score === null || score === undefined || score === '' || isNaN(score)) ? null : parseInt(score, 10);
            player.scoreUpdatedAt = Date.now();
            this.saveToStorage(); // 점수가 바뀔 때마다 잃어버리지 않게 몰래 저장해둬요!
        }
    },

    // ⛳ 스코어가 실제로 입력되었는지 확인하는 헬퍼 (0도 유효한 이븐파 스코어이므로 null/undefined/빈값만 미입력으로 처리)
    hasScore(player) {
        return GolfScore.hasScore(player);
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
            const player = this.players.find(p => p.id === playerId);
            const currentScore = this.hasScore(player) ? String(player.score) : '';
            this._keypadState = {
                type: 'score',
                playerId: playerId,
                inputEl: inputEl,
                title: player ? `${player.name} 스코어 입력` : '스코어 입력',
                value: currentScore,
                onConfirm: (val) => {
                    const trimmed = String(val !== undefined && val !== null ? val : '').trim();
                    const score = (trimmed === '' || isNaN(parseInt(trimmed, 10))) ? null : parseInt(trimmed, 10);
                    if (inputEl) inputEl.value = score !== null ? score : '';
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
                    <span id="keypad-value" class="${this._keypadState.value.startsWith('-') ? 'negative' : ''}">${this._keypadState.value}</span>
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

    // 🎯 참여자 등록 시 핸디 입력 키패드 열기
    openHandyKeypad(inputEl) {
        const el = inputEl || this.playerHandyInput;
        this.openKeypad({
            type: 'handy',
            inputEl: el,
            title: '핸디 입력',
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
        if (digits.length >= 3 && digits !== '0') return;

        let newDigits;
        if (digits === '0') {
            newDigits = num;
        } else {
            newDigits = digits + num;
        }
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
            const trimmed = String(val !== undefined && val !== null ? val : '').trim();
            const score = (trimmed === '' || isNaN(parseInt(trimmed, 10))) ? null : parseInt(trimmed, 10);
            const inputEl = this._keypadState.inputEl;

            if (inputEl) {
                inputEl.value = score !== null ? score : '';
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
            display.textContent = this._keypadState.value;
            display.className = this._keypadState.value.startsWith('-') ? 'negative' : '';
        }
    },

    // 🧮 오버파를 자동으로 감지해서 가져오는 기능 (입력값이 40을 넘으면 72타를 뺀 값을 사용)
    getOverPar(score) {
        return GolfScore.getOverPar(score);
    },

    parseHandicap(handy) {
        return GolfScore.parseHandicap(handy);
    },

    // 🧮 스코어 = 오늘 오버파 - 핸디캡 (음수 핸디도 부호 그대로 적용. 예: 2 - (-4) = 6)
    getNetScore(score, handy) {
        return GolfScore.getNetScore(score, handy);
    },

    // 🔢 스코어(오버파 - 핸디캡) 포맷팅 (예: -3, 0, +2)
    formatNet(net) {
        return GolfScore.formatNet(net);
    },

    // 🥇 최종 점수를 계산해서 1등부터 꼴찌까지 순위를 매기는 기능이에요.
    calculateRanking(askConfirm = true, isMidGame = false) {
        const activePlayers = this.players.filter(p => p.isActive);
        
        // 아직 점수를 안 적은 사람이 있는지 검사해요. (0타는 유효한 이븐파 스코어이므로 제외)
        const missingScores = activePlayers.some(p => !this.hasScore(p));
        if (askConfirm && missingScores && !isMidGame && !confirm('입력되지 않은 스코어가 있습니다. 그대로 진행할까요?')) return;

        let playersToRank = [...activePlayers];

        // Sort active players by Score (오늘 오버파 - 핸디캡, 낮을수록 승리)
        const rankedPlayers = playersToRank.sort((a, b) => GolfScore.compareRank(a, b, isMidGame));

        if (askConfirm && !isMidGame) {
            this.saveToHistory(rankedPlayers);
        }
        this.renderResults(rankedPlayers, isMidGame);
        this.showStep('results');
    },

    // 📸 최종 순위를 기록해요.
    // 같은 경기를 점수만 고쳐 다시 저장하면 새 줄을 쌓지 않고, 그 경기 기록을 갱신해요.
    // - 이 경기의 세션 아이디가 이미 있으면 그 기록을 덮어써요. (시간이 몇 시간 지나도 같은 경기)
    // - 세션이 없는 예전 기록은 '같은 로컬 날짜 + 저장 시각 3시간 이내 + 같은 참가자'일 때만 갱신해요.
    // - 조를 새로 짠 경기(다른 세션)와 다른 날 기록은 그대로 두어요.
    saveToHistory(rankedPlayers) {
        const now = Date.now();
        const sessionId = this.ensureGameSessionId();
        const snapshot = rankedPlayers.map(p => ({
            name: p.name,
            score: this.hasScore(p) ? p.score : 0,
            handy: p.handy,
            net: this.getNetScore(p.score, p.handy)
        }));

        const beforeKeys = new Set((this.history || []).map(record => this.historyStorageKey(record)));
        const result = GolfHistory.upsertHistory(this.history, snapshot, {
            sessionId,
            now,
            // 'new'는 방금 조를 새로 짠 경기다. 직전 기록을 시간 창으로 덮어쓰지 않는다.
            allowTimeMatch: this.gameSessionOrigin !== 'new'
        });
        // 저장 직후에도 같은 날·같은 참가자·4시간 안의 예전 중복을 최신 한 줄로 정리한다.
        const collapsed = GolfHistory.collapseStoredDuplicates(result.history);
        this.history = collapsed.history;
        const afterKeys = new Set(this.history.map(record => this.historyStorageKey(record)));
        beforeKeys.forEach(key => {
            if (!afterKeys.has(key) && this.sync) this.sync.tombstoneHistory(key, now);
        });
        this.persistSyncMeta();
        this.saveHistoryToStorage();
    },

    showHistory() {
        this.previousStep = this.currentStep || (this.rooms && this.rooms.length > 0 ? 'rooms' : 'players');
        this.renderHistory();
        this.showStep('history');
    },

    closeHistory() {
        // 게임 중(조 배정 상태)이면 지금 게임중('rooms') 화면으로 안전하게 복귀해요
        if (this.rooms && this.rooms.length > 0 && this.previousStep !== 'results') {
            this.showStep('rooms');
        } else {
            this.showStep(this.previousStep || 'players');
        }
    },

    renderHistory() {
        const expandedIds = new Set();
        document.querySelectorAll('.history-item.expanded').forEach(item => {
            if (item.dataset.id) expandedIds.add(item.dataset.id);
        });

        this.historyContainer.innerHTML = '';
        if (this.history.length === 0) {
            this.historyContainer.innerHTML = '<p style="text-align:center; padding: 20px; color: var(--text-muted);">저장된 기록이 없습니다.</p>';
            return;
        }

        this.history.forEach(record => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.dataset.id = record.id;
            
            if (expandedIds.has(String(record.id))) {
                div.classList.add('expanded');
            }
            
            div.onclick = () => div.classList.toggle('expanded');
            
            const winner = record.players[0];
            const others = record.players.slice(1).map((p, i) => `
                <div class="history-player-row">
                    <span class="rank">${i + 2}위</span>
                    <span class="name">${p.name}</span>
                    <span class="stats">오버파: ${p.score} | H: ${p.handy} | <span class="net">스코어: ${this.formatNet(p.net)}</span></span>
                </div>
            `).join('');

            div.innerHTML = `
                <div class="history-date-header">
                    <span class="history-date">${record.date}</span>
                    <span class="history-round">${record.round}경기</span>
                </div>
                <div class="history-winner-preview">
                    🏆 우승: <span>${winner.name}</span> (${this.formatNet(winner.net)}점)
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="history-players-list">
                    <div class="history-player-row winner">
                        <span class="rank">1위</span>
                        <span class="name">${winner.name}</span>
                        <span class="stats">오버파: ${winner.score} | H: ${winner.handy} | <span class="net">스코어: ${this.formatNet(winner.net)}</span></span>
                    </div>
                    ${others}
                </div>
            `;
            this.historyContainer.appendChild(div);
        });
    },

    renderResults(rankedPlayers, isMidGame = false) {
        const titleEl = document.getElementById('results-title');
        if (titleEl) {
            titleEl.textContent = isMidGame ? '중간 랭킹' : '최종 랭킹';
        }

        const restartBtn = document.getElementById('restart-btn');
        if (restartBtn) {
            restartBtn.style.display = isMidGame ? 'none' : 'block';
        }

        this.resultsBody.innerHTML = '';
        rankedPlayers.forEach((player, index) => {
            const isScoreEmpty = !this.hasScore(player);
            const finalScore = this.getNetScore(player.score, player.handy);
            
            const scoreDisplay = isScoreEmpty ? '-' : player.score;
            const finalScoreDisplay = (isMidGame && isScoreEmpty) ? '-' : this.formatNet(finalScore);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${player.name}</td>
                <td>${scoreDisplay}</td>
                <td>${player.handy}</td>
                <td style="font-weight: 700; color: var(--primary-light)">${finalScoreDisplay}</td>
            `;
            this.resultsBody.appendChild(tr);
        });
    },

    showStep(stepName) {
        this.currentStep = stepName;
        this.lsSet('golf_bet_current_step', stepName);
        Object.values(this.steps).forEach(step => step.classList.remove('active'));
        if (this.steps[stepName]) {
            this.steps[stepName].classList.add('active');
        }
        window.scrollTo(0, 0);
    },

    touchRooms() {
        this.roomsUpdatedAt = Date.now();
    },

    currentState() {
        return {
            players: this.players || [],
            rooms: this.rooms || [],
            history: this.history || [],
            roomsUpdatedAt: this.roomsUpdatedAt || 0
        };
    },

    persistLocalOnly() {
        this.lsSet('golf_bet_players', JSON.stringify(this.players || []));
        this.lsSet('golf_bet_current_rooms', JSON.stringify(this.rooms || []));
        this.lsSet('golf_bet_history', JSON.stringify(this.history || []));
        this.lsSet('golf_bet_rooms_updated_at', String(this.roomsUpdatedAt || 0));
    },

    persistSyncMeta() {
        if (!this.sync) return;
        if (this.sync.lastGood) this.lsSet('golf_bet_last_good', JSON.stringify(this.sync.lastGood));
        this.lsSet('golf_bet_tombstones', JSON.stringify(this.sync.tombstones || { players: {}, scores: {}, history: {} }));
    },

    // 💾 우리의 정보를 인터넷 브라우저의 '비밀 창고(로컬 스토리지)'에 저장하는 기능들이에요.
    saveToStorage() {
        this.lsSet('golf_bet_players', JSON.stringify(this.players));
        this.queueSync({ announce: true });
    },

    saveCurrentGameToStorage() {
        this.lsSet('golf_bet_current_rooms', JSON.stringify(this.rooms));
        this.lsSet('golf_bet_rooms_updated_at', String(this.roomsUpdatedAt || 0));
        this.queueSync({ announce: true });
    },

    saveHistoryToStorage() {
        this.lsSet('golf_bet_history', JSON.stringify(this.history));
        this.queueSync({ announce: true });
    },

    // 현재 경기 세션. 새로고침 후에도 같은 경기를 다시 저장하면 같은 기록으로 연결해요.
    saveGameSession() {
        if (this.gameSessionId) {
            this.lsSet('golf_bet_game_session', this.gameSessionId);
            this.lsSet('golf_bet_game_session_origin', this.gameSessionOrigin || '');
        }
    },

    startNewGameSession() {
        this.gameSessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        this.gameSessionOrigin = 'new';
        this.saveGameSession();
    },

    continueGameSession() {
        this.gameSessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        this.gameSessionOrigin = 'continued';
        this.saveGameSession();
    },

    clearGameSession() {
        this.gameSessionId = '';
        this.gameSessionOrigin = '';
        this.lsRemove('golf_bet_game_session');
        this.lsRemove('golf_bet_game_session_origin');
    },

    ensureGameSessionId() {
        if (this.gameSessionId) return this.gameSessionId;
        if (this.rooms && this.rooms.length > 0) this.continueGameSession();
        else this.startNewGameSession();
        return this.gameSessionId;
    },

    // ☁️ Firebase Realtime Database 서버 초기화 및 실시간 동기화
    initServer() {
        if (this._mockMode) {
            this.setServerUrl('mock://golf_namu');
            return;
        }
        const savedUrl = this.lsGet('golf_firebase_db_url') || (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) || '';
        this.setServerUrl(savedUrl);
    },

    detachServer() {
        if (this._restInterval) {
            clearInterval(this._restInterval);
            this._restInterval = null;
        }
        if (this.server.dbRef && this._valueHandler && this.server.dbRef.off) {
            this.server.dbRef.off('value', this._valueHandler);
        }
        if (this._infoRef && this._infoHandler && this._infoRef.off) {
            this._infoRef.off('value', this._infoHandler);
        }
        this._valueHandler = null;
        this._infoHandler = null;
        this._infoRef = null;
        this._usingInfoConnected = false;
    },

    setServerUrl(url) {
        this.detachServer();
        url = (url || '').trim().replace(/\/+$/, '');
        if (url.endsWith('.json')) url = url.replace(/\.json$/, '');

        if (this._mockMode) {
            this.installMockServer();
            return;
        }

        if (!url) {
            this.server.dbUrl = '';
            this.server.isConnected = false;
            this.server.dbRef = null;
            this._connKnown = true;
            this.updateServerStatusUI('offline', this.syncStatusText('local'));
            return;
        }

        this.server.dbUrl = url;
        this.updateServerStatusUI('checking', this.syncStatusText('checking'));

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
                this.bindSdk(db);
                return;
            }
        } catch (e) {
            console.warn('Firebase SDK init warning:', e);
        }

        this.startRestSync();
    },

    bindSdk(db) {
        this._usingInfoConnected = true;
        this._valueHandler = (snapshot) => {
            this.handleServerData(snapshot.val());
        };
        this.server.dbRef.on('value', this._valueHandler, (error) => {
            console.warn('Firebase SDK listener warning, using REST polling:', error);
            this.setConnected(false);
            this.startRestSync();
        });
        this._infoRef = db.ref('.info/connected');
        this._infoHandler = (snapshot) => {
            this.setConnected(snapshot.val() === true);
        };
        this._infoRef.on('value', this._infoHandler);
    },

    installMockServer() {
        const KEY = 'golf_mock_db_v1';
        const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('golf_mock_db_v1') : null;
        const listeners = [];
        const connListeners = [];
        let connected = true;
        const read = () => {
            try {
                const raw = localStorage.getItem(KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        };
        const write = (data) => localStorage.setItem(KEY, JSON.stringify(data));
        const emit = () => {
            const value = read();
            listeners.forEach(fn => {
                try { fn({ val: () => value }); } catch (e) { console.warn(e); }
            });
        };
        if (channel) channel.onmessage = () => emit();
        window.addEventListener('storage', (event) => {
            if (event.key === KEY) emit();
        });
        this.server.dbUrl = 'mock://golf_namu';
        this.server.dbRef = {
            on(event, cb) {
                if (event !== 'value') return;
                listeners.push(cb);
                cb({ val: () => read() });
            },
            off() {},
            update: async (updates) => {
                write(GolfSync.applyMultiPath(read() || {}, updates));
                if (channel) channel.postMessage({ t: Date.now() });
                emit();
            },
            set: async (value) => {
                write(value);
                if (channel) channel.postMessage({ t: Date.now() });
                emit();
            }
        };
        this._mock = {
            setConnected: (on) => {
                connected = !!on;
                connListeners.forEach(cb => cb({ val: () => connected }));
            },
            pull: () => read()
        };
        this._valueHandler = (snapshot) => this.handleServerData(snapshot.val());
        this.server.dbRef.on('value', this._valueHandler);
        this._infoHandler = (snapshot) => this.setConnected(snapshot.val() === true);
        connListeners.push(this._infoHandler);
        this._infoHandler({ val: () => connected });
        this.installMockTools();
    },

    // 목 서버 데모에서만 이 창의 연결을 끊었다 다시 붙인다.
    installMockTools() {
        if (!document || !document.createElement) return;
        const footer = document.querySelector ? document.querySelector('footer') : null;
        if (!footer) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'mock-link-toggle';
        button.textContent = '연결 끊기';
        button.style.cssText = 'display:block;margin:8px auto 0;background:#fff;border:1px solid #cbd5e1;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;color:#64748b;cursor:pointer;';
        button.addEventListener('click', () => {
            const goingOnline = !this.server.isConnected;
            this.setOnlineForDebug(goingOnline);
            button.textContent = goingOnline ? '연결 끊기' : '다시 연결';
        });
        footer.appendChild(button);
    },

    // 데모/테스트에서 이 창만 오프라인으로 바꿀 때 씁니다. (?mock=1)
    setOnlineForDebug(on) {
        if (this._mock && this._mock.setConnected) this._mock.setConnected(!!on);
    },

    pullMockSnapshot() {
        if (!this._mock || !this._mock.pull) return;
        this.handleServerData(this._mock.pull());
    },

    startRestSync() {
        if (!this.server.dbUrl || this._mockMode) return;
        this._restMode = true;
        this.loadFromServer();
        if (this._restInterval) clearInterval(this._restInterval);
        this._restInterval = setInterval(() => this.loadFromServer(), 3000);
    },

    syncStatusText(kind) {
        if (typeof GolfSync !== 'undefined' && GolfSync.statusText) return GolfSync.statusText(kind);
        if (kind === 'saving') return '저장 중…';
        if (kind === 'saved') return '저장됨 ✓';
        if (kind === 'offline') return '오프라인 · 연결되면 저장';
        if (kind === 'error') return '저장 실패';
        if (kind === 'local') return '로컬 모드';
        if (kind === 'checking') return '연결 확인 중';
        return '연결됨';
    },

    updateServerStatusUI(status, text) {
        const dot = document.getElementById('server-status-dot');
        const label = document.getElementById('server-status-text');
        if (dot) dot.className = `status-dot ${status}`;
        if (label) label.textContent = text || this.syncStatusText(status === 'online' ? 'online' : 'offline');
    },

    showToast(message) {
        const el = document.getElementById('sync-toast');
        if (!el) return;
        el.textContent = message;
        el.classList.add('visible');
        clearTimeout(this._toastTimer);
        const wait = (typeof GolfSync !== 'undefined' && GolfSync.TOAST_MS) || 1600;
        this._toastTimer = setTimeout(() => el.classList.remove('visible'), wait);
    },

    showSyncFeedback(kind, options = {}) {
        const text = this.syncStatusText(kind);
        const dot = kind === 'saving' ? 'saving'
            : kind === 'error' ? 'error'
            : (kind === 'offline' || kind === 'local') ? 'offline'
            : kind === 'checking' ? 'checking'
            : 'online';
        this.updateServerStatusUI(dot, text);
        if (options.toast) this.showToast(text);
        if (kind === 'saved') {
            clearTimeout(this._statusRevert);
            const wait = (typeof GolfSync !== 'undefined' && GolfSync.TOAST_MS) || 1600;
            this._statusRevert = setTimeout(() => {
                if (this.server.isConnected && (!this.sync || this.sync.writesInFlight === 0) && !this._needsSync) {
                    this.updateServerStatusUI('online', this.syncStatusText('online'));
                }
            }, wait);
        }
    },

    setConnected(on) {
        const wasKnown = this._connKnown;
        const prev = this.server.isConnected;
        this._connKnown = true;
        this.server.isConnected = !!on;
        if (this.sync) this.sync.connected = !!on;
        if (!on) {
            this.updateServerStatusUI('offline', this.syncStatusText('offline'));
            if (wasKnown && prev) this.showToast(this.syncStatusText('offline'));
            return;
        }
        if (!this.sync || this.sync.writesInFlight === 0) {
            this.updateServerStatusUI('online', this.syncStatusText('online'));
        }
        if (this._mockMode) this.pullMockSnapshot();
        const pendingWrite = this._needsSync || (this.sync && this.sync.hydrated && this.sync.nextUpdates(this.currentState()));
        if (pendingWrite) this.flushSync({ announce: !!this._announceNext });
    },

    handleServerData(data) {
        if (!this.sync) return;
        const result = this.sync.ingest(data == null ? null : data, this.currentState());
        if (!result || result.deferred) return;
        this.adoptSyncResult(result);
    },

    adoptSyncResult(result) {
        if (!result || result.deferred) return;
        this.persistSyncMeta();
        const before = this.currentState();
        if (result.changed && result.state) {
            this.players = result.state.players;
            this.rooms = result.state.rooms;
            this.history = result.state.history;
            this.roomsUpdatedAt = result.state.roomsUpdatedAt || 0;
            this.persistLocalOnly();
            this.renderAfterRemote(before);
        }
        const historyMigrated = this.migrateHistory();
        if (historyMigrated) this.renderAfterRemote(before);
        if (result.dirty || historyMigrated || result.migrationNeeded) {
            this.queueSync({ announce: false });
        }
    },

    renderAfterRemote(before) {
        const playersChanged = JSON.stringify(before.players || []) !== JSON.stringify(this.players || []);
        const roomsChanged = JSON.stringify(before.rooms || []) !== JSON.stringify(this.rooms || []);
        const historyChanged = JSON.stringify(before.history || []) !== JSON.stringify(this.history || []);
        if (playersChanged && this.playerNameInput && document.activeElement !== this.playerNameInput && document.activeElement !== this.playerHandyInput) {
            this.renderPlayerList();
        }
        const roomScreen = this.currentStep === 'rooms';
        if (roomScreen && (roomsChanged || playersChanged) && this.rooms && this.rooms.length > 0) {
            const isKeypadOpen = !!document.getElementById('keypad-overlay');
            const isDragging = !!document.querySelector('.touch-drag-avatar') || !!document.querySelector('.room-player.dragging');
            if (!isKeypadOpen && !isDragging) this.renderRooms();
        } else if (roomsChanged && (!this.rooms || this.rooms.length === 0) && roomScreen) {
            this.showStep('players');
        }
        if (historyChanged) this.renderHistory();
    },

    queueSync(options = {}) {
        if (!options) options = {};
        if (options.announce) this._announceNext = true;
        if (options.explicit) this._explicitToast = true;
        clearTimeout(this._syncTimer);
        const wait = (typeof GolfSync !== 'undefined' && GolfSync.WRITE_DEBOUNCE_MS) || 500;
        this._syncTimer = setTimeout(() => this.flushSync(), wait);
    },

    async flushSync(options = {}) {
        if (options && options.announce) this._announceNext = true;
        if (options && options.explicit) this._explicitToast = true;
        clearTimeout(this._syncTimer);
        this._syncTimer = null;
        if (this._flushing) {
            this._flushQueued = true;
            return this._flushing;
        }
        const current = this._flushNow();
        this._flushing = current;
        try {
            await current;
        } finally {
            if (this._flushing === current) this._flushing = null;
            if (this._flushQueued) {
                this._flushQueued = false;
                await this.flushSync();
            }
        }
    },

    async _flushNow() {
        const announce = !!(this._announceNext || this._explicitToast);
        const explicit = !!this._explicitToast;
        this._announceNext = false;
        this._explicitToast = false;
        if (!this.sync || typeof GolfSync === 'undefined') {
            if (announce || explicit) this.showSyncFeedback('saved', { toast: true });
            return;
        }

        const hasServer = !!(this.server.dbRef || this.server.dbUrl);
        if (!hasServer) {
            if (!this.sync.hydrated) {
                this.sync.hydrated = true;
                this.sync.acked = GolfSync.cloneState(this.currentState());
            }
            if (announce || explicit) this.showSyncFeedback('saved', { toast: true });
            return;
        }

        if (!this.sync.hydrated) {
            this._needsSync = true;
            if (announce) this._announceNext = true;
            if (!this._connKnown) this.updateServerStatusUI('checking', this.syncStatusText('checking'));
            else if (!this.server.isConnected) this.showSyncFeedback('offline', { toast: announce || explicit });
            return;
        }

        const updates = this.sync.nextUpdates(this.currentState());
        const decision = GolfSync.decideFlush(!!this.server.isConnected, updates, explicit || announce);
        if (!this._connKnown && !this.server.isConnected) {
            this._needsSync = true;
            if (announce) this._announceNext = true;
            this.updateServerStatusUI('checking', this.syncStatusText('checking'));
            return;
        }
        if (decision.action === 'defer') {
            this._needsSync = true;
            if (announce) this._announceNext = true;
            this.showSyncFeedback('offline', { toast: announce || explicit });
            return;
        }
        if (decision.action !== 'write') {
            if (explicit) this.showSyncFeedback('saved', { toast: true });
            return;
        }

        this.sync.beginWrite();
        this.showSyncFeedback('saving', { toast: announce || explicit });
        try {
            await this.writeUpdates(updates);
            const follow = this.sync.finishWrite(true, this.currentState(), updates);
            this._needsSync = !!(follow && follow.dirty);
            this.persistSyncMeta();
            this.showSyncFeedback('saved', { toast: announce || explicit });
            if (follow && !follow.deferred) this.adoptSyncResult(follow);
        } catch (err) {
            const follow = this.sync.finishWrite(false, this.currentState(), updates);
            this._needsSync = true;
            if (announce) this._announceNext = true;
            const offline = !this.server.isConnected || !!(err && err.offline);
            console.warn('sync failed', err);
            if (offline) {
                this.server.isConnected = false;
                if (this.sync) this.sync.connected = false;
                this.showSyncFeedback('offline', { toast: true });
            } else {
                this.showSyncFeedback('error', { toast: true });
            }
            if (follow && !follow.deferred) this.adoptSyncResult(follow);
        }
    },

    async writeUpdates(updates) {
        if (this.server.dbRef && typeof this.server.dbRef.update === 'function') {
            await this.server.dbRef.update(updates);
            return;
        }
        if (!this.server.dbUrl) {
            const error = new Error('no server');
            error.offline = true;
            throw error;
        }
        const patches = GolfSync.groupRestPatches(updates);
        for (let i = 0; i < patches.length; i++) {
            const patch = patches[i];
            const url = patch.path
                ? `${this.server.dbUrl}/golf_namu/${patch.path}.json`
                : `${this.server.dbUrl}/golf_namu.json`;
            let response;
            try {
                response = await fetch(url, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patch.body)
                });
            } catch (err) {
                err.offline = true;
                throw err;
            }
            if (!response.ok) {
                const error = new Error('REST patch failed ' + response.status);
                error.status = response.status;
                throw error;
            }
        }
    },

    async syncWithServer() {
        await this.flushSync({ announce: false });
    },

    async loadFromServer() {
        if (!this.server.dbUrl || this._mockMode) return;
        try {
            const response = await fetch(`${this.server.dbUrl}/golf_namu.json`);
            if (!response.ok) {
                this.setConnected(false);
                return;
            }
            const data = await response.json();
            this.handleServerData(data);
            this.setConnected(true);
        } catch (error) {
            this.setConnected(false);
            console.warn('Load from server failed:', error);
        }
    },

    openServerModal() {
        const modal = document.getElementById('server-modal');
        const input = document.getElementById('firebase-db-url');
        const alertBox = document.getElementById('server-status-alert');

        if (input) {
            input.value = (this._mockMode ? '' : this.server.dbUrl) || this.lsGet('golf_firebase_db_url') || (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) || '';
        }

        if (alertBox) {
            if (this.server.isConnected) {
                alertBox.className = 'server-status-box success';
                alertBox.innerHTML = '🟢 클라우드 서버에 연결되어 있습니다.';
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

        this.lsSet('golf_firebase_db_url', url);
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
        const savedPlayers = this.lsGet('golf_bet_players');
        if (savedPlayers) {
            this.players = JSON.parse(savedPlayers);
        }
        
        const savedHistory = this.lsGet('golf_bet_history');
        if (savedHistory) {
            this.history = JSON.parse(savedHistory);
        }

        const savedRooms = this.lsGet('golf_bet_current_rooms');
        if (savedRooms) {
            this.rooms = JSON.parse(savedRooms);
            // 옛날 버전과 호환되도록 아이디(ID)만 깔끔하게 빼와요.
            this.rooms = this.rooms.map(room => room.map(p => typeof p === 'object' ? p.id : p));
        }

        const savedRoomsAt = this.lsGet('golf_bet_rooms_updated_at');
        if (savedRoomsAt) this.roomsUpdatedAt = Number(savedRoomsAt) || 0;

        if (this.sync) {
            const lastGood = this.lsGet('golf_bet_last_good');
            if (lastGood) {
                try { this.sync.lastGood = JSON.parse(lastGood); } catch (e) { /* 손상된 캐시는 무시 */ }
            }
            const tombs = this.lsGet('golf_bet_tombstones');
            if (tombs) {
                try { this.sync.tombstones = JSON.parse(tombs); } catch (e) { /* 손상된 캐시는 무시 */ }
            }
        }

        this.gameSessionId = this.lsGet('golf_bet_game_session') || '';
        this.gameSessionOrigin = this.lsGet('golf_bet_game_session_origin') || '';
        // 이 업데이트 전에 진행 중이던 경기는 세션이 없다. 이어서 저장할 수 있게 하나 만들어요.
        if (!this.gameSessionId && this.rooms && this.rooms.length > 0) {
            this.continueGameSession();
        }
    },

    // 🔄 모든 걸 지우고 완전히 처음부터 새 게임을 시작하는 버튼이에요!
    restart() {
        if (confirm('현재 게임 결과를 기록하고 새로운 게임을 시작하시겠습니까? (등록된 인원은 유지됩니다)')) {
            // 선수들 명단은 놔두고, 점수랑 조 편성만 백지상태로 만들어요.
            const clearedAt = Date.now();
            this.players.forEach(p => {
                p.score = null;
                p.scoreUpdatedAt = clearedAt;
            });
            this.rooms = [];
            this.touchRooms();
            this.clearGameSession();
            this.saveCurrentGameToStorage();
            this.saveToStorage();
            this.renderPlayerList();
            this.showStep('players'); // 다시 선수 등록 화면으로 출발!
        }
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());

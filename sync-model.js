// 실시간 동기화 모델 (브라우저 스크립트 / Node 테스트 공용)
//
// 서버 구조 (schemaVersion 2) — golf_namu 아래
//   schemaVersion: 2
//   players/{id}: { id, name, handy, isActive, updatedAt }   // 스코어는 넣지 않는다
//   scores/{playerId}: { score, updatedAt }                  // 없으면 미입력. 삭제는 null
//   rooms: { "0": { "0": id, ... } | { _empty: true }, ... } // 빈 배열이 통째로 사라지지 않게 객체로 저장
//   roomsUpdatedAt: number
//   history/{sessionId|id_*}: 경기 기록. 같은 키는 savedAt이 큰 쪽이 이긴다
//
// 쓰는 쪽은 바뀐 경로만 update() 다중 경로로 올린다. 통째 set()은 하지 않는다.
//
// 구버전 클라이언트 한계 (보안 규칙은 건드리지 않음):
//   구버전은 golf_namu 전체를 set() 한다. 그 순간 서버의 새 구조는 지워진다.
//   새 클라이언트는 배열/updatedAt만 있는 스냅샷을 구버전 덮어쓰기로 보고,
//   메모리의 마지막 정상본(lastGood)과 이 기기 상태와 합친 뒤 새 구조로 다시 쓴다.
//   - 기록은 sessionId(없으면 id) 기준, savedAt이 큰 쪽을 남긴다.
//   - 선수는 id 합집합. updatedAt이 더 큰 필드를 남기고, 구버전에 없다고 지우지 않는다.
//   - 따라서 구버전 기기의 '삭제'는 새 클라이언트에서 되살아날 수 있다.
//   - 어느 새 클라이언트 메모리에도 없는 값은 set() 이후 복구할 수 없다.
//   - 구버전 앱이 켜져 있는 동안은 편집할 때마다 set()이 반복된다.
//   - 구버전 빈 배열은 서버에서 키가 사라져서, 그 사실만으로 방을 비우지는 않는다.
//     새 클라이언트는 rooms: null 과 roomsUpdatedAt으로 빈 방을 전달한다.
(function (global) {
    var SCHEMA_VERSION = 2;
    var WRITE_DEBOUNCE_MS = 500;
    var TOAST_MS = 1500;
    var REST_POLL_MS = 1500;

    var SERVER_STAMP = { '.sv': 'timestamp' };

    function emptyLive() {
        return { step: '', sessionId: '', sessionOrigin: '', updatedAt: 0 };
    }

    function normalizeLive(live) {
        var src = live || {};
        return {
            step: src.step || '',
            sessionId: src.sessionId || '',
            sessionOrigin: src.sessionOrigin || '',
            updatedAt: Number(src.updatedAt) || 0
        };
    }

    function emptyState() {
        return {
            players: [],
            rooms: [],
            history: [],
            roomsUpdatedAt: 0,
            live: emptyLive()
        };
    }

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function cloneState(state) {
        var src = state || emptyState();
        return {
            players: (src.players || []).map(clonePlayer),
            rooms: (src.rooms || []).map(function (room) {
                return (room || []).map(function (id) { return id; });
            }),
            history: (src.history || []).map(cloneHistoryRecord),
            roomsUpdatedAt: src.roomsUpdatedAt || 0,
            live: normalizeLive(src.live)
        };
    }

    function hasScore(player) {
        return !!(player && player.score !== null && player.score !== undefined && player.score !== '' && !isNaN(Number(player.score)));
    }

    function normalizeId(id) {
        if (id == null || id === '') return id;
        var n = Number(id);
        if (typeof id === 'number' && Number.isSafeInteger(id)) return id;
        if (typeof id === 'string' && String(n) === id && Number.isSafeInteger(n)) return n;
        return id;
    }

    function handyOf(value) {
        var n = Number(value);
        return Number.isNaN(n) ? 0 : n;
    }

    function clonePlayer(player) {
        if (!player) return player;
        return {
            id: normalizeId(player.id),
            name: player.name || '',
            handy: handyOf(player.handy),
            isActive: player.isActive !== false,
            updatedAt: Number(player.updatedAt) || 0,
            score: hasScore(player) ? Number(player.score) : null,
            scoreUpdatedAt: Number(player.scoreUpdatedAt) || 0
        };
    }

    function cloneHistoryRecord(record) {
        if (!record) return record;
        return {
            id: record.id != null ? record.id : (record.savedAt || 0),
            savedAt: Number(record.savedAt != null ? record.savedAt : record.id) || 0,
            date: record.date || '',
            round: record.round || 1,
            sessionId: record.sessionId || undefined,
            players: (record.players || []).map(function (player) {
                return {
                    name: player.name,
                    score: player.score,
                    handy: player.handy,
                    net: player.net
                };
            })
        };
    }

    function recordTime(record) {
        if (!record) return 0;
        var raw = record.savedAt != null ? record.savedAt : record.id;
        var time = Number(raw);
        return Number.isFinite(time) ? time : 0;
    }

    function historyKey(record) {
        if (!record) return 'id_0';
        var raw = record.sessionId
            ? String(record.sessionId)
            : ('id_' + (record.id != null ? record.id : (record.savedAt != null ? record.savedAt : 0)));
        return raw.replace(/[.#$[\]/]/g, '_');
    }

    function indexPlayers(players) {
        var map = {};
        (players || []).forEach(function (player) {
            if (!player || player.id == null) return;
            map[String(player.id)] = player;
        });
        return map;
    }

    function indexHistory(history) {
        var map = {};
        (history || []).forEach(function (record) {
            if (!record) return;
            map[historyKey(record)] = record;
        });
        return map;
    }

    function unionKeys() {
        var out = [];
        var seen = {};
        for (var i = 0; i < arguments.length; i++) {
            var obj = arguments[i] || {};
            Object.keys(obj).forEach(function (key) {
                if (seen[key]) return;
                seen[key] = true;
                out.push(key);
            });
        }
        return out;
    }

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function sequentialKeys(obj) {
        var keys = Object.keys(obj || {});
        if (!keys.length) return false;
        return keys.every(function (key, index) { return String(index) === key; });
    }

    function detectFormat(raw) {
        if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return 'empty';
        if (Number(raw.schemaVersion) >= SCHEMA_VERSION) return 'new';
        if (Array.isArray(raw.players) || Array.isArray(raw.history)) return 'old';
        if (isPlainObject(raw.players) && sequentialKeys(raw.players)) return 'old';
        if (isPlainObject(raw.history) && sequentialKeys(raw.history)) return 'old';
        if (raw.updatedAt != null && raw.schemaVersion == null && raw.scores == null && !isPlainObject(raw.players) && !isPlainObject(raw.history)) {
            return 'old';
        }
        if (isPlainObject(raw.players) || isPlainObject(raw.history) || isPlainObject(raw.scores)) return 'new';
        return 'empty';
    }

    function objectToArray(value) {
        if (value == null) return [];
        if (Array.isArray(value)) return value.slice();
        if (!isPlainObject(value)) return [];
        return Object.keys(value).sort(function (a, b) {
            return Number(a) - Number(b);
        }).map(function (key) { return value[key]; });
    }

    function decodeRoomIds(node) {
        if (node == null) return [];
        if (Array.isArray(node)) {
            return node.map(function (item) {
                return item && typeof item === 'object' ? item.id : item;
            }).filter(function (id) { return id != null && id !== ''; });
        }
        if (!isPlainObject(node)) return [];
        if (node._empty) return [];
        return Object.keys(node).filter(function (key) {
            return key !== '_empty';
        }).sort(function (a, b) {
            return Number(a) - Number(b);
        }).map(function (key) { return node[key]; }).filter(function (id) {
            return id != null && id !== '';
        });
    }

    function decodeRooms(raw) {
        if (raw == null || raw === '') return [];
        if (typeof raw === 'string') {
            try { return decodeRooms(JSON.parse(raw)); } catch (e) { return []; }
        }
        if (Array.isArray(raw)) {
            return raw.map(function (room) { return decodeRoomIds(room); });
        }
        if (!isPlainObject(raw)) return [];
        return Object.keys(raw).filter(function (key) {
            return key !== 'updatedAt' && key !== 'roomsUpdatedAt';
        }).sort(function (a, b) {
            return Number(a) - Number(b);
        }).map(function (key) { return decodeRoomIds(raw[key]); });
    }

    function encodeRooms(rooms) {
        if (!rooms || !rooms.length) return null;
        var encoded = {};
        rooms.forEach(function (room, index) {
            var ids = decodeRoomIds(room);
            if (!ids.length) {
                encoded[String(index)] = { _empty: true };
                return;
            }
            var slot = {};
            ids.forEach(function (id, idIndex) {
                slot[String(idIndex)] = id;
            });
            encoded[String(index)] = slot;
        });
        return encoded;
    }

    function sameRooms(a, b) {
        return JSON.stringify(decodeRooms(a)) === JSON.stringify(decodeRooms(b));
    }

    function serverPlayer(player) {
        return {
            id: normalizeId(player.id),
            name: player.name || '',
            handy: handyOf(player.handy),
            isActive: player.isActive !== false,
            updatedAt: Number(player.updatedAt) || 0
        };
    }

    function serverScore(player) {
        if (!hasScore(player)) return null;
        return {
            score: Number(player.score),
            updatedAt: Number(player.scoreUpdatedAt) || 0
        };
    }

    function serverHistory(record) {
        var copy = cloneHistoryRecord(record);
        if (!copy.sessionId) delete copy.sessionId;
        return copy;
    }

    function sameServerPlayer(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        var left = serverPlayer(a);
        var right = serverPlayer(b);
        return left.id === right.id && left.name === right.name && left.handy === right.handy && left.isActive === right.isActive && left.updatedAt === right.updatedAt;
    }

    function sameScore(a, b) {
        var left = a ? serverScore(a) : null;
        var right = b ? serverScore(b) : null;
        if (!left && !right) return true;
        if (!left || !right) return false;
        return left.score === right.score && left.updatedAt === right.updatedAt;
    }

    function sameHistory(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        return JSON.stringify(serverHistory(a)) === JSON.stringify(serverHistory(b));
    }

    function historyBody(record) {
        var copy = serverHistory(record);
        delete copy.savedAt;
        delete copy.id;
        return JSON.stringify(copy);
    }

    function sameLive(a, b) {
        var left = normalizeLive(a);
        var right = normalizeLive(b);
        return left.step === right.step && left.sessionId === right.sessionId && left.sessionOrigin === right.sessionOrigin && left.updatedAt === right.updatedAt;
    }

    function profileFieldsDiffer(player, other) {
        if (!player || !other) return true;
        return (player.name || '') !== (other.name || '')
            || handyOf(player.handy) !== handyOf(other.handy)
            || (player.isActive !== false) !== (other.isActive !== false);
    }

    function scoreFieldsDiffer(player, other) {
        var leftHas = hasScore(player);
        var rightHas = hasScore(other);
        if (leftHas !== rightHas) return true;
        return leftHas && Number(player.score) !== Number(other.score);
    }

    function stateFromSnapshot(raw) {
        var format = detectFormat(raw);
        if (format === 'empty') return { format: format, state: emptyState() };
        if (format === 'old') {
            var oldPlayers = objectToArray(raw.players).filter(function (player) {
                return player && typeof player === 'object';
            }).map(clonePlayer);
            return {
                format: format,
                state: {
                    players: oldPlayers,
                    rooms: decodeRooms(raw.rooms),
                    history: objectToArray(raw.history).filter(function (record) {
                        return record && typeof record === 'object';
                    }).map(cloneHistoryRecord),
                    roomsUpdatedAt: raw.rooms == null ? 0 : (Number(raw.updatedAt) || 0),
                    live: normalizeLive(raw.live)
                }
            };
        }

        var playerMap = isPlainObject(raw.players) && !sequentialKeys(raw.players) ? raw.players : {};
        if (Array.isArray(raw.players)) {
            raw.players.forEach(function (player) {
                if (player && player.id != null) playerMap[String(player.id)] = player;
            });
        }
        var scoreMap = isPlainObject(raw.scores) ? raw.scores : {};
        var players = Object.keys(playerMap).map(function (key) {
            var player = playerMap[key] || {};
            var id = player.id != null ? player.id : key;
            var scoreNode = scoreMap[String(id)] || scoreMap[key] || null;
            var score = null;
            var scoreUpdatedAt = 0;
            if (scoreNode && typeof scoreNode === 'object' && hasScore(scoreNode)) {
                score = Number(scoreNode.score);
                scoreUpdatedAt = Number(scoreNode.updatedAt) || 0;
            } else if (scoreNode != null && scoreNode !== '' && !isNaN(Number(scoreNode)) && typeof scoreNode !== 'object') {
                score = Number(scoreNode);
            } else if (hasScore(player)) {
                score = Number(player.score);
                scoreUpdatedAt = Number(player.scoreUpdatedAt) || 0;
            }
            return clonePlayer({
                id: id,
                name: player.name,
                handy: player.handy,
                isActive: player.isActive,
                updatedAt: player.updatedAt,
                score: score,
                scoreUpdatedAt: scoreUpdatedAt
            });
        });

        var historyMap = {};
        if (Array.isArray(raw.history)) {
            raw.history.forEach(function (record) {
                if (!record) return;
                historyMap[historyKey(record)] = record;
            });
        } else if (isPlainObject(raw.history) && !sequentialKeys(raw.history)) {
            historyMap = raw.history;
        } else if (isPlainObject(raw.history)) {
            objectToArray(raw.history).forEach(function (record) {
                if (!record) return;
                historyMap[historyKey(record)] = record;
            });
        }
        var history = Object.keys(historyMap).map(function (key) {
            return cloneHistoryRecord(historyMap[key]);
        }).sort(function (a, b) { return recordTime(b) - recordTime(a); });

        return {
            format: 'new',
            state: {
                players: players,
                rooms: decodeRooms(raw.rooms),
                history: history,
                roomsUpdatedAt: Number(raw.roomsUpdatedAt) || 0,
                live: normalizeLive(raw.live)
            }
        };
    }

    function orderedPlayers(localPlayers, merged) {
        var byId = indexPlayers(merged);
        var out = [];
        var seen = {};
        (localPlayers || []).forEach(function (player) {
            if (!player || player.id == null) return;
            var key = String(player.id);
            if (!byId[key] || seen[key]) return;
            out.push(byId[key]);
            seen[key] = true;
        });
        merged.forEach(function (player) {
            var key = String(player.id);
            if (seen[key]) return;
            out.push(player);
            seen[key] = true;
        });
        return out;
    }

    function orderedHistory(localHistory, merged) {
        var byKey = indexHistory(merged);
        var out = [];
        var seen = {};
        (localHistory || []).forEach(function (record) {
            var key = historyKey(record);
            if (!byKey[key] || seen[key]) return;
            out.push(byKey[key]);
            seen[key] = true;
        });
        merged.forEach(function (record) {
            var key = historyKey(record);
            if (seen[key]) return;
            out.push(record);
            seen[key] = true;
        });
        return out;
    }

    function pickProfile(localPlayer, remotePlayer, ackedPlayer) {
        if (!localPlayer) return remotePlayer;
        if (!remotePlayer) return localPlayer;
        var localPending = !!(ackedPlayer && profileFieldsDiffer(localPlayer, ackedPlayer));
        var remotePending = !!(ackedPlayer && profileFieldsDiffer(remotePlayer, ackedPlayer));
        if (!profileFieldsDiffer(localPlayer, remotePlayer)) return remotePlayer;
        if (localPending && !remotePending) return localPlayer;
        if (remotePending && !localPending) return remotePlayer;
        var localTime = Number(localPlayer.updatedAt) || 0;
        var remoteTime = Number(remotePlayer.updatedAt) || 0;
        // updatedAt 0 은 '시각 없음'이다. 같거나 0이면 서버 값을 받아 폰들이 한곳으로 모인다.
        if (localTime > remoteTime) return localPlayer;
        return remotePlayer;
    }

    function scoreTuple(player) {
        if (!player || !hasScore(player)) return { score: null, scoreUpdatedAt: Number(player && player.scoreUpdatedAt) || 0 };
        return { score: Number(player.score), scoreUpdatedAt: Number(player.scoreUpdatedAt) || 0 };
    }

    function pickScore(localPlayer, remotePlayer, ackedPlayer, scoreTomb) {
        var remote = remotePlayer;
        if (remote && scoreTomb && (Number(remote.scoreUpdatedAt) || 0) <= scoreTomb && hasScore(remote)) {
            remote = clonePlayer(remote);
            remote.score = null;
            remote.scoreUpdatedAt = 0;
        }
        var localPending = !!(ackedPlayer && scoreFieldsDiffer(localPlayer, ackedPlayer));
        var remotePending = !!(ackedPlayer && scoreFieldsDiffer(remote, ackedPlayer));
        var sameValue = !scoreFieldsDiffer(localPlayer, remote);

        if (sameValue && remote) return scoreTuple(remote);
        if (localPending && !remotePending) return scoreTuple(localPlayer);
        if (remotePending && !localPending) return scoreTuple(remote);
        if (localPending && remotePending) {
            var localTime = localPlayer ? (Number(localPlayer.scoreUpdatedAt) || 0) : 0;
            var remoteTime = remote ? (Number(remote.scoreUpdatedAt) || 0) : 0;
            if (localTime > remoteTime) return scoreTuple(localPlayer);
            return scoreTuple(remote);
        }
        if (remote) return scoreTuple(remote);
        if (localPlayer && (!ackedPlayer || scoreFieldsDiffer(localPlayer, ackedPlayer))) return scoreTuple(localPlayer);
        return { score: null, scoreUpdatedAt: 0 };
    }

    function playerKept(localPlayer, remotePlayer, ackedPlayer, playerTomb) {
        var remoteBlocked = remotePlayer && playerTomb && (Number(remotePlayer.updatedAt) || 0) <= playerTomb;
        var remote = remoteBlocked ? null : remotePlayer;
        if (localPlayer && remote) return { keep: true, remote: remote };
        if (localPlayer && !remote) {
            if (remoteBlocked) return { keep: false, remote: null };
            if (!ackedPlayer) return { keep: true, remote: null };
            var localTime = Number(localPlayer.updatedAt) || 0;
            var ackedTime = Number(ackedPlayer.updatedAt) || 0;
            if (localTime > ackedTime || !sameServerPlayer(localPlayer, ackedPlayer)) {
                return { keep: true, remote: null };
            }
            return { keep: false, remote: null };
        }
        if (!localPlayer && remote) return { keep: true, remote: remote };
        return { keep: false, remote: null };
    }

    function combinePlayer(localPlayer, remotePlayer, ackedPlayer, tombs) {
        var playerTomb = tombs && tombs.players ? (tombs.players[String(localId(localPlayer, remotePlayer, ackedPlayer))] || 0) : 0;
        var scoreTomb = tombs && tombs.scores ? (tombs.scores[String(localId(localPlayer, remotePlayer, ackedPlayer))] || 0) : 0;
        var presence = playerKept(localPlayer, remotePlayer, ackedPlayer, playerTomb);
        if (!presence.keep) return null;
        var profile = pickProfile(localPlayer, presence.remote, ackedPlayer);
        if (!profile) return null;
        var score = pickScore(localPlayer, presence.remote || (playerTomb ? null : remotePlayer), ackedPlayer, scoreTomb);
        return clonePlayer({
            id: profile.id,
            name: profile.name,
            handy: profile.handy,
            isActive: profile.isActive,
            updatedAt: profile.updatedAt,
            score: score.score,
            scoreUpdatedAt: score.score == null ? (score.scoreUpdatedAt || 0) : score.scoreUpdatedAt
        });
    }

    function localId(localPlayer, remotePlayer, ackedPlayer) {
        if (localPlayer && localPlayer.id != null) return localPlayer.id;
        if (remotePlayer && remotePlayer.id != null) return remotePlayer.id;
        if (ackedPlayer && ackedPlayer.id != null) return ackedPlayer.id;
        return '';
    }

    function mergePlayers(local, remote, acked, tombs) {
        var localMap = indexPlayers(local.players);
        var remoteMap = indexPlayers(remote.players);
        var ackedMap = indexPlayers(acked.players);
        var merged = [];
        unionKeys(localMap, remoteMap, ackedMap).forEach(function (id) {
            var player = combinePlayer(localMap[id] || null, remoteMap[id] || null, ackedMap[id] || null, tombs);
            if (player) merged.push(player);
        });
        return orderedPlayers(local.players, merged);
    }

    function historyTomb(tombs, key) {
        if (!tombs || !tombs.history) return 0;
        return tombs.history[key] || 0;
    }

    function mergeHistory(local, remote, acked, tombs) {
        var localMap = indexHistory(local.history);
        var remoteMap = indexHistory(remote.history);
        var ackedMap = indexHistory(acked.history);
        var merged = [];
        unionKeys(localMap, remoteMap, ackedMap).forEach(function (key) {
            var localRecord = localMap[key] || null;
            var remoteRecord = remoteMap[key] || null;
            var ackedRecord = ackedMap[key] || null;
            var tombAt = historyTomb(tombs, key);
            if (remoteRecord && tombAt && recordTime(remoteRecord) <= tombAt) remoteRecord = null;
            if (localRecord && remoteRecord) {
                if (historyBody(localRecord) === historyBody(remoteRecord)) {
                    merged.push(cloneHistoryRecord(remoteRecord));
                    return;
                }
                var localPendingHist = !ackedRecord || historyBody(localRecord) !== historyBody(ackedRecord);
                var remotePendingHist = !ackedRecord || historyBody(remoteRecord) !== historyBody(ackedRecord);
                if (localPendingHist && !remotePendingHist) {
                    merged.push(cloneHistoryRecord(localRecord));
                    return;
                }
                if (localPendingHist && remotePendingHist && recordTime(localRecord) > recordTime(remoteRecord)) {
                    merged.push(cloneHistoryRecord(localRecord));
                    return;
                }
                merged.push(cloneHistoryRecord(remoteRecord));
                return;
            }
            if (localRecord && !remoteRecord) {
                if (!ackedRecord || recordTime(localRecord) > recordTime(ackedRecord) || !sameHistory(localRecord, ackedRecord)) {
                    merged.push(cloneHistoryRecord(localRecord));
                }
                return;
            }
            if (!localRecord && remoteRecord) merged.push(cloneHistoryRecord(remoteRecord));
        });
        return orderedHistory(local.history, merged);
    }

    function mergeRooms(local, remote, acked) {
        var localTime = Number(local.roomsUpdatedAt) || 0;
        var remoteTime = Number(remote.roomsUpdatedAt) || 0;
        // 방 구성이 같으면 서버 시각을 받아 빠른 폰 시계가 계속 앞서지 않게 한다.
        if (sameRooms(local.rooms, remote.rooms)) {
            return { rooms: decodeRooms(remote.rooms), roomsUpdatedAt: remoteTime };
        }
        var base = acked || emptyState();
        var localPending = !sameRooms(local.rooms, base.rooms);
        var remotePending = !sameRooms(remote.rooms, base.rooms);
        if (localPending && !remotePending) {
            return { rooms: decodeRooms(local.rooms), roomsUpdatedAt: localTime };
        }
        if (remotePending && !localPending) {
            return { rooms: decodeRooms(remote.rooms), roomsUpdatedAt: remoteTime };
        }
        if (localTime > remoteTime) {
            return { rooms: decodeRooms(local.rooms), roomsUpdatedAt: localTime };
        }
        return { rooms: decodeRooms(remote.rooms), roomsUpdatedAt: remoteTime };
    }

    function mergeLive(local, remote, acked) {
        var left = normalizeLive(local && local.live);
        var right = normalizeLive(remote && remote.live);
        var base = normalizeLive(acked && acked.live);
        var sameScreen = left.step === right.step && left.sessionId === right.sessionId && left.sessionOrigin === right.sessionOrigin;
        if (sameScreen) return right;
        var localPending = left.step !== base.step || left.sessionId !== base.sessionId || left.sessionOrigin !== base.sessionOrigin;
        var remotePending = right.step !== base.step || right.sessionId !== base.sessionId || right.sessionOrigin !== base.sessionOrigin;
        if (localPending && !remotePending) return left;
        if (remotePending && !localPending) return right;
        if (left.updatedAt > right.updatedAt) return left;
        return right;
    }

    function mergeRemote(local, remote, acked, tombs) {
        var baseLocal = local || emptyState();
        var baseRemote = remote || emptyState();
        var baseAcked = acked || emptyState();
        var rooms = mergeRooms(baseLocal, baseRemote, baseAcked);
        return {
            players: mergePlayers(baseLocal, baseRemote, baseAcked, tombs),
            rooms: rooms.rooms,
            history: mergeHistory(baseLocal, baseRemote, baseAcked, tombs),
            roomsUpdatedAt: rooms.roomsUpdatedAt,
            live: mergeLive(baseLocal, baseRemote, baseAcked)
        };
    }

    function pickNewerPlayerUnion(current, next) {
        if (!current) return clonePlayer(next);
        if (!next) return clonePlayer(current);
        var profile = (Number(next.updatedAt) || 0) > (Number(current.updatedAt) || 0) ? next : current;
        var scoreSource = (Number(next.scoreUpdatedAt) || 0) > (Number(current.scoreUpdatedAt) || 0) ? next : current;
        if ((Number(next.scoreUpdatedAt) || 0) === (Number(current.scoreUpdatedAt) || 0)) {
            scoreSource = next && hasScore(next) ? next : current;
        }
        return clonePlayer({
            id: profile.id,
            name: profile.name,
            handy: profile.handy,
            isActive: profile.isActive,
            updatedAt: Math.max(Number(current.updatedAt) || 0, Number(next.updatedAt) || 0),
            score: hasScore(scoreSource) ? Number(scoreSource.score) : null,
            scoreUpdatedAt: Math.max(Number(current.scoreUpdatedAt) || 0, Number(next.scoreUpdatedAt) || 0)
        });
    }

    // 구버전 덮어쓰기는 삭제로 보지 않는다. id/sessionId 합집합이고, 더 최신 시각만 이긴다.
    function remergeOldWrite(raw, local, lastGood) {
        var incoming = stateFromSnapshot(raw).state;
        var sources = [local || emptyState(), lastGood || emptyState(), incoming];
        var playersAcc = {};
        sources.forEach(function (source) {
            (source.players || []).forEach(function (player) {
                if (!player || player.id == null) return;
                var key = String(player.id);
                playersAcc[key] = playersAcc[key] ? pickNewerPlayerUnion(playersAcc[key], player) : clonePlayer(player);
            });
        });
        var historyAcc = {};
        sources.forEach(function (source) {
            (source.history || []).forEach(function (record) {
                if (!record) return;
                var key = historyKey(record);
                var prev = historyAcc[key];
                if (!prev || recordTime(record) >= recordTime(prev)) historyAcc[key] = cloneHistoryRecord(record);
            });
        });
        var roomsSource = local || emptyState();
        var roomsTime = Number(roomsSource.roomsUpdatedAt) || 0;
        [lastGood || emptyState(), incoming].forEach(function (source, index) {
            var time = Number(source.roomsUpdatedAt) || 0;
            var allowEmpty = index === 1 ? raw && raw.rooms != null : true;
            if (!allowEmpty && (!source.rooms || !source.rooms.length)) return;
            if (time > roomsTime || (time === roomsTime && source.rooms && source.rooms.length)) {
                if (time > roomsTime || (source.rooms && source.rooms.length) || time > 0) {
                    if (time >= roomsTime) {
                        roomsSource = source;
                        roomsTime = time;
                    }
                }
            }
        });
        if (raw && raw.rooms == null) {
            var kept = (lastGood && (lastGood.roomsUpdatedAt || 0) >= (local && local.roomsUpdatedAt || 0)) ? lastGood : local;
            if (kept && kept.rooms && kept.rooms.length && !(incoming.rooms && incoming.rooms.length)) {
                roomsSource = kept;
                roomsTime = Number(kept.roomsUpdatedAt) || 0;
            }
        }
        var players = orderedPlayers((local && local.players) || [], Object.keys(playersAcc).map(function (key) {
            return playersAcc[key];
        }));
        var history = orderedHistory((local && local.history) || [], Object.keys(historyAcc).map(function (key) {
            return historyAcc[key];
        }));
        return {
            players: players,
            rooms: decodeRooms(roomsSource.rooms),
            history: history,
            roomsUpdatedAt: roomsTime,
            live: normalizeLive((local && local.live) || (lastGood && lastGood.live))
        };
    }

    function diffUpdates(local, acked) {
        var updates = {};
        var any = false;
        var localMap = indexPlayers(local.players);
        var ackedMap = indexPlayers(acked.players);
        unionKeys(localMap, ackedMap).forEach(function (id) {
            var left = localMap[id] || null;
            var right = ackedMap[id] || null;
            if (!left && right) {
                updates['players/' + id] = null;
                updates['scores/' + id] = null;
                any = true;
                return;
            }
            if (left && !sameServerPlayer(left, right)) {
                updates['players/' + id] = serverPlayer(left);
                any = true;
            }
            var leftScore = serverScore(left);
            var rightScore = serverScore(right);
            if (!leftScore && rightScore) {
                updates['scores/' + id] = null;
                any = true;
            } else if (leftScore && (!rightScore || leftScore.score !== rightScore.score || leftScore.updatedAt !== rightScore.updatedAt)) {
                updates['scores/' + id] = leftScore;
                any = true;
            }
        });

        var localHistory = indexHistory(local.history);
        var ackedHistory = indexHistory(acked.history);
        unionKeys(localHistory, ackedHistory).forEach(function (key) {
            var left = localHistory[key] || null;
            var right = ackedHistory[key] || null;
            if (!left && right) {
                updates['history/' + key] = null;
                any = true;
            } else if (left && !sameHistory(left, right)) {
                updates['history/' + key] = serverHistory(left);
                any = true;
            }
        });

        if (!sameRooms(local.rooms, acked.rooms)) {
            updates.rooms = encodeRooms(local.rooms);
            updates.roomsUpdatedAt = Number(local.roomsUpdatedAt) || 0;
            any = true;
        }

        if (!sameLive(local.live, acked.live)) {
            updates.live = normalizeLive(local.live);
            any = true;
        }

        if (!any) return null;
        updates.schemaVersion = SCHEMA_VERSION;
        return updates;
    }

    function stateHasData(state) {
        if (!state) return false;
        return (state.players && state.players.length > 0) || (state.rooms && state.rooms.length > 0) || (state.history && state.history.length > 0);
    }

    function migrationUpdates(state) {
        var players = {};
        var scores = {};
        var history = {};
        var anyPlayer = false;
        var anyScore = false;
        var anyHistory = false;
        (state.players || []).forEach(function (player) {
            if (!player || player.id == null) return;
            var id = String(player.id);
            players[id] = serverPlayer(player);
            anyPlayer = true;
            var score = serverScore(player);
            if (score) {
                scores[id] = score;
                anyScore = true;
            }
        });
        (state.history || []).forEach(function (record) {
            history[historyKey(record)] = serverHistory(record);
            anyHistory = true;
        });
        var updates = {
            schemaVersion: SCHEMA_VERSION,
            players: anyPlayer ? players : null,
            scores: anyScore ? scores : null,
            history: anyHistory ? history : null,
            rooms: encodeRooms(state.rooms),
            roomsUpdatedAt: Number(state.roomsUpdatedAt) || 0
        };
        var live = normalizeLive(state && state.live);
        if (live.step || live.sessionId || live.updatedAt) updates.live = live;
        return updates;
    }

    function applyMultiPath(root, updates) {
        var data = clone(root) || {};
        if (Array.isArray(data)) data = {};
        Object.keys(updates || {}).forEach(function (path) {
            var parts = path.split('/');
            var parent = data;
            for (var i = 0; i < parts.length - 1; i++) {
                var part = parts[i];
                if (!isPlainObject(parent[part])) parent[part] = {};
                parent = parent[part];
            }
            var leaf = parts[parts.length - 1];
            if (updates[path] === null) delete parent[leaf];
            else parent[leaf] = clone(updates[path]);
            pruneEmpty(data, parts.slice(0, -1));
        });
        return data;
    }

    function pruneEmpty(root, parts) {
        for (var depth = parts.length; depth > 0; depth--) {
            var parent = root;
            for (var i = 0; i < depth - 1; i++) {
                parent = parent && parent[parts[i]];
            }
            if (!parent) return;
            var key = parts[depth - 1];
            var node = parent[key];
            if (isPlainObject(node) && Object.keys(node).length === 0) delete parent[key];
        }
    }

    function stateToRaw(state) {
        var updates = migrationUpdates(state || emptyState());
        var raw = { schemaVersion: SCHEMA_VERSION, roomsUpdatedAt: updates.roomsUpdatedAt };
        if (updates.players) raw.players = updates.players;
        if (updates.scores) raw.scores = updates.scores;
        if (updates.history) raw.history = updates.history;
        if (updates.rooms) raw.rooms = updates.rooms;
        var live = normalizeLive(state && state.live);
        if (live.step || live.sessionId || live.updatedAt) raw.live = live;
        return raw;
    }

    function isServerStamp(value) {
        return !!value && typeof value === 'object' && value['.sv'] === 'timestamp';
    }

    function stampClock(node, field) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        if (typeof node[field] === 'number') node[field] = clone(SERVER_STAMP);
    }

    function stampCollection(map, field) {
        if (!map || typeof map !== 'object' || Array.isArray(map)) return;
        Object.keys(map).forEach(function (id) {
            stampClock(map[id], field);
        });
    }

    function stampForServer(updates) {
        var copy = clone(updates);
        if (!copy) return copy;
        Object.keys(copy).forEach(function (path) {
            var value = copy[path];
            if (path === 'roomsUpdatedAt' && typeof value === 'number') {
                copy[path] = clone(SERVER_STAMP);
                return;
            }
            if (path === 'players') {
                stampCollection(value, 'updatedAt');
                return;
            }
            if (path === 'scores') {
                stampCollection(value, 'updatedAt');
                return;
            }
            if (path === 'history') {
                stampCollection(value, 'savedAt');
                return;
            }
            if (!value || typeof value !== 'object' || Array.isArray(value)) return;
            if (path.indexOf('players/') === 0 || path.indexOf('scores/') === 0 || path === 'live') {
                stampClock(value, 'updatedAt');
            }
            if (path.indexOf('history/') === 0) stampClock(value, 'savedAt');
        });
        return copy;
    }

    function resolveServerStamps(value, now) {
        var clock = now || Date.now();
        function walk(node) {
            if (isServerStamp(node)) return clock;
            if (!node || typeof node !== 'object') return node;
            if (Array.isArray(node)) return node.map(walk);
            var copy = {};
            Object.keys(node).forEach(function (key) {
                copy[key] = walk(node[key]);
            });
            return copy;
        }
        return walk(clone(value));
    }

    function applyWrittenUpdates(acked, updates) {
        var raw = stateToRaw(acked || emptyState());
        var next = applyMultiPath(raw, updates || {});
        if (!next.schemaVersion) next.schemaVersion = SCHEMA_VERSION;
        return stateFromSnapshot(next).state;
    }

    function statesEqual(a, b) {
        return !diffUpdates(a || emptyState(), b || emptyState());
    }

    function statusText(kind) {
        if (kind === 'saving') return '저장 중…';
        if (kind === 'saved') return '저장됨 ✓';
        if (kind === 'offline') return '오프라인 · 연결되면 저장';
        if (kind === 'error') return '저장 실패';
        if (kind === 'local') return '로컬 모드';
        if (kind === 'checking') return '연결 확인 중';
        return '연결됨';
    }

    function decideFlush(connected, updates, explicit) {
        if (!updates) {
            return {
                action: 'noop',
                status: connected ? 'saved' : 'offline',
                toast: !!explicit
            };
        }
        if (!connected) {
            return { action: 'defer', status: 'offline', toast: true };
        }
        return { action: 'write', status: 'saving', toast: true };
    }

    function groupRestPatches(updates) {
        var top = {};
        var collections = { players: {}, scores: {}, history: {} };
        var extras = [];
        Object.keys(updates || {}).forEach(function (path) {
            var parts = String(path).split('/');
            if (parts.length === 1) {
                top[parts[0]] = updates[path];
                return;
            }
            if (collections[parts[0]] && parts.length === 2) {
                collections[parts[0]][parts[1]] = updates[path];
                return;
            }
            extras.push({ path: path, value: updates[path] });
        });
        var patches = [];
        if (Object.keys(top).length) patches.push({ path: '', method: 'PATCH', body: top });
        ['players', 'scores', 'history'].forEach(function (name) {
            if (Object.keys(collections[name]).length) {
                patches.push({ path: name, method: 'PATCH', body: collections[name] });
            }
        });
        extras.forEach(function (item) {
            patches.push({ path: item.path, method: 'PATCH', body: item.value });
        });
        return patches;
    }

    function emptyTombstones() {
        return { players: {}, scores: {}, history: {} };
    }

    function createSyncClient() {
        var client = {
            acked: emptyState(),
            lastGood: null,
            tombstones: emptyTombstones(),
            migrationNeeded: false,
            hydrated: false,
            writesInFlight: 0,
            pendingRemote: undefined,
            hasPending: false,
            connected: false,
            hasSessionEdits: false,
            baseline: null,

            noteEdit: function () {
                client.hasSessionEdits = true;
            },

            // 앱을 연 직후의 로컬 상태. 그 뒤 사용자가 고친 칸만 첫 스냅샷과 겨룬다.
            noteBaseline: function (state) {
                client.baseline = cloneState(state || emptyState());
            },

            tombstonePlayer: function (id, time) {
                var key = String(id);
                client.tombstones.players[key] = time;
                client.tombstones.scores[key] = time;
            },

            tombstoneHistory: function (key, time) {
                client.tombstones.history[String(key)] = time;
            },

            ingest: function (raw, localState) {
                if (client.writesInFlight > 0) {
                    client.pendingRemote = raw;
                    client.hasPending = true;
                    return { deferred: true, state: localState, changed: false, dirty: false };
                }
                return applySnapshot(client, raw, localState);
            },

            nextUpdates: function (localState) {
                if (!client.hydrated) return null;
                if (client.migrationNeeded) return migrationUpdates(localState);
                return diffUpdates(localState, client.acked);
            },

            beginWrite: function () {
                client.writesInFlight += 1;
            },

            finishWrite: function (success, localState, updates) {
                client.writesInFlight = Math.max(0, client.writesInFlight - 1);
                // 쓰기 중에 쌓아 둔 스냅샷을 먼저 합친다.
                // 방금 쓴 값으로 acked를 먼저 바꾸면, 그 스냅샷에 아직 없는 점수가
                // '서버가 지웠다'처럼 보여서 방금 저장한 값이 사라진다.
                if (client.writesInFlight === 0 && client.hasPending) {
                    var pending = client.pendingRemote;
                    client.pendingRemote = undefined;
                    client.hasPending = false;
                    var follow = applySnapshot(client, pending, localState);
                    if (success) client.lastGood = cloneState(follow.state || localState);
                    return follow;
                }
                if (success) {
                    client.acked = applyWrittenUpdates(client.migrationNeeded ? emptyState() : client.acked, updates);
                    client.lastGood = cloneState(localState);
                    client.migrationNeeded = false;
                    client.hydrated = true;
                    confirmTombstones(client, localState);
                }
                return null;
            }
        };
        return client;
    }

    function confirmTombstones(client, localState) {
        var players = indexPlayers(localState.players);
        var ackedPlayers = indexPlayers(client.acked.players);
        Object.keys(client.tombstones.players).forEach(function (id) {
            if (!players[id] && !ackedPlayers[id]) {
                delete client.tombstones.players[id];
                delete client.tombstones.scores[id];
            }
        });
        var history = indexHistory(localState.history);
        var ackedHistory = indexHistory(client.acked.history);
        Object.keys(client.tombstones.history).forEach(function (key) {
            if (!history[key] && !ackedHistory[key]) delete client.tombstones.history[key];
        });
    }

    function applySnapshot(client, raw, localState) {
        var format = detectFormat(raw);
        if (format === 'old') {
            var mergedOld = remergeOldWrite(raw, localState, client.lastGood);
            client.migrationNeeded = true;
            client.hydrated = true;
            return {
                deferred: false,
                state: mergedOld,
                changed: !statesEqual(localState, mergedOld),
                dirty: true,
                migrationNeeded: true,
                format: format
            };
        }

        if (format === 'empty' && !client.hydrated) {
            client.hydrated = true;
            client.acked = emptyState();
            var has = stateHasData(localState);
            client.migrationNeeded = has;
            if (has) client.lastGood = cloneState(localState);
            return {
                deferred: false,
                state: cloneState(localState),
                changed: false,
                dirty: has,
                migrationNeeded: has,
                format: format
            };
        }

        // 첫 스냅샷은 서버가 기준이다. 로컬 저장소의 옛 시각으로 서버를 덮어쓰지 않는다.
        // 그 전에 이 화면에서 고친 값만 예외로 합친다.
        if (format === 'new' && !client.hydrated && !client.hasSessionEdits) {
            var firstRemote = stateFromSnapshot(raw).state;
            var live = firstRemote.live || {};
            if (stateHasData(firstRemote) || live.step || live.sessionId) {
                client.acked = cloneState(firstRemote);
                client.lastGood = cloneState(firstRemote);
                client.hydrated = true;
                client.migrationNeeded = false;
                return {
                    deferred: false,
                    state: cloneState(firstRemote),
                    changed: !statesEqual(localState || emptyState(), firstRemote),
                    dirty: false,
                    migrationNeeded: false,
                    format: 'new'
                };
            }
        }

        var remote = stateFromSnapshot(raw).state;
        // 아직 서버를 받기 전이면, 빈 acked가 아니라 '열었을 때의 화면'과 비교한다.
        // 그래야 로컬 저장소의 옛 시각이 손대지 않은 점수를 서버보다 새것으로 착각하지 않는다.
        var prior = (!client.hydrated && client.baseline) ? client.baseline : client.acked;
        var merged = mergeRemote(localState || emptyState(), remote, prior, client.tombstones);
        client.acked = cloneState(remote);
        client.lastGood = cloneState(merged);
        client.hydrated = true;
        client.migrationNeeded = false;
        var dirty = !!diffUpdates(merged, remote);
        return {
            deferred: false,
            state: merged,
            changed: !statesEqual(localState, merged),
            dirty: dirty,
            migrationNeeded: false,
            format: 'new'
        };
    }

    var api = {
        SCHEMA_VERSION: SCHEMA_VERSION,
        WRITE_DEBOUNCE_MS: WRITE_DEBOUNCE_MS,
        TOAST_MS: TOAST_MS,
        REST_POLL_MS: REST_POLL_MS,
        emptyState: emptyState,
        cloneState: cloneState,
        detectFormat: detectFormat,
        stateFromSnapshot: stateFromSnapshot,
        historyKey: historyKey,
        encodeRooms: encodeRooms,
        decodeRooms: decodeRooms,
        diffUpdates: diffUpdates,
        migrationUpdates: migrationUpdates,
        applyMultiPath: applyMultiPath,
        applyWrittenUpdates: applyWrittenUpdates,
        remergeOldWrite: remergeOldWrite,
        mergeRemote: mergeRemote,
        statesEqual: statesEqual,
        stateHasData: stateHasData,
        statusText: statusText,
        decideFlush: decideFlush,
        groupRestPatches: groupRestPatches,
        stampForServer: stampForServer,
        resolveServerStamps: resolveServerStamps,
        SERVER_STAMP: SERVER_STAMP,
        createSyncClient: createSyncClient,
        hasScore: hasScore,
        recordTime: recordTime
    };

    global.GolfSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

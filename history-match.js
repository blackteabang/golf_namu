// 경기 기록 저장 규칙 (브라우저 스크립트 / Node 테스트 공용)
//
// 같은 경기의 다시 저장은 새 줄을 추가하지 않고 기존 기록을 덮어쓴다.
// 1) 세션 아이디가 같으면 같은 경기다. 시간 차이와 상관없이 그 기록을 갱신한다.
// 2) 세션이 없는 예전 기록은, 같은 로컬 날짜이고 저장 시각 차이가 3시간 이내이며
//    참가자 이름이 같을 때만 같은 경기로 본다.
// 3) 다시 저장할 때 세션 아이디가 서로 다르면 그 순간에는 새 줄로 둔다.
// 4) 앱을 열 때 이미 쌓인 중복은 더 넓게 정리한다.
//    같은 로컬 날짜 + 같은 참가자 + 4시간 이내면 점수나 세션이 달라도 가장 최근 한 줄만 남긴다.
//    참가자가 다르거나, 아침/저녁처럼 4시간이 넘는 경기는 그대로 둔다.
(function (global) {
    // 다시 저장할 때 예전 기록과 같은 경기로 보는 시간 창. 저장 시각 기준 앞뒤 3시간.
    var MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;
    // 이미 쌓인 중복을 열 때 합치는 시간 창. 한 라운드를 고쳐 저장한 간격이 3시간을 조금 넘어도 한 경기로 본다.
    var COLLAPSE_WINDOW_MS = 4 * 60 * 60 * 1000;

    function localDateString(timestamp) {
        var d = new Date(timestamp);
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return d.getFullYear() + '-' + month + '-' + day;
    }

    function recordTime(record) {
        if (!record) return 0;
        var raw = record.savedAt != null ? record.savedAt : record.id;
        var time = Number(raw);
        return Number.isFinite(time) ? time : 0;
    }

    function playerNamesKey(players) {
        return (players || []).map(function (player) {
            return player && player.name ? String(player.name).trim() : '';
        }).filter(function (name) {
            return name;
        }).sort().join('\u0001');
    }

    function cloneHistory(history) {
        return (history || []).map(function (record) {
            return Object.assign({}, record, {
                players: (record.players || []).map(function (player) {
                    return Object.assign({}, player);
                })
            });
        });
    }

    function clonePlayers(players) {
        return (players || []).map(function (player) {
            return Object.assign({}, player);
        });
    }

    // 저장된 날짜 문자열이 같거나, 저장 시각의 로컬 날짜가 같으면 같은 날이다.
    function sameStoredDay(a, b) {
        if (a && b && a.date && b.date && a.date === b.date) return true;
        var timeA = recordTime(a);
        var timeB = recordTime(b);
        return !!(timeA && timeB && localDateString(timeA) === localDateString(timeB));
    }

    function isSameCalendarDay(record, today) {
        if (!record) return false;
        if (record.date === today) return true;
        var time = recordTime(record);
        return !!(time && localDateString(time) === today);
    }

    function findHistoryMatch(history, options) {
        var list = history || [];
        var sessionId = options.sessionId || '';
        var now = options.now;
        var players = options.players || [];
        var allowTimeMatch = !!options.allowTimeMatch;

        if (sessionId) {
            var sessionMatch = -1;
            var sessionTime = -1;
            list.forEach(function (record, index) {
                if (!record || record.sessionId !== sessionId) return;
                var time = recordTime(record);
                if (sessionMatch === -1 || time >= sessionTime) {
                    sessionMatch = index;
                    sessionTime = time;
                }
            });
            if (sessionMatch >= 0) return sessionMatch;
        }

        if (!allowTimeMatch) return -1;

        var today = localDateString(now);
        var names = playerNamesKey(players);
        var best = -1;
        var bestDelta = Infinity;
        list.forEach(function (record, index) {
            if (!record) return;
            if (record.sessionId && record.sessionId !== sessionId) return;
            if (playerNamesKey(record.players) !== names) return;
            if (!isSameCalendarDay(record, today)) return;
            var time = recordTime(record);
            if (!time) return;
            var delta = Math.abs(now - time);
            if (delta > MATCH_WINDOW_MS) return;
            var betterDelta = delta < bestDelta;
            var sameDeltaNewer = delta === bestDelta && best !== -1 && time > recordTime(list[best]);
            if (betterDelta || sameDeltaNewer) {
                best = index;
                bestDelta = delta;
            }
        });
        return best;
    }

    function renumberDates(list, dates) {
        (dates || []).forEach(function (day) {
            if (!day) return;
            var rows = list.filter(function (record) {
                return record.date === day;
            }).sort(function (a, b) {
                return recordTime(a) - recordTime(b);
            });
            rows.forEach(function (record, index) {
                record.round = index + 1;
            });
        });
    }

    // 갱신한 기록과 같은 경기인 중복만 제거한다.
    // 세션이 이미 있던 기록을 갱신할 때는 그 세션의 중복만 지운다.
    // 세션이 없던 예전 기록을 이어 저장할 때만, 같은 날·같은 참가자·3시간 안의 예전 중복을 합친다.
    function dropSameGameDuplicates(list, keeperIndex, anchorTime, includeLegacyCluster) {
        var keeper = list[keeperIndex];
        var names = playerNamesKey(keeper.players);
        var sessionId = keeper.sessionId;
        return list.filter(function (record, index) {
            if (index === keeperIndex) return true;
            if (sessionId && record.sessionId === sessionId) return false;
            if (!includeLegacyCluster) return true;
            if (record.sessionId) return true;
            if (!sameStoredDay(record, keeper)) return true;
            if (playerNamesKey(record.players) !== names) return true;
            var time = recordTime(record);
            if (!anchorTime || !time || Math.abs(time - anchorTime) > MATCH_WINDOW_MS) return true;
            return false;
        });
    }

    function upsertHistory(history, players, options) {
        var list = cloneHistory(history);
        var now = options.now;
        var sessionId = options.sessionId || '';
        var allowTimeMatch = !!options.allowTimeMatch;
        var snapshot = clonePlayers(players);
        var matchIndex = findHistoryMatch(list, {
            sessionId: sessionId,
            now: now,
            players: snapshot,
            allowTimeMatch: allowTimeMatch
        });

        if (matchIndex >= 0) {
            var existing = list[matchIndex];
            var anchorTime = recordTime(existing);
            var originalDate = existing.date;
            var hadSession = !!existing.sessionId;
            existing.players = snapshot;
            existing.savedAt = now;
            if (sessionId) existing.sessionId = sessionId;
            if (!existing.date) existing.date = localDateString(anchorTime || now);
            if (!existing.id) existing.id = anchorTime || now;

            var next = dropSameGameDuplicates(list, matchIndex, anchorTime, !hadSession);
            if (next.length !== list.length) {
                renumberDates(next, [existing.date, originalDate]);
            }
            return { history: next, updated: true, id: existing.id };
        }

        var today = localDateString(now);
        var record = {
            id: now,
            savedAt: now,
            date: today,
            round: list.filter(function (item) { return item.date === today; }).length + 1,
            players: snapshot
        };
        if (sessionId) record.sessionId = sessionId;
        list.unshift(record);
        return { history: list, updated: false, id: record.id };
    }

    function keepNewest(list, indexes, remove) {
        if (!indexes || indexes.length < 2) return;
        var keep = indexes[0];
        indexes.forEach(function (index) {
            var time = recordTime(list[index]);
            var keepTime = recordTime(list[keep]);
            if (time > keepTime || (time === keepTime && index > keep)) keep = index;
        });
        indexes.forEach(function (index) {
            if (index !== keep) remove.add(index);
        });
    }

    // 같은 세션은 시간을 넘어도 한 경기다. 가장 최근 저장만 남긴다.
    function collapseSameSessions(list, remove) {
        var bySession = new Map();
        list.forEach(function (record, index) {
            if (!record.sessionId) return;
            if (!bySession.has(record.sessionId)) bySession.set(record.sessionId, []);
            bySession.get(record.sessionId).push(index);
        });
        bySession.forEach(function (indexes) {
            keepNewest(list, indexes, remove);
        });
    }

    // 앱을 열 때 이미 쌓인 중복을 정리한다.
    // 같은 날짜, 같은 참가자, 가장 이른 시각부터 4시간 안이면 점수가 달라도 최신 한 줄만 남긴다.
    // 예: 2026-09-30에 같은 멤버로 세 번 저장된 기록 → 1줄.
    function collapseStoredDuplicates(history) {
        var list = cloneHistory(history);
        var remove = new Set();
        collapseSameSessions(list, remove);

        var groups = new Map();
        list.forEach(function (record, index) {
            if (remove.has(index)) return;
            var names = playerNamesKey(record.players);
            if (!names) return;
            var day = record.date || (recordTime(record) ? localDateString(recordTime(record)) : '');
            if (!day) return;
            var key = day + '\u0000' + names;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(index);
        });

        groups.forEach(function (indexes) {
            var sorted = indexes.slice().sort(function (a, b) {
                return recordTime(list[a]) - recordTime(list[b]);
            });
            var start = 0;
            while (start < sorted.length) {
                var origin = recordTime(list[sorted[start]]);
                var end = start + 1;
                while (end < sorted.length) {
                    var time = recordTime(list[sorted[end]]);
                    if (!origin || !time || (time - origin) > COLLAPSE_WINDOW_MS) break;
                    end += 1;
                }
                keepNewest(list, sorted.slice(start, end), remove);
                start = end;
            }
        });

        if (remove.size === 0) return { history: list, changed: false };

        var affectedDates = new Set();
        remove.forEach(function (index) {
            if (list[index] && list[index].date) affectedDates.add(list[index].date);
        });
        var next = list.filter(function (_, index) { return !remove.has(index); });
        renumberDates(next, Array.from(affectedDates));
        return { history: next, changed: true };
    }

    global.GolfHistory = {
        MATCH_WINDOW_MS: MATCH_WINDOW_MS,
        COLLAPSE_WINDOW_MS: COLLAPSE_WINDOW_MS,
        localDateString: localDateString,
        recordTime: recordTime,
        playerNamesKey: playerNamesKey,
        findHistoryMatch: findHistoryMatch,
        upsertHistory: upsertHistory,
        collapseStoredDuplicates: collapseStoredDuplicates
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);

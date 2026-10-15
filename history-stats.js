// 과거 경기 기록 집계 (브라우저 스크립트 / Node 테스트 공용)
//
// 기록 한 줄의 선수에는 name, score(오버파), handy(핸디캡), net 이 있다.
// 상금이나 별도 포인트 필드는 없다. 화면의 '점'은 스코어다.
//   스코어 = 오늘 오버파 - 핸디캡   (GolfScore.getNetScore, 낮을수록 좋음)
//
// 집계 전에 GolfHistory.collapseStoredDuplicates 로 이미 쌓인 중복을 한 줄로 합친다.
// 같은 세션, 또는 같은 날·같은 참가자·4시간 안의 다시 저장은 한 경기로만 센다.
// 입력 기록은 바꾸지 않는다.
//
// 지표 (한 경기에서 이름이 같으면 한 명으로 보고, 더 좋은 스코어만 남긴다)
//   승     : 그 경기의 우승 1명. 스코어가 가장 낮고, 같으면 핸디가 더 낮은 사람.
//            스코어와 핸디까지 같으면 기록에 먼저 나온 한 명만 우승이다.
//   경기   : 참가한 경기 수
//   승률   : 승 / 경기
//   평균·합계 : 스코어(net)의 평균과 합
//   이달의 MVP : 선택 월(Asia/Seoul) 최다 승 → 평균 스코어가 더 낮은 쪽 →
//            그래도 같으면 합계 스코어가 더 낮은 쪽 → 이름 오름차순
//   누적 순위 : 승이 많은 순, 같으면 승률이 높은 순, 그다음 평균 스코어가 낮은 순
//   최저 스코어 : 한 경기 스코어가 가장 낮은 사람 (같으면 더 이른 날짜, 그다음 이름)
//   최다 참여 : 경기 수가 가장 많은 사람 (같으면 승이 많은 쪽, 그다음 이름)
(function (global) {
    var SEOUL_TZ = 'Asia/Seoul';
    var TOP_LIMIT = 5;

    function recordTime(record) {
        if (typeof GolfHistory !== 'undefined' && GolfHistory.recordTime) return GolfHistory.recordTime(record);
        if (!record) return 0;
        var raw = record.savedAt != null ? record.savedAt : record.id;
        var time = Number(raw);
        return Number.isFinite(time) ? time : 0;
    }

    function netPoints(player) {
        if (typeof GolfScore !== 'undefined' && GolfScore.getNetScore) {
            return GolfScore.getNetScore(player.score, player.handy);
        }
        var net = Number(player && player.net);
        return Number.isFinite(net) ? net : 0;
    }

    function rankCompare(a, b) {
        if (typeof GolfScore !== 'undefined' && GolfScore.compareRank) {
            return GolfScore.compareRank(a, b, false);
        }
        return netPoints(a) - netPoints(b);
    }

    function collapsedHistory(history) {
        var list = history || [];
        if (typeof GolfHistory !== 'undefined' && GolfHistory.collapseStoredDuplicates) {
            return GolfHistory.collapseStoredDuplicates(list).history;
        }
        return list.slice();
    }

    function seoulDateString(timestamp) {
        var formatted = new Intl.DateTimeFormat('en-CA', {
            timeZone: SEOUL_TZ,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date(timestamp));
        var match = /(\d{4})\D(\d{2})\D(\d{2})/.exec(formatted);
        if (!match) return '';
        return match[1] + '-' + match[2] + '-' + match[3];
    }

    function seoulMonthKey(timestamp) {
        var date = seoulDateString(timestamp);
        return date ? date.slice(0, 7) : '';
    }

    function normalizeMonth(value) {
        var match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
        if (!match) return '';
        var month = Number(match[2]);
        if (month < 1 || month > 12) return '';
        return match[1] + '-' + match[2];
    }

    function shiftMonth(key, delta) {
        var parts = String(key).split('-');
        var index = Number(parts[0]) * 12 + (Number(parts[1]) - 1) + delta;
        var year = Math.floor(index / 12);
        var month = index % 12;
        return year + '-' + String(month + 1).padStart(2, '0');
    }

    function monthLabel(key) {
        var parts = String(key || '').split('-');
        if (parts.length < 2) return '';
        return parts[0] + '년 ' + Number(parts[1]) + '월';
    }

    function monthNumberLabel(key) {
        var parts = String(key || '').split('-');
        if (parts.length < 2 || !parts[1]) return '';
        return Number(parts[1]) + '월';
    }

    function monthKeyFromRecord(record) {
        var date = record && record.date ? String(record.date) : '';
        var match = /^(\d{4})-(\d{2})/.exec(date);
        if (match) return match[1] + '-' + match[2];
        var time = recordTime(record);
        if (!time) return '';
        return seoulMonthKey(time);
    }

    function buildMonthRange(recordMonths, current) {
        var keys = recordMonths.slice();
        if (current && keys.indexOf(current) < 0) keys.push(current);
        keys = keys.filter(Boolean).sort();
        if (!keys.length) return current ? [current] : [];
        var out = [];
        var cursor = keys[0];
        var end = keys[keys.length - 1];
        var guard = 0;
        while (cursor && cursor <= end && guard < 240) {
            out.push(cursor);
            cursor = shiftMonth(cursor, 1);
            guard += 1;
        }
        return out;
    }

    // 한 경기 안에서 같은 이름은 한 번만. 더 좋은 스코어(같으면 더 낮은 핸디)를 남긴다.
    function entriesForGame(players) {
        var order = [];
        var indexByName = {};
        (players || []).forEach(function (player) {
            if (!player) return;
            var name = String(player.name || '').trim();
            if (!name) return;
            var known = indexByName[name];
            if (known == null) {
                indexByName[name] = order.length;
                order.push({ name: name, player: player });
                return;
            }
            if (rankCompare(player, order[known].player) < 0) order[known].player = player;
        });
        return order;
    }

    function winnerName(entries) {
        var best = -1;
        entries.forEach(function (entry, index) {
            if (best === -1 || rankCompare(entry.player, entries[best].player) < 0) best = index;
        });
        return best >= 0 ? entries[best].name : '';
    }

    function betterRound(candidate, best) {
        if (!best) return true;
        if (candidate.points !== best.points) return candidate.points < best.points;
        var dateA = candidate.date || '';
        var dateB = best.date || '';
        if (dateA !== dateB) return dateA < dateB;
        return candidate.name < best.name;
    }

    function accumulate(records) {
        var map = new Map();
        var best = null;
        var games = 0;
        (records || []).forEach(function (record) {
            if (!record) return;
            var entries = entriesForGame(record.players);
            if (!entries.length) return;
            games += 1;
            var winner = winnerName(entries);
            var date = record.date ? String(record.date) : '';
            if (!date) {
                var time = recordTime(record);
                if (time) date = seoulDateString(time);
            }
            entries.forEach(function (entry) {
                var points = netPoints(entry.player);
                var row = map.get(entry.name);
                if (!row) {
                    row = { name: entry.name, games: 0, wins: 0, totalPoints: 0 };
                    map.set(entry.name, row);
                }
                row.games += 1;
                row.totalPoints += points;
                if (entry.name === winner) row.wins += 1;
                var round = {
                    name: entry.name,
                    points: points,
                    date: date,
                    overPar: entry.player.score,
                    handy: entry.player.handy
                };
                if (betterRound(round, best)) best = round;
            });
        });
        var players = Array.from(map.values()).map(function (row) {
            return {
                name: row.name,
                games: row.games,
                wins: row.wins,
                winRate: row.games ? row.wins / row.games : 0,
                avgPoints: row.games ? row.totalPoints / row.games : 0,
                totalPoints: row.totalPoints
            };
        });
        players.sort(compareRanking);
        var most = players.slice().sort(compareMostPlayed)[0] || null;
        return {
            games: games,
            players: players,
            bestRound: best,
            mostPlayed: most ? { name: most.name, games: most.games, wins: most.wins } : null
        };
    }

    function compareMvp(a, b) {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.avgPoints !== b.avgPoints) return a.avgPoints - b.avgPoints;
        if (a.totalPoints !== b.totalPoints) return a.totalPoints - b.totalPoints;
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
    }

    function compareRanking(a, b) {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.winRate !== a.winRate) return b.winRate - a.winRate;
        if (a.avgPoints !== b.avgPoints) return a.avgPoints - b.avgPoints;
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
    }

    function compareMostPlayed(a, b) {
        if (b.games !== a.games) return b.games - a.games;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
    }

    function roundPlaces(value, places) {
        var factor = Math.pow(10, places);
        var scaled = value * factor;
        var rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
        return rounded / factor;
    }

    function formatPoints(value, digits) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '-';
        var places = digits == null ? (Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1) : digits;
        var rounded = roundPlaces(n, places);
        if (Math.abs(rounded) < 1e-9) rounded = 0;
        var text = rounded.toFixed(places);
        if (rounded > 0) return '+' + text;
        return text;
    }

    function formatWinRate(rate) {
        var pct = Number(rate) * 100;
        if (!Number.isFinite(pct)) return '-';
        var rounded = roundPlaces(pct, 1);
        if (Math.abs(rounded - Math.round(rounded)) < 0.05) return Math.round(rounded) + '%';
        return rounded.toFixed(1) + '%';
    }

    function summarize(history, options) {
        var opts = options || {};
        var now = opts.now != null ? opts.now : Date.now();
        var records = collapsedHistory(history);
        var current = seoulMonthKey(now);
        var recordMonths = [];
        records.forEach(function (record) {
            var key = monthKeyFromRecord(record);
            if (key && recordMonths.indexOf(key) < 0) recordMonths.push(key);
        });
        var months = buildMonthRange(recordMonths, current);
        var requested = normalizeMonth(opts.month);
        var month = current;
        if (requested && months.indexOf(requested) !== -1) month = requested;
        else if (months.indexOf(current) !== -1) month = current;
        else month = months.length ? months[months.length - 1] : current;

        var monthRecords = records.filter(function (record) {
            return monthKeyFromRecord(record) === month;
        });
        var all = accumulate(records);
        var monthStats = accumulate(monthRecords);
        var mvpPool = monthStats.players.slice().sort(compareMvp);
        var mvp = mvpPool[0] || null;
        var mvpTieCount = 0;
        if (mvp) {
            mvpTieCount = mvpPool.filter(function (row) {
                return row.wins === mvp.wins && row.avgPoints === mvp.avgPoints && row.totalPoints === mvp.totalPoints;
            }).length;
        }
        var index = months.indexOf(month);

        return {
            timezone: SEOUL_TZ,
            nowMonth: current,
            month: month,
            monthLabel: monthLabel(month),
            isCurrentMonth: month === current,
            canPrev: index > 0,
            canNext: index >= 0 && index < months.length - 1,
            months: months,
            gamesAll: all.games,
            gamesMonth: monthStats.games,
            mvp: mvp,
            mvpTieCount: mvpTieCount,
            rankingAll: all.players,
            rankingMonth: monthStats.players,
            bestRoundAll: all.bestRound,
            bestRoundMonth: monthStats.bestRound,
            mostPlayedAll: all.mostPlayed,
            mostPlayedMonth: monthStats.mostPlayed,
            topLimit: TOP_LIMIT
        };
    }

    global.GolfStats = {
        SEOUL_TZ: SEOUL_TZ,
        TOP_LIMIT: TOP_LIMIT,
        summarize: summarize,
        formatPoints: formatPoints,
        formatWinRate: formatWinRate,
        monthLabel: monthLabel,
        monthNumberLabel: monthNumberLabel,
        seoulMonthKey: seoulMonthKey
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);

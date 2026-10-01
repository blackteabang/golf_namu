import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(root, 'history-match.js'), 'utf8');
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
const { GolfHistory } = sandbox;

assert.ok(GolfHistory, 'GolfHistory should load');

const {
    MATCH_WINDOW_MS,
    COLLAPSE_WINDOW_MS,
    localDateString,
    upsertHistory,
    collapseStoredDuplicates
} = GolfHistory;

function at(hour, minute, day = 1) {
    return new Date(2026, 9, day, hour, minute, 0, 0).getTime();
}

function players(scoreA) {
    return [
        { name: '민수', score: scoreA, handy: -4, net: scoreA - (-4) },
        { name: '지연', score: 4, handy: 10, net: 4 - 10 }
    ];
}

const morning = at(9, 0);
const soon = at(9, 40);
const afternoon = at(14, 0);
const today = localDateString(morning);
const prev = new Date(2026, 8, 30, 9, 0, 0, 0).getTime();
const prevDate = localDateString(prev);

assert.equal(MATCH_WINDOW_MS, 3 * 60 * 60 * 1000);
assert.equal(COLLAPSE_WINDOW_MS, 4 * 60 * 60 * 1000);

// 첫 저장은 새 기록
let result = upsertHistory([], players(2), {
    sessionId: 'sess-a',
    now: morning,
    allowTimeMatch: false
});
assert.equal(result.updated, false);
assert.equal(result.history.length, 1);
assert.equal(result.history[0].date, today);
assert.equal(result.history[0].round, 1);
assert.equal(result.history[0].sessionId, 'sess-a');
const firstId = result.history[0].id;

// 같은 세션으로 점수를 고쳐 다시 저장하면 한 줄만 남고 점수가 바뀐다
result = upsertHistory(result.history, players(5), {
    sessionId: 'sess-a',
    now: soon,
    allowTimeMatch: false
});
assert.equal(result.updated, true);
assert.equal(result.history.length, 1);
assert.equal(result.history[0].id, firstId);
assert.equal(result.history[0].round, 1);
assert.equal(result.history[0].players.find(p => p.name === '민수').score, 5);
assert.equal(result.history[0].savedAt, soon);

// 같은 세션이면 3시간이 넘어도 갱신한다
const evening = morning + 10 * 60 * 60 * 1000;
result = upsertHistory(result.history, players(7), {
    sessionId: 'sess-a',
    now: evening,
    allowTimeMatch: false
});
assert.equal(result.history.length, 1);
assert.equal(result.history[0].id, firstId);
assert.equal(result.history[0].players.find(p => p.name === '민수').score, 7);

// 세션이 다르면 3시간 안이어도 새 경기로 추가하고, 이전 점수는 유지한다
const firstGame = upsertHistory([], players(2), {
    sessionId: 'sess-a',
    now: morning,
    allowTimeMatch: false
}).history;
result = upsertHistory(firstGame, players(9), {
    sessionId: 'sess-b',
    now: soon,
    allowTimeMatch: true
});
assert.equal(result.updated, false);
assert.equal(result.history.length, 2);
assert.equal(result.history.find(h => h.sessionId === 'sess-a').players.find(p => p.name === '민수').score, 2);
assert.equal(result.history.find(h => h.sessionId === 'sess-b').round, 2);

// 세션이 없는 예전 기록은 같은 날 + 3시간 + 같은 참가자면 갱신한다
const legacy = [{
    id: morning,
    date: today,
    round: 1,
    players: players(2)
}];
result = upsertHistory(legacy, players(8), {
    sessionId: 'sess-continued',
    now: soon,
    allowTimeMatch: true
});
assert.equal(result.updated, true);
assert.equal(result.history.length, 1);
assert.equal(result.history[0].id, morning);
assert.equal(result.history[0].sessionId, 'sess-continued');
assert.equal(result.history[0].players.find(p => p.name === '민수').score, 8);
assert.equal(result.history[0].date, today);

// 3시간을 넘긴 예전 기록은 새 경기다
result = upsertHistory(legacy, players(8), {
    sessionId: 'sess-continued',
    now: morning + MATCH_WINDOW_MS + 60 * 1000,
    allowTimeMatch: true
});
assert.equal(result.updated, false);
assert.equal(result.history.length, 2);
assert.equal(result.history.find(h => h.id === morning).players.find(p => p.name === '민수').score, 2);

// 다른 날 기록은 그대로 둔다
const older = [{
    id: prev,
    date: prevDate,
    round: 1,
    players: players(2)
}];
result = upsertHistory(older, players(3), {
    sessionId: 'sess-today',
    now: morning,
    allowTimeMatch: true
});
assert.equal(result.history.length, 2);
const keptYesterday = result.history.find(h => h.date === prevDate);
assert.equal(keptYesterday.id, prev);
assert.equal(keptYesterday.players.find(p => p.name === '민수').score, 2);
assert.equal(keptYesterday.round, 1);

// 참가자가 다르면 같은 시간대라도 다른 경기다
result = upsertHistory(legacy, [
    { name: '철수', score: 1, handy: 0, net: 1 }
], {
    sessionId: 'sess-other',
    now: soon,
    allowTimeMatch: true
});
assert.equal(result.history.length, 2);
assert.equal(result.history.find(h => h.id === morning).players.find(p => p.name === '민수').score, 2);

// 새 조 배정(allowTimeMatch false)은 예전 기록을 덮어쓰지 않는다
result = upsertHistory(legacy, players(6), {
    sessionId: 'sess-new-round',
    now: soon,
    allowTimeMatch: false
});
assert.equal(result.updated, false);
assert.equal(result.history.length, 2);

// 다시 저장하면 같은 시간대에 쌓인 예전 중복을 최신 한 줄로 합친다
const duplicates = [
    { id: prev, date: prevDate, round: 1, players: players(1) },
    { id: morning, date: today, round: 1, players: players(2) },
    { id: morning + 10 * 60 * 1000, date: today, round: 2, players: players(3) },
    { id: morning + 20 * 60 * 1000, date: today, round: 3, players: players(4) },
    {
        id: afternoon,
        date: today,
        round: 4,
        sessionId: 'sess-later',
        players: players(11)
    }
];
result = upsertHistory(duplicates, players(9), {
    sessionId: 'sess-continued',
    now: morning + 25 * 60 * 1000,
    allowTimeMatch: true
});
assert.equal(result.history.length, 3);
assert.equal(result.history.filter(h => h.date === today && !h.sessionId).length, 0);
const updatedMorning = result.history.find(h => h.sessionId === 'sess-continued');
assert.equal(updatedMorning.players.find(p => p.name === '민수').score, 9);
assert.ok(result.history.some(h => h.date === prevDate && h.players.find(p => p.name === '민수').score === 1));
const laterGame = result.history.find(h => h.sessionId === 'sess-later');
assert.equal(laterGame.players.find(p => p.name === '민수').score, 11);
assert.equal(laterGame.round, 2);

// 저장본 정리: 같은 날·같은 참가자·가까운 시간은 점수가 달라도 최신 한 줄
const stored = collapseStoredDuplicates([
    { id: morning, date: today, round: 1, players: players(2) },
    { id: morning + 1000, date: today, round: 2, players: players(2) },
    { id: morning + 30 * 60 * 1000, date: today, round: 3, players: players(4) },
    { id: prev, date: prevDate, round: 1, players: players(2) },
    { id: afternoon, date: today, round: 1, sessionId: 'sess-b', players: players(9) },
    { id: afternoon + 1000, date: today, round: 2, sessionId: 'sess-b', players: players(10) }
]);
assert.equal(stored.changed, true);
assert.equal(stored.history.filter(h => h.date === prevDate).length, 1);
assert.equal(stored.history.filter(h => h.sessionId === 'sess-b').length, 1);
assert.equal(stored.history.find(h => h.sessionId === 'sess-b').players.find(p => p.name === '민수').score, 10);
assert.equal(stored.history.filter(h => !h.sessionId && h.date === today).length, 1);
assert.equal(stored.history.find(h => !h.sessionId && h.date === today).players.find(p => p.name === '민수').score, 4);
assert.equal(stored.history.find(h => h.date === prevDate).round, 1);

// 2026-09-30 같은 멤버 세 줄(점수는 서로 다름)은 가장 최근 한 줄만 남긴다
const sep30 = '2026-09-30';
const sep30Start = new Date(2026, 8, 30, 10, 0, 0, 0).getTime();
const sep29 = new Date(2026, 8, 29, 10, 0, 0, 0).getTime();
const sep29Date = localDateString(sep29);
const sep30Cleaned = collapseStoredDuplicates([
    { id: sep30Start, date: sep30, round: 1, players: players(2) },
    { id: sep30Start + 50 * 60 * 1000, date: sep30, round: 2, players: players(5) },
    { id: sep30Start + 100 * 60 * 1000, savedAt: sep30Start + 100 * 60 * 1000, date: sep30, round: 3, players: players(9) },
    { id: sep29, date: sep29Date, round: 1, players: players(2) },
    {
        id: sep30Start + 20 * 60 * 1000,
        date: sep30,
        round: 1,
        players: [{ name: '철수', score: 3, handy: 1, net: 2 }, { name: '영희', score: 4, handy: 8, net: -4 }]
    }
]);
assert.equal(sep30Cleaned.changed, true);
const sep30SameRoster = sep30Cleaned.history.filter(h => h.date === sep30 && h.players.some(p => p.name === '민수'));
assert.equal(sep30SameRoster.length, 1);
assert.equal(sep30SameRoster[0].id, sep30Start + 100 * 60 * 1000);
assert.equal(sep30SameRoster[0].players.find(p => p.name === '민수').score, 9);
assert.equal(sep30SameRoster[0].round, 2);
assert.equal(sep30Cleaned.history.filter(h => h.date === sep29Date).length, 1);
assert.equal(sep30Cleaned.history.find(h => h.date === sep29Date).players.find(p => p.name === '민수').score, 2);
assert.equal(sep30Cleaned.history.filter(h => h.players.some(p => p.name === '철수')).length, 1);

// 3시간 반 차이는 한 경기로 보고, 5시간 차이(아침/저녁)는 따로 둔다
const withinWiden = collapseStoredDuplicates([
    { id: sep30Start, date: sep30, round: 1, players: players(1) },
    { id: sep30Start + 3.5 * 60 * 60 * 1000, date: sep30, round: 2, players: players(7) }
]);
assert.equal(withinWiden.history.length, 1);
assert.equal(withinWiden.history[0].players.find(p => p.name === '민수').score, 7);

const morningAndEvening = collapseStoredDuplicates([
    { id: sep30Start, date: sep30, round: 1, players: players(1) },
    { id: sep30Start + 5 * 60 * 60 * 1000, date: sep30, round: 2, players: players(7) }
]);
assert.equal(morningAndEvening.changed, false);
assert.equal(morningAndEvening.history.length, 2);

// savedAt이 더 최근이면 id가 더 작아도 그 점수를 남긴다
const bySavedAt = collapseStoredDuplicates([
    { id: sep30Start + 2 * 60 * 60 * 1000, savedAt: sep30Start, date: sep30, round: 2, players: players(1) },
    { id: sep30Start, savedAt: sep30Start + 2 * 60 * 60 * 1000, date: sep30, round: 1, players: players(9) }
]);
assert.equal(bySavedAt.history.length, 1);
assert.equal(bySavedAt.history[0].id, sep30Start);
assert.equal(bySavedAt.history[0].players.find(p => p.name === '민수').score, 9);

// 세션이 달라도 같은 멤버·가까운 시간이면 최신 한 줄로 합친다
const distinctSessions = collapseStoredDuplicates([
    { id: morning, date: today, round: 1, sessionId: 'sess-a', players: players(2) },
    { id: soon, date: today, round: 2, sessionId: 'sess-b', players: players(3) }
]);
assert.equal(distinctSessions.changed, true);
assert.equal(distinctSessions.history.length, 1);
assert.equal(distinctSessions.history[0].sessionId, 'sess-b');
assert.equal(distinctSessions.history[0].players.find(p => p.name === '민수').score, 3);

// 세션이 달라도 5시간 이상 떨어지면 아침/저녁 경기로 따로 둔다
const separateSessions = collapseStoredDuplicates([
    { id: morning, date: today, round: 1, sessionId: 'sess-a', players: players(2) },
    { id: afternoon, date: today, round: 2, sessionId: 'sess-b', players: players(8) }
]);
assert.equal(separateSessions.changed, false);
assert.equal(separateSessions.history.length, 2);

// 이미 세션이 있는 경기를 다시 저장해도, 근처에 있는 다른 예전 경기는 남긴다
const sessioned = [{
    id: morning,
    savedAt: morning,
    date: today,
    round: 1,
    sessionId: 'sess-a',
    players: players(2)
}, {
    id: morning - 60 * 60 * 1000,
    date: today,
    round: 2,
    players: players(4)
}];
result = upsertHistory(sessioned, players(6), {
    sessionId: 'sess-a',
    now: soon,
    allowTimeMatch: false
});
assert.equal(result.history.length, 2);
assert.equal(result.history.find(h => h.sessionId === 'sess-a').players.find(p => p.name === '민수').score, 6);
assert.equal(result.history.find(h => !h.sessionId).players.find(p => p.name === '민수').score, 4);

// 입력 배열은 바꾸지 않는다
const original = [{ id: morning, date: today, round: 1, players: players(2) }];
upsertHistory(original, players(9), { sessionId: 'sess-a', now: soon, allowTimeMatch: true });
assert.equal(original[0].players[0].score, 2);
assert.equal(original.length, 1);

console.log('history match tests passed');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
for (const file of ['score.js', 'history-match.js', 'history-stats.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const { GolfScore, GolfStats } = sandbox;
const { summarize, formatPoints, formatWinRate, seoulMonthKey } = GolfStats;

const NOW = Date.parse('2026-10-15T03:00:00Z'); // 서울 2026-10-15 12:00
assert.equal(seoulMonthKey(NOW), '2026-10');
assert.equal(GolfScore.getNetScore(2, -4), 6);
assert.equal(GolfScore.getNetScore(80, 0), 8);

function player(name, score, handy, net) {
    return { name, score, handy, net: net == null ? GolfScore.getNetScore(score, handy) : net };
}

// vm 안에서 만든 배열은 프로토타입이 달라 deepEqual 이 실패한다.
function namesOf(rows) {
    return Array.from(rows, (row) => row.name);
}

function game(date, players, extra = {}) {
    const savedAt = extra.savedAt != null ? extra.savedAt : Date.parse(date + 'T03:00:00Z');
    return {
        id: extra.id != null ? extra.id : savedAt,
        savedAt,
        date,
        round: extra.round || 1,
        sessionId: extra.sessionId,
        players
    };
}

// 스코어는 오버파 - 핸디. 오버파가 더 나빠도 스코어가 낮으면 우승이고, 저장된 net 은 무시한다.
{
    const summary = summarize([
        game('2026-10-15', [
            player('그로스', 80, 0, 999),
            player('오버', 4, 0, 999),
            player('기대밖', 2, -4, 0)
        ])
    ], { now: NOW });
    assert.equal(summary.mvp.name, '오버');
    const gross = summary.rankingMonth.find((row) => row.name === '그로스');
    const expected = summary.rankingMonth.find((row) => row.name === '기대밖');
    assert.equal(gross.wins, 0);
    assert.equal(gross.totalPoints, 8);
    assert.equal(expected.totalPoints, 6);
    assert.equal(summary.mostPlayedMonth.name, '오버');
}

// 스코어가 같으면 핸디가 더 낮은 한 명만 우승. 스코어와 핸디가 모두 같으면 각자 1승.
{
    const summary = summarize([
        game('2026-10-10', [
            player('높은핸디', 8, 2),
            player('낮은핸디', 2, -4)
        ]),
        game('2026-10-11', [
            player('먼저', 3, 1),
            player('나중', 3, 1)
        ])
    ], { now: NOW });
    assert.equal(summary.rankingMonth.find((row) => row.name === '낮은핸디').wins, 1);
    assert.equal(summary.rankingMonth.find((row) => row.name === '높은핸디').wins, 0);
    assert.equal(summary.rankingMonth.find((row) => row.name === '낮은핸디').totalPoints, 6);
    assert.equal(summary.rankingMonth.find((row) => row.name === '높은핸디').totalPoints, 6);
    assert.equal(summary.rankingMonth.find((row) => row.name === '먼저').wins, 1);
    assert.equal(summary.rankingMonth.find((row) => row.name === '나중').wins, 1);
    assert.equal(summary.gamesMonth, 2);
    assert.equal(summary.rankingMonth.reduce((sum, row) => sum + row.wins, 0), 3);
    assert.equal(summary.mvpTieCount, 2);
}

// 같은 +7이라도 핸디가 더 높으면 승이 아니다. 핸디까지 같으면 둘 다 승.
{
    const summary = summarize([
        game('2026-10-15', [
            player('나무', 13, 6),
            player('굿샷', 13, 6),
            player('돌풍', 18, 11)
        ])
    ], { now: NOW });
    assert.equal(summary.rankingMonth.find((row) => row.name === '나무').wins, 1);
    assert.equal(summary.rankingMonth.find((row) => row.name === '굿샷').wins, 1);
    assert.equal(summary.rankingMonth.find((row) => row.name === '돌풍').wins, 0);
    assert.equal(summary.mvpTieCount, 2);
}

// 한 경기 안에서는 같은 이름을 한 번만 세고, 더 좋은 스코어를 쓴다.
{
    const summary = summarize([
        game('2026-10-03', [
            player('버디왕', 9, 0),
            player('이글남', 3, 0),
            player('버디왕', 1, 0)
        ])
    ], { now: NOW });
    const birdie = summary.rankingMonth.find((row) => row.name === '버디왕');
    assert.equal(birdie.games, 1);
    assert.equal(birdie.wins, 1);
    assert.equal(birdie.totalPoints, 1);
    assert.equal(summary.gamesMonth, 1);
}

// 이름 앞뒤 공백은 같은 선수다.
{
    const summary = summarize([
        game('2026-10-03', [player(' 버디왕 ', 1, 0), player('이글남', 4, 0)]),
        game('2026-10-04', [player('버디왕', 2, 0), player('이글남', 5, 0)])
    ], { now: NOW });
    assert.equal(summary.rankingMonth.filter((row) => row.name.trim() === '버디왕').length, 1);
    assert.equal(summary.mvp.name, '버디왕');
    assert.equal(summary.mvp.games, 2);
}

// 같은 날·같은 참가자·4시간 안의 중복은 최신 한 줄만. 4시간이 넘거나 참가자가 다르면 따로 센다.
{
    const start = Date.parse('2026-10-02T01:00:00Z');
    const history = [
        game('2026-10-02', [player('알파', 1, 0), player('브라보', 4, 0)], { savedAt: start, id: start, sessionId: 'old' }),
        game('2026-10-02', [player('브라보', 0, 0), player('알파', 3, 0)], { savedAt: start + 60 * 60 * 1000, id: start + 1, sessionId: 'new' }),
        game('2026-10-02', [player('알파', 2, 0), player('브라보', 5, 0)], { savedAt: start + 5 * 60 * 60 * 1000, id: start + 2, sessionId: 'later' }),
        game('2026-10-02', [player('알파', 8, 0), player('찰리', 1, 0)], { savedAt: start + 30 * 60 * 1000, id: start + 3, sessionId: 'other' })
    ];
    const before = JSON.stringify(history);
    const summary = summarize(history, { now: NOW });
    assert.equal(JSON.stringify(history), before);
    assert.equal(summary.gamesMonth, 3);
    const alpha = summary.rankingMonth.find((row) => row.name === '알파');
    const bravo = summary.rankingMonth.find((row) => row.name === '브라보');
    const charlie = summary.rankingMonth.find((row) => row.name === '찰리');
    assert.equal(bravo.wins, 1);
    assert.equal(alpha.wins, 1);
    assert.equal(charlie.wins, 1);
    assert.equal(alpha.games, 3);
    assert.equal(bravo.games, 2);
    // 중복의 오래된 스코어(알파 1)는 빠지고, 한 시간 뒤 스코어(알파 3)와 다섯 시간 뒤(알파 2), 다른 멤버 경기(알파 8)만 남는다.
    assert.equal(alpha.totalPoints, 3 + 2 + 8);
}

// 같은 세션은 날짜가 달라도 최신 한 경기만 남는다.
{
    const summary = summarize([
        game('2026-09-20', [player('알파', 1, 0), player('브라보', 4, 0)], { sessionId: 'sess-x', savedAt: Date.parse('2026-09-20T03:00:00Z') }),
        game('2026-10-05', [player('브라보', 1, 0), player('알파', 4, 0)], { sessionId: 'sess-x', savedAt: Date.parse('2026-10-05T03:00:00Z') })
    ], { now: NOW });
    assert.equal(summary.gamesAll, 1);
    assert.equal(summary.gamesMonth, 1);
    assert.equal(summary.mvp.name, '브라보');
    assert.equal(summary.rankingAll.find((row) => row.name === '알파').wins, 0);
}

// MVP 는 이번 달 최다 승, 동률이면 평균 스코어, 그래도 같으면 합계 스코어. 다른 달은 빠진다.
{
    const history = [
        game('2026-10-01', [player('알파', 0, 0), player('브라보', 4, 0)]),
        game('2026-10-05', [player('알파', 6, 0), player('브라보', 8, 0)]),
        game('2026-10-08', [player('브라보', 1, 0), player('알파', 3, 0)]),
        game('2026-10-12', [player('찰리', 4, 0), player('델타', 7, 0)]),
        game('2026-10-14', [player('찰리', 6, 0), player('델타', 9, 0)]),
        game('2026-09-28', [player('찰리', -5, 0), player('알파', 9, 0)]),
        game('2026-09-29', [player('찰리', -3, 0), player('알파', 2, 0)])
    ];
    const october = summarize(history, { now: NOW, month: '2026-10' });
    assert.equal(october.mvp.name, '알파');
    assert.equal(october.mvp.wins, 2);
    assert.equal(october.mvp.games, 3);
    assert.equal(october.mvp.avgPoints, 3);
    assert.equal(october.mvp.totalPoints, 9);
    const charlie = october.rankingMonth.find((row) => row.name === '찰리');
    assert.equal(charlie.wins, 2);
    assert.equal(charlie.avgPoints, 5);
    assert.equal(october.isCurrentMonth, true);

    const tiedAverage = summarize([
        game('2026-10-02', [player('에코', 0, 0), player('게스트', 4, 0)]),
        game('2026-10-03', [player('게스트', 1, 0), player('에코', 4, 0)]),
        game('2026-10-04', [player('폭스', 2, 0), player('게스트', 6, 0)])
    ], { now: NOW });
    // 에코 1승 2경기 합계 4 평균 2, 폭스 1승 1경기 합계 2 평균 2 → 합계가 더 낮은 폭스
    assert.equal(tiedAverage.mvp.name, '폭스');
    assert.equal(tiedAverage.mvp.wins, 1);
    assert.equal(tiedAverage.mvp.avgPoints, 2);
    assert.equal(tiedAverage.mvp.totalPoints, 2);
    assert.equal(tiedAverage.mvpTieCount, 1);
}

// 누적 순위는 전체 기간이 기본이고, 선택 월로 거르면 그 달만 남는다. 정렬은 승수 → 평균 스코어.
{
    const history = [
        game('2026-10-01', [player('씨', 1, 0), player('에이', 4, 0)]),
        game('2026-10-02', [player('씨', 1, 0), player('비', 8, 0)]),
        game('2026-10-03', [player('씨', 1, 0), player('에이', 4, 0)]),
        game('2026-09-02', [player('비', 1, 0), player('에이', 3, 0)]),
        game('2026-09-03', [player('비', 2, 0), player('에이', 5, 0)]),
        game('2026-08-19', [player('에이', 1, 0), player('디', 4, 0)]),
        game('2026-08-20', [player('에이', 2, 0), player('디', 4, 0)]),
        game('2026-08-21', [player('에이', 0, 0), player('디', 4, 0)])
    ];
    const summary = summarize(history, { now: NOW });
    assert.deepEqual(namesOf(summary.rankingAll), ['씨', '에이', '비', '디']);
    assert.equal(summary.rankingAll[0].wins, 3);
    assert.equal(summary.rankingAll[0].avgPoints, 1);
    assert.equal(summary.rankingAll[1].wins, 3);
    assert.equal(summary.rankingAll[1].games, 7);
    assert.ok(summary.rankingAll[1].avgPoints > summary.rankingAll[0].avgPoints);
    assert.equal(summary.rankingAll[2].wins, 2);
    assert.deepEqual(namesOf(summary.rankingMonth), ['씨', '에이', '비']);
    assert.equal(summary.rankingMonth.find((row) => row.name === '디'), undefined);

    const september = summarize(history, { now: NOW, month: '2026-09' });
    assert.equal(september.month, '2026-09');
    assert.equal(september.isCurrentMonth, false);
    assert.equal(september.mvp.name, '비');
    assert.equal(september.gamesMonth, 2);
    assert.equal(september.canPrev, true);
    assert.equal(september.canNext, true);
    assert.deepEqual(Array.from(september.months), ['2026-08', '2026-09', '2026-10']);
}

// 날짜 문자열이 있으면 그 달, 없으면 저장 시각을 서울 달력으로 본다.
{
    const seoulNewMonth = Date.parse('2026-09-30T15:30:00Z'); // 서울 2026-10-01 00:30
    assert.equal(seoulMonthKey(seoulNewMonth), '2026-10');
    const summary = summarize([
        { id: seoulNewMonth, savedAt: seoulNewMonth, players: [player('새벽', -1, 0), player('다른', 2, 0)] },
        game('2026-09-30', [player('구월', 0, 0), player('새벽', 3, 0)], { savedAt: seoulNewMonth + 1000 })
    ], { now: NOW });
    assert.equal(summary.mvp.name, '새벽');
    assert.equal(summary.mvp.wins, 1);
    assert.equal(summary.mvp.games, 1);
    const september = summarize([
        { id: seoulNewMonth, savedAt: seoulNewMonth, players: [player('새벽', -1, 0), player('다른', 2, 0)] },
        game('2026-09-30', [player('구월', 0, 0), player('새벽', 3, 0)], { savedAt: seoulNewMonth + 1000 })
    ], { now: NOW, month: '2026-09' });
    assert.equal(september.mvp.name, '구월');
}

// 최다 참여자는 선택 월의 경기 수. 빈 달로 이동할 수 있고, 미래 달은 현재 달로 붙인다.
{
    const history = [
        game('2026-08-19', [player('단골', 4, 0), player('손님', -8, 0)]),
        game('2026-08-20', [player('단골', 1, 0), player('손님', 3, 0)]),
        game('2026-10-15', [player('단골', 2, 0), player('손님', 5, 0)]),
        game('2026-10-12', [player('단골', -3, 0), player('새얼굴', 1, 0)])
    ];
    const summary = summarize(history, { now: NOW });
    assert.equal(summary.mostPlayedMonth.name, '단골');
    assert.equal(summary.mostPlayedMonth.games, 2);
    assert.equal(summary.mostPlayedAll.name, '단골');
    assert.equal(summary.mostPlayedAll.games, 4);
    assert.equal(summary.bestRoundMonth, undefined);

    const emptySeptember = summarize(history, { now: NOW, month: '2026-09' });
    assert.equal(emptySeptember.mvp, null);
    assert.equal(emptySeptember.gamesMonth, 0);
    assert.deepEqual(Array.from(emptySeptember.rankingMonth), []);
    assert.equal(emptySeptember.mostPlayedMonth, null);
    assert.equal(emptySeptember.canPrev, true);
    assert.equal(emptySeptember.canNext, true);

    const clamped = summarize(history, { now: NOW, month: '2026-12' });
    assert.equal(clamped.month, '2026-10');
    assert.equal(clamped.canNext, false);

    const empty = summarize([], { now: NOW });
    assert.equal(empty.mvp, null);
    assert.equal(empty.month, '2026-10');
    assert.deepEqual(Array.from(empty.rankingAll), []);
    assert.equal(empty.gamesAll, 0);
    assert.equal(empty.canPrev, false);
    assert.equal(empty.canNext, false);
}

// 승이 없는 선수도 순위에 남고, 평균 스코어가 더 좋은 쪽이 앞선다.
{
    const summary = summarize([
        game('2026-10-06', [player('찰리', 1, 0), player('알파', 2, 0), player('브라보', 5, 0)])
    ], { now: NOW });
    assert.deepEqual(namesOf(summary.rankingMonth), ['찰리', '알파', '브라보']);
    assert.equal(summary.rankingMonth[1].wins, 0);
    assert.equal(summary.rankingMonth[0].avgPoints, 1);
    assert.equal(summary.rankingMonth[1].avgPoints, 2);
    assert.equal(formatWinRate(1 / 3), '33.3%');
    assert.equal(formatWinRate(0), '0%');
    assert.equal(formatPoints(2, 1), '+2.0');
    assert.equal(formatPoints(-1.25, 1), '-1.3');
    assert.equal(formatPoints(0, 1), '0.0');
    assert.equal(formatPoints(6), '+6');
    assert.equal(formatPoints(-8), '-8');
}

// 이미 합쳐진 기록과, 중복이 섞인 기록을 집계하면 같다.
{
    const start = Date.parse('2026-10-09T02:00:00Z');
    const kept = game('2026-10-09', [player('알파', 2, 0), player('브라보', 5, 0)], { savedAt: start + 60 * 60 * 1000, id: start + 1 });
    const duplicate = game('2026-10-09', [player('브라보', 0, 0), player('알파', 4, 0)], { savedAt: start, id: start });
    const raw = summarize([duplicate, kept], { now: NOW });
    const collapsed = summarize([kept], { now: NOW });
    assert.equal(raw.mvp.name, collapsed.mvp.name);
    assert.equal(raw.mvp.wins, collapsed.mvp.wins);
    assert.equal(raw.gamesMonth, collapsed.gamesMonth);
    assert.equal(raw.mvp.totalPoints, collapsed.mvp.totalPoints);
}

// 승수가 같으면 승률이 높아도 평균 스코어가 더 낮은 사람이 앞선다.
{
    const summary = summarize([
        game('2026-10-01', [player('갑', 5, 0), player('병', 9, 0)]),
        game('2026-10-02', [player('갑', 5, 0), player('병', 8, 0)]),
        game('2026-10-03', [player('을', 0, 0), player('병', 4, 0)]),
        game('2026-10-04', [player('을', 1, 0), player('병', 4, 0)]),
        game('2026-10-05', [player('병', 0, 0), player('을', 3, 0)]),
        game('2026-10-06', [player('병', 0, 0), player('을', 3, 0)])
    ], { now: NOW });
    const names = namesOf(summary.rankingMonth);
    const gap = summary.rankingMonth.find((row) => row.name === '갑');
    const eul = summary.rankingMonth.find((row) => row.name === '을');
    assert.equal(names[0], '을');
    assert.ok(names.indexOf('을') < names.indexOf('갑'));
    assert.equal(gap.wins, 2);
    assert.equal(eul.wins, 2);
    assert.equal(gap.avgPoints, 5);
    assert.equal(eul.avgPoints, (0 + 1 + 3 + 3) / 4);
    assert.ok(gap.winRate > eul.winRate);
}

// 통계 아코디언 기본값. 저장된 값만 덮어쓰고 없는 칸은 기본을 유지한다.
{
    const fresh = GolfStats.normalizePanels(null);
    assert.equal(fresh.root, true);
    assert.equal(fresh.mvp, true);
    assert.equal(fresh.rank, true);
    assert.equal(Object.prototype.hasOwnProperty.call(fresh, 'extra'), false);
    const merged = GolfStats.normalizePanels({ root: false, extra: true, ignored: true, mvp: 'yes' });
    assert.equal(merged.root, false);
    assert.equal(merged.mvp, true);
    assert.equal(merged.rank, true);
    assert.equal(Object.prototype.hasOwnProperty.call(merged, 'extra'), false);
    assert.equal(fresh.root, true);
}

console.log('history stats tests passed');

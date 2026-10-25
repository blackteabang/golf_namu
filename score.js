// ⛳ 스코어 계산 순수 함수 (브라우저 스크립트 / Node 테스트 공용)
// 스코어 = 오늘 오버파 - 핸디캡
// 핸디캡은 파 대비 기대 성적이다. 예: -4 = 4언더 기대. 절대값으로 바꾸지 않는다.
(function (global) {
    function hasScore(player) {
        return !!(player && player.score !== null && player.score !== undefined && player.score !== '' && !isNaN(player.score));
    }

    // 입력값이 40을 넘으면 18홀 그로스(타수)로 보고 72타를 빼 오버파로 변환
    function getOverPar(score) {
        if (score === undefined || score === null || score === '' || isNaN(score)) return 0;
        const num = Number(score);
        return num > 40 ? num - 72 : num;
    }

    function parseHandicap(handy) {
        const handyNum = Number(handy);
        return Number.isNaN(handyNum) ? 0 : handyNum;
    }

    // 스코어(순위·내기 기준) = 오늘 오버파 - 핸디캡
    // 예: 핸디 -4, 오늘 오버파 +2 → 2 - (-4) = +6
    function getNetScore(score, handy) {
        return getOverPar(score) - parseHandicap(handy);
    }

    function formatNet(net) {
        if (net === undefined || net === null || isNaN(net)) return '0';
        net = Number(net);
        if (net > 0) return `+${net}`;
        return `${net}`;
    }

    // 낮은 스코어가 앞선다. 스코어가 같으면 핸디캡이 더 낮은 쪽이 앞선다.
    // 핸디캡은 부호 있는 숫자다. 예: -1 < 4 < 9.
    // 스코어와 핸디캡이 모두 같으면 0이고, 안정 정렬이라 입력 순서가 유지된다.
    function compareRank(a, b, isMidGame) {
        if (isMidGame) {
            const aHasScore = hasScore(a);
            const bHasScore = hasScore(b);
            if (aHasScore && !bHasScore) return -1;
            if (!aHasScore && bHasScore) return 1;
            if (!aHasScore && !bHasScore) return 0;
        }

        const scoreA = getNetScore(a.score, a.handy);
        const scoreB = getNetScore(b.score, b.handy);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return parseHandicap(a.handy) - parseHandicap(b.handy);
    }

    // 공동 순위는 스코어와 핸디캡이 모두 같을 때만. 중간 순위의 미입력은 동점이 아니다.
    function samePlace(a, b, isMidGame) {
        if (isMidGame && (!hasScore(a) || !hasScore(b))) return false;
        return getNetScore(a.score, a.handy) === getNetScore(b.score, b.handy)
            && parseHandicap(a.handy) === parseHandicap(b.handy);
    }

    // compareRank로 정렬된 목록의 대회 순위. 공동이면 같은 번호, 다음 순위는 건너뛴다.
    function competitionRanks(players, isMidGame) {
        const ranks = [];
        for (let i = 0; i < players.length; i++) {
            if (i > 0 && samePlace(players[i], players[i - 1], isMidGame)) ranks.push(ranks[i - 1]);
            else ranks.push(i + 1);
        }
        return ranks;
    }

    function rankPlayers(players, isMidGame) {
        const ordered = (players || []).slice().sort((a, b) => compareRank(a, b, !!isMidGame));
        return { players: ordered, ranks: competitionRanks(ordered, !!isMidGame) };
    }

    global.GolfScore = {
        hasScore,
        getOverPar,
        parseHandicap,
        getNetScore,
        formatNet,
        compareRank,
        samePlace,
        competitionRanks,
        rankPlayers
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);

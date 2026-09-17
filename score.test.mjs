import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(root, 'score.js'), 'utf8');
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
const { GolfScore } = sandbox;

assert.ok(GolfScore, 'GolfScore should load');

const {
    hasScore,
    getOverPar,
    parseHandicap,
    getNetScore,
    formatNet,
    compareRank
} = GolfScore;

// --- 사용자 재현 케이스 (핵심 버그) ---
assert.equal(getNetScore(2, -4), 6, '핸디 -4, 오늘 +2 → 스코어 6');
assert.equal(formatNet(getNetScore(2, -4)), '+6');

// 그로스 타수 입력(74 = 파72 기준 +2)도 같은 스코어가 나와야 함
assert.equal(getOverPar(74), 2);
assert.equal(getNetScore(74, -4), 6);

// --- 핸디캡 부호 ---
assert.equal(getNetScore(2, 0), 2, '핸디 0이면 오버파가 곧 스코어');
assert.equal(getNetScore(2, 18), -16, '양수 핸디: 2 - 18 = -16');
assert.equal(getNetScore(2, 4), -2, '양수 핸디 4: 2 - 4 = -2 (예전 버그와 구분)');
assert.equal(parseHandicap(-4), -4);
assert.equal(parseHandicap('-4'), -4);
assert.equal(parseHandicap(0), 0);
assert.equal(parseHandicap(undefined), 0);

// --- 오늘 언더파 / 이븐파 ---
assert.equal(getNetScore(-5, -4), -1, '오늘 -5, 핸디 -4 → -5 - (-4) = -1');
assert.equal(getNetScore(0, -4), 4, '오늘 이븐(0), 핸디 -4 → 4');
assert.equal(getNetScore(0, 18), -18, '오늘 이븐(0), 핸디 18 → -18');
assert.equal(getNetScore(-3, 10), -13, '오늘 언더파, 양수 핸디');

// --- 0 vs 미입력 ---
assert.equal(hasScore({ score: 0 }), true, '0은 이븐파로 유효한 입력');
assert.equal(hasScore({ score: null }), false);
assert.equal(hasScore({ score: undefined }), false);
assert.equal(hasScore({ score: '' }), false);
assert.equal(hasScore({}), false);
assert.equal(getOverPar(0), 0);
assert.equal(getOverPar(null), 0);

// --- 순위: 낮은 스코어 승리, 동점이면 핸디가 낮은 쪽 ---
const a = { name: 'A', score: 2, handy: -4 }; // net +6
const b = { name: 'B', score: 2, handy: 18 }; // net -16
const ranked = [a, b].sort((x, y) => compareRank(x, y, false));
assert.equal(ranked[0].name, 'B', '스코어가 더 낮은 B가 1등');
assert.equal(ranked[1].name, 'A');

const tieLow = { name: 'lowH', score: 2, handy: -4 }; // net 6
const tieHigh = { name: 'highH', score: 10, handy: 4 }; // net 6
const tied = [tieHigh, tieLow].sort((x, y) => compareRank(x, y, false));
assert.equal(tied[0].name, 'lowH', '동점이면 핸디가 더 낮은(-4) 쪽이 앞선다');

const midEntered = { name: 'entered', score: 8, handy: 0 };
const midEmpty = { name: 'empty', score: null, handy: 0 };
const mid = [midEmpty, midEntered].sort((x, y) => compareRank(x, y, true));
assert.equal(mid[0].name, 'entered', '중간 순위에서는 미입력 선수를 뒤로');

console.log('score tests passed');

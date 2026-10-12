import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

function loadScript(filename, sandbox) {
    const code = fs.readFileSync(path.join(root, filename), 'utf8');
    vm.runInNewContext(code, sandbox, { filename });
}

const sandbox = { globalThis: {}, console };
sandbox.globalThis = sandbox;
loadScript('score.js', sandbox);
loadScript('history-match.js', sandbox);
loadScript('sync-model.js', sandbox);
const { GolfSync, GolfScore, GolfHistory } = sandbox;

assert.ok(GolfSync, 'GolfSync should load');

function jsonEqual(actual, expected, message) {
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);
}

const {
    detectFormat,
    stateFromSnapshot,
    diffUpdates,
    migrationUpdates,
    applyMultiPath,
    encodeRooms,
    decodeRooms,
    remergeOldWrite,
    createSyncClient,
    statusText,
    decideFlush,
    groupRestPatches,
    statesEqual,
    historyKey,
    emptyState,
    WRITE_DEBOUNCE_MS,
    TOAST_MS
} = GolfSync;

assert.equal(WRITE_DEBOUNCE_MS, 500);
assert.ok(TOAST_MS >= 1000 && TOAST_MS <= 2000);

assert.equal(statusText('saving'), '저장 중…');
assert.equal(statusText('saved'), '저장됨 ✓');
assert.equal(statusText('offline'), '오프라인 · 연결되면 저장');
assert.equal(statusText('error'), '저장 실패');

function player(id, name, handy, score, times = {}) {
    return {
        id,
        name,
        handy,
        isActive: true,
        updatedAt: times.updatedAt || 0,
        score: score == null ? null : score,
        scoreUpdatedAt: times.scoreUpdatedAt || 0
    };
}

function state(players, rooms = [], history = [], roomsUpdatedAt = 0) {
    return { players, rooms, history, roomsUpdatedAt };
}

// --- 없는 키는 빈 값 ---
assert.equal(detectFormat(null), 'empty');
assert.equal(detectFormat({ schemaVersion: 2 }).format || detectFormat({ schemaVersion: 2 }), 'new');
const missing = stateFromSnapshot({ schemaVersion: 2, roomsUpdatedAt: 4 });
jsonEqual(missing.state.players, []);
jsonEqual(missing.state.history, []);
jsonEqual(missing.state.rooms, []);

const oldMissing = stateFromSnapshot({ updatedAt: 9 });
assert.equal(oldMissing.format, 'old');
jsonEqual(oldMissing.state.players, []);
jsonEqual(oldMissing.state.history, []);
jsonEqual(oldMissing.state.rooms, []);

// --- 방의 빈 슬롯은 왕복해도 남는다 ---
const rooms = [[11, 12], [], [13]];
jsonEqual(decodeRooms(encodeRooms(rooms)), rooms);
assert.equal(encodeRooms([]), null);

// --- 바뀐 스코어 경로만 쓴다 ---
const acked = state([
    player(1, '민수', -4, null, { updatedAt: 1 }),
    player(2, '지연', 5, null, { updatedAt: 1 })
]);
const edited = state([
    player(1, '민수', -4, 3, { updatedAt: 1, scoreUpdatedAt: 50 }),
    player(2, '지연', 5, null, { updatedAt: 1 })
]);
const scoreOnly = diffUpdates(edited, acked);
jsonEqual(scoreOnly['scores/1'], { score: 3, updatedAt: 50 });
assert.equal(scoreOnly['scores/2'], undefined);
assert.equal(scoreOnly['players/1'], undefined);
assert.equal(scoreOnly['players/2'], undefined);
assert.equal(scoreOnly.schemaVersion, 2);
assert.equal(Object.keys(scoreOnly).some((key) => key === 'players' || key === 'history'), false);

// --- 삭제는 그 경로에 null ---
const removed = state([player(1, '민수', -4, 3, { updatedAt: 1, scoreUpdatedAt: 50 })]);
const deletion = diffUpdates(removed, edited);
assert.equal(deletion['players/2'], null);
assert.equal(deletion['scores/2'], null);
assert.equal(deletion['players/1'], undefined);

// --- 빈 방 전체는 rooms null ---
const withRooms = state(acked.players, [[1, 2]], [], 10);
const clearedRooms = state(acked.players, [], [], 11);
const roomDiff = diffUpdates(clearedRooms, withRooms);
assert.equal(roomDiff.rooms, null);
assert.equal(roomDiff.roomsUpdatedAt, 11);

// --- 기록은 savedAt이 큰 쪽 ---
function historyRecord(id, savedAt, sessionId, score) {
    return {
        id,
        savedAt,
        date: '2026-10-12',
        round: 1,
        sessionId,
        players: [{ name: '민수', score, handy: -4, net: GolfScore.getNetScore(score, -4) }]
    };
}

const older = historyRecord(1, 100, 'sess_a', 2);
const newer = historyRecord(1, 300, 'sess_a', 8);
const historyDiffLocal = state([], [], [newer]);
const historyDiffRemote = state([], [], [older]);
const mergedHistory = GolfSync.mergeRemote(historyDiffLocal, historyDiffRemote, emptyState(), { players: {}, scores: {}, history: {} });
assert.equal(mergedHistory.history.length, 1);
assert.equal(mergedHistory.history[0].savedAt, 300);
assert.equal(historyKey(newer), 'sess_a');

// --- 구형 배열을 한 번에 새 구조로 ---
const legacy = {
    players: [player(1, '민수', -4, 4), player(2, '지연', 5, 7)],
    history: [older],
    rooms: [[1], [2]],
    updatedAt: 80
};
assert.equal(detectFormat(legacy), 'old');
const migrated = migrationUpdates(stateFromSnapshot(legacy).state);
assert.equal(migrated.schemaVersion, 2);
assert.equal(Array.isArray(migrated.players), false);
assert.equal(migrated.players['1'].name, '민수');
assert.equal(migrated.players['1'].score, undefined);
jsonEqual(migrated.scores['1'], { score: 4, updatedAt: 0 });
assert.ok(migrated.history.sess_a || migrated.history[historyKey(older)]);
const roundTrip = stateFromSnapshot(applyMultiPath({}, migrated)).state;
assert.equal(roundTrip.players.length, 2);
assert.equal(roundTrip.players.find((item) => item.id === 1).score, 4);
jsonEqual(roundTrip.rooms, [[1], [2]]);
assert.equal(roundTrip.history[0].sessionId, 'sess_a');

// --- 구버전 전체 덮어쓰기가 새 선수를 지우지 않는다 ---
const lastGood = state(
    [player(1, '민수', -4, 9, { updatedAt: 500, scoreUpdatedAt: 500 }), player(3, '새선수', 1, 2, { updatedAt: 400, scoreUpdatedAt: 400 })],
    [[1, 3]],
    [newer],
    400
);
const oldOverwrite = {
    players: [player(1, '민수', -4, 1)],
    history: [older],
    rooms: [[1]],
    updatedAt: 900
};
const recovered = remergeOldWrite(oldOverwrite, state([player(1, '민수', -4, 9, { updatedAt: 500, scoreUpdatedAt: 500 })]), lastGood);
const recoveredIds = recovered.players.map((item) => item.id).sort();
jsonEqual(recoveredIds, [1, 3]);
assert.equal(recovered.players.find((item) => item.id === 1).score, 9);
assert.equal(recovered.history[0].savedAt, 300);

// REST는 통째 PUT이 아니라 경로별 PATCH
const patches = groupRestPatches(scoreOnly);
assert.ok(patches.every((patch) => patch.method === 'PATCH'));
assert.ok(!JSON.stringify(patches).includes('PUT'));
const scorePatch = patches.find((patch) => patch.path === 'scores');
jsonEqual(scorePatch.body['1'], { score: 3, updatedAt: 50 });
const versionPatch = patches.find((patch) => patch.path === '');
assert.equal(versionPatch.body.schemaVersion, 2);
assert.equal(versionPatch.body.players, undefined);

function memoryDb() {
    const db = {
        data: null,
        listeners: new Set(),
        sets: 0,
        updates: 0,
        subscribe(fn) {
            this.listeners.add(fn);
            fn(this.data);
        },
        async update(updates) {
            this.updates += 1;
            this.data = applyMultiPath(this.data || {}, updates);
            [...this.listeners].forEach((fn) => fn(this.data));
        },
        async set(value) {
            this.sets += 1;
            this.data = value;
            [...this.listeners].forEach((fn) => fn(this.data));
        }
    };
    return db;
}

function bootClient(db, initial) {
    const sync = createSyncClient();
    sync.connected = true;
    const client = {
        sync,
        state: GolfSync.cloneState(initial),
        status: statusText('checking'),
        connected: true,
        async onData(raw) {
            const result = sync.ingest(raw, client.state);
            if (!result || result.deferred) return result;
            client.state = result.state;
            if (result.dirty) await client.flush({ announce: false });
            return result;
        },
        async flush(options = {}) {
            const updates = sync.nextUpdates(client.state);
            const decision = decideFlush(client.connected, updates, !!options.explicit);
            if (decision.action === 'defer') {
                client.status = statusText(decision.status);
                client.deferred = true;
                return decision;
            }
            if (decision.action !== 'write') {
                if (options.explicit) client.status = statusText('saved');
                return decision;
            }
            sync.beginWrite();
            client.status = statusText('saving');
            try {
                await db.update(updates);
                const follow = sync.finishWrite(true, client.state, updates);
                client.status = statusText('saved');
                client.deferred = false;
                if (follow && !follow.deferred) {
                    client.state = follow.state;
                    if (follow.dirty) await client.flush({ announce: false });
                }
                return updates;
            } catch (error) {
                sync.finishWrite(false, client.state, updates);
                client.status = statusText('error');
                throw error;
            }
        }
    };
    db.subscribe((raw) => {
        client.onData(raw);
    });
    return client;
}

// 두 클라이언트가 서로 다른 선수 스코어를 동시에 고쳐도 둘 다 남는다.
{
    const db = memoryDb();
    const seed = state([
        player(1, '민수', -4, null, { updatedAt: 1 }),
        player(2, '지연', 5, null, { updatedAt: 1 })
    ], [[1], [2]], [], 1);
    const clientA = bootClient(db, seed);
    const clientB = bootClient(db, seed);
    await Promise.resolve();
    await Promise.resolve();

    clientA.state.players.find((item) => item.id === 1).score = 3;
    clientA.state.players.find((item) => item.id === 1).scoreUpdatedAt = 1000;
    clientB.state.players.find((item) => item.id === 2).score = 6;
    clientB.state.players.find((item) => item.id === 2).scoreUpdatedAt = 1001;

    const updatesA = clientA.sync.nextUpdates(clientA.state);
    const updatesB = clientB.sync.nextUpdates(clientB.state);
    jsonEqual(updatesA['scores/1'], { score: 3, updatedAt: 1000 });
    assert.equal(updatesA['scores/2'], undefined);
    jsonEqual(updatesB['scores/2'], { score: 6, updatedAt: 1001 });
    assert.equal(updatesB['scores/1'], undefined);

    clientA.sync.beginWrite();
    clientB.sync.beginWrite();
    await db.update(updatesA);
    await db.update(updatesB);
    assert.equal(db.sets, 0, '동시 수정은 set()으로 통째 덮어쓰지 않는다');
    const followA = clientA.sync.finishWrite(true, clientA.state, updatesA);
    const followB = clientB.sync.finishWrite(true, clientB.state, updatesB);
    if (followA && !followA.deferred) clientA.state = followA.state;
    if (followB && !followB.deferred) clientB.state = followB.state;
    if (followA && followA.dirty) await clientA.flush();
    if (followB && followB.dirty) await clientB.flush();

    const scoreOf = (client, id) => client.state.players.find((item) => item.id === id).score;
    assert.equal(scoreOf(clientA, 1), 3);
    assert.equal(scoreOf(clientA, 2), 6);
    assert.equal(scoreOf(clientB, 1), 3);
    assert.equal(scoreOf(clientB, 2), 6);
    assert.equal(stateFromSnapshot(db.data).state.players.find((item) => item.id === 1).score, 3);
    assert.equal(stateFromSnapshot(db.data).state.players.find((item) => item.id === 2).score, 6);
}

// 쓰기가 날아가는 동안 도착한 스냅샷은 버리지 않고, 끝난 뒤에 합친다.
{
    const sync = createSyncClient();
    sync.hydrated = true;
    sync.acked = state([player(1, '민수', -4, null, { updatedAt: 1 })]);
    const local = state([player(1, '민수', -4, 4, { updatedAt: 1, scoreUpdatedAt: 20 })]);
    sync.beginWrite();
    const deferred = sync.ingest({
        schemaVersion: 2,
        players: { 1: { id: 1, name: '민수', handy: -4, isActive: true, updatedAt: 1 }, 2: { id: 2, name: '지연', handy: 5, isActive: true, updatedAt: 8 } },
        scores: { 2: { score: 11, updatedAt: 30 } },
        roomsUpdatedAt: 1
    }, local);
    assert.equal(deferred.deferred, true);
    const follow = sync.finishWrite(true, local, diffUpdates(local, sync.acked));
    assert.equal(follow.deferred, false);
    assert.equal(follow.state.players.find((item) => item.id === 1).score, 4);
    assert.equal(follow.state.players.find((item) => item.id === 2).score, 11);
}

// 삭제가 다른 클라이언트에 전달된다.
{
    const db = memoryDb();
    const seed = state([
        player(1, '민수', -4, 2, { updatedAt: 1, scoreUpdatedAt: 5 }),
        player(2, '지연', 5, 3, { updatedAt: 1, scoreUpdatedAt: 5 })
    ]);
    const clientA = bootClient(db, seed);
    const clientB = bootClient(db, seed);
    await Promise.resolve();
    clientA.sync.tombstonePlayer(2, 2000);
    clientA.state = state(clientA.state.players.filter((item) => item.id !== 2), clientA.state.rooms, clientA.state.history, clientA.state.roomsUpdatedAt);
    await clientA.flush();
    await Promise.resolve();
    assert.equal(clientB.state.players.some((item) => item.id === 2), false);
    assert.equal(clientA.state.players.some((item) => item.id === 2), false);
    assert.equal(db.data.players['2'], undefined);
}

// 오프라인이면 쓰지 않고, 다시 연결되면 저장 상태가 바뀐다.
{
    const db = memoryDb();
    const seed = state([player(1, '민수', -4, null, { updatedAt: 1 })]);
    const client = bootClient(db, seed);
    await Promise.resolve();
    client.connected = false;
    client.state.players[0].score = 8;
    client.state.players[0].scoreUpdatedAt = 70;
    const deferred = await client.flush({ explicit: true });
    assert.equal(deferred.action, 'defer');
    assert.equal(client.status, '오프라인 · 연결되면 저장');
    assert.equal(stateFromSnapshot(db.data).state.players[0].score, null);
    client.connected = true;
    await client.flush({ explicit: true });
    assert.equal(client.status, '저장됨 ✓');
    assert.equal(stateFromSnapshot(db.data).state.players[0].score, 8);
}

// 쓰기 실패는 저장 실패로 구분한다.
{
    const decision = decideFlush(true, { schemaVersion: 2 }, true);
    assert.equal(decision.status, 'saving');
    assert.equal(statusText('error'), '저장 실패');
}

// 스코어 계산과 같은 날 중복 정리는 그대로다.
assert.equal(GolfScore.getNetScore(2, -4), 6);
const otherDay = historyRecord(2, 2000, 'sess_b', 5);
otherDay.players = [{ name: '지연', score: 5, handy: 5, net: 0 }];
const collapsed = GolfHistory.collapseStoredDuplicates([
    historyRecord(1, 1000, 'sess_a', 2),
    otherDay
]);
assert.equal(collapsed.history.length, 2);

// migrateHistory는 바뀐 뒤에만 참이고, 같은 데이터에 다시 하면 거짓이다.
{
    const appSandbox = {
        globalThis: {},
        console,
        document: { addEventListener() {}, getElementById() { return null; } },
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
    };
    appSandbox.globalThis = appSandbox;
    appSandbox.window = appSandbox;
    loadScript('score.js', appSandbox);
    loadScript('history-match.js', appSandbox);
    loadScript('sync-model.js', appSandbox);
    const appCode = fs.readFileSync(path.join(root, 'app.js'), 'utf8') + '\nglobalThis.__app = app;\n';
    vm.runInNewContext(appCode, appSandbox, { filename: 'app.js' });
    const app = appSandbox.__app;
    let syncs = 0;
    app.syncWithServer = () => { syncs += 1; };
    app.queueSync = () => { syncs += 1; };
    app.history = [{
        id: 10,
        savedAt: 10,
        date: '2026-10-12',
        round: 1,
        sessionId: 'sess_m',
        players: [{ name: '민수', score: 2, handy: -4, net: 0 }]
    }, {
        id: 11,
        savedAt: 11,
        date: '2026-09-01',
        round: 1,
        players: [{ name: '옛기록', score: 1, handy: 1, net: 0 }]
    }];
    app.sync = { tombstoneHistory() {} };
    assert.equal(app.migrateHistory(), true);
    assert.equal(app.history.some((record) => record.date === '2026-09-01'), false);
    assert.equal(app.history[0].players[0].net, 6);
    assert.equal(app.migrateHistory(), false);
    assert.equal(syncs, 0, 'migrateHistory는 서버에 바로 쓰지 않는다');
}

console.log('sync-model tests passed');

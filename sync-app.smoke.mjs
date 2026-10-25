// 두 개의 앱 인스턴스가 같은 목 서버를 보며 서로 다른 점수를 고친다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const memory = new Map();
const channels = new Map();

class BroadcastChannel {
    constructor(name) {
        this.name = name;
        this.onmessage = null;
        if (!channels.has(name)) channels.set(name, new Set());
        channels.get(name).add(this);
    }
    postMessage(data) {
        channels.get(this.name).forEach((channel) => {
            if (channel !== this && channel.onmessage) channel.onmessage({ data });
        });
    }
    close() {
        channels.get(this.name).delete(this);
    }
}

const localStorage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); }
};

function element() {
    return {
        addEventListener() {},
        removeEventListener() {},
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        className: '',
        innerHTML: '',
        textContent: '',
        value: '',
        disabled: false,
        focus() {},
        click() {},
        appendChild() {},
        remove() {},
        contains() { return false; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        setAttribute() {},
        getAttribute() { return null; },
        dataset: {}
    };
}

function makeDocument() {
    const elements = {};
    return {
        addEventListener() {},
        createElement() { return element(); },
        getElementById(id) {
            if (!elements[id]) elements[id] = element();
            return elements[id];
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        activeElement: null,
        body: element()
    };
}

function boot(client) {
    const document = makeDocument();
    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        Promise,
        queueMicrotask,
        URLSearchParams,
        BroadcastChannel,
        localStorage,
        document,
        alert() {},
        confirm() { return true; },
        Date,
        Math,
        JSON,
        Number,
        String,
        Object,
        Array,
        isNaN,
        parseInt
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    sandbox.addEventListener = () => {};
    sandbox.scrollTo = () => {};
    sandbox.location = { search: `?mock=1&client=${client}` };
    for (const file of ['score.js', 'history-match.js', 'sync-model.js']) {
        vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
    }
    const appCode = fs.readFileSync(path.join(root, 'app.js'), 'utf8').replace(
        "document.addEventListener('DOMContentLoaded', () => app.init());",
        'globalThis.appRef = app;'
    );
    vm.runInNewContext(appCode, sandbox, { filename: 'app.js' });
    sandbox.app = sandbox.appRef;
    sandbox.app.init();
    sandbox.app._doc = document;
    return sandbox.app;
}

const clientA = boot('a');
const clientB = boot('b');

clientA.playerNameInput.value = '민수';
clientA.playerHandyInput.value = '-4';
clientA.addPlayer();
clientA.playerNameInput.value = '지연';
clientA.playerHandyInput.value = '5';
clientA.addPlayer();
await clientA.flushSync({ explicit: true, announce: true });
await new Promise((resolve) => setTimeout(resolve, 30));

assert.equal(clientB.players.length, 2, '다른 창에 참여자가 보여야 한다');
assert.equal(clientA._doc.getElementById('server-status-text').textContent, '저장됨');
assert.equal(clientA._doc.getElementById('sync-status').className.includes('visible'), true);

clientA.assignRooms();
await clientA.flushSync({ explicit: true });
await new Promise((resolve) => setTimeout(resolve, 30));
assert.ok(clientB.rooms.length > 0, '조 편성이 다른 창에 전달된다');

const aMinsu = clientA.players.find((player) => player.name === '민수');
const bJiyun = clientB.players.find((player) => player.name === '지연');
const writes = Promise.all([
    (async () => {
        clientA.updateScore(aMinsu.id, 4);
        await clientA.flushSync({ explicit: true });
    })(),
    (async () => {
        clientB.updateScore(bJiyun.id, 9);
        await clientB.flushSync({ explicit: true });
    })()
]);
await writes;
await new Promise((resolve) => setTimeout(resolve, 50));

const score = (client, name) => client.players.find((player) => player.name === name).score;
assert.equal(score(clientA, '민수'), 4);
assert.equal(score(clientA, '지연'), 9);
assert.equal(score(clientB, '민수'), 4);
assert.equal(score(clientB, '지연'), 9);
assert.equal(clientA._doc.getElementById('server-status-text').textContent, '저장됨');

const raw = JSON.parse(localStorage.getItem('golf_mock_db_v1'));
assert.equal(raw.schemaVersion, 2);
assert.equal(raw.scores[String(aMinsu.id)].score, 4);
assert.equal(raw.scores[String(bJiyun.id)].score, 9);
assert.equal(Array.isArray(raw.players), false);

clientA.setOnlineForDebug(false);
clientA.updateScore(aMinsu.id, 12);
await clientA.flushSync({ explicit: true });
assert.equal(clientA._doc.getElementById('server-status-text').textContent.includes('오프라인'), false);
assert.equal(JSON.parse(localStorage.getItem('golf_mock_db_v1')).scores[String(aMinsu.id)].score, 4);

clientA.setOnlineForDebug(true);
await clientA.flushSync({ explicit: true });
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(score(clientB, '민수'), 12);
assert.equal(clientA._doc.getElementById('server-status-text').textContent, '저장됨');

clientA.showStep('results');
await clientA.flushSync({ explicit: true });
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(clientA.currentStep, 'results');
assert.equal(clientB.currentStep, 'results', '최종 랭킹 화면이 다른 창에 전달된다');
assert.equal(clientB.gameSessionId, clientA.gameSessionId);

clientA.removePlayer(bJiyun.id);
await clientA.flushSync({ explicit: true });
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(clientB.players.some((player) => player.name === '지연'), false);
assert.equal(JSON.parse(localStorage.getItem('golf_mock_db_v1')).players[String(bJiyun.id)], undefined);

console.log('two-client app smoke passed');

// ========================================================
// 3Dダンジョン探索ロジック (Gameplay)
// ※ 3D描画は components/dungeon/view3d/view3d.js、戦闘は components/dungeon/battle/battle.js、
//    宝箱は components/dungeon/chest/chest.js、キャンプは components/dungeon/camp/camp.js が担当
// ========================================================

// --------------------------------------------------------
// 1. ダンジョンマップデータ定義 (FLOORS)
// --------------------------------------------------------
const FLOORS = {
    'B1F': {
        name: '地下1階',
        map: [
            [1, 1, 1, 1, 1, 1, 1, 1, 1],
            [1, 5, 6, 3, 1, 0, 0, 0, 1], // (1,1) 上り階段: 街へ戻る
            [1, 0, 1, 0, 2, 0, 1, 0, 1],
            [1, 0, 1, 0, 0, 0, 1, 4, 1],
            [1, 0, 1, 1, 1, 0, 1, 0, 1],
            [1, 0, 0, 0, 1, 0, 0, 8, 1], // (7,5) 宝箱
            [1, 1, 1, 1, 1, 1, 1, 1, 1]
        ],
        stairs: {
            '1,1': { isTownExit: true, text: '地上（王都ルミナリア）へ繋がる階段がある。街へ戻りますか？' },
            // guardian: 倒すまで階段を使えない番人 (battle.js の GUARDIAN_TEMPLATES の ID)
            '7,3': { targetFloor: 'B2F', targetX: 1, targetZ: 1, targetDir: 2, text: '地下2階へ降りる階段がある。', guardian: 'tomozo_ghost' }
        },
        chests: {
            '7,5': { trap: 'poison', trapName: '毒針の罠', damage: 8, gold: 60, itemId: 'potion' }
        }
    },
    'B2F': {
        name: '地下2階',
        map: [
            [1, 1, 1, 1, 1, 1, 1, 1, 1],
            [1, 5, 0, 0, 1, 0, 0, 8, 1], // (7,1) 宝箱
            [1, 0, 1, 0, 0, 0, 1, 0, 1],
            [1, 0, 1, 1, 1, 0, 6, 0, 1],
            [1, 0, 0, 0, 0, 0, 0, 7, 1], // (7,4) ボス魔王
            [1, 1, 1, 1, 1, 1, 1, 1, 1]
        ],
        stairs: {
            '1,1': { targetFloor: 'B1F', targetX: 7, targetZ: 3, targetDir: 0, text: '地下1階へ昇る階段がある。' }
        },
        chests: {
            '7,1': { trap: 'crossbow', trapName: '石弓の矢', damage: 14, gold: 180, itemId: 'dagger' }
        }
    }
};

let currentFloorId = 'B1F';
let doors = {};
let items = {};

let player = null;

// 探索画面の選択肢 (共通の「もどる」「やめる」「立ち去る」「完了」は storage.js の COMMON_COMMANDS)
const DUNGEON_COMMANDS = {
    TO_TOWN: '街に戻る',
    STAY: '留まる',
    USE_STAIRS: '階段を使う',
    SKIP_STAIRS: 'つかわない',
    COLLECT_ALL: 'すべて回収する',
    COLLECT_MEMBERS: '遺体のみ回収する',
    COLLECT_LOOT: 'ゴールド・所持品のみ回収',
    RETURN_TO_CAPITAL: '王都へ戻る',
    CONTINUE: '先へ進む',
    CHALLENGE_GUARDIAN: '戦いを挑む',
    TURN_BACK: '引き返す'
};

// --------------------------------------------------------
// 2. フロア構築 (描画は view3d.js、ここではゲーム側の状態を登録)
// --------------------------------------------------------
function loadFloor(floorId) {
    currentFloorId = floorId;
    const mapData = FLOORS[floorId].map;
    const floorChests = FLOORS[floorId].chests || {};

    const defeatedBosses = getDefeatedBossKeys();

    doors = {};
    items = {};
    resetChests();

    for (let z = 0; z < mapData.length; z++) {
        for (let x = 0; x < mapData[z].length; x++) {
            const cell = mapData[z][x];

            if (cell === 7 && defeatedBosses.includes(`${floorId}:${x},${z}`)) {
                // 撃破済みのボスは通路に戻す
                mapData[z][x] = 0;

            } else if (cell === 2) {
                // 扉 (開閉状態のみ保持)
                doors[`${x},${z}`] = { x, z, isOpen: false };

            } else if (cell === 3) {
                // 鍵アイテム (3D非表示、データのみ保持)
                items[`${x},${z}`] = { isPicked: false };

            } else if (cell === 8) {
                // 宝箱 (3D非表示。イベント処理・開封状態は components/dungeon/chest/chest.js)
                registerChest(floorId, x, z, floorChests[`${x},${z}`]);
            }
        }
    }

    DungeonView.buildFloor(mapData);
}

function updateCameraPosition() {
    DungeonView.setCamera(player.gridX, player.gridZ, player.dir);
}

function changeFloor(targetFloorId, startX, startZ, startDir) {
    const floorData = FLOORS[targetFloorId];

    playStairsSE();
    flashScreen();

    loadFloor(targetFloorId);

    player.gridX = startX;
    player.gridZ = startZ;
    player.dir = startDir;
    player.currentFloorId = targetFloorId;
    // 前のフロアの位置へ「後退」しないよう、到着地点を前のマスにしておく
    player.prevGridX = startX;
    player.prevGridZ = startZ;
    updateCameraPosition();

    updateStatusUI();

    saveTempCampPlayer(player);
    showMessage(`${floorData.name} へ到着した。`);
}

// 街へ帰還する
function exitToTown(reason = 'return') {
    if (reason !== 'dead') {
        savePermanentPlayer(player);
    }
    clearTempCampPlayer();
    if (typeof stopBGM === 'function') {
        stopBGM();
    }
    playStairsSE();
    window.location.href = `town.html?reason=${reason}`;
}

// 階段・街への帰還イベントを発動する
function triggerStairs(x = (player ? player.gridX : 1), z = (player ? player.gridZ : 1)) {
    const floorData = FLOORS[currentFloorId];
    if (!floorData || !floorData.stairs) return false;
    const stairInfo = floorData.stairs[`${x},${z}`];
    if (!stairInfo) return false;

    if (stairInfo.guardian && triggerStairGuardian(stairInfo.guardian, x, z)) return true;

    showMessage(stairInfo.text);
    // 街へ戻るかを選ぶときは右下の「＊」を出さない
    showCommands(stairInfo.isTownExit
        ? [DUNGEON_COMMANDS.TO_TOWN, DUNGEON_COMMANDS.STAY]
        : [DUNGEON_COMMANDS.USE_STAIRS, DUNGEON_COMMANDS.SKIP_STAIRS], (choice) => {
        // 消した「＊」を、このあと出るメッセージのために戻しておく
        promptHintEl.innerText = MESSAGES.HINT_CLOSE;
        if (choice === DUNGEON_COMMANDS.TO_TOWN) {
            exitToTown('return');
        } else if (choice === DUNGEON_COMMANDS.USE_STAIRS) {
            changeFloor(
                stairInfo.targetFloor,
                stairInfo.targetX,
                stairInfo.targetZ,
                stairInfo.targetDir
            );
        } else {
            hideMessage();
        }
    }, stairInfo.isTownExit ? '' : MESSAGES.HINT_SELECT);
    return true;
}
window.triggerStairs = triggerStairs;

// 階段の番人 (まだ倒していなければ、挑むか引き返すかを選ばせる。番人の場面を出したら true)
// 撃破はボスと同じく player.defeatedBosses に「フロアID:x,z」(階段の位置) で記録する
function triggerStairGuardian(guardianId, x, z) {
    const key = `${currentFloorId}:${x},${z}`;
    const guardian = window.GUARDIAN_TEMPLATES && GUARDIAN_TEMPLATES[guardianId];
    if (!guardian || getDefeatedBossKeys().includes(key)) return false;

    showMessage(guardian.approachMsg || guardian.encounterMsg);
    showCommands([DUNGEON_COMMANDS.CHALLENGE_GUARDIAN, DUNGEON_COMMANDS.TURN_BACK], (choice) => {
        hideMessage();
        if (choice === DUNGEON_COMMANDS.CHALLENGE_GUARDIAN) {
            triggerGuardianBattle(guardianId, () => {
                const keys = getDefeatedBossKeys();
                if (!keys.includes(key)) keys.push(key);
                saveTempCampPlayer(player);
            });
        } else {
            retreatPlayer(() => {
                showMessage('気づかれないよう、静かにその場を離れた...');
            });
        }
    });
    return true;
}

// --------------------------------------------------------
// 3. UI & メッセージ・コマンド
// --------------------------------------------------------
const messageBox = document.getElementById('message-box');
const messageText = document.getElementById('message-text');
const commandListEl = document.getElementById('command-list');
const promptHintEl = document.getElementById('prompt-hint');
const eventFrameEl = document.getElementById('event-frame');
const eventNameEl = document.getElementById('event-name');
const eventImgEl = document.getElementById('event-img');

// 探索イベントのイラスト (宝箱・鍵など)
const EVENT_IMAGES = {
    chest: { name: '宝箱', img: 'assets/objects/chest.jpg' },
    chestOpen: { name: '宝箱', img: 'assets/objects/chest_open.jpg' },
    key: { name: '扉の鍵', img: 'assets/objects/key.jpg' }
};

// 探索用メッセージボックスのコマンド選択状態
var currentCommands = [];
var selectedIndex = 0;
var onCommandSelect = null;

window.updateStatusUI = updateStatusUI;
function updateStatusUI() {
    const statusBox = document.getElementById('status-box');
    if (!statusBox || !player) return;
    if (!inBattle && Array.isArray(player.partyMembers)) {
        player.partyMembers.forEach(m => {
            delete m.currentBattleAction;
        });
    }
    const floorName = FLOORS[currentFloorId] ? FLOORS[currentFloorId].name : currentFloorId;
    const coordText = `<span>POS: X:${player.gridX} Z:${player.gridZ}</span><span>DIR: ${DIR_ICONS[player.dir]} ${DIR_NAMES[player.dir]}</span>`;
    renderPartyHUD(statusBox, player, `[ ${floorName} ]`, coordText);
}

// 生存メンバー全員に経験値を加算する (リーダーの値は syncPartyLeader でトップレベルへ反映)
function gainExp(amount) {
    (player.partyMembers || []).forEach(m => {
        if (isMemberAlive(m)) m.exp = (m.exp || 0) + amount;
    });
    syncPartyLeader(player, false);
    updateStatusUI();
    saveTempCampPlayer(player);
}

// メンバーの HP を減らす (HP 0 で死亡)。表示更新と保存はしない。与えたダメージ量を返す
function applyMemberDamage(member, amount) {
    if (!member || member.isDead) return 0;
    const oldHp = member.hp;
    member.hp = Math.max(0, member.hp - amount);
    if (member.hp === 0) {
        member.isDead = true;
    }
    return oldHp - member.hp;
}

function damagePartyMember(member, amount) {
    const dealt = applyMemberDamage(member, amount);
    syncPartyLeader(player, false);
    updateStatusUI();
    saveTempCampPlayer(player);
    return dealt;
}

function damagePlayer(amount) {
    // 先頭の生存メンバー（リーダー不在時は先頭生存者）にダメージ
    const livingMember = (player.partyMembers && player.partyMembers.find(isMemberAlive)) || (player.partyMembers ? player.partyMembers[0] : null);
    if (livingMember) {
        damagePartyMember(livingMember, amount);
    } else {
        player.hp = Math.max(0, player.hp - amount);
        if (player.hp === 0) player.isDead = true;
        updateStatusUI();
        saveTempCampPlayer(player);
    }
}


let flashTimeoutId = null;
function flashScreen(isRed = false, colorType = '') {
    const flashOverlay = document.getElementById('flash-overlay');
    if (!flashOverlay) return;
    if (flashTimeoutId) {
        clearTimeout(flashTimeoutId);
        flashTimeoutId = null;
    }
    flashOverlay.classList.remove('flash-active', 'flash-red-active', 'flash-purple-active');
    void flashOverlay.offsetWidth;

    let animClass = 'flash-active';
    let duration = 400;
    if (colorType === 'purple') {
        animClass = 'flash-purple-active';
        duration = 450;
        DungeonView.shake();
    } else if (isRed || colorType === 'red') {
        animClass = 'flash-red-active';
        duration = 450;
        DungeonView.shake();
    }

    flashOverlay.style.background = '';
    flashOverlay.style.display = 'block';
    flashOverlay.classList.add(animClass);

    const cleanUpFlash = () => {
        flashOverlay.classList.remove('flash-active', 'flash-red-active', 'flash-purple-active');
        flashOverlay.style.display = 'none';
        flashOverlay.style.background = 'none';
        if (flashTimeoutId) {
            clearTimeout(flashTimeoutId);
            flashTimeoutId = null;
        }
    };
    flashOverlay.addEventListener('animationend', cleanUpFlash, { once: true });
    flashTimeoutId = setTimeout(cleanUpFlash, duration + 50);
}

// ========================================================
// 3.1 メッセージ履歴システム (20行ログ)
// ========================================================
const MAX_LOG_CAPACITY = 100;
const LOG_DISPLAY_LINES = 20; // 画面表示行数 (20行)
const messageHistoryLogs = [];
let isMessageHistoryMinimized = false;


function addMessageLog(text, category = 'normal') {
    if (!text) return;
    const rawLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    rawLines.forEach(line => {
        if (line.startsWith('▼') || line.includes('[Space]/[Enter]')) return;

        let cat = category;
        if (line.includes('ダメージ') || line.includes('力尽き') || line.includes('毒針') || line.includes('石弓') || line.includes('痛烈') || line.includes('壁だ')) {
            cat = 'damage';
        } else if (line.includes('回復') || line.includes('蘇生') || line.includes('浄化') || line.includes('ヒール') || line.includes('癒やし')) {
            cat = 'heal';
        } else if (line.includes('【') || line.includes('★') || line.includes('獲得') || line.includes('宝箱') || line.includes('鍵') || line.includes('出現')) {
            cat = 'important';
        }

        messageHistoryLogs.push({ text: line, cat: cat, time: Date.now() });
        if (messageHistoryLogs.length > MAX_LOG_CAPACITY) {
            messageHistoryLogs.shift();
        }
    });

    renderMessageHistory();
}

function renderMessageHistory() {
    const listEl = document.getElementById('message-history-list');
    const bodyEl = document.getElementById('message-history-body');
    if (!listEl) return;

    // 最新20行を取得
    const displayLogs = messageHistoryLogs.slice(-LOG_DISPLAY_LINES);

    // 行数が20行未満の場合は空行で埋めて「ちょうど20行の枠」を美しく保持
    let html = '';
    const emptyCount = Math.max(0, LOG_DISPLAY_LINES - displayLogs.length);
    for (let i = 0; i < emptyCount; i++) {
        html += `<div class="log-entry log-empty">~</div>`;
    }

    displayLogs.forEach((item, idx) => {
        const isLatest = (idx === displayLogs.length - 1);
        let extraClass = '';
        if (isLatest) extraClass += ' log-latest';
        if (item.cat === 'damage') extraClass += ' log-damage';
        else if (item.cat === 'heal') extraClass += ' log-heal';
        else if (item.cat === 'important') extraClass += ' log-important';

        html += `<div class="log-entry${extraClass}">${escapeHtml(item.text)}</div>`;
    });

    listEl.innerHTML = html;

    // 常に最新（最下部）に自動スクロール
    if (bodyEl) {
        bodyEl.scrollTop = bodyEl.scrollHeight;
    }
}

function toggleMessageHistory() {
    const bodyEl = document.getElementById('message-history-body');
    const btnEl = document.getElementById('log-toggle-btn');
    if (!bodyEl || !btnEl) return;

    isMessageHistoryMinimized = !isMessageHistoryMinimized;
    if (isMessageHistoryMinimized) {
        bodyEl.style.display = 'none';
        btnEl.innerText = '[+]';
    } else {
        bodyEl.style.display = 'block';
        btnEl.innerText = '[-]';
        renderMessageHistory();
    }
}
window.toggleMessageHistory = toggleMessageHistory;

let lastActionTime = 0;
const INPUT_COOLDOWN_MS = GAME_RULES.input.cooldownMs;

function showMessage(text) {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    player.isEventActive = true;
    messageText.innerText = text;
    messageBox.style.display = 'flex';
    messageBox.scrollTop = messageBox.scrollHeight;
    requestAnimationFrame(() => {
        messageBox.scrollTop = messageBox.scrollHeight;
    });
    addMessageLog(text);
}

// メッセージボックスの上にイベントのイラストを表示する (hideMessage で消える)
function showEventImage(imageId) {
    const def = EVENT_IMAGES[imageId];
    if (!def || !eventFrameEl) return;
    eventNameEl.innerText = def.name;
    eventImgEl.src = def.img;
    eventImgEl.alt = def.name;
    eventFrameEl.style.display = 'flex';
}

function hideEventImage() {
    if (eventFrameEl) eventFrameEl.style.display = 'none';
}

function hideMessage() {
    if (typeof isWipingOut !== 'undefined' && isWipingOut) return;
    lastActionTime = performance.now();
    playCancelSE();
    messageBox.style.display = 'none';
    hideEventImage();
    player.isEventActive = false;
    currentCommands = [];
    onCommandSelect = null;
    commandListEl.style.display = 'none';
    commandListEl.innerHTML = '';
    if (!isMoveAnimating) player.isMoving = false;
    if (typeof playBGM === 'function') {
        playBGM('dungeon');
    }

    // 探索中にパーティ全員が力尽きていた場合は全滅イベントを起動
    const living = (player.partyMembers || []).filter(isMemberAlive);
    if (living.length === 0 && (player.partyMembers || []).length > 0) {
        triggerPartyWipeout(["パーティ全員が力尽きてしまった..."]);
    }
}

// hint: ウィンドウ右下の案内 (空文字なら何も出さない)
function showCommands(options, onSelectCallback, hint = MESSAGES.HINT_SELECT) {
    currentCommands = options;
    selectedIndex = 0;
    onCommandSelect = onSelectCallback;
    // 階層メニュー（二階層目等）が表示された際、直前の決定クールダウンで操作がブロックされないようリセット
    lastActionTime = 0;

    commandListEl.innerHTML = '';
    options.forEach((opt, index) => {
        const item = document.createElement('div');
        item.className = `command-item ${index === 0 ? 'selected' : ''}`;
        item.innerHTML = '<span class="cursor">▶</span><span></span>';
        item.lastElementChild.textContent = opt; // 選択肢 (冒険者名を含む) は文字列として表示
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedIndex = index;
            confirmCommand();
        });
        commandListEl.appendChild(item);
    });

    commandListEl.style.display = 'flex';
    promptHintEl.innerText = hint;

    // コマンド一覧追加でメッセージボックスの高さが増加するため、最下部までスクロール
    messageBox.scrollTop = messageBox.scrollHeight;
    requestAnimationFrame(() => {
        messageBox.scrollTop = messageBox.scrollHeight;
    });
}

window.updateCommandSelection = updateCommandSelection;
function updateCommandSelection(delta) {
    if (currentCommands.length === 0 || !commandListEl) return;
    playCursorSE();

    const items = commandListEl.querySelectorAll('.command-item');
    if (items.length > 0 && items[selectedIndex]) {
        items[selectedIndex].classList.remove('selected');
        selectedIndex = (selectedIndex + delta + currentCommands.length) % currentCommands.length;
        items[selectedIndex].classList.add('selected');

        if (typeof items[selectedIndex].scrollIntoView === 'function') {
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }
}

function confirmCommand() {
    if (!onCommandSelect || currentCommands.length === 0) return;
    lastActionTime = performance.now();
    playConfirmSE();

    const selectedValue = currentCommands[selectedIndex];
    if (commandListEl) {
        commandListEl.style.display = 'none';
        commandListEl.innerHTML = '';
    }
    currentCommands = [];

    const callback = onCommandSelect;
    onCommandSelect = null;
    callback(selectedValue);
}

function openFieldMagicMenu() {
    if (player.isMoving || player.isEventActive || inBattle || isCampOpen) return;

    const fieldSpells = SPELLS.filter(s => s.fieldUsable);
    if (fieldSpells.length === 0) return;

    const spell = fieldSpells[0]; // ヒール

    // 詠唱可能な術士（僧侶・司祭）の探索
    const casters = player.partyMembers.filter(m => canCastSpell(m, spell));
    if (casters.length === 0) {
        initAudio();
        playTone(180, 'sawtooth', 0.15, 0.2);
        showMessage(MESSAGES.noCasterAvailable(spell));
        promptHintEl.innerText = MESSAGES.HINT_CLOSE;
        return;
    }

    const caster = casters[0];
    showMessage(`【神聖魔法: ${spell.name}】 (術士: ${caster.name} 残り${getSpellUses(caster, spell.id)}/${getSpellMaxUses(caster, spell.id)}回)\n回復する対象の仲間を選んでください。`);

    const targetOptions = player.partyMembers.map((m, idx) => {
        const rowTag = getRowLabel(idx, true);
        const condition = getMemberCondition(m);
        const st = condition === 'good' ? '' : `[${MEMBER_CONDITION_LABELS[condition]}]`;
        return `${idx + 1}.${m.name} (${rowTag} H:${m.hp}/${m.maxHp} ${st})`;
    });
    targetOptions.push(COMMON_COMMANDS.CANCEL);

    showCommands(targetOptions, (choice) => {
        if (choice === COMMON_COMMANDS.CANCEL) {
            hideMessage();
            return;
        }

        const selectedIdx = targetOptions.indexOf(choice);
        if (selectedIdx < 0 || selectedIdx >= player.partyMembers.length) {
            hideMessage();
            return;
        }

        const target = player.partyMembers[selectedIdx];
        if (!isMemberAlive(target)) {
            playTone(180, 'sawtooth', 0.15, 0.2);
            showMessage(MESSAGES.CANNOT_HEAL_DEAD);
            promptHintEl.innerText = MESSAGES.HINT_CLOSE;
            return;
        }

        if (target.hp >= target.maxHp) {
            playTone(200, 'triangle', 0.1, 0.15);
            showMessage(MESSAGES.HP_ALREADY_FULL);
            promptHintEl.innerText = MESSAGES.HINT_CLOSE;
            return;
        }

        // 詠唱実行
        consumeSpellUse(caster, spell.id);
        const oldHp = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + spell.power);
        const healed = target.hp - oldHp;

        playMagicSE();
        syncPartyLeader(player, false);
        saveTempCampPlayer(player);
        updateStatusUI();

        showMessage(`${caster.name} は${spell.name}を唱えた！\n『${target.name}』のHPが ${healed} 回復した！`);
        promptHintEl.innerText = MESSAGES.HINT_CLOSE;
    });
}

function openDoor(door, onComplete) {
    playDoorOpenSE();
    addMessageLog("重い扉を押し開けた。");
    door.isOpen = true;
    DungeonView.animateDoorOpen(door.x, door.z, onComplete);
}

// 撃破済みボス (player.defeatedBosses に「フロアID:x,z」で記録。一度倒したボスは復活しない)
function getDefeatedBossKeys() {
    if (!Array.isArray(player.defeatedBosses)) player.defeatedBosses = [];
    return player.defeatedBosses;
}

window.clearBoss = clearBoss;
function clearBoss(bossX, bossZ) {
    FLOORS[currentFloorId].map[bossZ][bossX] = 0;
    const keys = getDefeatedBossKeys();
    const key = `${currentFloorId}:${bossX},${bossZ}`;
    if (!keys.includes(key)) keys.push(key);
    saveTempCampPlayer(player);
}

let isWipingOut = false;

// ========================================================
// パーティ全滅処理 (戦闘・毒・罠共通)
// ========================================================
function triggerPartyWipeout(roundLogs = []) {
    try {
        isWipingOut = true;
        clearAllActionBadges();
        currentCommands = [];
        onCommandSelect = null;
        if (typeof hideBattleMessage === 'function') hideBattleMessage();
        if (typeof hideBattleCommands === 'function') hideBattleCommands();
        if (commandListEl) {
            commandListEl.style.display = 'none';
            commandListEl.innerHTML = '';
        }
        if (typeof hideMonsterFrame === 'function') hideMonsterFrame();
        hideEventImage();
        inBattle = false;
        if (player) {
            player.isMoving = false;
            player.isEventActive = true;
        }
        if (typeof stopBGM === 'function') {
            stopBGM();
        }

        // 1. 全滅地点に遺体・装備品・所持品・所持金を記録
        const floorId = (typeof currentFloorId !== 'undefined' ? currentFloorId : null) || (player && player.currentFloorId) || 'B1F';
        const gx = (player && player.gridX !== undefined) ? player.gridX : 1;
        const gz = (player && player.gridZ !== undefined) ? player.gridZ : 1;
        const wipedMembers = (player && player.partyMembers ? player.partyMembers : []).map(m => {
            const copy = Object.assign({}, m);
            copy.hp = 0;
            copy.isDead = true;
            delete copy.currentBattleAction;
            delete copy.lastBattleAction;
            return copy;
        });

        const corpseEntry = {
            id: 'corpse_' + Date.now(),
            floorId: floorId,
            x: gx,
            z: gz,
            wipedAt: Date.now(),
            gold: (player && player.gold) || 0,
            items: (player && Array.isArray(player.inventory)) ? [...player.inventory] : [],
            unidentified: (player && Array.isArray(player.unidentified)) ? [...player.unidentified] : [],
            members: wipedMembers
        };
        if (typeof addCorpse === 'function') {
            addCorpse(corpseEntry);
        }

        // 名簿側の該当メンバーも死亡状態に更新
        if (typeof syncPartyWithRoster === 'function') {
            syncPartyWithRoster(wipedMembers);
        }

        // 2. プレイヤー状態をパーティ0人・所持品0にして永続保存
        if (player) {
            player.partyMembers = [];
            player.gold = 0;
            player.inventory = [];
            player.unidentified = [];
            player.hasKey = false;
            player.isDead = false;
            player.isPoisoned = false;
            player.currentFloorId = 'B1F';
            player.gridX = 1;
            player.gridZ = 1;
            player.dir = 2; // 南向き
        }

        if (typeof clearTempCampPlayer === 'function') {
            clearTempCampPlayer();
        }
        if (typeof savePermanentPlayer === 'function') {
            savePermanentPlayer(player);
        }

        const wipeoutText = (roundLogs && roundLogs.length > 0 ? roundLogs.join('\n\n') + '\n\n' : '')
            + 'パーティの全冒険者が力尽き、迷宮の深い闇へと呑み込まれた...\n'
            + `遺体と装備品は迷宮の深部【${floorId} (${gx}, ${gz})】に横たわったままだ。\n\n`
            + '王都の酒場で新たな冒険者を編成し、\n'
            + '救助隊を結成して遺体の回収に向かってください。';
        
        if (typeof showMessage === 'function') {
            showMessage(wipeoutText);
        }
        // 王都へ戻る選択肢では右下の「＊」を出さない
        if (typeof showCommands === 'function') {
            showCommands([DUNGEON_COMMANDS.RETURN_TO_CAPITAL], () => {
                window.location.href = 'town.html?reason=wiped';
            }, '');
        }
    } catch (err) {
        console.error('全滅処理中にエラーが発生しました:', err);
        alert('パーティは全滅しました。地上へ帰還します。');
        // 中断セーブが残っていると街からダンジョンへ戻されるため、確実に破棄する
        if (typeof clearTempCampPlayer === 'function') {
            clearTempCampPlayer();
        }
        window.location.href = 'town.html?reason=wiped';
    }
}

// ========================================================
// 遭難者の遺体・遺留品発見・回収イベント
// ========================================================
function triggerCorpseEvent(corpse) {
    if (!corpse) return;
    player.isEventActive = true;
    player.isMoving = false;

    // 発見SE音
    playTone([330, 260], 'sine', 0.2, 0.4);

    // 遺体・遺留金・遺留品がすべて無くなった現場か
    const hasCorpseItems = (c) => (c.items && c.items.length > 0) || (c.unidentified && c.unidentified.length > 0);
    const isCorpseEmpty = (c) => (!c.members || c.members.length === 0) && !c.gold && !hasCorpseItems(c);
    // 遺留品の表示 (未鑑定の武具は「武器？」「防具？」)
    const getCorpseItemsText = (c) => [
        ...(c.items || []).map(it => getItemDef(it) ? getItemDef(it).name : it),
        ...(c.unidentified || []).map(getUnidentifiedName)
    ].join('、');

    const updateEventView = () => {
        const currentCorpse = (typeof loadCorpses === 'function' ? loadCorpses() : []).find(c => c.id === corpse.id);
        if (!currentCorpse || isCorpseEmpty(currentCorpse)) {
            if (typeof removeCorpse === 'function') removeCorpse(corpse.id);
            savePermanentPlayer(player);
            player.isEventActive = false;
            hideMessage();
            return;
        }

        const party = player.partyMembers || [];
        const freeSlots = Math.max(0, GAME_RULES.party.maxSize - party.length);
        const memberCount = currentCorpse.members ? currentCorpse.members.length : 0;
        const goldCount = currentCorpse.gold || 0;
        const hasItems = hasCorpseItems(currentCorpse);

        let msg = `【 遭難現場の痕跡を発見 】\n`;
        msg += `冷たい石畳の上に、以前ここで力尽きた冒険者の遺体と遺留品が横たわっている...\n\n`;

        if (memberCount > 0) {
            msg += `■ 遺体 (${memberCount}体):\n`;
            currentCorpse.members.forEach(m => {
                const jobName = m.className || m.job || '冒険者';
                msg += `  ・${m.name} (${jobName} Lv.${m.level}) [死亡]\n`;
            });
        } else {
            msg += `■ 遺体: なし (回収済み)\n`;
        }

        if (goldCount > 0) {
            msg += `■ 遺留金: ${goldCount} G\n`;
        }
        if (hasItems) {
            msg += `■ 遺留品: ${getCorpseItemsText(currentCorpse)}\n`;
        }

        msg += `\n(救助隊の現在人数: ${party.length}/${GAME_RULES.party.maxSize}名、遺体収容の空き枠: ${freeSlots}名)`;

        showMessage(msg);

        const options = [];

        // 遺体と遺品をすべて回収
        if ((memberCount > 0 && freeSlots > 0) || goldCount > 0 || hasItems) {
            options.push(DUNGEON_COMMANDS.COLLECT_ALL);
        }

        // 遺体のみ回収（空き枠がある場合）
        if (memberCount > 0 && freeSlots > 0) {
            options.push(DUNGEON_COMMANDS.COLLECT_MEMBERS);
        }

        // 遺留品・ゴールドのみ回収
        if (goldCount > 0 || hasItems) {
            options.push(DUNGEON_COMMANDS.COLLECT_LOOT);
        }

        options.push(COMMON_COMMANDS.LEAVE);

        showCommands(options, (choice) => {
            if (choice === DUNGEON_COMMANDS.COLLECT_ALL) {
                handleCollectAll(currentCorpse, freeSlots);
            } else if (choice === DUNGEON_COMMANDS.COLLECT_MEMBERS) {
                handleCollectMembers(currentCorpse, freeSlots);
            } else if (choice === DUNGEON_COMMANDS.COLLECT_LOOT) {
                handleCollectLoot(currentCorpse);
            } else {
                player.isEventActive = false;
                hideMessage();
            }
        });
    };

    // 遺留金・遺留品を回収する
    const collectLoot = (currentCorpse, logs) => {
        if (currentCorpse.gold > 0) {
            player.gold = (player.gold || 0) + currentCorpse.gold;
            logs.push(`・遺留金 ${currentCorpse.gold} G を回収しました。(所持金: ${player.gold} G)`);
            currentCorpse.gold = 0;
        }

        if (hasCorpseItems(currentCorpse)) {
            const itemNames = getCorpseItemsText(currentCorpse);
            const items = currentCorpse.items || [];
            if (!Array.isArray(player.inventory)) player.inventory = [];
            if (!Array.isArray(player.unidentified)) player.unidentified = [];
            player.inventory.push(...items);
            player.unidentified.push(...(currentCorpse.unidentified || []));
            if (items.includes('key')) {
                player.hasKey = true;
            }
            logs.push(`・遺留品【${itemNames}】を回収しました。`);
            currentCorpse.items = [];
            currentCorpse.unidentified = [];
        }
    };

    // 救助隊の空き枠に遺体を収容する (教会で蘇生可能)
    const collectMembers = (currentCorpse, freeSlots, logs) => {
        if (!currentCorpse.members || currentCorpse.members.length === 0) return;
        if (freeSlots <= 0) {
            logs.push(`※ 救助隊が満員 (${GAME_RULES.party.maxSize}名) のため、遺体を収容できませんでした。街で編成を見直して再訪してください。`);
            return;
        }

        const canTake = Math.min(freeSlots, currentCorpse.members.length);
        const taken = currentCorpse.members.splice(0, canTake);
        taken.forEach(m => {
            m.hp = 0;
            m.isDead = true;
            player.partyMembers.push(m);
        });
        syncPartyWithRoster(player.partyMembers);
        logs.push(`・救助隊の空き枠に【${taken.map(m => m.name).join('、')}】の遺体を収容しました。(教会で蘇生可能)`);
        if (currentCorpse.members.length > 0) {
            logs.push(`※ 救助隊が満員のため、残り ${currentCorpse.members.length} 体の遺体はその場に残っています。`);
        }
    };

    // 回収結果を保存して表示する (空になった現場は消す)。「完了」で現場に何か残っていれば再び現場の画面へ
    const finishCollection = (currentCorpse, logs, clearedText) => {
        if (isCorpseEmpty(currentCorpse)) {
            if (typeof removeCorpse === 'function') removeCorpse(currentCorpse.id);
            logs.push(`\n★ ${clearedText}(現場の💀印消滅)`);
        } else {
            if (typeof updateCorpse === 'function') updateCorpse(currentCorpse);
        }

        savePermanentPlayer(player);
        updateStatusUI();

        showMessage(logs.join('\n'));
        showCommands([COMMON_COMMANDS.DONE], () => {
            if (typeof getCorpseAt === 'function' && getCorpseAt(currentFloorId, player.gridX, player.gridZ)) {
                updateEventView();
            } else {
                player.isEventActive = false;
                hideMessage();
            }
        });
    };

    const handleCollectAll = (currentCorpse, freeSlots) => {
        playItemGetSE();
        const logs = [];
        collectLoot(currentCorpse, logs);
        collectMembers(currentCorpse, freeSlots, logs);
        finishCollection(currentCorpse, logs, '現場のすべての遺体と遺品を回収しました！');
    };

    const handleCollectMembers = (currentCorpse, freeSlots) => {
        playItemGetSE();
        const logs = [];
        collectMembers(currentCorpse, freeSlots, logs);
        finishCollection(currentCorpse, logs, '現場のすべての遺体と遺品を回収しました！');
    };

    const handleCollectLoot = (currentCorpse) => {
        playItemGetSE();
        const logs = [];
        collectLoot(currentCorpse, logs);
        finishCollection(currentCorpse, logs, '現場のすべての遺品を回収しました！');
    };

    updateEventView();
}

// --------------------------------------------------------
// 4. プレイヤー移動
// --------------------------------------------------------
// 歩行・扉の開放・壁への衝突のアニメ中フラグ。
// この間はメッセージを閉じても移動中のまま (hideMessage が isMoving を解除しない) にし、移動が二重に走るのを防ぐ
let isMoveAnimating = false;

function movePlayer(forward) {
    if (player.isMoving || player.isEventActive) return;

    const mapData = FLOORS[currentFloorId].map;
    const [dx, dz] = DIR_OFFSET[player.dir];
    const step = forward ? 1 : -1;
    const targetX = player.gridX + dx * step;
    const targetZ = player.gridZ + dz * step;

    const tileType = mapData[targetZ] ? mapData[targetZ][targetX] : 1;

    const executeMove = (onComplete) => {
        player.isMoving = true;
        isMoveAnimating = true;
        playStepSE();

        player.prevGridX = player.gridX;
        player.prevGridZ = player.gridZ;

        DungeonView.animateStep(targetX, targetZ, () => {
            player.gridX = targetX;
            player.gridZ = targetZ;
            player.isMoving = false;
            isMoveAnimating = false;

            updateStatusUI();
            saveTempCampPlayer(player); // ブラウザを閉じてもこのマスから再開できるよう、一歩ごとに中断セーブ

            // 到着後の処理 (遺体の検知 → マスのイベント / エンカウント)
            const continueArrival = () => {
                // 遭難者の遺体マス検知
                // ボス・罠・宝箱のマスはイベントを優先し、遺体はイベント後に [Space/Enter] で調べる
                const corpse = (typeof getCorpseAt === 'function') ? getCorpseAt(currentFloorId, player.gridX, player.gridZ) : null;
                const isHazardTile = (tileType === 6 || tileType === 7 || tileType === 8);
                if (corpse && !isHazardTile) {
                    triggerCorpseEvent(corpse);
                    return;
                }
                if (corpse) {
                    addMessageLog(MESSAGES.CORPSE_AT_FEET);
                }

                if (onComplete) onComplete();
                else checkEncounter();
            };

            // 毒状態のスリップダメージ判定 (毒に冒されたメンバーごとに一歩ごとに GAME_RULES.dungeon.poisonStepDamage)
            // 全員分のダメージを先に与え、同期・表示更新・保存は1回だけ行う
            const poisonedMembers = (player.partyMembers || []).filter(m => m.isPoisoned && isMemberAlive(m));
            if (poisonedMembers.length > 0) {
                poisonedMembers.forEach(m => applyMemberDamage(m, GAME_RULES.dungeon.poisonStepDamage));
                syncPartyLeader(player, false);
                updateStatusUI();
                saveTempCampPlayer(player);
                flashScreen(false, 'purple');
                playTone(160, 'sawtooth', 0.08, 0.18);

                const living = (player.partyMembers || []).filter(isMemberAlive);
                if (living.length === 0) {
                    triggerPartyWipeout(["全身を巡る激毒に耐えきれず、パーティは力尽きてしまった..."]);
                    return;
                }

                // 毒で倒れた仲間がいれば知らせ、閉じてから到着後の処理へ進む
                const poisonDeaths = poisonedMembers.filter(m => m.isDead);
                if (poisonDeaths.length > 0) {
                    const names = poisonDeaths.map(m => `『${m.name}』`).join('、');
                    showMessage(`全身を巡る毒に耐えきれず、${names} は力尽きてしまった...\n(教会で蘇生できます)`);
                    showCommands([DUNGEON_COMMANDS.CONTINUE], () => {
                        hideMessage();
                        continueArrival();
                    });
                    return;
                }
            }

            continueArrival();
        });
    };

    if (tileType === 0) {
        executeMove();
    } else if (tileType === 8) {
        executeMove(() => {
            triggerChestEvent(targetX, targetZ);
        });
    } else if (tileType === 7) {
        executeMove(() => {
            triggerBossBattle(targetX, targetZ);
        });
    } else if (tileType === 6) {
        executeMove(() => {
            flashScreen(true);
            playDamageSE();

            const { pitTrapDamageMin, pitTrapDamageMax } = GAME_RULES.dungeon;
            const trapDamage = Math.floor(Math.random() * (pitTrapDamageMax - pitTrapDamageMin + 1)) + pitTrapDamageMin;
            damagePlayer(trapDamage);

            const living = (player.partyMembers || []).filter(isMemberAlive);
            if (living.length === 0) {
                triggerPartyWipeout([`罠が発動した！\n落とし穴に落ちて ${trapDamage} のダメージを受け、パーティは力尽きてしまった...`]);
                return;
            }

            showMessage(`罠が発動した！\n落とし穴に落ちて ${trapDamage} のダメージを受けた！`);
        });
    } else if (tileType === 3) {
        const item = items[`${targetX},${targetZ}`];
        executeMove(() => {
            if (item && !item.isPicked) {
                item.isPicked = true;
                player.hasKey = true;
                if (!Array.isArray(player.inventory)) player.inventory = [];
                if (!player.inventory.includes('key')) player.inventory.push('key');
                playItemGetSE();
                saveTempCampPlayer(player);
                showEventImage('key');
                showMessage("『扉の鍵』を手に入れた！\n(キャンプの [もちもの] に追加されました)");
            } else {
                checkEncounter();
            }
        });
    } else if (tileType === 2) {
        const door = doors[`${targetX},${targetZ}`];
        if (door && !door.isOpen) {
            if (player.hasKey) {
                player.isMoving = true;
                isMoveAnimating = true;
                showMessage("鍵を使って扉を開けた！");
                openDoor(door, () => {
                    executeMove();
                });
            } else {
                bumpPlayer(forward);
                showMessage("扉には鍵がかかっている...\nどこかに鍵があるようだ。");
            }
        } else {
            executeMove();
        }
    } else if (tileType === 4 || tileType === 5) {
        executeMove(() => {
            if (!triggerStairs(targetX, targetZ)) {
                checkEncounter();
            }
        });
    } else {
        bumpPlayer(forward);
    }
}

function bumpPlayer(forward) {
    if (player.isMoving || player.isEventActive) return;
    player.isMoving = true;
    isMoveAnimating = true;
    playBumpSE();
    addMessageLog("石壁だ！ これ以上は進めない。");

    const [dx, dz] = DIR_OFFSET[player.dir];
    const step = forward ? 1 : -1;

    DungeonView.animateBump(dx * step, dz * step, () => {
        player.isMoving = false;
        isMoveAnimating = false;
    });
}

function rotatePlayer(right) {
    if (player.isMoving || player.isEventActive) return;
    player.isMoving = true;

    const nextDir = (player.dir + (right ? 1 : 3)) % 4;

    DungeonView.animateTurn(right ? 1 : -1, nextDir, () => {
        player.dir = nextDir;
        player.isMoving = false;

        updateStatusUI();
        saveTempCampPlayer(player);

        const corpseOnTile = (typeof getCorpseAt === 'function') ? getCorpseAt(currentFloorId, player.gridX, player.gridZ) : null;
        if (corpseOnTile) {
            addMessageLog(MESSAGES.CORPSE_AT_FEET);
        }
    });
}

function turnAroundPlayer() {
    if (player.isMoving || player.isEventActive) return;
    player.isMoving = true;
    playStepSE();

    // 180度半回転
    const nextDir = (player.dir + 2) % 4;

    DungeonView.animateTurn(2, nextDir, () => {
        player.dir = nextDir;
        player.isMoving = false;

        updateStatusUI();
        saveTempCampPlayer(player);

        const corpseOnTile = (typeof getCorpseAt === 'function') ? getCorpseAt(currentFloorId, player.gridX, player.gridZ) : null;
        if (corpseOnTile) {
            addMessageLog(MESSAGES.CORPSE_AT_FEET);
        }
    });
}

function retreatPlayer(onComplete) {
    if (player.prevGridX !== undefined && player.prevGridZ !== undefined) {
        player.gridX = player.prevGridX;
        player.gridZ = player.prevGridZ;
    }
    player.isMoving = false;
    updateCameraPosition();
    updateStatusUI();
    saveTempCampPlayer(player);
    if (onComplete) onComplete();
}

// 入力ガード (エンカウント時やウィンドウオープン時の連打誤爆を防止)
let inputUnlockTime = 0;

function blockInput(durationMs = GAME_RULES.input.blockMs) {
    inputUnlockTime = performance.now() + durationMs;
    isConfirmKeyDown = false;
}

function isInputBlocked() {
    return performance.now() < inputUnlockTime;
}

window.blockInput = blockInput;
window.isInputBlocked = isInputBlocked;

let isConfirmKeyDown = false;

// --------------------------------------------------------
// 5. イベントリスナー & 開始処理
// --------------------------------------------------------
window.addEventListener('keydown', (e) => {
    initAudio();

    // BGM ON/OFF トグル (Bキー)
    if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (typeof toggleBGM === 'function') {
            toggleBGM();
        }
        return;
    }

    // Spaceキーや矢印キーによるブラウザ既定動作（スクロールやフォーカスボタンの再クリック）を完全遮断
    if (e.key === ' ' || e.key === 'Spacebar' || e.key.startsWith('Arrow')) {
        e.preventDefault();
    }

    // 入力ブロック期間中はすべてのキー入力を破棄 (エンカウント・キャンプ等のラグ中連打を完全無効化)
    if (isInputBlocked()) {
        isConfirmKeyDown = false;
        return;
    }

    // 決定キー（Space/Enter）の押下検知（ダウン→リリースの「ダウン」）
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        if (e.repeat) return; // 長押しオートリピートを完全無視
        isConfirmKeyDown = true;
        return;
    }

    // キーリピート（カーソル移動長押し等のOS自動連打）を完全遮断
    if (e.repeat) return;

    // キャンプ画面が開いている場合のキーハンドリング (components/dungeon/camp/camp.js に委譲)
    if (typeof handleCampKeyDown === 'function' && handleCampKeyDown(e)) {
        return;
    }

    // 戦闘中のキーハンドリング (components/dungeon/battle/battle.js に委譲)
    if (typeof handleBattleKeyDown === 'function' && handleBattleKeyDown(e)) {
        return;
    }

    // メッセージやコマンド選択が表示されている場合のカーソル移動・キャンセル
    if (player.isEventActive) {
        if (currentCommands.length > 0) {
            // Esc / Backspace で「やめる」「もどる」「やりなおす (いいえ)」を素早く実行
            if (e.key === 'Escape' || e.key === 'Backspace') {
                const cancelIndex = currentCommands.findIndex(isCancelCommand);
                if (cancelIndex !== -1) {
                    e.preventDefault();
                    selectedIndex = cancelIndex;
                    confirmCommand();
                    return;
                }
            }

            // [Y] キーで肯定選択肢 ('たたかう (はい)', 'はい' 等) を素早く実行
            if (e.key === 'y' || e.key === 'Y') {
                const yesIndex = currentCommands.findIndex(isYesCommand);
                if (yesIndex !== -1) {
                    e.preventDefault();
                    selectedIndex = yesIndex;
                    confirmCommand();
                    return;
                }
            }

            // [N] キーで否定選択肢 ('やりなおす (いいえ)', 'いいえ' 等) を素早く実行
            if (e.key === 'n' || e.key === 'N') {
                const noIndex = currentCommands.findIndex(isNoCommand);
                if (noIndex !== -1) {
                    e.preventDefault();
                    selectedIndex = noIndex;
                    confirmCommand();
                    return;
                }
            }


            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                updateCommandSelection(-1);
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                updateCommandSelection(1);
            }
            return;
        }

        if (e.key === 'Escape') {
            hideMessage();
        }
        return;
    }

    // 通常探索時の移動・コマンド
    switch (e.key) {
        case 'ArrowUp': case 'w': case 'W': movePlayer(true); break;
        case 'ArrowDown': case 's': case 'S': turnAroundPlayer(); break;
        case 'ArrowLeft': case 'a': case 'A': rotatePlayer(false); break;
        case 'ArrowRight': case 'd': case 'D': rotatePlayer(true); break;
        case 'c': case 'C': openCamp(); break;
        case 'm': case 'M': openFieldMagicMenu(); break;
        case 'h': case 'H': toggleMessageHistory(); break;
    }
});

// 決定プッシュ：キーの「ダウン→リリース」の組み合わせで安全に発火
window.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        e.preventDefault();
        if (isInputBlocked()) {
            isConfirmKeyDown = false;
            return;
        }
        if (!isConfirmKeyDown) return; // keydown を経ていない release は無視
        isConfirmKeyDown = false;

        // 戦闘中の決定実行 (components/dungeon/battle/battle.js に委譲)
        if (typeof handleBattleConfirm === 'function' && handleBattleConfirm()) {
            return;
        }

        // 微小連打クールダウン
        if (performance.now() - lastActionTime < INPUT_COOLDOWN_MS) {
            return;
        }

        // キャンプ画面での決定実行
        if (isCampOpen) {
            executeCampAction();
            return;
        }

        // コマンド選択・メッセージ表示中の決定実行
        if (player.isEventActive) {
            if (currentCommands.length > 0) {
                confirmCommand();
            } else {
                hideMessage();
            }
        } else if (!inBattle && !player.isMoving) {
            // 足元の階段・街への帰還を調べる
            if (triggerStairs()) {
                return;
            }
            // 通常探索中の決定キー（Space/Enter）: 足元に遭難者の遺体があれば回収イベントを発動
            const corpse = (typeof getCorpseAt === 'function') ? getCorpseAt(currentFloorId, player.gridX, player.gridZ) : null;
            if (corpse) {
                triggerCorpseEvent(corpse);
            }
        }
    }
});

if (messageBox) {
    messageBox.addEventListener('click', () => {
        initAudio();
        if (player.isEventActive && currentCommands.length === 0) {
            hideMessage();
        }
    });
}

// グローバル公開 (ダンジョン・外部連携用)
window.damagePlayer = damagePlayer;
window.flashScreen = flashScreen;
window.confirmCommand = confirmCommand;


// 開始処理
window.addEventListener('DOMContentLoaded', () => {
    // 街からの出撃時は中断セーブが破棄されているため、残っていればブラウザを閉じる前の探索の続き
    const isResumed = hasTempCampSave();
    player = loadPlayer();
    // 全滅後にブラウザの「戻る」で来た場合など、パーティがいなければ街へ
    // (ここで中断セーブを作ると、街とダンジョンの間で戻され続けてしまう)
    if (player.partyMembers.length === 0) {
        clearTempCampPlayer();
        window.location.replace('town.html');
        return;
    }
    player.isMoving = false;
    player.isEventActive = false;
    loadFloor(player.currentFloorId || 'B1F');
    // 迷宮に入った時点で中断セーブを作る (このあと一歩も動かずに閉じても、次回はダンジョンから再開)
    saveTempCampPlayer(player);

    // 初期位置設定 (保存されていればその位置、なければ階段前)
    updateCameraPosition();

    updateStatusUI();

    renderMessageHistory();
    if (!DungeonView.isAvailable()) {
        addMessageLog("3D表示を利用できないため、座標表示 (POS / DIR) のみで探索します。", 'important');
    }
    // 入口から始まっても街へ戻る選択肢は出さない (戻るときは足元を調べるか、キャンプを終える)
    showMessage(isResumed
        ? `${FLOORS[currentFloorId].name}の探索を再開した...\n[C] キーでいつでもキャンプ画面を開けます。`
        : "ダンジョンへ足を踏み入れた...\n[C] キーでいつでもキャンプ画面を開けます。");

    if (typeof playBGM === 'function') {
        playBGM('dungeon');
    }
});

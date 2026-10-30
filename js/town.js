// ========================================================
// 王都ルミナリア (Town) ロジック
// ========================================================
var player = null;
window.player = null;

// ※ commandListEl / promptHintEl / messageBox / INPUT_COOLDOWN_MS は message-box.js が window に公開
// ※ 最終決定時刻は MessageBox.getLastActionTime() で取得

// 入力ガード (ウィンドウオープン時の連打・キー判定誤爆を完全防止)
let inputUnlockTime = 0;

function blockInput(durationMs = GAME_RULES.input.blockMs) {
    inputUnlockTime = performance.now() + durationMs;
    isConfirmKeyDown = false;
}

function isInputBlocked() {
    return performance.now() < inputUnlockTime;
}

// 街の選択肢
const TOWN_COMMANDS = {
    DIVE: 'このまま迷宮へ潜る',
    TURN_BACK: '引き返す',
    RESET_YES: 'はい、リセットする',
    RESET_NO: 'いいえ、やめる',
    DEBUG_STRONG_PARTY: '強キャラパーティをセット',
    DEBUG_DUNGEON_RESET: 'ダンジョン状態をリセット',
    DEBUG_FULL_RESET: '最初からやり直す (全データ初期化)'
};

// ダンジョンの中断セーブが残っている (= パーティはまだ迷宮内) ならダンジョンへ戻す
// (街で中断セーブを読み込んで施設を使うと、迷宮内の状態が街の記録として保存されてしまうため)
function redirectToDungeonIfSuspended() {
    if (!hasTempCampSave()) return false;
    window.location.replace('dungeon.html');
    return true;
}

// 初期化
window.addEventListener('DOMContentLoaded', () => {
    if (redirectToDungeonIfSuspended()) return;

    player = loadPlayer();
    window.player = player;
    updateStatusUI();

    // ダンジョンから帰還した直後の処理
    const params = new URLSearchParams(window.location.search);
    if (params.get('reason') === 'wiped' || params.get('reason') === 'dead') {
        clearTempCampPlayer();
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
        savePermanentPlayer(player);
        updateStatusUI();
        showMessage("迷宮でパーティが全滅した...\n遺体や装備品は全滅したその場に残されている。\n\n【酒場】で待機中の仲間を編成するか、\n【訓練場】で新たな冒険者を作成して救助隊を結成し、\n現場へ遺体回収に向かいましょう。");
    } else if (params.get('reason') === 'return') {
        clearTempCampPlayer();
        savePermanentPlayer(player);
        updateStatusUI();
        showMessage("ダンジョンから無事に王都ルミナリアへ帰還した。");
    }

    if (typeof playBGM === 'function') {
        playBGM('town');
    }
});

// ブラウザの「戻る」ボタン (BFCache: Back-Forward Cache) で戻ってきた場合の最新データ同期
window.addEventListener('pageshow', (event) => {
    if (redirectToDungeonIfSuspended()) return;

    player = loadPlayer();
    window.player = player;
    updateStatusUI();
});

function updateStatusUI() {
    const statusBox = document.getElementById('status-box');
    if (!statusBox || !player) return;
    renderPartyHUD(statusBox, player, MESSAGES.TOWN_TITLE, '');
}

let townFlashTimeoutId = null;
function flashScreen(colorType = 'white') {
    const flashOverlay = document.getElementById('flash-overlay');
    if (!flashOverlay) return;
    if (townFlashTimeoutId) {
        clearTimeout(townFlashTimeoutId);
        townFlashTimeoutId = null;
    }
    flashOverlay.classList.remove('flash-active', 'flash-red-active', 'flash-purple-active');
    void flashOverlay.offsetWidth;

    let animClass = 'flash-active';
    let duration = 400;
    if (colorType === 'red') {
        animClass = 'flash-red-active';
        duration = 450;
    } else if (colorType === 'purple') {
        animClass = 'flash-purple-active';
        duration = 450;
    }

    flashOverlay.style.background = '';
    flashOverlay.style.display = 'block';
    flashOverlay.classList.add(animClass);

    const cleanUpFlash = () => {
        flashOverlay.classList.remove('flash-active', 'flash-red-active', 'flash-purple-active');
        flashOverlay.style.display = 'none';
        flashOverlay.style.background = 'none';
        if (townFlashTimeoutId) {
            clearTimeout(townFlashTimeoutId);
            townFlashTimeoutId = null;
        }
    };
    flashOverlay.addEventListener('animationend', cleanUpFlash, { once: true });
    townFlashTimeoutId = setTimeout(cleanUpFlash, duration + 50);
}

// ========================================================
// ※ メッセージボックス制御ロジックは components/common/message-box/message-box.js に共通パーツ化されました
// ========================================================
// ※ 商店ロジックは components/town/shop/shop.js に分割・移行されました
// ========================================================
// ========================================================
// ※ 教会ロジックは components/town/church/church.js に分割・移行されました
// ========================================================
// ========================================================
// ※ 宿屋 (Inn) ロジックは components/town/inn/inn.js に分割・移行されました
// ========================================================
// ※ パーティの状態一覧 (showPartyRecord) は components/town/party-record/party-record.js にあります

// ダンジョン突入
function enterDungeon() {
    initAudio();
    const party = player.partyMembers || [];
    if (party.length === 0) {
        playCancelSE();
        showMessage("衛兵「待て！ 出撃パーティに誰もいないぞ！\nまずは酒場で冒険者を編成してくるのだ。」");
        return;
    }

    const livingMembers = party.filter(isMemberAlive);
    if (livingMembers.length === 0) {
        playCancelSE();
        showMessage("衛兵「待て！ 全員が息絶えた状態で迷宮へ行くことはならん！\nまずは教会で神父に蘇生してもらうのだ。」");
        return;
    }

    const deadMembers = player.partyMembers.filter(m => !isMemberAlive(m));
    if (deadMembers.length > 0) {
        showMessage(`衛兵「仲間の中に息絶えた者（${deadMembers.map(m => m.name).join('、')}）がいるぞ。\nこのまま死者を連れて迷宮へ潜るのか？」`);
        showCommands([TOWN_COMMANDS.DIVE, TOWN_COMMANDS.TURN_BACK], (choice) => {
            if (choice === TOWN_COMMANDS.DIVE) {
                proceedToDungeon();
            } else {
                hideMessage();
            }
        });
        return;
    }

    proceedToDungeon();
}

function proceedToDungeon() {
    playStairsSE();
    if (typeof stopBGM === 'function') {
        stopBGM();
    }
    savePermanentPlayer(player);
    if (typeof markScoutRefreshPending === 'function') markScoutRefreshPending(); // 戻ったら酒場のスカウト候補が入れ替わる
    window.location.href = 'dungeon.html';
}

// デバッグメニュー (強キャラパーティのセット / ダンジョン状態のリセット / 最初からやり直す)
function openDebugMenu() {
    initAudio();
    showMessage("【デバッグメニュー】\n実行する項目を選んでください。");
    showCommands([TOWN_COMMANDS.DEBUG_STRONG_PARTY, TOWN_COMMANDS.DEBUG_DUNGEON_RESET, TOWN_COMMANDS.DEBUG_FULL_RESET, COMMON_COMMANDS.CANCEL], (choice) => {
        if (choice === TOWN_COMMANDS.DEBUG_STRONG_PARTY) {
            chooseDebugPartyLevel();
        } else if (choice === TOWN_COMMANDS.DEBUG_DUNGEON_RESET) {
            confirmDungeonReset();
        } else if (choice === TOWN_COMMANDS.DEBUG_FULL_RESET) {
            confirmReset();
        } else {
            hideMessage();
        }
    });
}

// 強キャラパーティ (デバッグ用。6職業がそろい、各職業で装備できるいちばん強い武具を身につけている)
const DEBUG_PARTY_LEVELS = [10, 20, 30];
const DEBUG_PARTY_ID_PREFIX = 'char_debug_';
const DEBUG_PARTY_SPECS = [
    { classId: 'fighter', name: '強戦士', attrs: { str: 4, vit: 4, agi: 2 }, weapon: 'battle_axe', armor: 'plate_armor' },
    { classId: 'knight', name: '強騎士', attrs: { str: 4, vit: 4, agi: 2 }, weapon: 'battle_axe', armor: 'plate_armor' },
    { classId: 'thief', name: '強盗賊', attrs: { str: 3, vit: 3, agi: 4 }, weapon: 'broadsword', armor: 'leather_armor' },
    { classId: 'priest', name: '強僧侶', attrs: { pie: 5, vit: 5 }, weapon: 'dagger', armor: 'chain_mail' },
    { classId: 'mage', name: '強魔術師', attrs: { int: 6, vit: 4 }, weapon: 'dagger', armor: null },
    { classId: 'bishop', name: '強司祭', attrs: { int: 5, pie: 5 }, weapon: 'dagger', armor: 'leather_armor' }
];

function chooseDebugPartyLevel() {
    const options = DEBUG_PARTY_LEVELS.map(lv => `Lv${lv} のパーティ`);
    showMessage("【強キャラパーティをセット】\nレベルを選んでください。\n（いまのパーティの仲間は名簿に残ります。前にセットした強キャラは名簿から消えます）");
    showCommands([...options, COMMON_COMMANDS.BACK], (choice) => {
        const idx = options.indexOf(choice);
        if (idx === -1) {
            openDebugMenu();
            return;
        }
        setDebugStrongParty(DEBUG_PARTY_LEVELS[idx]);
        updateStatusUI();
        playConfirmSE();
        showMessage(`Lv${DEBUG_PARTY_LEVELS[idx]} の強キャラパーティをセットしました。\n（HP・呪文の使用回数は全快です）`);
    });
}

function setDebugStrongParty(level) {
    const members = DEBUG_PARTY_SPECS.map((spec, i) => {
        const m = createCustomCharacter(spec.name, spec.classId, spec.attrs);
        m.id = `${DEBUG_PARTY_ID_PREFIX}${Date.now()}_${i}`;
        while (m.level < level) levelUpMember(m, true);
        m.equippedWeapon = spec.weapon;
        m.equippedArmor = spec.armor;
        return m;
    });

    // 前にセットした強キャラを名簿から消す (迷宮で遭難中の者は遺体の回収ができるよう残す)
    const roster = loadCharacterRoster().filter(c =>
        !String(c.id).startsWith(DEBUG_PARTY_ID_PREFIX) || getLostCharacterInfo(c.id));
    saveCharacterRoster(roster);

    player.partyMembers = members;
    savePermanentPlayer(player); // 新しい仲間は名簿にも登録される
}

// ダンジョン状態リセット確認
function confirmDungeonReset() {
    showMessage("【ダンジョン状態リセット】\n迷宮の状態を最初に戻しますか？\n（開けた宝箱・倒したボス・遺体と遺留品が元に戻り、次の出撃は B1F の入口からになります。\n　名簿・パーティ・所持品・ゴールドはそのままです）");
    showCommands([TOWN_COMMANDS.RESET_YES, TOWN_COMMANDS.RESET_NO], (choice) => {
        if (choice === TOWN_COMMANDS.RESET_YES) {
            player = resetDungeonState(player);
            updateStatusUI();
            playConfirmSE();
            showMessage("ダンジョンの状態を初期化しました。");
        } else {
            hideMessage();
        }
    });
}

// データリセット確認
function confirmReset() {
    showMessage("【セーブデータ初期化】\n本当に冒険の記録をリセットして最初からやり直しますか？\n（レベル・所持品・名簿の冒険者・迷宮の遺体はすべて初期化されます）");
    showCommands([TOWN_COMMANDS.RESET_YES, TOWN_COMMANDS.RESET_NO], (choice) => {
        if (choice === TOWN_COMMANDS.RESET_YES) {
            player = resetPlayer();
            updateStatusUI();
            playConfirmSE();
            showMessage("冒険の記録を初期化しました。新しい冒険を始めましょう！");
        } else {
            hideMessage();
        }
    });
}

let isConfirmKeyDown = false;

// ========================================================
// 施設メニューのキーボード選択 (↑↓/W・S で移動、Space/Enter で決定)
// ========================================================
let townMenuIndex = 0;

function getTownMenuButtons() {
    return Array.from(document.querySelectorAll('.town-menu .town-btn'));
}

// メッセージも施設画面 (酒場・訓練場) も開いていないときだけ施設メニューを操作できる
function isTownMenuActive() {
    if (isEventActive) return false;
    return !Array.from(document.querySelectorAll('.facility-overlay')).some(el => el.style.display !== 'none');
}

function renderTownMenuSelection() {
    getTownMenuButtons().forEach((btn, idx) => btn.classList.toggle('selected', idx === townMenuIndex));
}

function moveTownMenuSelection(delta) {
    const buttons = getTownMenuButtons();
    if (buttons.length === 0) return;
    townMenuIndex = (townMenuIndex + delta + buttons.length) % buttons.length;
    if (typeof playCursorSE === 'function') playCursorSE();
    renderTownMenuSelection();
}

function confirmTownMenuSelection() {
    const btn = getTownMenuButtons()[townMenuIndex];
    if (btn) btn.click();
}

// マウスを乗せたボタンにカーソルを合わせる (キーとマウスで選択表示が二重にならないように)
window.addEventListener('DOMContentLoaded', () => {
    getTownMenuButtons().forEach((btn, idx) => {
        btn.addEventListener('mouseenter', () => {
            townMenuIndex = idx;
            renderTownMenuSelection();
        });
    });
    renderTownMenuSelection();
});

// ========================================================
// 施設画面 (酒場・訓練場) のキーボード操作
// 矢印/WASD で画面上の位置関係どおりに移動、Space/Enter で決定、Esc で閉じる
// ※ 画面は操作のたびに描き直されるため、選択中の項目は onclick (入力欄は id) で覚えて描き直し後に復元する
// ※ 画面の上に別のウィンドウを重ねたとき (パーティの状態 → 冒険者のつよさ) は、一番上のウィンドウを操作する
// ※ 上部のタブは選んでいるタブも選択できる (←→ でタブを渡り、Enter で切り替えても選択がタブに残る)
// ※ 描き直しで選択中の項目が消えたときは本文の同じ位置の項目へ。施設側から requestFacilityFocus() で行き先を指定できる
// ※ Esc / Backspace は、画面に data-kb-back の付いた「もどる」項目があればそれを押し、なければ施設を閉じる
// ========================================================
const FACILITY_ITEM_SELECTOR = 'button[onclick]:not(:disabled), button[data-facility-tab], input[type="text"], .class-card, .record-card[onclick]';
let facilityFocusOverlayId = null;
let facilityFocusKey = null;
let facilityFocusIndex = 0;
let facilityFocusContentIndex = -1; // 本文 (.facility-content) の項目の中での位置 (見出し・足元の項目なら -1)
// 上にウィンドウを重ねている間、下の画面で選んでいた項目 { overlayId, key, index }
let facilityFocusStack = [];
// 次の描き直しで選ぶ項目のキー (見つからなければ本文の最初の項目)。null なら指定なし
let facilityFocusRequest = null;

/**
 * 施設の操作で画面を描き直した後に選ぶ項目を指定する (例: 並べ替えた仲間のボタンを選んだままにする)
 * @param {string|string[]} [keys] 項目のキー (onclick の文字列)。先に見つかったものを選ぶ。省略・見つからなければ本文の最初の項目
 */
function requestFacilityFocus(keys) {
    facilityFocusRequest = Array.isArray(keys) ? keys : (keys ? [keys] : []);
}

function isFacilityOverlayOpen(el) {
    return !!el && el.style.display !== 'none';
}

// 開いている施設画面のうち一番上 (後から重ねたもの) を返す
function getOpenFacilityOverlay() {
    const open = Array.from(document.querySelectorAll('.facility-overlay')).filter(isFacilityOverlayOpen);
    return open.length > 0 ? open[open.length - 1] : null;
}

function getFacilityItems(overlay) {
    return Array.from(overlay.querySelectorAll(FACILITY_ITEM_SELECTOR)).filter(el => el.offsetParent !== null);
}

// 項目のキー (タブは選んでいるかどうかで onclick が変わるので番号で覚える)
function getFacilityItemKey(el) {
    if (el.hasAttribute('data-facility-tab')) return 'tab:' + el.getAttribute('data-facility-tab');
    return el.getAttribute('onclick') || el.id || null;
}

function getFacilityContentItems(items) {
    return items.filter(el => el.closest('.facility-content'));
}

// 本文の最初の項目 (タブは除く。本文にタブしかなければ選んでいるタブ)
function getFirstFacilityContentItem(items) {
    const contentItems = getFacilityContentItems(items);
    return contentItems.find(el => !el.hasAttribute('data-facility-tab'))
        || contentItems.find(el => !el.hasAttribute('onclick'))
        || items[0];
}

function setFacilityFocus(overlay, el) {
    const items = getFacilityItems(overlay);
    overlay.querySelectorAll('.kb-focus').forEach(x => x.classList.remove('kb-focus'));
    if (!el) return;
    // 開いたままの画面の上に重ねたときは、下の画面の選択位置を覚えておく
    if (facilityFocusOverlayId && facilityFocusOverlayId !== overlay.id
        && isFacilityOverlayOpen(document.getElementById(facilityFocusOverlayId))) {
        facilityFocusStack.push({ overlayId: facilityFocusOverlayId, key: facilityFocusKey, index: facilityFocusIndex });
    }
    facilityFocusStack = facilityFocusStack.filter(s => s.overlayId !== overlay.id);
    facilityFocusOverlayId = overlay.id;
    facilityFocusKey = getFacilityItemKey(el);
    facilityFocusIndex = Math.max(0, items.indexOf(el));
    facilityFocusContentIndex = getFacilityContentItems(items).indexOf(el);
    el.classList.add('kb-focus');
    el.scrollIntoView({ block: 'nearest' });
}

// 描き直し後・施設を開いた直後に、覚えている項目へ選択表示を戻す
function refreshFacilityFocus() {
    facilityFocusStack = facilityFocusStack.filter(s => isFacilityOverlayOpen(document.getElementById(s.overlayId)));
    const overlay = getOpenFacilityOverlay();
    if (!overlay) return;
    const items = getFacilityItems(overlay);
    if (items.length === 0) return;

    const findByKey = (key) => items.find(el => getFacilityItemKey(el) === key);
    let target = null;
    let startTyping = false; // 画面を開いた・切り替えた直後に入力欄 (冒険者の名前) を選んだら、そのまま文字を打てるようにする
    if (facilityFocusRequest) {
        // 施設側が行き先を指定した (並べ替えた仲間のボタン・画面が切り替わった後の最初の項目など)
        target = facilityFocusRequest.map(findByKey).find(Boolean) || getFirstFacilityContentItem(items);
        facilityFocusRequest = null;
        startTyping = true;
    } else if (items.includes(document.activeElement)) {
        target = document.activeElement; // 名前未入力の警告で入力欄にフォーカスが戻った場合など
    } else if (facilityFocusOverlayId === overlay.id) {
        // 選んでいた項目が描き直しで消えたら、本文の同じ位置の項目へ (見出し・足元のボタンへ飛ばない)
        const contentItems = getFacilityContentItems(items);
        target = findByKey(facilityFocusKey)
            || (facilityFocusContentIndex >= 0 && contentItems.length > 0
                ? contentItems[Math.min(facilityFocusContentIndex, contentItems.length - 1)]
                : items[Math.min(facilityFocusIndex, items.length - 1)]);
    } else if (facilityFocusStack.some(s => s.overlayId === overlay.id)) {
        // 重ねていたウィンドウを閉じたら、下の画面で選んでいた項目に戻す
        const saved = facilityFocusStack.find(s => s.overlayId === overlay.id);
        target = items.find(el => getFacilityItemKey(el) === saved.key)
            || items[Math.min(saved.index, items.length - 1)];
    } else {
        // 別の施設を開いた直後は、見出しの「とじる」やタブではなく本文の最初の項目から始める
        target = getFirstFacilityContentItem(items);
        startTyping = true;
    }
    setFacilityFocus(overlay, target);
    if (startTyping && target && target.tagName === 'INPUT') target.focus();
}

function getCurrentFacilityItem(overlay, items) {
    const current = overlay.querySelector('.kb-focus');
    if (current && items.includes(current)) return current;
    refreshFacilityFocus();
    return overlay.querySelector('.kb-focus');
}

// 指定方向で一番近い項目 (進行方向の距離 + 横ずれ×2 が最小のもの)
// 左右は横に並んだ項目 (ずれが進む距離以内) だけを対象にし、右端で → を押しても斜め下の足元のボタンへ飛ばない
function findFacilityNeighbor(items, current, dir) {
    const center = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const c = center(current);
    let best = null;
    let bestScore = Infinity;
    items.forEach(el => {
        if (el === current) return;
        const p = center(el);
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        let primary, secondary;
        if (dir === 'up') { primary = -dy; secondary = dx; }
        else if (dir === 'down') { primary = dy; secondary = dx; }
        else if (dir === 'left') { primary = -dx; secondary = dy; }
        else { primary = dx; secondary = dy; }
        if (primary <= 1) return;
        if ((dir === 'left' || dir === 'right') && Math.abs(secondary) > primary) return;
        const score = primary + Math.abs(secondary) * 2;
        if (score < bestScore) {
            bestScore = score;
            best = el;
        }
    });
    return best;
}

function moveFacilityFocus(overlay, dir) {
    const items = getFacilityItems(overlay);
    const current = getCurrentFacilityItem(overlay, items);
    if (!current) return;
    let next = findFacilityNeighbor(items, current, dir);
    if (!next && (dir === 'up' || dir === 'down')) {
        // その方向に項目がなければ並び順で前後へ (端まで行ったら反対側へ回り込む)
        const idx = items.indexOf(current);
        next = items[(idx + (dir === 'up' ? -1 : 1) + items.length) % items.length];
    }
    if (!next || next === current) return;

    if (typeof playCursorSE === 'function') playCursorSE();
    setFacilityFocus(overlay, next);
    // 入力欄に来たらそのまま文字を打てるようにし、離れたらフォーカスを外す
    if (next.tagName === 'INPUT') next.focus();
    else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
}

function activateFacilityFocus(overlay) {
    const current = getCurrentFacilityItem(overlay, getFacilityItems(overlay));
    if (!current) return;
    if (current.tagName === 'INPUT') current.focus();
    else current.click();
}

// 数字キー (1〜9) で「1. パーティ編成」などの番号付きタブを押し、そのタブの本文の最初の項目を選ぶ。処理したら true
function selectFacilityTabByNumber(overlay, key) {
    if (!/^[1-9]$/.test(key)) return false;
    const tab = overlay.querySelector(`[data-facility-tab="${key}"]`);
    if (!tab) return false;
    if (tab.hasAttribute('onclick')) {
        requestFacilityFocus();
        tab.click();
    }
    return true;
}

function closeFacilityOverlay(overlay) {
    const closeBtn = overlay.querySelector('.facility-header button[onclick]');
    if (closeBtn) closeBtn.click();
}

// Esc / Backspace: 「今は装備しない」など data-kb-back の付いた項目があれば押して一つ前へ戻り、なければ施設を閉じる
function backFacilityOverlay(overlay) {
    const back = Array.from(overlay.querySelectorAll('[data-kb-back]')).find(el => el.offsetParent !== null);
    if (back) back.click();
    else closeFacilityOverlay(overlay);
}

// 押されたキーの方向名 ('up' など) を返す (方向キーでなければ null)
function getFacilityDirection(e, allowLetters) {
    if (e.key === 'ArrowUp' || (allowLetters && (e.key === 'w' || e.key === 'W'))) return 'up';
    if (e.key === 'ArrowDown' || (allowLetters && (e.key === 's' || e.key === 'S'))) return 'down';
    if (e.key === 'ArrowLeft' || (allowLetters && (e.key === 'a' || e.key === 'A'))) return 'left';
    if (e.key === 'ArrowRight' || (allowLetters && (e.key === 'd' || e.key === 'D'))) return 'right';
    return null;
}

// マウスで押した項目にも選択表示を合わせ、描き直し後に選択表示を戻す
// (押した項目が上にウィンドウを開いた場合も、押した項目がある画面の選択位置として覚える)
document.addEventListener('click', (e) => {
    const item = e.target.closest ? e.target.closest(FACILITY_ITEM_SELECTOR) : null;
    const overlay = item ? item.closest('.facility-overlay') : null;
    if (overlay) {
        facilityFocusOverlayId = overlay.id;
        facilityFocusKey = getFacilityItemKey(item);
    }
    setTimeout(refreshFacilityFocus, 0);
});

// 施設画面の名前入力欄にいるときのキー処理。処理したら true
// (左右キーは文字カーソル移動、文字キーは入力に使うので、上下・Enter・Esc だけ扱う)
function handleFacilityTextFieldKeyDown(e) {
    const overlay = getOpenFacilityOverlay();
    if (!overlay || !overlay.contains(e.target)) return false;
    if (e.isComposing || e.keyCode === 229) return true; // 日本語変換中の Enter などは入力欄に任せる

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        moveFacilityFocus(overlay, e.key === 'ArrowUp' ? 'up' : 'down');
        return true;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        moveFacilityFocus(overlay, 'down');
        return true;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        e.target.blur();
        return true;
    }
    return false;
}

// 名前入力欄など文字を入力中のキーは、ゲームの操作 (BGM切替・決定など) に使わない
function isTypingInTextField(e) {
    const el = e.target;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

// キー入力 & クリック
window.addEventListener('keydown', (e) => {
    initAudio();
    if (isTypingInTextField(e)) {
        handleFacilityTextFieldKeyDown(e);
        return;
    }

    // BGM ON/OFF トグル (Bキー)
    if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        if (typeof toggleBGM === 'function') {
            toggleBGM();
        }
        return;
    }

    // Spaceキーや矢印キーによるブラウザ既定動作（フォーカスボタンの再クリックやスクロール）を完全遮断
    if (e.key === ' ' || e.key === 'Spacebar' || e.key.startsWith('Arrow')) {
        e.preventDefault();
    }

    // 入力ブロック期間中はすべてのキー入力を破棄 (ウィンドウオープン等のラグ中連打を完全無効化)
    if (isInputBlocked()) {
        isConfirmKeyDown = false;
        return;
    }

    // 決定キー（Space/Enter）の押下検知（ダウン→リリースの「ダウン」）
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        // クリック後にフォーカスが残ったボタンが Enter で再クリックされるのを防ぐ (決定は keyup で行う)
        if (isTownMenuActive() || getOpenFacilityOverlay()) e.preventDefault();
        if (e.repeat) return; // 長押しオートリピートを完全無視
        isConfirmKeyDown = true;
        return;
    }

    // キーリピート（長押しによるOS自動連打）を完全遮断
    if (e.repeat) return;

    if (isEventActive) {
        if (currentCommands.length > 0) {
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
    } else if (isTownMenuActive()) {
        if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
            moveTownMenuSelection(-1);
        } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
            moveTownMenuSelection(1);
        }
    } else if (getOpenFacilityOverlay()) {
        const overlay = getOpenFacilityOverlay();
        const dir = getFacilityDirection(e, true);
        if (dir) {
            moveFacilityFocus(overlay, dir);
        } else if (selectFacilityTabByNumber(overlay, e.key)) {
            e.preventDefault();
        } else if (e.key === 'Escape' || e.key === 'Backspace') {
            e.preventDefault();
            backFacilityOverlay(overlay);
        }
    }
});

// 決定プッシュ：キーの「ダウン→リリース」の組み合わせで安全に発火
window.addEventListener('keyup', (e) => {
    if (isTypingInTextField(e)) return;
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        e.preventDefault();
        if (isInputBlocked()) {
            isConfirmKeyDown = false;
            return;
        }
        if (!isConfirmKeyDown) return; // keydown を経ていない release は無視
        isConfirmKeyDown = false;

        // 微小連打クールダウン
        if (performance.now() - MessageBox.getLastActionTime() < INPUT_COOLDOWN_MS) {
            return;
        }

        if (isEventActive) {
            if (currentCommands.length > 0) {
                confirmCommand();
            } else {
                hideMessage();
            }
        } else if (isTownMenuActive()) {
            confirmTownMenuSelection();
        } else if (getOpenFacilityOverlay()) {
            activateFacilityFocus(getOpenFacilityOverlay());
        }
    }
});


// ========================================================
// ※ 訓練場ロジックは components/town/training/training.js に分割・移行されました
// ※ 酒場ロジックは components/town/tavern/tavern.js に分割・移行されました
// ========================================================




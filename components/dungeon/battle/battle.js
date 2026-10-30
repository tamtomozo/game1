/**
 * 迷宮戦闘システム (Battle Component)
 * - components/dungeon/battle/battle.js
 * 
 * 責務:
 * 1. エネミー隊列リスト HUD、モンスターイラスト表示枠の描画・制御
 * 2. 戦闘専用 横長メッセージウィンドウ & コマンド選択ウィンドウの制御
 * 3. モンスター個体生成、レベル補正、経験値・ゴールド分配計算
 * 4. ターン制コマンドバトルエンジン (startBattle, triggerBossBattle, triggerEncounterAPI, checkEncounter)
 * 5. 自己修復 DOM 生成 (ensureBattleDOM)
 */

(function (window) {
    'use strict';

    // 戦闘専用 横長メッセージ & コマンド選択ウィンドウ (完全排他制御)
    let battleMessageBox = null;
    let battleMessageText = null;
    let battleMessageHint = null;

    let battleCommandBox = null;
    let battleCommandHeader = null;
    let battleCommandListEl = null;
    let battleCommandHintEl = null;

    // エネミー表示枠 (モンスターフレーム)
    let monsterFrameEl = null;
    let monsterImgEl = null;
    let monsterNameEl = null;
    let monsterCountEl = null;
    let monsterHpBarEl = null;
    let battleFormationHudEl = null;

    let inBattle = false;
    let activeMonster = null;
    let battleGroups = [];
    let defeatedMonsters = [];
    let onBattleRepeatKey = null; // 戦闘中 [R] キー押下時のキャラ別リピートハンドラ

    // 戦闘中フラグの切り替え (body の in-battle クラスで、戦闘中はパーティ欄の EXP を隠す)
    function setInBattle(val) {
        inBattle = !!val;
        document.body.classList.toggle('in-battle', inBattle);
    }

    // 戦闘コマンド選択の状態 (探索用メッセージボックスとは独立)
    let battleCommands = [];
    let battleSelectedIndex = 0;
    let onBattleCommandSelect = null;
    let battleLastActionTime = 0;
    let isBattleMessageShown = false;
    let isBattleMessageClosable = false; // 戦闘終了メッセージ (閉じると探索へ復帰)
    const BATTLE_INPUT_COOLDOWN_MS = GAME_RULES.input.cooldownMs;

    // エンカウント・逃走判定
    const ENCOUNT_RATE = GAME_RULES.battle.encounterRate; // 1歩ごとのエンカウント率
    const ESCAPE_RATE = GAME_RULES.battle.escapeRate;     // 逃走成功率

    // 戦闘コマンドの選択肢 (共通の「もどる」「やめる」は storage.js の COMMON_COMMANDS)
    const BATTLE_COMMANDS = {
        ATTACK: 'たたかう',
        ASSIST: 'たたかう(援護)',
        DEFEND: 'ぼうぎょ',
        MAGIC: 'まほう',
        ITEM: 'どうぐ',
        PERSUADE: '説得を試みる',
        ESCAPE: 'にげる',
        REPEAT_PREFIX: '[R] リピート',
        CONFIRM: `たたかう ${YES_MARK}`,
        RETRY: `やりなおす ${NO_MARK}`
    };

    // ========================================================
    // 自己修復 DOM 生成 & 要素取得
    // ========================================================
    function ensureBattleDOM() {
        if (typeof document === 'undefined') return;

        // 1. エネミー隊列 HUD
        let formationHud = document.getElementById('battle-formation-hud');
        if (!formationHud) {
            formationHud = document.createElement('div');
            formationHud.id = 'battle-formation-hud';
            formationHud.style.display = 'none';
            document.body.appendChild(formationHud);
        }

        // 2. モンスターフレーム
        let monsterFrame = document.getElementById('monster-frame');
        if (!monsterFrame) {
            monsterFrame = document.createElement('div');
            monsterFrame.id = 'monster-frame';
            monsterFrame.className = 'monster-frame';
            monsterFrame.style.display = 'none';
            monsterFrame.innerHTML = `
                <div class="monster-header">
                    <span id="monster-name" class="monster-name">UNKNOWN</span>
                    <span id="monster-count" class="monster-count" style="display: none;">× 1</span>
                    <div id="monster-hp-container" class="monster-hp-container" style="display: none;">
                        <div id="monster-hp-bar" class="monster-hp-bar"></div>
                    </div>
                </div>
                <div class="monster-image-wrapper">
                    <img id="monster-img" class="monster-img" src="" alt="Monster">
                </div>
            `;
            document.body.appendChild(monsterFrame);
        }

        // 3. 戦闘メッセージボックス
        let battleMsgBox = document.getElementById('battle-message-box');
        if (!battleMsgBox) {
            battleMsgBox = document.createElement('div');
            battleMsgBox.id = 'battle-message-box';
            battleMsgBox.style.display = 'none';
            battleMsgBox.innerHTML = `
                <div id="battle-message-text"></div>
                <div class="prompt-hint" id="battle-message-hint" style="display: none;">${MESSAGES.HINT_CLOSE}</div>
            `;
            document.body.appendChild(battleMsgBox);
        }

        // メッセージボックスクリックによる進行
        if (battleMsgBox && !battleMsgBox._hasClickInit) {
            battleMsgBox._hasClickInit = true;
            battleMsgBox.addEventListener('click', () => {
                if (typeof initAudio === 'function') initAudio();
                if (battleCommands.length === 0) closeBattleResult();
            });
        }

        // 4. 戦闘コマンドボックス
        let battleCmdBox = document.getElementById('battle-command-box');
        if (!battleCmdBox) {
            battleCmdBox = document.createElement('div');
            battleCmdBox.id = 'battle-command-box';
            battleCmdBox.style.display = 'none';
            battleCmdBox.innerHTML = `
                <div id="battle-command-header" class="battle-command-header"></div>
                <div id="battle-command-list" class="battle-command-list"></div>
                <div id="battle-command-hint" class="battle-command-hint"></div>
            `;
            document.body.appendChild(battleCmdBox);
        }

        // DOM参照の最新化
        battleMessageBox = document.getElementById('battle-message-box');
        battleMessageText = document.getElementById('battle-message-text');
        battleMessageHint = document.getElementById('battle-message-hint');

        battleCommandBox = document.getElementById('battle-command-box');
        battleCommandHeader = document.getElementById('battle-command-header');
        battleCommandListEl = document.getElementById('battle-command-list');
        battleCommandHintEl = document.getElementById('battle-command-hint');

        monsterFrameEl = document.getElementById('monster-frame');
        monsterImgEl = document.getElementById('monster-img');
        monsterNameEl = document.getElementById('monster-name');
        monsterCountEl = document.getElementById('monster-count');
        monsterHpBarEl = document.getElementById('monster-hp-bar');
        battleFormationHudEl = document.getElementById('battle-formation-hud');
    }

    // 初期化実行 (DOM Ready)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureBattleDOM);
    } else {
        ensureBattleDOM();
    }

    // ========================================================
    // エネミー表示 & 隊列 HUD 描画関数
    // ========================================================
    /**
     * 画面横中央上部のエネミー隊列リストHUDを更新
     * - 1行に1種類のエネミーを表示（複数種類の場合は複数行で縦並び表示）
     * - 同じエネミーが複数の場合はレベル表示は不要で数のみ (例: ゴブリン × 3)
     * - 単体の場合はレベル付き名称 (例: Lv.2 ゴブリン、魔王)
     * - エネミーHPは一切表示しない
     */
    function updateBattleFormationUI() {
        const formationHudEl = battleFormationHudEl || document.getElementById('battle-formation-hud');
        if (!formationHudEl) return;

        if (!inBattle || !battleGroups || battleGroups.length === 0) {
            formationHudEl.style.display = 'none';
            return;
        }

        const linesHtml = [];

        battleGroups.forEach((group, index) => {
            if (!group || group.aliveCount <= 0) return;

            const isFront = (index === 0);
            const tagClass = isFront ? 'tag-front' : 'tag-rear';
            const tagText = isFront ? '前衛' : '後衛';
            const lineClass = isFront ? 'formation-front' : 'formation-rear';

            let nameHtml = '';
            let countHtml = '';

            if (group.aliveCount > 1) {
                // 同じエネミーが複数の場合は「名称」＋「× 匹数」
                nameHtml = `<span class="formation-name">${group.baseName}</span>`;
                countHtml = `<span class="formation-count">× ${group.aliveCount}</span>`;
            } else {
                // 単体の場合は「名称」＋「Lv」
                const sample = group.currentMonster || group.members.find(m => m.currentHp > 0) || group.members[0];
                const baseName = sample ? (sample.baseName || sample.name.replace(/^Lv\.\d+\s*/, '')) : group.baseName;
                const lvlStr = (sample && sample.level) ? `Lv.${sample.level}` : '';
                nameHtml = `<span class="formation-name">${baseName}</span>`;
                countHtml = lvlStr ? `<span class="formation-count">${lvlStr}</span>` : '';
            }

            linesHtml.push(`
                <div class="formation-line ${lineClass}">
                    <div class="formation-line-left">
                        <span class="formation-tag ${tagClass}">${tagText}</span>
                        ${nameHtml}
                    </div>
                    ${countHtml}
                </div>
            `);
        });

        if (linesHtml.length === 0) {
            formationHudEl.style.display = 'none';
            return;
        }

        formationHudEl.innerHTML = `
            <div class="formation-title">[ 隊列 FORMATION ]</div>
            <div class="formation-body">
                ${linesHtml.join('')}
            </div>
        `;
        formationHudEl.style.display = 'flex';
    }

    function showMonsterFrame(monster, count = 1, isBoss = false) {
        if (!monsterFrameEl) return;
        monsterFrameEl.className = 'monster-frame' + (isBoss ? ' boss-frame' : '');
        if (monsterNameEl) {
            const rawName = monster.baseName || monster.name.replace(/^Lv\.\d+\s*/, '');
            monsterNameEl.innerText = rawName;
        }
        if (monsterCountEl) {
            if (count > 1) {
                monsterCountEl.innerText = `× ${count}`;
                monsterCountEl.style.display = 'inline-block';
            } else if (monster.level) {
                monsterCountEl.innerText = `Lv.${monster.level}`;
                monsterCountEl.style.display = 'inline-block';
            } else {
                monsterCountEl.style.display = 'none';
            }
        }
        if (monsterImgEl) {
            monsterImgEl.src = monster.img;
            // 専用の絵がないエネミーは、ほかの絵の色味を変えて使う (imgFilter)
            monsterImgEl.style.filter = monster.imgFilter || '';
            // 絵の大きさの倍率 (imgScale)。指定がなければ等倍
            if (monsterImgEl.parentElement) {
                monsterImgEl.parentElement.style.setProperty('--monster-img-scale', monster.imgScale || 1);
            }
        }
        // HPバーは常に非表示（HPは常に表示不要）
        if (monsterHpBarEl && monsterHpBarEl.parentElement) {
            monsterHpBarEl.parentElement.style.display = 'none';
        }
        monsterFrameEl.style.display = 'flex';
        updateBattleFormationUI();
    }

    function updateMonsterHpBar(currentHp, maxHp) {
        // HPは常に表示不要
    }

    function playMonsterHitAnim() {
        if (!monsterFrameEl) return;
        monsterFrameEl.classList.remove('monster-hit', 'monster-magic-hit');
        void monsterFrameEl.offsetWidth;
        monsterFrameEl.classList.add('monster-hit');
    }

    function playMonsterMagicHitAnim() {
        if (!monsterFrameEl) return;
        monsterFrameEl.classList.remove('monster-hit', 'monster-magic-hit');
        void monsterFrameEl.offsetWidth;
        monsterFrameEl.classList.add('monster-magic-hit');
    }

    function hideMonsterFrame(animType = '') {
        updateBattleFormationUI();
        if (!monsterFrameEl || monsterFrameEl.style.display === 'none') return;
        if (animType === 'defeated') {
            monsterFrameEl.classList.add('monster-defeated');
            setTimeout(() => {
                monsterFrameEl.style.display = 'none';
                monsterFrameEl.classList.remove('monster-defeated');
                updateBattleFormationUI();
            }, 800);
        } else if (animType === 'fled') {
            monsterFrameEl.classList.add('monster-fled');
            setTimeout(() => {
                monsterFrameEl.style.display = 'none';
                monsterFrameEl.classList.remove('monster-fled');
                updateBattleFormationUI();
            }, 400);
        } else {
            monsterFrameEl.style.display = 'none';
            updateBattleFormationUI();
        }
    }

    // ========================================================
    // 戦闘専用 横長メッセージ & コマンド選択 (完全排他制御)
    // ========================================================
    function showBattleMessage(text, showCloseHint = false) {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
        // コマンドウィンドウおよび探索用通常メッセージは完全非表示
        if (battleCommandBox) battleCommandBox.style.display = 'none';
        const exploreMessageBox = document.getElementById('message-box');
        if (exploreMessageBox) exploreMessageBox.style.display = 'none';

        player.isEventActive = true;
        isBattleMessageShown = true;
        isBattleMessageClosable = !!showCloseHint;
        if (battleMessageText) battleMessageText.innerText = text;
        if (battleMessageHint) {
            battleMessageHint.style.display = showCloseHint ? 'block' : 'none';
            if (showCloseHint) {
                battleMessageHint.innerText = MESSAGES.HINT_CLOSE;
            }
        }
        if (battleMessageBox) {
            battleMessageBox.style.display = 'block';
        }
        addMessageLog(text);
    }

    function hideBattleMessage() {
        isBattleMessageShown = false;
        isBattleMessageClosable = false;
        if (battleMessageBox) battleMessageBox.style.display = 'none';
        if (battleMessageText) battleMessageText.innerText = '';
        if (battleMessageHint) battleMessageHint.style.display = 'none';
    }

    function showBattleCommands(headerText, options, hintText, onSelectCallback, defaultIndex = 0) {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
        // 戦闘メッセージおよび探索用通常メッセージは完全非表示 (同時に表示しない)
        hideBattleMessage();
        const exploreMessageBox = document.getElementById('message-box');
        if (exploreMessageBox) exploreMessageBox.style.display = 'none';

        player.isEventActive = true;
        battleCommands = options;
        const initialIdx = (typeof defaultIndex === 'number' && defaultIndex >= 0 && defaultIndex < options.length) ? defaultIndex : 0;
        battleSelectedIndex = initialIdx;
        onBattleCommandSelect = onSelectCallback;
        battleLastActionTime = 0;

        if (battleCommandHeader) {
            battleCommandHeader.textContent = headerText;
        }

        if (battleCommandListEl) {
            battleCommandListEl.innerHTML = '';
            options.forEach((opt, index) => {
                const item = document.createElement('div');
                item.className = `command-item ${index === initialIdx ? 'selected' : ''}`;
                item.innerHTML = '<span class="cursor">▶</span><span></span>';
                item.lastElementChild.textContent = opt; // 選択肢 (冒険者名を含む) は文字列として表示
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    battleSelectedIndex = index;
                    confirmBattleCommand();
                });
                battleCommandListEl.appendChild(item);
            });
        }

        if (battleCommandHintEl) {
            // 案内がなければ区切り線ごと隠す (コマンド選択中は「＊」も出さない)
            battleCommandHintEl.innerText = hintText || '';
            battleCommandHintEl.style.display = hintText ? '' : 'none';
        }

        if (battleCommandBox) {
            battleCommandBox.style.display = 'block';
        }
    }

    function hideBattleCommands() {
        if (battleCommandBox) {
            battleCommandBox.style.display = 'none';
        }
        if (battleCommandListEl) {
            battleCommandListEl.innerHTML = '';
        }
        battleCommands = [];
        onBattleCommandSelect = null;
        onBattleRepeatKey = null;
    }

    function updateBattleCommandSelection(delta) {
        if (battleCommands.length === 0 || !battleCommandListEl) return;
        playCursorSE();

        const items = battleCommandListEl.querySelectorAll('.command-item');
        if (items.length > 0 && items[battleSelectedIndex]) {
            items[battleSelectedIndex].classList.remove('selected');
            battleSelectedIndex = (battleSelectedIndex + delta + battleCommands.length) % battleCommands.length;
            items[battleSelectedIndex].classList.add('selected');

            if (typeof items[battleSelectedIndex].scrollIntoView === 'function') {
                items[battleSelectedIndex].scrollIntoView({ block: 'nearest' });
            }
        }
    }

    function confirmBattleCommand() {
        if (!onBattleCommandSelect || battleCommands.length === 0) return;
        battleLastActionTime = performance.now();
        playConfirmSE();

        const selectedValue = battleCommands[battleSelectedIndex];
        if (battleCommandBox) battleCommandBox.style.display = 'none';
        if (battleCommandListEl) battleCommandListEl.innerHTML = '';
        battleCommands = [];

        const callback = onBattleCommandSelect;
        onBattleCommandSelect = null;
        callback(selectedValue);
    }

    // 条件に合う最初の選択肢を即決定 (Y / N / Esc ショートカット用)
    function confirmBattleCommandWhere(predicate) {
        const idx = battleCommands.findIndex(predicate);
        if (idx === -1) return false;
        battleSelectedIndex = idx;
        confirmBattleCommand();
        return true;
    }

    // ========================================================
    // 戦闘中の入力処理 (dungeon.js のキーイベントから委譲される)
    // ========================================================

    // 戦闘中、または戦闘メッセージの表示中 (逃走成功〜終了メッセージ等) は入力を戦闘側で処理する
    function isBattleInputActive() {
        return inBattle || isBattleMessageShown || battleCommands.length > 0;
    }

    /**
     * keydown の委譲先。戦闘側で処理した (探索側に渡さない) 場合は true を返す
     */
    function handleBattleKeyDown(e) {
        if (!isBattleInputActive()) return false;

        if (battleCommands.length > 0) {
            // [R] キーによる前ターン行動リピート (キャラ別)
            if (inBattle && onBattleRepeatKey && (e.key === 'r' || e.key === 'R')) {
                e.preventDefault();
                onBattleRepeatKey();
                return true;
            }

            // Esc / Backspace で「やめる」「もどる」「やりなおす (いいえ)」を素早く実行
            if (e.key === 'Escape' || e.key === 'Backspace') {
                if (confirmBattleCommandWhere(isCancelCommand)) {
                    e.preventDefault();
                }
                return true;
            }

            // [Y] / [N] キーで肯定・否定の選択肢を素早く実行
            if (e.key === 'y' || e.key === 'Y') {
                if (confirmBattleCommandWhere(isYesCommand)) e.preventDefault();
                return true;
            }
            if (e.key === 'n' || e.key === 'N') {
                if (confirmBattleCommandWhere(isNoCommand)) e.preventDefault();
                return true;
            }

            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                updateBattleCommandSelection(-1);
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                updateBattleCommandSelection(1);
            }
            return true;
        }

        if (e.key === 'Escape') {
            closeBattleResult();
        }
        return true;
    }

    /**
     * 決定キー (Space / Enter のリリース) の委譲先。戦闘側で処理した場合は true を返す
     * ※ 攻防の自動進行メッセージ中は入力を無視する
     */
    function handleBattleConfirm() {
        if (!isBattleInputActive()) return false;

        // 微小連打クールダウン
        if (performance.now() - battleLastActionTime < BATTLE_INPUT_COOLDOWN_MS) {
            return true;
        }

        if (battleCommands.length > 0) {
            confirmBattleCommand();
        } else {
            closeBattleResult();
        }
        return true;
    }

    // 戦闘終了メッセージを閉じて探索へ復帰
    function closeBattleResult() {
        if (!isBattleMessageClosable) return;
        hideBattleMessage();
        hideBattleCommands();
        hideMonsterFrame();
        hideMessage();
    }

    // ========================================================
    // モンスターデータ定義
    // バランスの目安: 「開始直後 (Lv1・初期装備) の戦士がゴブリンと1対1で戦うと五分五分」の強さの 80%。
    //   ほかのエネミーもゴブリンと同じ割合で強さをそろえている
    // ========================================================
    const MONSTER_TABLE = {
        'B1F': [
            {
                id: 'goblin',
                baseName: 'ゴブリン (Goblin)',
                name: 'ゴブリン (Goblin)',
                levelMin: 1,
                levelMax: 3,
                spd: 12,
                maxHp: 51,
                atkMin: 10,
                atkMax: 14,
                exp: 22,
                gold: 25,
                drops: [{ itemId: 'dagger', rate: 0.10 }, { itemId: 'leather_armor', rate: 0.08 }],
                img: 'assets/monsters/goblin.jpg',
                encounterMsg: '暗がりから血に飢えた小型の魔獣が飛び出してきた！'
            },
            {
                id: 'skeleton',
                baseName: 'スケルトン (Skeleton Warrior)',
                name: 'スケルトン (Skeleton Warrior)',
                levelMin: 2,
                levelMax: 4,
                spd: 8,
                maxHp: 56,
                atkMin: 10,
                atkMax: 15,
                exp: 28,
                gold: 40,
                drops: [{ itemId: 'broadsword', rate: 0.08 }, { itemId: 'leather_armor', rate: 0.08 }],
                img: 'assets/monsters/skeleton.jpg',
                encounterMsg: '朽ちた甲冑を纏った骸骨の剣士が立ちはだかった！'
            }
        ],
        'B2F': [
            {
                id: 'skeleton',
                baseName: 'スケルトン・ベテラン (Elite Skeleton)',
                name: 'スケルトン・ベテラン (Elite Skeleton)',
                levelMin: 3,
                levelMax: 5,
                spd: 9,
                maxHp: 80,
                atkMin: 14,
                atkMax: 19,
                exp: 38,
                gold: 55,
                drops: [{ itemId: 'broadsword', rate: 0.12 }, { itemId: 'chain_mail', rate: 0.08 }],
                img: 'assets/monsters/skeleton.jpg',
                encounterMsg: '地下深くを彷徨う冷酷な骸骨騎士が切先を向けた！'
            },
            {
                id: 'orc',
                baseName: 'オーク・バーサーカー (Orc Berserker)',
                name: 'オーク・バーサーカー (Orc Berserker)',
                levelMin: 4,
                levelMax: 6,
                spd: 7,
                maxHp: 84,
                atkMin: 15,
                atkMax: 21,
                exp: 45,
                gold: 70,
                drops: [{ itemId: 'battle_axe', rate: 0.10 }, { itemId: 'chain_mail', rate: 0.08 }],
                img: 'assets/monsters/orc.jpg',
                encounterMsg: '血塗られた重戦斧を掲げた狂戦士オークが現れた！'
            }
        ]
    };

    // ラスボス。Lv30 前後の6人パーティで倒せる強さ
    // (Lv26 では勝率2割ほど、Lv28 で5割ほど、Lv30 で8割ほど、Lv32 ならまず勝てる)
    const BOSS_MONSTER_TEMPLATE = {
        id: 'demon_lord',
        baseName: '古代の魔王 (Ancient Demon Lord)',
        name: '古代の魔王 (Ancient Demon Lord)',
        levelMin: 30,
        levelMax: 30,
        spd: 40,
        maxHp: 2800,
        atkMin: 110,
        atkMax: 140,
        exp: 120,
        gold: 300,
        drops: [{ itemId: 'plate_armor', rate: 1.0 }],
        img: 'assets/monsters/demon_lord.jpg',
        encounterMsg: 'ダンジョンの最奥で、不気味な気配を放つ古代の魔王が立ちふさがった！\n魔王「愚かな冒険者よ、我が領域を侵した罪、万死に値する！」',
        canPersuade: true,   // 『扉の鍵』を見せる説得で戦いを終えられる
        persuadeMinLevel: 30, // 説得する者 (隊列の先頭) のレベルがこれ未満だと、鍵があっても失敗する
        isFinalBoss: true    // 倒すとダンジョン制覇
    };

    // 階段などを守るガーディアン (dungeon.js の FLOORS の stairs[...].guardian で ID を指定)
    // ボスと同じく逃げられない。挑む前に引き返すかを選べる
    const GUARDIAN_TEMPLATES = {
        // 地下2階へ降りる階段の番人。Lv20 前後の6人パーティでようやく倒せる強さ
        // (Lv18 では勝率3割ほど、Lv20 で8割ほど、Lv22 ならまず勝てる)
        tomozo_ghost: {
            id: 'tomozo_ghost',
            baseName: 'トモゾウの怨霊 (Tomozo\'s Wraith)',
            name: 'トモゾウの怨霊 (Tomozo\'s Wraith)',
            levelMin: 20,
            levelMax: 20,
            spd: 30,
            maxHp: 2000,
            atkMin: 90,
            atkMax: 115,
            exp: 615,      // ×expRate で約 2400。Lv20 の6人なら1人 400 (ちょうど1レベル分)
            gold: 1000,
            drops: [{ itemId: 'plate_armor', rate: 0.5 }],
            // 専用イラスト: フォークと鎌(釜)を持ったピエロ衣装・メガネの死神
            img: 'assets/monsters/tomozo_ghost.jpg',
            imgFilter: '',
            imgScale: 1.5,
            encounterMsg: '階段の前の闇が凍りつき、青白い怨霊が姿を現した！\nトモゾウの怨霊「この先へは…行かせぬ…！」',
            approachMsg: '地下2階へ降りる階段の前に、青白い人影が揺らめいている…\n「トモゾウの怨霊」が階段を守っているようだ。\n\n(ボスと同じく、戦いが始まると逃げられません)'
        }
    };

    // ========================================================
    // 経験値・速度・モンスター生成計算
    // ========================================================
    /**
     * 敵とプレイヤーのレベル差に基づいて獲得経験値を計算する
     * - 敵レベル > プレイヤーレベル (格上): レベル差1につき +30% のボーナス付与 (レベル差が大きいほど大幅増加)
     * - 敵レベル < プレイヤーレベル (格下): レベル差1につき -10% 減衰 (最低保証50%)
     * @param {number} baseExp エネミーの基礎経験値
     * @param {number} monsterLevel エネミーのレベル
     * @param {number} playerLevel プレイヤーの現在レベル
     * @returns {{ finalExp: number, bonusExp: number, diff: number, multiplier: number }}
     */
    function calculateBattleExp(baseExp, monsterLevel, playerLevel) {
        const mLevel = Math.max(1, monsterLevel || 1);
        const pLevel = Math.max(1, playerLevel || 1);
        const diff = mLevel - pLevel;
        let multiplier = 1.0;

        if (diff > 0) {
            // 格上撃破ボーナス: レベル差1ごとに+30%増加 (例: Lv差+1で1.3倍、Lv差+2で1.6倍、Lv差+5で2.5倍)
            multiplier = 1.0 + (diff * 0.30);
        } else if (diff < 0) {
            // 格下撃破補正: レベル差1ごとに-10%減衰 (下限50%。B1F で稼ぎ続けても Lv20 まで届くように)
            multiplier = Math.max(0.50, 1.0 + (diff * 0.10));
        }

        const finalExp = Math.max(1, Math.round(baseExp * multiplier));
        const bonusExp = finalExp - baseExp;
        return { finalExp, bonusExp, diff, multiplier };
    }

    /**
     * 戦闘勝利時の経験値・ゴールド分配処理 (パターン2: 生存人数で頭割り + 各自のレベル差補正)
     * @param {Array<{name: string, level: number, baseExp: number, gold: number}>} defeatedList
     * @returns {{ memberResults: Array<{member: Object, exp: number, bonusExp: number}>, livingCount: number, totalGold: number, totalGainedExp: number }}
     */
    function distributeBattleExpDivided(defeatedList) {
        const livingMembers = (Array.isArray(player.partyMembers) && player.partyMembers.length > 0)
            ? player.partyMembers.filter(isMemberAlive)
            : [player];
        const livingCount = Math.max(1, livingMembers.length);

        let totalGold = 0;
        defeatedList.forEach(d => {
            totalGold += (d.gold || 0);
        });

        const memberResults = [];

        livingMembers.forEach(m => {
            let memberTotalExp = 0;
            let memberTotalBonus = 0;

            defeatedList.forEach(d => {
                const baseExp = d.baseExp !== undefined ? d.baseExp : (d.exp || 0);
                // 敵1体ごとの基礎EXPを生残人数で等分 (最低保証1)
                const shareBaseExp = Math.max(1, Math.round(baseExp / livingCount));
                // そのメンバー自身のレベルと敵レベルでボーナス/減衰を個別に計算
                const expRes = calculateBattleExp(shareBaseExp, d.level, m.level);
                memberTotalExp += expRes.finalExp;
                memberTotalBonus += expRes.bonusExp;
            });

            m.exp = (m.exp || 0) + memberTotalExp;
            memberResults.push({
                member: m,
                exp: memberTotalExp,
                bonusExp: memberTotalBonus
            });
        });

        // 勝利メッセージに出す獲得EXP (各メンバーが実際に得たEXPの合計)
        const totalGainedExp = memberResults.reduce((sum, r) => sum + r.exp, 0);

        // リーダープロパティと同期
        syncPartyLeader(player, false);
        updateStatusUI();

        return {
            memberResults,
            livingCount,
            totalGold,
            totalGainedExp
        };
    }

    /**
     * 倒したエネミーの落とした武具を抽選し、未鑑定の品として荷物に入れる
     * 1体につき最大1つ (drops の先頭から順に rate の確率で判定)
     * @param {Array<{drops?: Array<{itemId: string, rate: number}>}>} defeatedList
     * @returns {string[]} 落とした品の ID
     */
    function collectBattleDrops(defeatedList) {
        const dropped = [];
        defeatedList.forEach(d => {
            const hit = (d.drops || []).find(drop => Math.random() < drop.rate);
            if (hit && getItemDef(hit.itemId)) dropped.push(makeItemId(hit.itemId, rollItemPlus()));
        });
        if (!Array.isArray(player.unidentified)) player.unidentified = [];
        player.unidentified.push(...dropped);
        return dropped;
    }

    /**
     * エネミー個体を生成し、レベル幅から抽選＆ステータス補正を行う
     */
    function createMonsterIndividual(template) {
        const minLvl = template.levelMin || template.level || 1;
        const maxLvl = template.levelMax || template.level || minLvl;
        const rolledLevel = Math.floor(Math.random() * (maxLvl - minLvl + 1)) + minLvl;

        const lvlDelta = rolledLevel - minLvl;
        const scaledMaxHp = template.maxHp + (lvlDelta * 4);
        const scaledAtkMin = template.atkMin + lvlDelta;
        const scaledAtkMax = template.atkMax + lvlDelta;
        const baseSpd = template.spd || 10;
        const scaledSpd = baseSpd + Math.floor(lvlDelta * 0.8);
        const scaledExp = Math.round(template.exp * (1 + lvlDelta * 0.15) * GAME_RULES.battle.expRate);
        const scaledGold = Math.round(template.gold * (1 + lvlDelta * 0.15));

        const baseName = template.baseName || template.name.replace(/^Lv\.\d+\s*/, '');
        const formattedName = baseName;

        return {
            ...template,
            baseName: baseName,
            level: rolledLevel,
            name: formattedName,
            maxHp: scaledMaxHp,
            currentHp: scaledMaxHp,
            atkMin: scaledAtkMin,
            atkMax: scaledAtkMax,
            spd: scaledSpd,
            exp: scaledExp,
            gold: scaledGold
        };
    }

    /**
     * 同種エネミーの部隊（グループ）オブジェクトを生成
     * 前衛となる同種エネミー全員を個体リスト (members) として管理
     */
    function createBattleGroup(template, count) {
        const c = Math.max(1, count || 1);
        const members = [];
        for (let i = 0; i < c; i++) {
            members.push(createMonsterIndividual(template));
        }
        return {
            template: template,
            baseName: template.baseName || template.name.replace(/^Lv\.\d+\s*/, ''),
            count: c,
            aliveCount: c,
            members: members,
            get currentMonster() {
                return this.members.find(m => m.currentHp > 0) || this.members[this.members.length - 1];
            }
        };
    }

    function getPlayerSpeed(p) {
        const baseSpd = 10 + (p.level * 2);
        const equipSpd = getPlayerSpdBonus(p);
        const roll = Math.floor(Math.random() * 4); // 0〜3
        return baseSpd + equipSpd + roll;
    }

    function getEnemySpeed(enemy) {
        const baseSpd = enemy.spd || 10;
        const roll = Math.floor(Math.random() * 4); // 0〜3
        return baseSpd + roll;
    }

    const sleep = (ms) => new Promise(res => setTimeout(res, (typeof window !== 'undefined' && window.BATTLE_ACTION_DELAY_MS !== undefined) ? window.BATTLE_ACTION_DELAY_MS : ms));
    let BATTLE_ACTION_DELAY_MS = GAME_RULES.battle.actionDelayMs; // 各アクション間のウェイト
    window.BATTLE_ACTION_DELAY_MS = BATTLE_ACTION_DELAY_MS;


    // ========================================================
    // 戦闘アクションバッジ（行動指示）の全消去
    // ========================================================
    // keepLastActions = true のときは [R] リピート用の前ターン行動 (lastBattleAction) を残す
    function clearAllActionBadges(keepLastActions = false) {
        if (typeof player !== 'undefined' && player && Array.isArray(player.partyMembers)) {
            player.partyMembers.forEach(m => {
                delete m.currentBattleAction;
                if (!keepLastActions) delete m.lastBattleAction;
            });
        }
        document.querySelectorAll('.member-action-badge').forEach(b => {
            b.className = 'member-action-badge';
            b.innerText = '';
        });
    }

    // ========================================================
    // コア戦闘進行エンジン (startBattle, triggerBossBattle, etc.)
    // ========================================================
    function startBattle(monsterOrGroups, isBoss = false, onBossDefeated = null) {
        player.isMoving = true;
        setInBattle(true);
        if (typeof playBGM === 'function') {
            playBGM(isBoss ? 'boss' : 'battle');
        }

        // 単体エネミーまたはグループ配列の正規化
        if (Array.isArray(monsterOrGroups)) {
            battleGroups = monsterOrGroups.map(g => createBattleGroup(g.template, g.count));
        } else {
            battleGroups = [createBattleGroup(monsterOrGroups, 1)];
        }
        // ボス戦の相手 (説得できるか・倒すとダンジョン制覇か・逃走失敗時の名前に使う)
        const bossTemplate = isBoss ? battleGroups[0].template : null;
        const bossShortName = bossTemplate ? bossTemplate.baseName.replace(/\s*\(.*\)$/, '') : '';
        defeatedMonsters = [];
        hideBattleCommands();

        // 各メンバーの前回バトル行動を初期化
        if (player.partyMembers) {
            player.partyMembers.forEach(m => {
                m.lastBattleAction = null;
            });
        }

        // 並びの先頭グループの先頭生存個体をアクティブエネミーに設定
        activeMonster = battleGroups[0].currentMonster;

        flashScreen(isBoss);
        showMonsterFrame(activeMonster, battleGroups[0].aliveCount, isBoss);

        // 連打ガード
        blockInput();

        const isSolo = battleGroups.length === 1 && battleGroups[0].aliveCount === 1;
        let encounterText = '';
        if (isSolo) {
            encounterText = `${activeMonster.baseName || activeMonster.name} が現れた！\n\n${activeMonster.encounterMsg}`;
        } else {
            encounterText = `敵が現れた！\n\n武器を構え、襲いかかってきた！`;
        }

        showBattleMessage(encounterText);

        // 生存メンバー取得ヘルパー
        const getLivingMembers = () => (player.partyMembers || []).filter(isMemberAlive);
        const getLivingFrontMembers = () => (player.partyMembers || []).slice(0, GAME_RULES.party.frontRowSize).filter(isMemberAlive);
        const getLivingRearMembers = () => (player.partyMembers || []).slice(GAME_RULES.party.frontRowSize, GAME_RULES.party.maxSize).filter(isMemberAlive);

        // 全滅処理
        const handlePartyWipeout = (roundLogs = []) => {
            triggerPartyWipeout(roundLogs);
        };

        const handleTargetDefeated = (target, activeGroup, roundLogs) => {
            const defeatedName = activeGroup.aliveCount > 1 ? target.baseName : target.name;
            defeatedMonsters.push({
                name: target.name,
                baseName: target.baseName,
                level: target.level,
                baseExp: target.exp,
                gold: target.gold,
                drops: target.drops
            });

            activeGroup.aliveCount = activeGroup.members.filter(m => m.currentHp > 0).length;

            let defeatLog = `★ ${defeatedName} を倒した！`;
            if (activeGroup.aliveCount > 0) {
                playMonsterHitAnim();
                playTone([400, 520], 'sine', 0.1, 0.25);

                // 前衛の次の生存個体にターゲットを切り替え
                activeMonster = activeGroup.members.find(m => m.currentHp > 0);
                showMonsterFrame(activeMonster, activeGroup.aliveCount, isBoss);
            }
            roundLogs.push(defeatLog);
            updateBattleFormationUI();
            return defeatLog;
        };

        const handleGroupWipedOut = async (roundLogs) => {
            battleGroups.shift();

            if (battleGroups.length > 0) {
                playMonsterHitAnim();
                playTone([440, 660], 'sawtooth', 0.15, 0.25);

                const nextGroup = battleGroups[0];
                activeMonster = nextGroup.members.find(m => m.currentHp > 0) || nextGroup.currentMonster;
                showMonsterFrame(activeMonster, nextGroup.aliveCount, isBoss);

                const nextDisplayName = nextGroup.aliveCount > 1
                    ? `${nextGroup.baseName}たち`
                    : (nextGroup.currentMonster ? (nextGroup.currentMonster.baseName || nextGroup.currentMonster.name) : nextGroup.baseName);

                const advanceLog = `後衛に控えていた ${nextDisplayName} が前に進み出て前衛となった！`;
                updateBattleFormationUI();
                showBattleMessage(advanceLog);
                await sleep(BATTLE_ACTION_DELAY_MS);
                showBattleTurn();
                return;
            }

            // すべてのエネミーを撃破 (完全勝利!)
            hideMonsterFrame('defeated');
            updateBattleFormationUI();
            playVictorySE();
            if (typeof playBGM === 'function') {
                playBGM('victory');
            }

            setInBattle(false);
            clearAllActionBadges();
            onBattleRepeatKey = null;
            hideBattleCommands();
            player.isMoving = false;

            // パターン2: 生存人数で頭割り + 各自のレベル差補正で個別経験値分配
            const rewardSummary = distributeBattleExpDivided(defeatedMonsters);
            player.gold += rewardSummary.totalGold;
            const droppedIds = collectBattleDrops(defeatedMonsters);
            syncPartyLeader(player, false);
            updateStatusUI();
            saveTempCampPlayer(player);

            if (isBoss && onBossDefeated) {
                onBossDefeated();
            }

            // 落とした武具は鑑定するまで「武器？」「防具？」
            const dropText = droppedIds.map(id => `\n★ 『${getUnidentifiedName(id)}』を手に入れた！`).join('');
            const victoryText = `敵を打ち倒した！\n★ ${rewardSummary.totalGainedExp} EXP を獲得！\n★ ${rewardSummary.totalGold} GOLD を手に入れた！`
                + dropText
                + (bossTemplate && bossTemplate.isFinalBoss ? "\n★ ダンジョン制覇！ ★" : "");

            showBattleMessage(victoryText, true);
        };

        /**
         * 行動サマリー取得 (リピート表示用)
         */
        const getActionSummary = (act, actor = null) => {
            if (!act) return null;
            switch (act.type) {
                case 'attack':
                    return act.isRanged ? '援護攻撃' : 'たたかう';
                case 'defend':
                    return 'ぼうぎょ';
                case 'magic':
                    if (actor && act.spell && getSpellUses(actor, act.spell.id) <= 0) {
                        return 'ぼうぎょ (回数切れ)';
                    }
                    return act.spell ? act.spell.name : 'まほう';
                case 'item': {
                    const itemId = act.itemId || (act.itemDef && act.itemDef.id);
                    if (actor && itemId && (!player.inventory || player.inventory.indexOf(itemId) === -1)) {
                        return 'ぼうぎょ (品切れ)';
                    }
                    return act.itemDef ? act.itemDef.name : 'どうぐ';
                }
                case 'escape':
                    return 'にげる';
                case 'persuade':
                    return '説得';
                default:
                    return null;
            }
        };

        /**
         * 戦闘コマンドバッジ更新ヘルパー
         */
        const setMemberActionBadge = (globalIdx, action = null, isSelecting = false) => {
            const mem = player.partyMembers && player.partyMembers[globalIdx];
            if (mem) {
                if (isSelecting) {
                    mem.currentBattleAction = { type: '_selecting' };
                } else if (action) {
                    mem.currentBattleAction = action;
                } else {
                    delete mem.currentBattleAction;
                }
            }

            const badgeEl = document.getElementById(`party-act-${globalIdx}`);
            if (!badgeEl) return;

            // 行動バッジ (文言は storage.js の getActionBadge)
            const badge = getActionBadge(isSelecting ? { type: '_selecting' } : action);
            badgeEl.className = 'member-action-badge' + (badge ? ' ' + badge.cls : '');
            badgeEl.innerText = badge ? badge.text : '';
        };

        /**
         * ターンコマンド選択フェーズ (Wizardry完全準拠: 直接1人目の個別指示へ)
         */
        const showBattleTurn = (turnLog = '') => {
            const living = getLivingMembers();
            if (living.length === 0) {
                handlePartyWipeout();
                return;
            }

            updateBattleFormationUI();
            startIndividualCommandInput(turnLog);
        };

        /**
         * 個別指示入力フロー (キャラ別 [R] キーリピート対応 & ステータス連動バッジ表示)
         */
        const startIndividualCommandInput = (turnLog = '') => {
            clearAllActionBadges(true);
            const living = getLivingMembers();
            const actions = [];

            const promptMember = (mIdx) => {
                if (!inBattle) return;

                if (mIdx >= living.length) {
                    // 全員入力完了 -> ハイライト枠解除 & リピートキー解除
                    onBattleRepeatKey = null;
                    document.querySelectorAll('.party-card').forEach(c => c.classList.remove('party-card-active'));

                    // パターン1: 「たたかいますか？」確認ウィンドウ表示
                    const confirmHeader = '【COMMAND】 たたかいますか？';
                    const confirmOptions = [BATTLE_COMMANDS.CONFIRM, BATTLE_COMMANDS.RETRY];
                    showBattleCommands(confirmHeader, confirmOptions, '', (choice) => {
                        if (choice === BATTLE_COMMANDS.CONFIRM) {
                            // ラウンド実行開始
                            hideBattleCommands();
                            hideBattleMessage();
                            actions.forEach(a => {
                                if (a.actor) {
                                    // 循環参照を完全回避するため、プリミティブ値と軽量情報のみ保持
                                    a.actor.lastBattleAction = {
                                        type: a.type,
                                        spell: a.spell ? { id: a.spell.id, name: a.spell.name } : null,
                                        itemDef: a.itemDef ? { id: a.itemDef.id, name: a.itemDef.name } : null,
                                        itemId: a.itemId,
                                        isRanged: a.isRanged
                                    };
                                }
                            });
                            executeBattleRound(actions);
                        } else {
                            // 「やりなおす (いいえ)」: 直前（最後）のキャラの入力に戻る
                            playTone(180, 'sawtooth', 0.1, 0.15);
                            if (actions.length > 0) {
                                actions.pop(); // 最後のキャラのアクションを破棄
                                const lastMemberIdx = living.length - 1;
                                const lastGlobalIdx = player.partyMembers.indexOf(living[lastMemberIdx]);
                                setMemberActionBadge(lastGlobalIdx, null);
                                promptMember(lastMemberIdx);
                            } else {
                                promptMember(0);
                            }
                        }
                    }, 0);
                    return;
                }


                const m = living[mIdx];
                const memberGlobalIdx = player.partyMembers.indexOf(m);
                const isFront = isFrontRow(memberGlobalIdx);
                const rowLabel = isFront ? '【前衛】' : '【後衛】';

                // 現在コマンド入力中のメンバーカードをハイライト & バッジを「選択中...」に設定
                document.querySelectorAll('.party-card').forEach(c => c.classList.remove('party-card-active'));
                const activeCard = document.getElementById(`party-row-${memberGlobalIdx}`);
                if (activeCard) activeCard.classList.add('party-card-active');
                setMemberActionBadge(memberGlobalIdx, null, true);

                // アクション決定共通ハンドラ (コマンド選択肢およびコールバックを即座に破棄)
                const commitMemberAction = (actionObj) => {
                    onBattleRepeatKey = null;
                    hideBattleCommands();
                    actions.push(actionObj);
                    if (actionObj && actionObj.type && actionObj.type !== 'escape') {
                        m.lastCommandType = actionObj.type; // 戦闘をまたいでコマンド種別を記憶 (パターンB)
                    }
                    setMemberActionBadge(memberGlobalIdx, actionObj);
                    promptMember(mIdx + 1);
                };

                // キャラ別リピート実行関数
                const tryRepeatMemberAction = () => {
                    if (!m.lastBattleAction) {
                        playTone(180, 'sawtooth', 0.1, 0.15);
                        if (battleCommandHintEl) {
                            battleCommandHintEl.innerText = `※ ${m.name} の前ターンの行動がありません！`;
                            battleCommandHintEl.style.display = '';
                        }
                        return false;
                    }

                    const prev = m.lastBattleAction;

                    if (prev.type === 'magic') {
                        // 前ターンの記録は id と名前だけなので、呪文の定義を引き直す
                        const spell = prev.spell ? SPELLS.find(s => s.id === prev.spell.id) : null;
                        if (!spell) {
                            playTone(180, 'sawtooth', 0.1, 0.15);
                            return false;
                        }
                        if (getSpellUses(m, spell.id) <= 0) {
                            // 使用回数切れのときは自動で「ぼうぎょ」にフォールバック
                            addMessageLog(`※ ${m.name} は【${spell.name}】の使用回数が尽きたため【ぼうぎょ】をとった`);
                            playConfirmSE();
                            commitMemberAction({ type: 'defend', actor: m, fallbackReason: 'spell_exhausted' });
                            return true;
                        }
                        let target = prev.targetMember;
                        if (spell.type === 'heal') {
                            const livingNow = getLivingMembers();
                            if (!target || !isMemberAlive(target)) {
                                target = [...livingNow].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
                            }
                        }
                        playConfirmSE();
                        commitMemberAction({ type: 'magic', spell: spell, targetMember: target, actor: m });
                        return true;
                    }

                    if (prev.type === 'item') {
                        const itemId = prev.itemId || (prev.itemDef && prev.itemDef.id);
                        const invIdx = player.inventory ? player.inventory.indexOf(itemId) : -1;
                        if (invIdx === -1) {
                            // アイテム枯渇時は自動で「ぼうぎょ」にフォールバック
                            addMessageLog(`※ ${m.name} はアイテム枯渇のため【ぼうぎょ】をとった`);
                            playConfirmSE();
                            commitMemberAction({ type: 'defend', actor: m, fallbackReason: 'item_empty' });
                            return true;
                        }
                        let target = prev.targetMember;
                        const livingNow = getLivingMembers();
                        if (!target || !isMemberAlive(target)) {
                            target = [...livingNow].sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
                        }
                        playConfirmSE();
                        commitMemberAction({
                            type: 'item',
                            invIndex: invIdx,
                            itemId: itemId,
                            itemDef: getItemDef(itemId) || prev.itemDef,
                            targetMember: target,
                            actor: m
                        });
                        return true;
                    }

                    if (prev.type === 'attack') {
                        const isFrontNow = isFrontRow(player.partyMembers.indexOf(m));
                        playConfirmSE();
                        commitMemberAction({ type: 'attack', actor: m, isRanged: !isFrontNow });
                        return true;
                    }

                    if (prev.type === 'defend') {
                        playConfirmSE();
                        commitMemberAction({ type: 'defend', actor: m });
                        return true;
                    }

                    if (prev.type === 'escape') {
                        playConfirmSE();
                        commitMemberAction({ type: 'escape', actor: m });
                        return true;
                    }

                    if (prev.type === 'persuade') {
                        playConfirmSE();
                        commitMemberAction({ type: 'persuade', actor: m });
                        return true;
                    }

                    return false;
                };

                // キーボード [R] キー押下時のハンドラ設定
                onBattleRepeatKey = tryRepeatMemberAction;

                const memberOptions = [];
                if (isFront) {
                    memberOptions.push(BATTLE_COMMANDS.ATTACK, BATTLE_COMMANDS.DEFEND);
                } else {
                    memberOptions.push(BATTLE_COMMANDS.MAGIC, BATTLE_COMMANDS.DEFEND, BATTLE_COMMANDS.ASSIST);
                }
                memberOptions.push(BATTLE_COMMANDS.ITEM);
                if (bossTemplate && bossTemplate.canPersuade && mIdx === 0) {
                    memberOptions.push(BATTLE_COMMANDS.PERSUADE);
                }
                memberOptions.push(BATTLE_COMMANDS.ESCAPE);

                const repeatSummary = getActionSummary(m.lastBattleAction, m);
                if (m.lastBattleAction && repeatSummary) {
                    memberOptions.push(`${BATTLE_COMMANDS.REPEAT_PREFIX} (${repeatSummary})`);
                }

                if (mIdx > 0) {
                    memberOptions.push(COMMON_COMMANDS.CANCEL);
                }

                // 前回の戦闘コマンド記憶に基づく初期カーソル位置の決定 (パターンB)
                let defaultCmdIdx = 0;
                if (m.lastCommandType) {
                    let targetText = null;
                    switch (m.lastCommandType) {
                        case 'attack':
                            targetText = isFront ? BATTLE_COMMANDS.ATTACK : BATTLE_COMMANDS.ASSIST;
                            break;
                        case 'magic':
                            targetText = BATTLE_COMMANDS.MAGIC;
                            break;
                        case 'defend':
                            targetText = BATTLE_COMMANDS.DEFEND;
                            break;
                        case 'item':
                            targetText = BATTLE_COMMANDS.ITEM;
                            break;
                        case 'persuade':
                            targetText = BATTLE_COMMANDS.PERSUADE;
                            break;
                    }
                    if (targetText) {
                        const found = memberOptions.indexOf(targetText);
                        if (found !== -1) defaultCmdIdx = found;
                    }
                } else {
                    // 初回デフォルト: 後衛で戦闘用呪文を習得していれば「まほう」にカーソル
                    const hasBattleMagic = SPELLS.some(s => s.battleUsable && (
                        (Array.isArray(m.spells) && m.spells.includes(s.id)) ||
                        (CLASS_DEFS[m.classId] && CLASS_DEFS[m.classId].initialSpells && CLASS_DEFS[m.classId].initialSpells.includes(s.id))
                    ));
                    if (!isFront && hasBattleMagic) {
                        const magicIdx = memberOptions.indexOf(BATTLE_COMMANDS.MAGIC);
                        if (magicIdx !== -1) defaultCmdIdx = magicIdx;
                    }
                }

                const spellUsesText = getSpellUsesText(m);
                const memberHeader = `【${mIdx + 1}/${living.length}人目: ${m.name} (${m.className}) ${rowLabel}】 HP:${m.hp}/${m.maxHp}${spellUsesText ? `  ${spellUsesText}` : ''}`;
                showBattleCommands(memberHeader, memberOptions, '', (choice) => {
                    if (choice === COMMON_COMMANDS.CANCEL) {
                        onBattleRepeatKey = null;
                        if (mIdx > 0) {
                            setMemberActionBadge(memberGlobalIdx, null);
                            actions.pop();
                            const prevMember = living[mIdx - 1];
                            const prevGlobalIdx = player.partyMembers.indexOf(prevMember);
                            setMemberActionBadge(prevGlobalIdx, null);
                            promptMember(mIdx - 1);
                        } else {
                            playTone(180, 'sawtooth', 0.1, 0.15);
                            promptMember(0);
                        }
                        return;
                    }

                    if (choice.startsWith(BATTLE_COMMANDS.REPEAT_PREFIX)) {
                        tryRepeatMemberAction();
                        return;
                    }

                    if (choice === BATTLE_COMMANDS.ATTACK || choice === BATTLE_COMMANDS.ASSIST) {
                        commitMemberAction({ type: 'attack', actor: m, isRanged: !isFront });
                    } else if (choice === BATTLE_COMMANDS.DEFEND) {
                        commitMemberAction({ type: 'defend', actor: m });
                    } else if (choice === BATTLE_COMMANDS.PERSUADE) {
                        commitMemberAction({ type: 'persuade', actor: m });
                    } else if (choice === BATTLE_COMMANDS.ESCAPE) {
                        commitMemberAction({ type: 'escape', actor: m });
                    } else if (choice === BATTLE_COMMANDS.MAGIC) {
                        onBattleRepeatKey = null;
                        promptMagicChoice(m, (spellAction) => {
                            commitMemberAction(spellAction);
                        }, () => promptMember(mIdx));
                    } else if (choice === BATTLE_COMMANDS.ITEM) {
                        onBattleRepeatKey = null;
                        promptItemChoice(m, (itemAction) => {
                            commitMemberAction(itemAction);
                        }, () => promptMember(mIdx));
                    }
                }, defaultCmdIdx);
            };

            promptMember(0);
        };

        /**
         * 個別指示: 魔法選択
         */
        const promptMagicChoice = (caster, onSelected, onCancel) => {
            const battleSpells = SPELLS.filter(s => s.battleUsable && (
                (Array.isArray(caster.spells) && caster.spells.includes(s.id)) ||
                (CLASS_DEFS[caster.classId] && CLASS_DEFS[caster.classId].initialSpells && CLASS_DEFS[caster.classId].initialSpells.includes(s.id))
            ));

            if (battleSpells.length === 0) {
                playTone(180, 'sawtooth', 0.1, 0.15);
                alert(`${caster.name} は戦闘で使える呪文を習得していません！`);
                onCancel();
                return;
            }

            const spellOptions = [...battleSpells.map(s => `${s.name} (残り${getSpellUses(caster, s.id)}/${getSpellMaxUses(caster, s.id)}回)`), COMMON_COMMANDS.BACK];
            const spellHeader = `【${caster.name} の呪文選択】`;

            let defaultSpellIdx = 0;
            if (caster.lastSelectedSpellId) {
                const sIdx = battleSpells.findIndex(s => s.id === caster.lastSelectedSpellId);
                if (sIdx !== -1) defaultSpellIdx = sIdx;
            }

            showBattleCommands(spellHeader, spellOptions, '', (spellChoice) => {
                if (spellChoice === COMMON_COMMANDS.BACK) {
                    onCancel();
                    return;
                }

                const chosen = battleSpells[spellOptions.indexOf(spellChoice)];
                if (!chosen) { onCancel(); return; }

                caster.lastSelectedSpellId = chosen.id; // 前回呪文を記憶

                if (getSpellUses(caster, chosen.id) <= 0) {
                    playTone(180, 'sawtooth', 0.1, 0.15);
                    alert(MESSAGES.NO_SPELL_USES_LEFT);
                    onCancel();
                    return;
                }

                if (chosen.type === 'heal') {
                    // 回復対象の仲間を選択
                    const living = getLivingMembers();
                    const targetOptions = living.map((tm, tIdx) => `${tIdx + 1}.${tm.name} (H:${tm.hp}/${tm.maxHp})`);
                    targetOptions.push(COMMON_COMMANDS.BACK);

                    showBattleCommands(`【${chosen.name}】の回復対象を選んでください`, targetOptions, '', (tChoice) => {
                        if (tChoice === COMMON_COMMANDS.BACK) {
                            onCancel();
                            return;
                        }
                        const tIdx = targetOptions.indexOf(tChoice);
                        const targetMem = living[tIdx];
                        onSelected({ type: 'magic', spell: chosen, targetMember: targetMem, actor: caster });
                    });
                } else {
                    // 攻撃魔法 (ファイア)
                    onSelected({ type: 'magic', spell: chosen, actor: caster });
                }
            }, defaultSpellIdx);
        };

        /**
         * 個別指示: アイテム選択
         */
        const promptItemChoice = (actor, onSelected, onCancel) => {
            if (!player.inventory || player.inventory.length === 0) {
                alert("もちものがありません！");
                onCancel();
                return;
            }

            const usableIdxs = [];
            player.inventory.forEach((id, idx) => {
                const def = getItemDef(id);
                if (def && def.usable) usableIdxs.push(idx);
            });

            if (usableIdxs.length === 0) {
                alert("戦闘で使えるアイテムがありません！");
                onCancel();
                return;
            }

            const itemOptions = usableIdxs.map(idx => {
                const def = getItemDef(player.inventory[idx]);
                return `${def.name} (${def.desc})`;
            });
            itemOptions.push(COMMON_COMMANDS.BACK);

            let defaultItemIdx = 0;
            if (actor.lastSelectedItemId) {
                const itmIdx = usableIdxs.findIndex(idx => player.inventory[idx] === actor.lastSelectedItemId);
                if (itmIdx !== -1) defaultItemIdx = itmIdx;
            }

            const itemHeader = `【${actor.name} のどうぐ選択】`;
            showBattleCommands(itemHeader, itemOptions, '', (itemChoice) => {
                if (itemChoice === COMMON_COMMANDS.BACK) {
                    onCancel();
                    return;
                }

                const optIdx = itemOptions.indexOf(itemChoice);
                const invIdx = usableIdxs[optIdx];
                const itemDef = getItemDef(player.inventory[invIdx]);
                const chosenItemId = player.inventory[invIdx];
                actor.lastSelectedItemId = chosenItemId; // 前回アイテムを記憶

                // 対象の仲間を選択
                const living = getLivingMembers();
                const targetOptions = living.map((tm, tIdx) => `${tIdx + 1}.${tm.name} (H:${tm.hp}/${tm.maxHp})`);
                targetOptions.push(COMMON_COMMANDS.BACK);

                showBattleCommands(`【${itemDef.name}】を使う対象を選んでください`, targetOptions, '', (tChoice) => {
                    if (tChoice === COMMON_COMMANDS.BACK) {
                        onCancel();
                        return;
                    }
                    const tIdx = targetOptions.indexOf(tChoice);
                    const targetMem = living[tIdx];
                    onSelected({ type: 'item', invIndex: invIdx, itemId: chosenItemId, itemDef: itemDef, targetMember: targetMem, actor: actor });
                });
            }, defaultItemIdx);
        };

        /**
         * 6人パーティ完全対応: 素早さ優先ラウンド実行システム
         */
        const executeBattleRound = async (partyActions) => {
            const livingMembers = getLivingMembers();
            if (livingMembers.length === 0 || battleGroups.length === 0) return;

            const activeGroup = battleGroups[0];
            const livingFrontEnemies = activeGroup.members.filter(m => m.currentHp > 0);
            if (livingFrontEnemies.length === 0) return;

            hideBattleCommands();

            // 1. 防御フラグの先行集約 (ラウンド中の被ダメージ半減用)
            const defendingMembers = new Set();
            partyActions.forEach(a => {
                if (a.type === 'defend' && a.actor) {
                    defendingMembers.add(a.actor.id);
                }
            });

            // 2. 行動キューの構築
            const actionQueue = [];

            // プレイヤー側メンバーのアクション投入
            partyActions.forEach(a => {
                const m = a.actor;
                if (!m || !isMemberAlive(m)) return;

                let spd = getMemberTotalSpd(m) + Math.floor(Math.random() * 4);
                if (a.type === 'escape') spd += 3;
                else if (a.type === 'magic' && a.spell && a.spell.type === 'heal') spd += 2;
                else if (a.type === 'defend') spd += 99; // 防御は先手で体勢をとる

                actionQueue.push({
                    actorType: 'member',
                    member: m,
                    name: m.name,
                    spd: spd,
                    action: a
                });
            });

            // エネミー側のアクション投入
            livingFrontEnemies.forEach(enemy => {
                const eSpd = getEnemySpeed(enemy);
                actionQueue.push({
                    actorType: 'enemy',
                    name: enemy.name,
                    spd: eSpd,
                    monster: enemy
                });
            });

            // 素早さ降順ソート (同速は味方優先、敵同士はランダム)
            actionQueue.sort((a, b) => {
                if (b.spd !== a.spd) return b.spd - a.spd;
                if (a.actorType === 'member' && b.actorType !== 'member') return -1;
                if (b.actorType === 'member' && a.actorType !== 'member') return 1;
                return Math.random() - 0.5;
            });

            let roundLogs = [];
            let partyFled = false;
            let groupWipedOut = false;

            // 3. 行動実行ループ (各アクション1件のみ横長メッセージウィンドウに表示)
            for (let i = 0; i < actionQueue.length; i++) {
                // パーティ全滅判定
                if (getLivingMembers().length === 0) break;

                const item = actionQueue[i];

                if (item.actorType === 'member') {
                    const actor = item.member;
                    // 自身が死亡していたらスキップ
                    if (!isMemberAlive(actor)) continue;

                    const act = item.action;
                    const target = activeGroup.members.find(m => m.currentHp > 0);

                    if (!target && act.type !== 'escape' && act.type !== 'defend') {
                        break;
                    }

                    let actionMsg = '';

                    // --- A. たたかう (直接攻撃 / 援護攻撃) ---
                    if (act.type === 'attack') {
                        const isFront = isFrontRow(player.partyMembers.indexOf(actor));
                        const isCrit = Math.random() < 0.15;
                        const atkBonus = getMemberAtkBonus(actor);
                        const baseAtk = Math.floor(Math.random() * 5) + 6 + (actor.level * 2) + atkBonus;
                        let dmg = isFront ? baseAtk : Math.max(1, Math.floor(baseAtk * 0.7)); // 後衛は70%援護威力
                        if (isCrit) dmg = Math.round(dmg * 1.6);

                        playMonsterHitAnim();
                        playTone([320, 480, 640], 'sawtooth', 0.12, 0.25);

                        target.currentHp = Math.max(0, target.currentHp - dmg);
                        updateMonsterHpBar(target.currentHp, target.maxHp);

                        const targetName = activeGroup.aliveCount > 1 ? target.baseName : target.name;
                        const attackKind = isFront ? '猛撃！' : '後衛から援護攻撃！';

                        if (isCrit) {
                            actionMsg = `★ ${actor.name} の会心の一撃！！\n${targetName} に ${dmg} の大ダメージを与えた！`;
                        } else {
                            actionMsg = `▶ ${actor.name} は${attackKind}\n${targetName} に ${dmg} のダメージを与えた！`;
                        }
                        roundLogs.push(actionMsg);

                        if (target.currentHp <= 0) {
                            const defeatText = handleTargetDefeated(target, activeGroup, roundLogs);
                            if (defeatText) actionMsg += `\n${defeatText}`;
                            const aliveLeft = activeGroup.members.filter(m => m.currentHp > 0).length;
                            if (aliveLeft === 0) {
                                groupWipedOut = true;
                                showBattleMessage(actionMsg);
                                await sleep(BATTLE_ACTION_DELAY_MS);
                                break;
                            }
                        }

                    // --- B. ぼうぎょ ---
                    } else if (act.type === 'defend') {
                        if (act.fallbackReason === 'spell_exhausted') {
                            actionMsg = `▶ ${actor.name} は呪文の使用回数が尽きたため身構えを固めた！ (被ダメージ半減)`;
                        } else if (act.fallbackReason === 'item_empty') {
                            actionMsg = `▶ ${actor.name} はアイテムが尽きたため身構えを固めた！ (被ダメージ半減)`;
                        } else {
                            actionMsg = `▶ ${actor.name} は盾と身構えを固めた！ (被ダメージ半減)`;
                        }
                        roundLogs.push(actionMsg);

                    // --- C. まほう (回復の対象が先に力尽きていた場合は詠唱を取りやめ、使用回数は減らさない) ---
                    } else if (act.type === 'magic' && act.spell.type === 'heal' &&
                        !isMemberAlive(act.targetMember || actor)) {
                        const downTarget = act.targetMember || actor;
                        actionMsg = `▶ ${actor.name} は【${act.spell.name}】を唱えようとしたが、『${downTarget.name}』はすでに力尽きていた...`;
                        roundLogs.push(actionMsg);

                    // --- C. まほう ---
                    } else if (act.type === 'magic') {
                        const spell = act.spell;
                        consumeSpellUse(actor, spell.id);
                        playMagicSE();
                        syncPartyLeader(player, false);
                        updateStatusUI();

                        if (spell.type === 'damage') {
                            // 攻撃呪文 (ファイア)
                            playMonsterMagicHitAnim();
                            const magicDmg = spell.power + Math.floor(Math.random() * 8);
                            target.currentHp = Math.max(0, target.currentHp - magicDmg);
                            updateMonsterHpBar(target.currentHp, target.maxHp);

                            const targetName = activeGroup.aliveCount > 1 ? target.baseName : target.name;
                            actionMsg = `▶ ${actor.name} は【${spell.name}】を放った！\n${targetName} に ${magicDmg} の魔法ダメージ！`;
                            roundLogs.push(actionMsg);

                            if (target.currentHp <= 0) {
                                const defeatText = handleTargetDefeated(target, activeGroup, roundLogs);
                                if (defeatText) actionMsg += `\n${defeatText}`;
                                const aliveLeft = activeGroup.members.filter(m => m.currentHp > 0).length;
                                if (aliveLeft === 0) {
                                    groupWipedOut = true;
                                    showBattleMessage(actionMsg);
                                    await sleep(BATTLE_ACTION_DELAY_MS);
                                    break;
                                }
                            }
                        } else if (spell.type === 'heal') {
                            // 回復呪文 (ヒール)
                            const targetMem = act.targetMember || actor;
                            if (isMemberAlive(targetMem)) {
                                const oldHp = targetMem.hp;
                                targetMem.hp = Math.min(targetMem.maxHp, targetMem.hp + spell.power);
                                const healed = targetMem.hp - oldHp;
                                updateStatusUI();
                                actionMsg = `▶ ${actor.name} は【${spell.name}】を唱えた！\n『${targetMem.name}』の傷が癒え、HPが ${healed} 回復した！`;
                                roundLogs.push(actionMsg);
                            }
                        }

                    // --- D. どうぐ ---
                    } else if (act.type === 'item') {
                        const itemDef = act.itemDef;
                        const targetMem = act.targetMember || actor;
                        const itemId = act.itemId || (act.itemDef && act.itemDef.id);
                        const realIdx = itemId ? player.inventory.indexOf(itemId) : act.invIndex;

                        if (realIdx === -1 || realIdx === undefined || !player.inventory[realIdx]) {
                            // 同じラウンドで先に使い切られていた (効果なし)
                            actionMsg = `▶ ${actor.name} は【${itemDef.name}】を使おうとしたが、もう残っていなかった！`;
                            roundLogs.push(actionMsg);
                        } else if (!isMemberAlive(targetMem)) {
                            // 対象が先に力尽きていた (アイテムは消費しない)
                            actionMsg = `▶ ${actor.name} は『${targetMem.name}』に【${itemDef.name}】を使おうとしたが、すでに力尽きていた...`;
                            roundLogs.push(actionMsg);
                        } else {
                            player.inventory.splice(realIdx, 1);

                            let effectDesc = '';
                            if (itemDef.type === 'heal') {
                                const oldHp = targetMem.hp;
                                targetMem.hp = Math.min(targetMem.maxHp, targetMem.hp + itemDef.power);
                                const healed = targetMem.hp - oldHp;
                                effectDesc = `HPが ${healed} 回復した！`;
                            } else if (itemDef.type === 'mana') {
                                const restored = restoreSpellUses(targetMem, itemDef.power);
                                effectDesc = restored > 0
                                    ? `呪文の使用回数が回復した！ (${getSpellUsesText(targetMem)})`
                                    : 'しかし何も起こらなかった...';
                            } else if (itemDef.type === 'cure_poison') {
                                targetMem.isPoisoned = false;
                                effectDesc = `毒が浄化された！`;
                            }
                            actionMsg = `▶ ${actor.name} は『${targetMem.name}』に【${itemDef.name}】を使った！\n${effectDesc}`;
                            roundLogs.push(actionMsg);
                            syncPartyLeader(player, false);
                            updateStatusUI();
                        }

                    // --- E. 説得を試みる (ボス戦) ---
                    } else if (act.type === 'persuade') {
                        const persuadeMinLevel = (bossTemplate && bossTemplate.persuadeMinLevel) || 0;
                        const isLevelEnough = (actor.level || 1) >= persuadeMinLevel;
                        if (player.hasKey && isLevelEnough) {
                            playVictorySE();
                            const rewardSummary = distributeBattleExpDivided([{
                                name: target.name,
                                baseName: target.baseName,
                                level: target.level,
                                baseExp: target.exp,
                                gold: target.gold
                            }]);
                            player.gold += rewardSummary.totalGold;
                            saveTempCampPlayer(player);

                            hideMonsterFrame('fled');
                            setInBattle(false);
                            clearAllActionBadges();
                            onBattleRepeatKey = null;
                            hideBattleCommands();
                            player.isMoving = false;

                            if (onBossDefeated) onBossDefeated();

                            showBattleMessage(`あなたは手に持っていた『扉の鍵』の古の刻印を見せた！\n魔王「む…！？ それは古の契約の証…！ 良いだろう、無礼を許し道を開けよう。」\n★ ${rewardSummary.totalGainedExp} EXP を獲得！\n★ ${target.gold} GOLD を手に入れた！\n★ ダンジョン制覇！ ★`, true);
                            return;
                        } else {
                            playDamageSE();
                            flashScreen(true);
                            damagePartyMember(actor, GAME_RULES.battle.persuadeFailDamage);
                            actionMsg = player.hasKey
                                ? `▶ ${actor.name} は『扉の鍵』の古の刻印を見せたが、魔王「その程度の力で古の契約を語るか！」と雷撃を受けた！(${actor.name}に${GAME_RULES.battle.persuadeFailDamage}のダメージ)\n※ 説得には Lv${persuadeMinLevel} 以上の力が必要なようだ`
                                : `▶ 説得を試みたが、魔王「戯れ言を！」と雷撃を受けた！(${actor.name}に${GAME_RULES.battle.persuadeFailDamage}のダメージ)`;
                            roundLogs.push(actionMsg);
                        }

                    // --- F. にげる ---
                    } else if (act.type === 'escape') {
                        if (isBoss) {
                            playEscapeFailureSE();
                            flashScreen(true);
                            damagePartyMember(actor, GAME_RULES.battle.bossEscapeFailDamage);
                            actionMsg = `▶ ${bossShortName}の圧倒的威圧感の前に逃げ出せない！背後から追撃を受けた！(${actor.name}に${GAME_RULES.battle.bossEscapeFailDamage}のダメージ)`;
                            roundLogs.push(actionMsg);
                        } else {
                            if (Math.random() < ESCAPE_RATE) {
                                playEscapeSuccessSE();
                                hideMonsterFrame('fled');
                                setInBattle(false);
                                player.isMoving = false;
                                activeMonster = null;
                                battleGroups = [];
                                partyFled = true;
                                actionMsg = `▶ パーティ全員は素早く身を翻し、前衛の包囲網を突破して逃げ出した！`;
                                roundLogs.push(actionMsg);
                                showBattleMessage(actionMsg);
                                await sleep(BATTLE_ACTION_DELAY_MS);
                                break;
                            } else {
                                playEscapeFailureSE();
                                actionMsg = `▶ 逃走を試みたが、敵に回り込まれて退路を塞がれた！`;
                                roundLogs.push(actionMsg);
                            }
                        }
                    }

                    if (actionMsg) {
                        showBattleMessage(actionMsg);
                        await sleep(BATTLE_ACTION_DELAY_MS);
                    }

                // ============================================
                // 敵の行動ターン
                // ============================================
                } else if (item.actorType === 'enemy') {
                    const enemy = item.monster;
                    if (enemy.currentHp <= 0) continue;

                    // 攻撃対象メンバーの選定 (前衛70% / 後衛30%、前衛全滅時は後衛100%)
                    const livingFront = getLivingFrontMembers();
                    const livingRear = getLivingRearMembers();

                    let target = null;
                    if (livingFront.length > 0 && livingRear.length > 0) {
                        if (Math.random() < GAME_RULES.battle.frontTargetRate) {
                            target = livingFront[Math.floor(Math.random() * livingFront.length)];
                        } else {
                            target = livingRear[Math.floor(Math.random() * livingRear.length)];
                        }
                    } else if (livingFront.length > 0) {
                        target = livingFront[Math.floor(Math.random() * livingFront.length)];
                    } else if (livingRear.length > 0) {
                        target = livingRear[Math.floor(Math.random() * livingRear.length)];
                    }

                    if (!target) break; // 全員死亡

                    // ダメージ計算 (防具軽減 & 防御半減)
                    const defBonus = getMemberDefBonus(target);
                    const rawDmg = Math.floor(Math.random() * (enemy.atkMax - enemy.atkMin + 1)) + enemy.atkMin;
                    let dmg = Math.max(1, rawDmg - defBonus);

                    const isDefending = defendingMembers.has(target.id);
                    if (isDefending) {
                        dmg = Math.max(1, Math.ceil(dmg * GAME_RULES.battle.defendDamageRate));
                    }

                    flashScreen(true);
                    playDamageSE();
                    damagePartyMember(target, dmg);

                    let guardNote = '';
                    if (isDefending) {
                        guardNote = ` (${target.name}は防御で半減!)`;
                    }

                    const enemyDisplayName = activeGroup.aliveCount > 1 ? `${enemy.baseName}たち` : (enemy.baseName || enemy.name);
                    let enemyMsg = '';
                    if (!isMemberAlive(target)) {
                        enemyMsg = `▼ 前衛の ${enemyDisplayName} の猛攻！\n${target.name} に ${dmg} の致命打！『${target.name}』は力尽きて倒れてしまった！！`;
                    } else {
                        enemyMsg = `▼ 前衛の ${enemyDisplayName} の攻撃！\n${target.name} に ${dmg} のダメージ！${guardNote}`;
                    }
                    roundLogs.push(enemyMsg);

                    showBattleMessage(enemyMsg);
                    await sleep(BATTLE_ACTION_DELAY_MS);

                    if (getLivingMembers().length === 0) {
                        handlePartyWipeout(roundLogs);
                        return;
                    }
                }
            }

            // 4. ラウンド終了判定
            if (getLivingMembers().length === 0) {
                handlePartyWipeout(roundLogs);
                return;
            }

            if (partyFled) {
                setInBattle(false);
                clearAllActionBadges();
                onBattleRepeatKey = null;
                hideBattleCommands();
                player.isMoving = false;
                retreatPlayer(() => {
                    showBattleMessage('うまく逃げ切れた！（前回のマスへ後退）', true);
                });
                return;
            }

            if (groupWipedOut) {
                handleGroupWipedOut(roundLogs);
                return;
            }

            // ラウンド継続 (メッセージを非表示にして次ターンのコマンド選択へ)
            hideBattleMessage();
            showBattleTurn();
        };

        // 初期ターン開始
        setTimeout(() => {
            if (!inBattle || !activeMonster) return;
            showBattleTurn();
        }, 1000);
    }


    function triggerBossBattle(bossX, bossZ) {
        startBattle([{ template: BOSS_MONSTER_TEMPLATE, count: 1 }], true, () => {
            clearBoss(bossX, bossZ);
        });
    }

    // ガーディアン戦 (ボス戦と同じ扱い。倒したら onDefeated で撃破を記録する)
    function triggerGuardianBattle(guardianId, onDefeated) {
        const template = GUARDIAN_TEMPLATES[guardianId];
        if (!template) return false;
        startBattle([{ template: template, count: 1 }], true, onDefeated);
        return true;
    }

    function triggerEncounterAPI() {
        const table = MONSTER_TABLE[currentFloorId] || MONSTER_TABLE['B1F'];
        const rand = Math.random();

        let groups = [];
        if (rand < 0.45) {
            // 45% 単一種 1体 (単騎出現)
            const chosen = table[Math.floor(Math.random() * table.length)];
            groups = [{ template: chosen, count: 1 }];
        } else if (rand < 0.80) {
            // 35% 同種複数体 (2〜3体の群れ)
            const chosen = table[Math.floor(Math.random() * table.length)];
            const count = Math.floor(Math.random() * 2) + 2; // 2〜3体
            groups = [{ template: chosen, count: count }];
        } else {
            // 20% 混成部隊 (2種類の異なるモンスターの混成)
            const t1 = table[0];
            const t2 = table[1] || table[0];
            const count1 = Math.floor(Math.random() * 2) + 1; // 1〜2体
            const count2 = Math.floor(Math.random() * 2) + 1; // 1〜2体
            groups = [
                { template: t1, count: count1 },
                { template: t2, count: count2 }
            ];
        }

        startBattle(groups, false);
    }

    function checkEncounter() {
        if (Math.random() < ENCOUNT_RATE) {
            triggerEncounterAPI();
        }
    }

    // ========================================================
    // グローバル公開 & プロパティ同期
    // ========================================================
    window.ensureBattleDOM = ensureBattleDOM;
    window.updateBattleFormationUI = updateBattleFormationUI;
    window.showMonsterFrame = showMonsterFrame;
    window.updateMonsterHpBar = updateMonsterHpBar;
    window.playMonsterHitAnim = playMonsterHitAnim;
    window.playMonsterMagicHitAnim = playMonsterMagicHitAnim;
    window.hideMonsterFrame = hideMonsterFrame;

    window.showBattleMessage = showBattleMessage;
    window.hideBattleMessage = hideBattleMessage;
    window.showBattleCommands = showBattleCommands;
    window.hideBattleCommands = hideBattleCommands;
    window.updateBattleCommandSelection = updateBattleCommandSelection;
    window.confirmBattleCommand = confirmBattleCommand;
    window.isBattleInputActive = isBattleInputActive;
    window.handleBattleKeyDown = handleBattleKeyDown;
    window.handleBattleConfirm = handleBattleConfirm;
    window.closeBattleResult = closeBattleResult;

    window.clearAllActionBadges = clearAllActionBadges;
    window.calculateBattleExp = calculateBattleExp;
    window.distributeBattleExpDivided = distributeBattleExpDivided;
    window.createMonsterIndividual = createMonsterIndividual;
    window.createBattleGroup = createBattleGroup;
    window.getPlayerSpeed = getPlayerSpeed;
    window.getEnemySpeed = getEnemySpeed;

    window.MONSTER_TABLE = MONSTER_TABLE;
    window.BOSS_MONSTER_TEMPLATE = BOSS_MONSTER_TEMPLATE;
    window.GUARDIAN_TEMPLATES = GUARDIAN_TEMPLATES;

    window.startBattle = startBattle;
    window.triggerBossBattle = triggerBossBattle;
    window.triggerGuardianBattle = triggerGuardianBattle;
    window.triggerEncounterAPI = triggerEncounterAPI;
    window.checkEncounter = checkEncounter;

    // 変数同期プロパティ
    try {
        Object.defineProperty(window, 'inBattle', {
            get: () => inBattle,
            set: (val) => { setInBattle(val); },
            configurable: true
        });
        Object.defineProperty(window, 'activeMonster', {
            get: () => activeMonster,
            set: (val) => { activeMonster = val; },
            configurable: true
        });
        Object.defineProperty(window, 'battleGroups', {
            get: () => battleGroups,
            set: (val) => { battleGroups = val; },
            configurable: true
        });
        Object.defineProperty(window, 'defeatedMonsters', {
            get: () => defeatedMonsters,
            set: (val) => { defeatedMonsters = val; },
            configurable: true
        });
        Object.defineProperty(window, 'onBattleRepeatKey', {
            get: () => onBattleRepeatKey,
            set: (val) => { onBattleRepeatKey = val; },
            configurable: true
        });
        Object.defineProperty(window, 'BATTLE_ACTION_DELAY_MS', {
            get: () => BATTLE_ACTION_DELAY_MS,
            set: (val) => { BATTLE_ACTION_DELAY_MS = val; },
            configurable: true
        });
    } catch (e) {
        window.inBattle = false;
    }

})(window);

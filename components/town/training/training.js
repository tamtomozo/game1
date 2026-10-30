/**
 * ========================================================
 * 訓練場 (Training Grounds) コンポーネント
 * ========================================================
 * 新規冒険者作成、ボーナスポイント割り振り、クラス選択、
 * 登録冒険者名簿一覧、冒険者除名
 */

(function (window) {
    'use strict';

    let charCreationState = null;
    let trainingActiveTab = 'create'; // 'create' または 'roster'


    /**
     * 訓練場DOM要素を取得・未配置なら自動修復生成
     */
    function ensureTrainingDOM() {
        let overlay = document.getElementById('training-overlay');
        if (!overlay) {
            const container = document.getElementById('part-training') || document.body;
            const temp = document.createElement('div');
            temp.innerHTML = `
                <div id="training-overlay" class="facility-overlay" style="display: none;">
                    <div class="facility-window">
                        <div class="facility-header">
                            <div>
                                <div class="facility-title">=== 訓練場 (Training Grounds) ===</div>
                                <div class="facility-subtitle">新たな冒険者を育成・登録し、ギルドの名簿に記す</div>
                            </div>
                            <div>
                                <button class="facility-action-btn btn-close" onclick="closeTraining()">× とじる</button>
                            </div>
                        </div>
                        <div class="facility-content" id="training-content"></div>
                        <div class="facility-footer" id="training-footer"></div>
                    </div>
                </div>
            `.trim();
            overlay = temp.firstElementChild;
            if (container && container.id === 'part-training' && container.parentNode) {
                container.parentNode.replaceChild(overlay, container);
            } else {
                (container || document.body).appendChild(overlay);
            }
        }
        return {
            overlay: overlay,
            content: document.getElementById('training-content'),
            footer: document.getElementById('training-footer')
        };
    }

    /**
     * 訓練場を開く
     */
    function visitTraining() {
        if (typeof initAudio === 'function') initAudio();
        if (typeof playTone === 'function') {
            playTone([261.6, 311.1, 392.0], 'triangle', 0.14, 0.22); // 訓練場の重厚な短調ファンファーレSE (Cマイナー)
        }
        if (typeof hideMessage === 'function') hideMessage();

        const { overlay } = ensureTrainingDOM();
        if (overlay) {
            overlay.style.display = 'flex';
        }
        if (typeof playBGM === 'function') playBGM('training');
        trainingActiveTab = 'create';
        resetCharCreationState();
        renderTrainingView();
    }

    /**
     * 訓練場を閉じる
     */
    function closeTraining() {
        if (typeof playCancelSE === 'function') playCancelSE();

        const { overlay } = ensureTrainingDOM();
        if (overlay) {
            overlay.style.display = 'none';
        }
        if (typeof playBGM === 'function') playBGM('town');
    }

    /**
     * 作成中キャラの状態をリセット
     */
    function resetCharCreationState() {
        const bonus = typeof rollBonusPoints === 'function' ? rollBonusPoints() : Math.floor(Math.random() * 10) + 7;
        charCreationState = {
            name: '',
            classId: 'fighter',
            bonusPoints: bonus,
            allocated: { str: 0, int: 0, pie: 0, vit: 0, agi: 0, luc: 0 }
        };
    }

    /**
     * 訓練場画面（作成タブ or 名簿タブ）を描画
     */
    function renderTrainingView() {
        const { content, footer } = ensureTrainingDOM();
        if (!content || !footer) return;

        if (trainingActiveTab === 'roster') {
            renderTrainingRosterTab();
            return;
        }

        if (!charCreationState) {
            resetCharCreationState();
        }

        const classDefs = (typeof CLASS_DEFS !== 'undefined') ? CLASS_DEFS : {};
        const attrDefs = (typeof ATTRIBUTE_DEFS !== 'undefined') ? ATTRIBUTE_DEFS : {};
        const itemDefs = (typeof ITEM_DEFS !== 'undefined') ? ITEM_DEFS : {};

        const cls = classDefs[charCreationState.classId] || classDefs['fighter'] || { name: '戦士', nameEn: 'Fighter', desc: '' };
        const baseAttrs = cls.baseAttrs || { str: 10, int: 10, pie: 10, vit: 10, agi: 10, luc: 10 };

        // 残りボーナスポイントの計算
        const usedPoints = Object.values(charCreationState.allocated).reduce((a, b) => a + b, 0);
        const remainPoints = charCreationState.bonusPoints - usedPoints;

        // 予想能力値
        const currentAttrs = {};
        Object.keys(baseAttrs).forEach(k => {
            currentAttrs[k] = baseAttrs[k] + (charCreationState.allocated[k] || 0);
        });

        // 予想ステータス
        const vitBonus = Math.max(0, (currentAttrs.vit - 10) * 2);
        const estHp = (cls.baseHp || 24) + vitBonus;
        // Lv1 の呪文の使用回数 (知恵/信仰心のボーナス込み)
        const estSpellUses = getSpellUsesText({ classId: charCreationState.classId, level: 1, attrs: currentAttrs }) || 'なし';
        const eqWeapon = cls.initialWeapon ? (itemDefs[cls.initialWeapon] ? itemDefs[cls.initialWeapon].name : cls.initialWeapon) : 'なし';
        const eqArmor = cls.initialArmor ? (itemDefs[cls.initialArmor] ? itemDefs[cls.initialArmor].name : cls.initialArmor) : 'なし';

        const rosterCount = typeof loadCharacterRoster === 'function' ? loadCharacterRoster().length : 0;

        let html = `
            <div style="display: flex; gap: 8px; margin-bottom: 6px;">
                <button class="facility-action-btn" data-facility-tab="1" style="background: #253520; color: #ffff00; border-color: #ffff00;">1. 新しい冒険者の作成</button>
                <button class="facility-action-btn btn-close" data-facility-tab="2" onclick="switchTrainingTab('roster')">2. 登録冒険者名簿 (${rosterCount}名)</button>
            </div>

            <!-- 名前入力 -->
            <div class="create-char-row">
                <label style="font-weight: bold; color: #00ff88; font-size: 13px;">【冒険者の名前】</label>
                <input type="text" id="input-char-name" class="char-name-input" placeholder="名前を入力 (1〜10文字)" maxlength="10" value="${escapeHtml(charCreationState.name)}">
                <span style="font-size: 11px; color: #888;">※王都ギルドに正式登録されます</span>
            </div>

            <!-- 職業選択 -->
            <div>
                <div style="font-weight: bold; color: #00ff88; font-size: 13px; margin-bottom: 6px;">【職業の選択 (Class)】</div>
                <div class="class-select-grid">
        `;

        Object.keys(classDefs).forEach(cId => {
            const cDef = classDefs[cId];
            const isSel = cId === charCreationState.classId;
            html += `
                <div class="class-card ${isSel ? 'selected' : ''}" onclick="selectCharClass('${cId}')">
                    <div class="class-card-name">${isSel ? '▶ ' : ''}${cDef.name} (${cDef.nameEn})</div>
                    <div class="class-card-desc">${cDef.desc}</div>
                </div>
            `;
        });

        html += `
                </div>
            </div>

            <!-- ボーナスポイント & 能力値割り振り -->
            <div class="bp-panel">
                <div class="bp-header">
                    <div>
                        <span style="color: #aaa; font-size: 12px;">【能力値割り振り】 残りボーナス: </span>
                        <span class="bp-counter" id="bp-counter-text">${remainPoints} pt</span>
                    </div>
                    <button class="roll-btn" onclick="rerollBonusPoints()">🎲 サイコロを振り直す (再ロール)</button>
                </div>
                <div class="attr-grid">
        `;

        Object.keys(attrDefs).forEach(attrKey => {
            const aDef = attrDefs[attrKey];
            const base = baseAttrs[attrKey] || 10;
            const add = charCreationState.allocated[attrKey] || 0;
            const cur = base + add;
            const canDec = add > 0;
            const canInc = remainPoints > 0;

            html += `
                <div class="attr-row">
                    <div class="attr-label" title="${aDef.desc}">${aDef.name}</div>
                    <div class="attr-controls">
                        <button class="attr-btn" ${canDec ? '' : 'disabled'} onclick="modifyAttr('${attrKey}', -1)">-</button>
                        <span class="attr-val ${add > 0 ? 'text-yellow' : ''}">${cur}</span>
                        <button class="attr-btn" ${canInc ? '' : 'disabled'} onclick="modifyAttr('${attrKey}', 1)">+</button>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>

            <!-- 予想初期ステータスプレビュー -->
            <div class="char-preview-box">
                <div class="preview-item">予想HP: <span>${estHp}</span></div>
                <div class="preview-item">呪文回数: <span>${estSpellUses}</span></div>
                <div class="preview-item">初期武器: <span>${eqWeapon}</span></div>
                <div class="preview-item">初期防具: <span>${eqArmor}</span></div>
            </div>
        `;

        content.innerHTML = html;

        // 名前入力のイベント同期
        const nameInput = document.getElementById('input-char-name');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                charCreationState.name = e.target.value;
            });
        }

        // フッター
        footer.innerHTML = `
            <span style="font-size: 11px; color: #888;">
                ${remainPoints > 0 ? `※残りボーナスポイント (${remainPoints}pt) をすべて割り振ることをお勧めします` : '★すべてのボーナスポイントを割り振りました！'}
            </span>
            <div style="display: flex; gap: 8px;">
                <button class="facility-action-btn" onclick="submitNewCharacter()">★ この冒険者を名簿に登録する</button>
                <button class="facility-action-btn btn-close" onclick="closeTraining()">訓練場を出る</button>
            </div>
        `;
    }

    /**
     * 職業選択
     */
    function selectCharClass(classId) {
        if (typeof playCursorSE === 'function') playCursorSE();
        charCreationState.classId = classId;
        charCreationState.allocated = { str: 0, int: 0, pie: 0, vit: 0, agi: 0, luc: 0 };
        renderTrainingView();
    }

    /**
     * ボーナスポイント再ロール
     */
    function rerollBonusPoints() {
        if (typeof playTone === 'function') {
            playTone([330, 440, 660], 'sawtooth', 0.1, 0.2); // ダイスロールSE
        }
        charCreationState.bonusPoints = typeof rollBonusPoints === 'function' ? rollBonusPoints() : Math.floor(Math.random() * 10) + 7;
        charCreationState.allocated = { str: 0, int: 0, pie: 0, vit: 0, agi: 0, luc: 0 };
        renderTrainingView();
    }

    /**
     * 能力値割り振りの増減
     */
    function modifyAttr(attrKey, delta) {
        const usedPoints = Object.values(charCreationState.allocated).reduce((a, b) => a + b, 0);
        const remainPoints = charCreationState.bonusPoints - usedPoints;

        if (delta > 0 && remainPoints <= 0) {
            if (typeof playTone === 'function') playTone(180, 'sawtooth', 0.1, 0.15);
            return;
        }
        if (delta < 0 && (charCreationState.allocated[attrKey] || 0) <= 0) {
            if (typeof playTone === 'function') playTone(180, 'sawtooth', 0.1, 0.15);
            return;
        }

        if (typeof playTone === 'function') playTone(600, 'sine', 0.05, 0.1);
        charCreationState.allocated[attrKey] = (charCreationState.allocated[attrKey] || 0) + delta;
        renderTrainingView();
    }

    /**
     * タブ切り替え ('create' or 'roster')
     */
    function switchTrainingTab(tab) {
        if (typeof playCursorSE === 'function') playCursorSE();
        trainingActiveTab = tab;
        renderTrainingView();
    }

    /**
     * 新規冒険者の登録確定
     */
    function submitNewCharacter() {
        const nameInput = document.getElementById('input-char-name');
        const name = nameInput ? nameInput.value.trim() : (charCreationState.name || '').trim();

        if (!name) {
            if (typeof playTone === 'function') playTone(180, 'sawtooth', 0.1, 0.15);
            alert('冒険者の名前を入力してください！');
            if (nameInput) nameInput.focus();
            return;
        }

        const usedPoints = Object.values(charCreationState.allocated).reduce((a, b) => a + b, 0);
        const remainPoints = charCreationState.bonusPoints - usedPoints;

        if (remainPoints > 0) {
            const confirmUnused = confirm(`ボーナスポイントがまだ ${remainPoints} pt 残っています。\nこのまま登録してもよろしいですか？`);
            if (!confirmUnused) return;
        }

        if (typeof createCustomCharacter !== 'function' || typeof addCharacterToRoster !== 'function') {
            alert('キャラクター作成機能の読み込みに問題が発生しました。');
            return;
        }

        const newChar = createCustomCharacter(name, charCreationState.classId, charCreationState.allocated);
        addCharacterToRoster(newChar);

        if (typeof playTone === 'function') {
            playTone([523, 659, 784, 1046], 'triangle', 0.15, 0.35); // 登録成功ファンファーレ
        }
        alert(`【登録完了!】\n新たな冒険者『${newChar.name} (${newChar.className})』がギルド名簿に登録されました！\n\n【酒場】でいつでもパーティに加えることができます。`);

        resetCharCreationState();
        trainingActiveTab = 'roster';
        renderTrainingView();
    }

    /**
     * 登録冒険者名簿タブを描画
     */
    function renderTrainingRosterTab() {
        const { content, footer } = ensureTrainingDOM();
        if (!content || !footer) return;

        const roster = typeof loadCharacterRoster === 'function' ? loadCharacterRoster() : [];
        const inPartyIds = (typeof player !== 'undefined' && player && player.partyMembers) ? player.partyMembers.map(m => m.id) : [];

        let html = `
            <div style="display: flex; gap: 8px; margin-bottom: 6px;">
                <button class="facility-action-btn btn-close" data-facility-tab="1" onclick="switchTrainingTab('create')">1. 新しい冒険者の作成</button>
                <button class="facility-action-btn" data-facility-tab="2" style="background: #253520; color: #ffff00; border-color: #ffff00;">2. 登録冒険者名簿 (${roster.length}名)</button>
            </div>
            <div style="font-size: 12px; color: #aaa; margin-bottom: 4px;">
                王都ギルドに登録されている冒険者一覧です。不要になった冒険者は名簿から削除できます（出撃中のキャラは削除不可）。
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; flex: 1; overflow-y: auto; padding-right: 4px;">
        `;

        roster.forEach(c => {
            const inParty = inPartyIds.includes(c.id);
            const attrs = c.attrs || {};
            const attrStr = `力:${attrs.str || '-'} 知:${attrs.int || '-'} 信:${attrs.pie || '-'} 生:${attrs.vit || '-'} 速:${attrs.agi || '-'} 運:${attrs.luc || '-'}`;

            html += `
                <div class="roster-card" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px;">
                    <div>
                        <span style="font-weight: bold; color: ${inParty ? '#00ff88' : '#fff'}; font-size: 13px;">
                            ${escapeHtml(c.name)}
                        </span>
                        <span style="font-size: 11px; color: #ffff00; margin-left: 6px;">
                            【${c.className || c.job || '冒険者'} Lv.${c.level}】
                        </span>
                        <span style="font-size: 10px; color: #aaa; margin-left: 8px;">
                            HP:${c.hp}/${c.maxHp}  ${getSpellUsesText(c)}  [${attrStr}]
                        </span>
                    </div>
                    <div>
                        ${inParty
                            ? '<span style="font-size: 11px; color: #00ff88; font-weight: bold; margin-right: 8px;">[出撃中]</span>'
                            : `<button class="mini-btn remove-btn" onclick="handleDeleteRosterChar('${escapeHtml(c.id)}')">名簿から削除</button>`
                        }
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        content.innerHTML = html;

        footer.innerHTML = `
            <span style="font-size: 11px; color: #888;">登録冒険者数: ${roster.length}人</span>
            <div style="display: flex; gap: 8px;">
                <button class="facility-action-btn" onclick="closeTraining(); if (typeof visitTavern === 'function') visitTavern();">🍺 酒場へ行って編成する</button>
                <button class="facility-action-btn btn-close" onclick="closeTraining()">訓練場を出る</button>
            </div>
        `;
    }

    /**
     * 冒険者を名簿から削除 (除名)
     */
    // ※ 名前は onclick 属性に埋め込まず (「'」を含む名前で壊れるため)、ID から名簿を引いて取得する
    function handleDeleteRosterChar(charId) {
        const target = (typeof loadCharacterRoster === 'function' ? loadCharacterRoster() : []).find(c => c.id === charId);
        if (!target) return;
        const charName = target.name;
        if (typeof isCharacterLostInDungeon === 'function' && isCharacterLostInDungeon(charId)) {
            if (typeof playTone === 'function') playTone(180, 'sawtooth', 0.1, 0.15);
            alert(`冒険者『${charName}』は迷宮内で遭難中です。\n救助隊で現場へ行き遺体を回収するまで名簿から除名できません。`);
            return;
        }
        if (!confirm(`冒険者『${charName}』をギルド名簿から完全に除名します。\nよろしいですか？（※復活できません）`)) {
            return;
        }
        if (typeof removeCharacterFromRoster === 'function') {
            removeCharacterFromRoster(charId);
        }
        if (typeof playCancelSE === 'function') playCancelSE();
        renderTrainingRosterTab();
    }

    // スクリプトロード時にDOMを自動準備
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureTrainingDOM);
    } else {
        ensureTrainingDOM();
    }

    // グローバル公開
    window.visitTraining = visitTraining;
    window.closeTraining = closeTraining;
    window.resetCharCreationState = resetCharCreationState;
    window.renderTrainingView = renderTrainingView;
    window.selectCharClass = selectCharClass;
    window.rerollBonusPoints = rerollBonusPoints;
    window.modifyAttr = modifyAttr;
    window.switchTrainingTab = switchTrainingTab;
    window.submitNewCharacter = submitNewCharacter;
    window.renderTrainingRosterTab = renderTrainingRosterTab;
    window.handleDeleteRosterChar = handleDeleteRosterChar;

})(window);

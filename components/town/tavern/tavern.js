/**
 * ========================================================
 * 酒場 (Tavern) コンポーネント
 * ========================================================
 * パーティ編成、メンバー入替、待機名簿一覧、遭難者確認、冒険者のスカウト (雇用)
 */

(function (window) {
    'use strict';

    // スカウトの調整値
    // 雇用費 = (feeBase + Lv² × feePerLevelSq + ボーナス点 × feePerBonus) × 格付けの feeRate (10 G 単位に丸める)
    const SCOUT_RULES = {
        candidateCount: 4,
        maxLevel: 20,
        feeBase: 50,
        feePerLevelSq: 10,
        feePerBonus: 8
    };

    // スカウト候補の格付け (weight: 出現の重み)
    // 英雄はスカウト限定: ボーナス点が訓練場の上限 (25pt) を超え、職業で装備できる最良の武具を身につけている
    const SCOUT_RANKS = {
        novice: { id: 'novice', name: '駆け出し', weight: 55, levelMin: 1, levelMax: 4, feeRate: 1.0, color: '#aaaaaa' },
        veteran: { id: 'veteran', name: '熟練', weight: 35, levelMin: 5, levelMax: 12, feeRate: 1.0, color: '#55aaff' },
        hero: { id: 'hero', name: '英雄', weight: 10, levelMin: 10, levelMax: 20, feeRate: 1.5, color: '#ffcc00', bonusMin: 26, bonusMax: 35, bestGear: true }
    };

    const SCOUT_NAMES = [
        'アルド', 'ベルナ', 'カイル', 'ドーラ', 'エリク', 'フィオナ', 'ガレス', 'ヘルガ',
        'イーサン', 'ジーナ', 'ケイン', 'リーネ', 'マルコ', 'ニナ', 'オスカー', 'ペトラ',
        'ラウル', 'セラ', 'トーマ', 'ウルスラ', 'ヴィクト', 'ワルド', 'ユリア', 'ゼノ',
        'ボリス', 'クララ', 'ダリオ', 'エマ', 'ゴードン', 'イリス', 'レオン', 'ミラ'
    ];

    let tavernActiveTab = 'party'; // 'party' (パーティ編成) or 'scout' (スカウト)


    /**
     * 酒場DOM要素を取得・未配置なら自動修復生成
     */
    function ensureTavernDOM() {
        let overlay = document.getElementById('tavern-overlay');
        if (!overlay) {
            const container = document.getElementById('part-tavern') || document.body;
            const temp = document.createElement('div');
            temp.innerHTML = `
                <div id="tavern-overlay" class="facility-overlay" style="display: none;">
                    <div class="facility-window">
                        <div class="facility-header">
                            <div>
                                <div class="facility-title">=== 酒場 (Tavern) ===</div>
                                <div class="facility-subtitle">酒場に集う冒険者たちから仲間を選び、パーティを編成する</div>
                            </div>
                            <div>
                                <button class="facility-action-btn btn-close" onclick="closeTavern()">× とじる</button>
                            </div>
                        </div>
                        <div class="facility-content" id="tavern-content"></div>
                        <div class="facility-footer" id="tavern-footer"></div>
                    </div>
                </div>
            `.trim();
            overlay = temp.firstElementChild;
            if (container && container.id === 'part-tavern' && container.parentNode) {
                container.parentNode.replaceChild(overlay, container);
            } else {
                (container || document.body).appendChild(overlay);
            }
        }
        return {
            overlay: overlay,
            content: document.getElementById('tavern-content'),
            footer: document.getElementById('tavern-footer')
        };
    }

    /**
     * 酒場を開く
     */
    function visitTavern() {
        if (typeof initAudio === 'function') initAudio();
        if (typeof playTone === 'function') {
            playTone([293.7, 349.2, 440.0], 'triangle', 0.12, 0.2); // 酒場の退廃的な短三和音SE (Dマイナー)
        }
        if (typeof hideMessage === 'function') hideMessage();

        const { overlay } = ensureTavernDOM();
        if (overlay) {
            overlay.style.display = 'flex';
        }
        if (typeof playBGM === 'function') playBGM('tavern');
        tavernActiveTab = 'party';
        renderTavernView();
    }

    /**
     * タブ切り替え ('party' or 'scout')
     */
    function switchTavernTab(tab) {
        if (typeof playCursorSE === 'function') playCursorSE();
        tavernActiveTab = tab;
        renderTavernView();
    }

    function renderTavernTabsHtml() {
        return renderFacilityTabsHtml([
            { id: 'party', label: '1. パーティ編成' },
            { id: 'scout', label: '2. 冒険者のスカウト' }
        ], tavernActiveTab, 'switchTavernTab');
    }

    /**
     * 酒場を閉じる
     */
    function closeTavern() {
        if (typeof playCancelSE === 'function') playCancelSE();

        const { overlay } = ensureTavernDOM();
        if (overlay) {
            overlay.style.display = 'none';
        }
        if (typeof playBGM === 'function') playBGM('town');
        // 永続セーブとHUD再描画
        if (typeof player !== 'undefined' && typeof savePermanentPlayer === 'function') {
            savePermanentPlayer(player);
        }
        if (typeof updateStatusUI === 'function') {
            updateStatusUI();
        }
    }

    /**
     * 酒場の内容（左: 出撃パーティ / 右: 待機名簿）を描画
     */
    function renderTavernView() {
        const { content, footer } = ensureTavernDOM();
        if (!content || !footer) return;

        if (tavernActiveTab === 'scout') {
            renderTavernScoutTab();
            return;
        }

        const roster = typeof loadCharacterRoster === 'function' ? loadCharacterRoster() : [];
        const currentParty = (typeof player !== 'undefined' && player && player.partyMembers) ? player.partyMembers : [];
        const partyIds = currentParty.map(m => m.id);

        let html = renderTavernTabsHtml() + `
            <div class="tavern-columns">
                <!-- 左側: 出撃パーティ (最大 GAME_RULES.party.maxSize 名) -->
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【出撃パーティ】 (${currentParty.length}/${GAME_RULES.party.maxSize}名)</span>
                        <span style="font-size: 10px; color: #aaa;">上3人:前衛 / 下3人:後衛</span>
                    </div>
                    <div class="tavern-list">
        `;

        for (let slot = 0; slot < GAME_RULES.party.maxSize; slot++) {
            const mem = currentParty[slot];
            const isFront = isFrontRow(slot);
            const rowClass = isFront ? 'front-row' : 'rear-row';
            const rowLabel = isFront ? '前衛' : '後衛';

            if (mem) {
                const nameStr = escapeHtml(mem.name);
                const nextExp = getNextLevelExp(mem.level);
                html += `
                    <div class="party-slot-card ${rowClass}">
                        <div>
                            <span style="color: #888; font-size: 10px;">${slot + 1}.[${rowLabel}]</span>
                            <span style="font-weight: bold; color: #fff; margin-left: 4px;">${nameStr}</span>
                            <span style="font-size: 10px; color: #00ff88; margin-left: 4px;">${mem.className || mem.job || '冒険者'} L${mem.level}</span>
                            <div style="font-size: 9px; color: #888; margin-top: 2px;">
                                HP:${mem.hp}/${mem.maxHp} ${getSpellUsesText(mem)} <span style="color:#ffaa00;">EXP:${mem.exp || 0}/${nextExp}</span>
                            </div>
                        </div>
                        <div class="slot-actions">
                            ${slot > 0 ? `<button class="mini-btn" onclick="movePartyMember(${slot}, -1)">▲</button>` : ''}
                            ${slot < currentParty.length - 1 ? `<button class="mini-btn" onclick="movePartyMember(${slot}, 1)">▼</button>` : ''}
                            <button class="mini-btn remove-btn" onclick="removePartyMemberAt(${slot})">外す</button>
                        </div>
                    </div>
                `;
            } else {
                html += `
                    <div class="party-slot-card empty-slot">
                        <span>${slot + 1}.[${rowLabel}] (空きスロット - 右の名簿から追加)</span>
                    </div>
                `;
            }
        }

        html += `
                    </div>
                </div>

                <!-- 右側: 待機冒険者名簿 -->
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【待機所の冒険者名簿】 (${roster.length}名)</span>
                        <span style="font-size: 10px; color: #aaa;">クリックで追加</span>
                    </div>
                    <div class="tavern-list">
        `;

        roster.forEach(c => {
            const inParty = partyIds.includes(c.id);
            const lostInfo = typeof getLostCharacterInfo === 'function' ? getLostCharacterInfo(c.id) : null;
            const isLost = !!lostInfo;
            const canAdd = !inParty && !isLost && currentParty.length < GAME_RULES.party.maxSize;

            let statusBadge = '';
            if (isLost) {
                statusBadge = ` <span style="color:#ff6666; font-weight:bold;">[遭難中: ${lostInfo.corpse.floorId}]</span>`;
            } else if (c.isDead) {
                statusBadge = ' <span style="color:#ff4444;">[死亡]</span>';
            } else if (c.isPoisoned) {
                statusBadge = ' <span style="color:#aa44ff;">[毒]</span>';
            }

            let actionBtnHtml = '';
            const nameStr = escapeHtml(c.name);
            const nextExp = getNextLevelExp(c.level);

            if (inParty) {
                actionBtnHtml = '<span style="font-size: 10px; color: #00ff88;">[出撃中]</span>';
            } else if (isLost) {
                actionBtnHtml = `<button class="mini-btn" style="background:#442222; color:#ffaaaa; border:1px solid #aa4444;" onclick="showLostCharacterNotice('${escapeHtml(c.id)}')">遭難中 (要回収)</button>`;
            } else if (canAdd) {
                actionBtnHtml = `<button class="mini-btn add-btn" onclick="addMemberToParty('${c.id}')">+ パーティへ</button>`;
            } else {
                actionBtnHtml = `<span style="font-size: 10px; color: #666;">満員 (${GAME_RULES.party.maxSize}人)</span>`;
            }

            html += `
                <div class="roster-card ${inParty ? 'in-party' : ''}">
                    <div>
                        <span style="font-weight: bold; color: ${inParty ? '#666' : (isLost ? '#aa7777' : '#fff')};">${nameStr}</span>
                        <span style="font-size: 10px; color: #ffff00; margin-left: 4px;">${c.className || c.job || '冒険者'} L${c.level}</span>
                        <div style="font-size: 9px; color: #888; margin-top: 2px;">
                            HP:${c.hp}/${c.maxHp} ${getSpellUsesText(c)} <span style="color:#ffaa00;">EXP:${c.exp || 0}/${nextExp}</span>
                            ${statusBadge}
                        </div>
                    </div>
                    <div>
                        ${actionBtnHtml}
                    </div>
                </div>
            `;
        });

        html += `
                    </div>
                </div>
            </div>
        `;

        content.innerHTML = html;

        footer.innerHTML = `
            <span style="font-size: 11px; color: #888;">
                ※前衛(上3人)は近接攻撃が可能。後衛(下3人)は援護攻撃・魔法に適しています。
            </span>
            <div style="display: flex; gap: 8px;">
                <button class="facility-action-btn" onclick="closeTavern(); if (typeof visitTraining === 'function') visitTraining();">⚔ 訓練場へ (新キャラ作成)</button>
                <button class="facility-action-btn" style="background: #254425; color: #00ff88;" onclick="closeTavern()">★ この編成で決定</button>
            </div>
        `;
    }

    /**
     * 待機所からパーティへメンバーを追加
     */
    function addMemberToParty(charId) {
        if (!player) return;
        if ((player.partyMembers || []).length >= GAME_RULES.party.maxSize) {
            if (typeof playTone === 'function') playTone(180, 'sawtooth', 0.1, 0.15);
            alert(`パーティは最大${GAME_RULES.party.maxSize}名までです！誰かを外してから追加してください。`);
            return;
        }

        if (typeof isCharacterLostInDungeon === 'function' && isCharacterLostInDungeon(charId)) {
            if (typeof playTone === 'function') playTone(180, 'sawtooth', 0.1, 0.15);
            const info = typeof getLostCharacterInfo === 'function' ? getLostCharacterInfo(charId) : null;
            const locText = info ? `${info.corpse.floorId} (${info.corpse.x}, ${info.corpse.z})` : '迷宮深部';
            alert(`この冒険者は迷宮【${locText}】で力尽きて横たわっています。\n救助隊を編成して現場へ遺体回収に向かってください。`);
            return;
        }

        const roster = typeof loadCharacterRoster === 'function' ? loadCharacterRoster() : [];
        const target = roster.find(c => c.id === charId);
        if (!target) return;

        if (typeof playConfirmSE === 'function') playConfirmSE();
        if (!Array.isArray(player.partyMembers)) player.partyMembers = [];
        player.partyMembers.push(Object.assign({}, target));

        if (typeof syncPartyLeader === 'function') syncPartyLeader(player, false);
        if (typeof savePermanentPlayer === 'function') savePermanentPlayer(player);
        renderTavernView();
        if (typeof updateStatusUI === 'function') updateStatusUI();
    }

    /**
     * 遭難中の冒険者の居場所を知らせる
     * ※ 名前は onclick 属性に埋め込まず (「'」を含む名前で壊れるため)、ID から引いて表示する
     */
    function showLostCharacterNotice(charId) {
        const roster = typeof loadCharacterRoster === 'function' ? loadCharacterRoster() : [];
        const target = roster.find(c => c.id === charId);
        const info = typeof getLostCharacterInfo === 'function' ? getLostCharacterInfo(charId) : null;
        if (!target || !info) return;
        const locText = `${info.corpse.floorId} (${info.corpse.x}, ${info.corpse.z})`;
        alert(`『${target.name}』は迷宮【${locText}】で力尽きて倒れています。\n\n救助隊を編成して現場へ遺体を回収に向かってください。`);
    }

    /**
     * パーティからメンバーを外す
     */
    function removePartyMemberAt(index) {
        if (!player) return;
        if ((player.partyMembers || []).length <= 1) {
            if (typeof playTone === 'function') playTone(180, 'sawtooth', 0.1, 0.15);
            alert('パーティには最低1人の冒険者が必要です！');
            return;
        }

        if (typeof playCancelSE === 'function') playCancelSE();
        // 外す前に現在の最新ステータス（EXP等）を名簿に同期
        if (typeof syncPartyWithRoster === 'function') {
            syncPartyWithRoster(player.partyMembers);
        }
        player.partyMembers.splice(index, 1);

        if (typeof syncPartyLeader === 'function') syncPartyLeader(player, false);
        if (typeof savePermanentPlayer === 'function') savePermanentPlayer(player);
        renderTavernView();
        if (typeof updateStatusUI === 'function') updateStatusUI();
    }

    /**
     * パーティ内の並び替え
     */
    function movePartyMember(index, delta) {
        if (!player || !player.partyMembers) return;
        const newIdx = index + delta;
        if (newIdx < 0 || newIdx >= player.partyMembers.length) return;

        if (typeof playTone === 'function') playTone(500, 'sine', 0.05, 0.1);
        const temp = player.partyMembers[index];
        player.partyMembers[index] = player.partyMembers[newIdx];
        player.partyMembers[newIdx] = temp;

        if (typeof syncPartyLeader === 'function') syncPartyLeader(player, false);
        if (typeof savePermanentPlayer === 'function') savePermanentPlayer(player);
        // キーボード操作では動かした仲間の矢印を選んだままにする (続けて押すと同じ仲間がさらに動く。端まで来たら逆向きの矢印)
        if (typeof requestFacilityFocus === 'function') {
            requestFacilityFocus([`movePartyMember(${newIdx}, ${delta})`, `movePartyMember(${newIdx}, ${-delta})`]);
        }
        renderTavernView();
        if (typeof updateStatusUI === 'function') updateStatusUI();
    }

    // ========================================================
    // 冒険者のスカウト (雇用)
    // ========================================================
    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function pickScoutRank() {
        const ranks = Object.values(SCOUT_RANKS);
        let r = Math.random() * ranks.reduce((sum, rank) => sum + rank.weight, 0);
        for (const rank of ranks) {
            r -= rank.weight;
            if (r < 0) return rank;
        }
        return ranks[0];
    }

    /**
     * ボーナス点を職業の得意な能力値ほど多く振る (基本値が高い能力値ほど当たりやすい)
     */
    function allocateScoutBonus(cls, points) {
        const baseAttrs = cls.baseAttrs || { str: 10, int: 10, pie: 10, vit: 10, agi: 10, luc: 10 };
        const keys = Object.keys(baseAttrs);
        const weights = keys.map(k => Math.max(1, baseAttrs[k] - 6));
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        const allocated = {};
        keys.forEach(k => { allocated[k] = 0; });
        for (let i = 0; i < points; i++) {
            let r = Math.random() * totalWeight;
            let idx = 0;
            while (r >= weights[idx]) {
                r -= weights[idx];
                idx++;
            }
            allocated[keys[idx]]++;
        }
        return allocated;
    }

    // 職業で装備できる品のうち、bonusKey (atkBonus / defBonus) が最も高いもの
    function getBestGear(itemIds, bonusKey) {
        let best = null;
        (itemIds || []).forEach(id => {
            const def = getItemDef(id);
            if (def && (!best || (def[bonusKey] || 0) > (getItemDef(best)[bonusKey] || 0))) best = id;
        });
        return best;
    }

    function calcScoutFee(level, bonusPoints, rank) {
        const raw = (SCOUT_RULES.feeBase + level * level * SCOUT_RULES.feePerLevelSq + bonusPoints * SCOUT_RULES.feePerBonus) * rank.feeRate;
        return Math.round(raw / 10) * 10;
    }

    /**
     * スカウト候補を1人作る (usedNames: 名簿・他の候補と名前が重ならないように使う)
     */
    function createScoutCandidate(index, usedNames) {
        const rank = pickScoutRank();
        const classIds = Object.keys(CLASS_DEFS);
        const classId = classIds[randomInt(0, classIds.length - 1)];
        const cls = CLASS_DEFS[classId];

        const bonusPoints = rank.bonusMin ? randomInt(rank.bonusMin, rank.bonusMax) : rollBonusPoints();
        const freeNames = SCOUT_NAMES.filter(n => !usedNames.includes(n));
        let name = freeNames.length > 0 ? freeNames[randomInt(0, freeNames.length - 1)] : SCOUT_NAMES[randomInt(0, SCOUT_NAMES.length - 1)];
        // 候補の名前を使い切ったときは番号を付けて区別する
        for (let n = 2; usedNames.includes(name); n++) {
            name = name.replace(/\d+$/, '') + n;
        }
        usedNames.push(name);

        const member = createCustomCharacter(name, classId, allocateScoutBonus(cls, bonusPoints));
        // 同じミリ秒に複数人作るので、連番を付けて ID の重複を防ぐ
        member.id = 'char_scout_' + Date.now() + '_' + index + '_' + Math.floor(Math.random() * 10000);

        const level = Math.min(SCOUT_RULES.maxLevel, randomInt(rank.levelMin, rank.levelMax));
        while (member.level < level) {
            levelUpMember(member, true);
        }
        member.exp = 0;

        if (rank.bestGear) {
            member.equippedWeapon = getBestGear(cls.canEquipWeapons, 'atkBonus') || member.equippedWeapon;
            member.equippedArmor = getBestGear(cls.canEquipArmors, 'defBonus') || member.equippedArmor;
        }

        return {
            member: member,
            rank: rank.id,
            bonusPoints: bonusPoints,
            fee: calcScoutFee(member.level, bonusPoints, rank)
        };
    }

    /**
     * 現在のスカウト候補 (初めて開いたとき・ダンジョンから戻った後は新しい顔ぶれに入れ替える)
     */
    function getScoutCandidates() {
        const data = loadScoutData();
        if (!data.candidates || data.refreshPending) {
            const usedNames = loadCharacterRoster().map(c => c.name);
            data.candidates = [];
            for (let i = 0; i < SCOUT_RULES.candidateCount; i++) {
                data.candidates.push(createScoutCandidate(i, usedNames));
            }
            data.refreshPending = false;
            saveScoutData(data);
        }
        return data.candidates;
    }

    /**
     * スカウトタブを描画
     */
    function renderTavernScoutTab() {
        const { content, footer } = ensureTavernDOM();
        if (!content || !footer) return;

        const candidates = getScoutCandidates();
        const gold = (typeof player !== 'undefined' && player) ? (player.gold || 0) : 0;

        let html = renderTavernTabsHtml() + `
            <div class="tavern-section scout-section">
                <div class="tavern-section-title">
                    <span>【酒場に居合わせた冒険者】 (${candidates.length}名)</span>
                    <span style="font-size: 10px; color: #aaa;">迷宮から戻るたびに顔ぶれが入れ替わる</span>
                </div>
                <div class="tavern-list">
        `;

        if (candidates.length === 0) {
            html += `
                <div class="party-slot-card empty-slot">
                    <span>今日はもう声をかけられる冒険者がいない... (迷宮から戻ると新しい冒険者が現れる)</span>
                </div>
            `;
        }

        candidates.forEach(cand => {
            const m = cand.member;
            const rank = SCOUT_RANKS[cand.rank] || SCOUT_RANKS.novice;
            const attrText = Object.keys(ATTRIBUTE_DEFS)
                .map(k => `${ATTRIBUTE_DEFS[k].shortName}${(m.attrs && m.attrs[k]) || 0}`)
                .join(' ');
            const weaponName = m.equippedWeapon && getItemDef(m.equippedWeapon) ? getItemDef(m.equippedWeapon).name : 'なし';
            const armorName = m.equippedArmor && getItemDef(m.equippedArmor) ? getItemDef(m.equippedArmor).name : 'なし';
            const canAfford = gold >= cand.fee;
            const actionBtnHtml = canAfford
                ? `<button class="mini-btn add-btn" onclick="hireScoutCandidate('${escapeHtml(m.id)}')">雇う (${cand.fee} G)</button>`
                : `<span style="font-size: 10px; color: #666;">${cand.fee} G (所持金不足)</span>`;

            html += `
                <div class="roster-card scout-card ${cand.rank === 'hero' ? 'scout-hero' : ''}">
                    <div>
                        <span style="font-size: 10px; font-weight: bold; color: ${rank.color};">[${rank.name}]</span>
                        <span style="font-weight: bold; color: #fff; margin-left: 4px;">${escapeHtml(m.name)}</span>
                        <span style="font-size: 10px; color: #ffff00; margin-left: 4px;">${m.className} L${m.level}</span>
                        <div style="font-size: 9px; color: #888; margin-top: 2px;">
                            HP:${m.maxHp}${getSpellUsesText(m) ? ` ${getSpellUsesText(m)}` : ''} / ${attrText} <span style="color:#ffaa00;">(ボーナス ${cand.bonusPoints}pt)</span>
                        </div>
                        <div style="font-size: 9px; color: #888;">装備: ${weaponName} / ${armorName}</div>
                    </div>
                    <div>
                        ${actionBtnHtml}
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;

        content.innerHTML = html;

        footer.innerHTML = `
            <span style="font-size: 11px; color: #888;">
                所持金: <span style="color: #ffaa00;">${gold} G</span> ※雇った冒険者は名簿に加わります。英雄はここでしか出会えません。
            </span>
            <div style="display: flex; gap: 8px;">
                <button class="facility-action-btn" style="background: #254425; color: #00ff88;" onclick="closeTavern()">★ 酒場を出る</button>
            </div>
        `;
    }

    /**
     * スカウト候補を雇って名簿に加える
     * ※ 名前は onclick 属性に埋め込まず、ID から候補を引いて表示する
     */
    function hireScoutCandidate(candidateId) {
        if (!player) return;
        const data = loadScoutData();
        const cand = (data.candidates || []).find(c => c.member && c.member.id === candidateId);
        if (!cand) return;
        const m = cand.member;

        if ((player.gold || 0) < cand.fee) {
            if (typeof playTone === 'function') playTone(180, 'sawtooth', 0.1, 0.15);
            alert(`所持金が足りません。\n(必要: ${cand.fee} G / 所持: ${player.gold || 0} G)`);
            return;
        }
        if (!confirm(`『${m.name}』(${m.className} Lv.${m.level}) を ${cand.fee} G で雇いますか？\n(所持金: ${player.gold} G)`)) {
            return;
        }

        player.gold -= cand.fee;
        addCharacterToRoster(Object.assign({}, m, { createdAt: Date.now() }));
        data.candidates = data.candidates.filter(c => c !== cand);
        saveScoutData(data);
        if (typeof savePermanentPlayer === 'function') savePermanentPlayer(player);

        if (typeof playTone === 'function') {
            playTone([523, 659, 784, 1046], 'triangle', 0.15, 0.35); // 雇用成功ファンファーレ
        }
        alert(`【雇用成立!】\n『${m.name} (${m.className} Lv.${m.level})』がギルド名簿に加わりました！\n\n「パーティ編成」タブからパーティに加えられます。`);

        renderTavernView();
        if (typeof updateStatusUI === 'function') updateStatusUI();
    }

    // スクリプトロード時にDOMを自動準備
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureTavernDOM);
    } else {
        ensureTavernDOM();
    }

    // グローバル公開
    window.visitTavern = visitTavern;
    window.closeTavern = closeTavern;
    window.renderTavernView = renderTavernView;
    window.addMemberToParty = addMemberToParty;
    window.showLostCharacterNotice = showLostCharacterNotice;
    window.removePartyMemberAt = removePartyMemberAt;
    window.movePartyMember = movePartyMember;
    window.switchTavernTab = switchTavernTab;
    window.hireScoutCandidate = hireScoutCandidate;

})(window);

/**
 * ========================================================
 * パーティの状態 (Party Record) コンポーネント
 * ========================================================
 * 前衛・後衛の各冒険者の状態・能力値・装備と、所持金・荷物の一覧 (表示のみ)
 * カードを選ぶと、その冒険者のつよさを重ねたウィンドウで詳しく表示する
 * ※ 街では施設の利用や帰還のたびに自動で永続セーブされるため、ここでは保存しない
 */

(function (window) {
    'use strict';

    let detailSlot = 0; // 詳細ウィンドウで表示中のメンバー (隊列の番号 0 始まり)

    function ensurePartyRecordDOM() {
        return ensureFacilityOverlay({
            id: 'party-record',
            title: '=== パーティの状態 (Status) ===',
            subtitle: '出撃パーティの容態・能力値・装備と、所持金・荷物を確かめる (冒険者を選ぶと詳しいつよさを表示)',
            closeFn: 'closePartyRecord'
        });
    }

    /**
     * パーティの状態を開く
     */
    function showPartyRecord() {
        if (typeof initAudio === 'function') initAudio();
        if (typeof playConfirmSE === 'function') playConfirmSE();
        if (typeof hideMessage === 'function') hideMessage();
        if (!window.player) return;

        const { overlay } = ensurePartyRecordDOM();
        if (overlay) overlay.style.display = 'flex';
        renderPartyRecordView();
    }

    function closePartyRecord() {
        if (typeof playCancelSE === 'function') playCancelSE();
        const { overlay } = ensurePartyRecordDOM();
        if (overlay) overlay.style.display = 'none';
    }

    // ---- 1人分の詳細 (パーティの状態の上に重ねて出すウィンドウ) ----

    function ensureMemberDetailDOM() {
        return ensureFacilityOverlay({
            id: 'member-detail',
            title: '=== 冒険者のつよさ (Status) ===',
            subtitle: '数字キーで仲間を切り替え / Esc でパーティの状態にもどる',
            closeFn: 'closeMemberDetail',
            sub: true
        });
    }

    /**
     * 隊列 slot 番目 (0 始まり) のメンバーの詳細を開く
     */
    function showMemberDetail(slot) {
        if (!window.player || !window.player.partyMembers[slot]) return;
        if (typeof playConfirmSE === 'function') playConfirmSE();
        detailSlot = slot;
        const { overlay } = ensureMemberDetailDOM();
        if (overlay) overlay.style.display = 'flex';
        renderMemberDetailView();
    }

    function closeMemberDetail() {
        if (typeof playCancelSE === 'function') playCancelSE();
        const { overlay } = ensureMemberDetailDOM();
        if (overlay) overlay.style.display = 'none';
    }

    // 詳細ウィンドウ上部のタブで表示する仲間を切り替える (tab: 隊列の番号の文字列)
    function switchMemberDetail(tab) {
        if (typeof playCursorSE === 'function') playCursorSE();
        detailSlot = parseInt(tab, 10);
        renderMemberDetailView();
    }

    function renderMemberDetailView() {
        const { content, footer } = ensureMemberDetailDOM();
        if (!content || !footer) return;

        const party = window.player.partyMembers || [];
        const m = party[detailSlot];
        if (!m) return;

        const tabsHtml = renderFacilityTabsHtml(
            party.map((mem, idx) => ({ id: String(idx), label: `${idx + 1}.${escapeHtml(mem.name)}` })),
            String(detailSlot), 'switchMemberDetail');

        content.innerHTML = `
            ${tabsHtml}
            <div class="member-detail-rows">${renderMemberDetailRowsHtml(m, detailSlot)}</div>
        `;

        footer.innerHTML = `
            <span style="font-size: 11px; color: #888;">
                所持金: <span style="color: #ffaa00;">${window.player.gold} G</span>
            </span>
            <div style="display: flex; gap: 8px;">
                <button class="facility-action-btn" style="background: #254425; color: #00ff88;" onclick="closeMemberDetail()">◀ もどる</button>
            </div>
        `;
    }

    function getConditionBadge(m) {
        const condition = getMemberCondition(m);
        if (condition === 'dead') return '<span style="color:#ff4444;">[死亡]</span>';
        if (condition === 'poison') return '<span style="color:#aa44ff;">[毒]</span>';
        return '<span style="color:#00ff88;">[健康]</span>';
    }

    function getEquipText(m, slot) {
        const def = m[slot] ? getItemDef(m[slot]) : null;
        if (!def) return MESSAGES.noEquipment(slot);
        return slot === 'equippedWeapon' ? `${def.name} (+${def.atkBonus})` : `${def.name} (+${def.defBonus})`;
    }

    // 1人分のカード (空きスロットは点線の枠)
    function renderMemberCardHtml(m, slot) {
        const isFront = isFrontRow(slot);
        const rowClass = isFront ? 'front-row' : 'rear-row';
        const rowLabel = isFront ? '前衛' : '後衛';

        if (!m) {
            return `
                <div class="party-slot-card empty-slot">
                    <span>${slot + 1}.[${rowLabel}] (空きスロット)</span>
                </div>
            `;
        }

        const attrText = Object.keys(ATTRIBUTE_DEFS)
            .map(k => `${ATTRIBUTE_DEFS[k].shortName}${(m.attrs && m.attrs[k]) || 0}`)
            .join(' ');
        return `
            <div class="party-slot-card record-card ${rowClass}" onclick="showMemberDetail(${slot})">
                <div>
                    <span style="color: #888; font-size: 10px;">${slot + 1}.[${rowLabel}]</span>
                    <span style="font-weight: bold; color: ${isMemberAlive(m) ? '#fff' : '#aa7777'}; margin-left: 4px;">${escapeHtml(m.name)}</span>
                    <span style="font-size: 10px; color: #00ff88; margin-left: 4px;">${m.className || m.job || '冒険者'} L${m.level}</span>
                    <span style="font-size: 10px; margin-left: 4px;">${getConditionBadge(m)}</span>
                    <div style="font-size: 9px; color: #888; margin-top: 2px;">
                        HP:${m.hp}/${m.maxHp} ${getSpellUsesText(m)} <span style="color:#ffaa00;">EXP:${m.exp || 0}/${getNextLevelExp(m.level)}</span> 素早さ:${getMemberTotalSpd(m)}
                    </div>
                    <div style="font-size: 9px; color: #888;">${attrText}</div>
                    <div style="font-size: 9px; color: #888;">武器: ${getEquipText(m, 'equippedWeapon')} / 防具: ${getEquipText(m, 'equippedArmor')}</div>
                </div>
            </div>
        `;
    }

    /**
     * パーティの状態 (左: 前衛 / 右: 後衛 / 下: 荷物) を描画
     */
    function renderPartyRecordView() {
        const { content, footer } = ensurePartyRecordDOM();
        if (!content || !footer) return;

        const player = window.player;
        const party = player.partyMembers || [];
        const frontSize = GAME_RULES.party.frontRowSize;

        let frontHtml = '';
        let rearHtml = '';
        for (let slot = 0; slot < GAME_RULES.party.maxSize; slot++) {
            const cardHtml = renderMemberCardHtml(party[slot], slot);
            if (slot < frontSize) frontHtml += cardHtml;
            else rearHtml += cardHtml;
        }

        // 荷物 (同じ品は個数をまとめる)
        const counts = {};
        (player.inventory || []).forEach(id => { counts[id] = (counts[id] || 0) + 1; });
        // 未鑑定の品は「武器？」「防具？」
        const inventoryText = [
            ...Object.keys(counts).map(id => `${getItemDef(id) ? getItemDef(id).name : id}${counts[id] > 1 ? ` ×${counts[id]}` : ''}`),
            getUnidentifiedListText(player.unidentified)
        ].filter(Boolean).join('、') || 'なし';

        content.innerHTML = `
            <div class="tavern-columns">
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【前衛 (FRONT)】</span>
                        <span style="font-size: 10px; color: #aaa;">近接攻撃が可能</span>
                    </div>
                    <div class="tavern-list">${frontHtml}</div>
                </div>
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【後衛 (REAR)】</span>
                        <span style="font-size: 10px; color: #aaa;">援護攻撃・魔法に適する</span>
                    </div>
                    <div class="tavern-list">${rearHtml}</div>
                </div>
            </div>
            <div class="record-inventory">
                <span style="color: #ffaa00; font-weight: bold;">【荷物】</span> ${inventoryText}
            </div>
        `;

        footer.innerHTML = `
            <span style="font-size: 11px; color: #888;">
                所持金: <span style="color: #ffaa00;">${player.gold} G</span> ※街では冒険の記録が自動で保存されています。
            </span>
            <div style="display: flex; gap: 8px;">
                <button class="facility-action-btn" style="background: #254425; color: #00ff88;" onclick="closePartyRecord()">★ 街へ戻る</button>
            </div>
        `;
    }

    // スクリプトロード時にDOMを自動準備
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { ensurePartyRecordDOM(); ensureMemberDetailDOM(); });
    } else {
        ensurePartyRecordDOM();
        ensureMemberDetailDOM();
    }

    // グローバル公開
    window.showPartyRecord = showPartyRecord;
    window.closePartyRecord = closePartyRecord;
    window.renderPartyRecordView = renderPartyRecordView;
    window.showMemberDetail = showMemberDetail;
    window.closeMemberDetail = closeMemberDetail;
    window.switchMemberDetail = switchMemberDetail;

})(window);

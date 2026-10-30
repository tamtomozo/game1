/**
 * ========================================================
 * パーティステータスボックス (Status Box) コンポーネント
 * ========================================================
 * 街・ダンジョン共通の画面下部 6人パーティHUD (3列2行グリッド)
 */

(function (window) {
    'use strict';

    function ensureStatusBoxDOM() {
        let box = document.getElementById('status-box');
        if (!box) {
            const target = document.getElementById('part-status-box') || document.body;
            box = document.createElement('div');
            box.id = 'status-box';
            if (target && target.id === 'part-status-box' && target.parentNode) {
                target.parentNode.replaceChild(box, target);
            } else {
                (target || document.body).appendChild(box);
            }
        }
        return box;
    }


    // 6人パーティHUDのHTML生成・共通レンダラー (画面下部 3列2行グリッド対応)
    function renderPartyHUD(containerEl, player, floorText = '', coordText = '') {
        const targetEl = containerEl || document.getElementById('status-box') || ensureStatusBoxDOM();
        if (!targetEl || !player) return;
        const members = Array.isArray(player.partyMembers) ? player.partyMembers : [];

        // ヘッダー部: 階層名・座標/方角・所持金
        let html = `
            <div class="status-header">
                <div class="status-header-left">
                    <span class="floor-title">${floorText || MESSAGES.TOWN_TITLE}</span>
                    ${coordText ? `<span class="coord-inline">${coordText}</span>` : ''}
                </div>
                <div class="status-header-right">
                    <span class="party-gold">${player.gold || 0} G</span>
                </div>
            </div>
        `;

        // 3列2行グリッド (1行目: 前衛1~3, 2行目: 後衛4~6)
        html += `<div class="party-grid">`;

        if (members.length === 0) {
            html += `
                <div class="party-empty-notice" style="grid-column: 1 / -1; padding: 12px; text-align: center; color: #ff9999; font-size: 13px; background: rgba(0,0,0,0.6); border: 1px dashed #ff4444; border-radius: 4px;">
                    【出撃パーティ未編成 (0名)】 酒場で冒険者を編成してください。
                </div>
            `;
        }

        members.forEach((m, idx) => {
            const isFront = isFrontRow(idx);
            const rowClass = isFront ? 'card-front' : 'card-rear';
            const tagText = isFront ? '前' : '後';

            const condition = getMemberCondition(m);
            const statusText = `<span class="status-${condition}">[ ${MEMBER_CONDITION_LABELS[condition]} ]</span>`;

            const hpLow = (!m.isDead && m.hp <= m.maxHp * 0.25) ? 'hp-low' : '';

            const wName = getEquipName(m, 'equippedWeapon');
            const aName = getEquipName(m, 'equippedArmor');
            const tooltip = `${m.name} (${m.className || m.classId} Lv.${m.level})\nHP: ${m.hp}/${m.maxHp}  呪文: ${getSpellUsesText(m) || 'なし'}\n武器: ${wName}\n防具: ${aName}\nEXP: ${m.exp || 0}`;

            // 戦闘中の行動バッジ (文言は storage.js の getActionBadge)
            const badge = getActionBadge(m.currentBattleAction);
            const actionBadgeHtml = `<span class="member-action-badge${badge ? ' ' + badge.cls : ''}" id="party-act-${idx}">${badge ? escapeHtml(badge.text) : ''}</span>`;

            const nextReqExp = getNextLevelExp(m.level);
            const isExpReady = (m.exp || 0) >= nextReqExp;
            const expReadyText = isExpReady ? '★UP' : '';
            const expClass = isExpReady ? 'member-exp exp-ready' : 'member-exp';

            html += `
                <div class="party-card party-member-row ${rowClass}" id="party-row-${idx}" title="${escapeHtml(tooltip)}">
                    <div class="party-card-header">
                        <span class="member-idx">${idx + 1}.</span>
                        <span class="member-row-tag ${isFront ? 'row-front' : 'row-rear'}">${tagText}</span>
                        <span class="member-name">${escapeHtml(m.name)}</span>
                        <span class="member-class">${escapeHtml(m.className || m.classId)} <span class="member-lvl">L${m.level}</span></span>
                        <span class="member-status">${statusText}</span>
                    </div>
                    <div class="party-card-stats">
                        <div class="stats-values">
                            <span class="member-hp ${hpLow}">H:${m.hp}/${m.maxHp}</span>
                            <span class="member-mp">${getSpellUsesText(m, true)}</span>
                            <span class="${expClass}">E:${m.exp || 0}/${nextReqExp}${expReadyText}</span>
                        </div>
                        ${actionBadgeHtml}
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        targetEl.innerHTML = html;
    }

    // スクリプトロード時にDOMを自動準備
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureStatusBoxDOM);
    } else {
        ensureStatusBoxDOM();
    }

    // グローバル公開
    window.renderPartyHUD = renderPartyHUD;
    window.ensureStatusBoxDOM = ensureStatusBoxDOM;

})(window);

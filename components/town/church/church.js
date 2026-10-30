/**
 * ========================================================
 * 教会 (Church) コンポーネント
 * ========================================================
 * 死亡した冒険者の蘇生、猛毒の解毒治療
 */

(function (window) {
    'use strict';

    function ensureChurchDOM() {
        return ensureFacilityOverlay({
            id: 'church',
            title: '=== 教会 (Church) ===',
            subtitle: '神父「神の御加護あれ... 迷える魂よ、神の御慈悲を授けましょう。」',
            closeFn: 'closeChurch'
        });
    }

    /**
     * 教会を開く
     */
    function visitChurch() {
        if (typeof initAudio === 'function') initAudio();
        // 厳かで暗鬱なカテドラルの鐘音 (Dマイナー)
        if (typeof playTone === 'function') playTone([146.8, 220.0, 293.7, 349.2], 'triangle', 0.32, 0.24);
        if (typeof hideMessage === 'function') hideMessage();
        if (!window.player) return;

        const { overlay } = ensureChurchDOM();
        if (overlay) overlay.style.display = 'flex';
        if (typeof playBGM === 'function') playBGM('church');
        renderChurchView();
    }

    /**
     * 教会を閉じる (蘇生・毒抜きのたびに保存済み)
     */
    function closeChurch() {
        if (typeof playCancelSE === 'function') playCancelSE();
        const { overlay } = ensureChurchDOM();
        if (overlay) overlay.style.display = 'none';
        if (typeof playBGM === 'function') playBGM('town');
        if (typeof updateStatusUI === 'function') updateStatusUI();
    }

    /**
     * 教会の内容 (左: パーティの容態 / 右: 教会の御業) を描画
     */
    function renderChurchView() {
        const { content, footer } = ensureChurchDOM();
        if (!content || !footer) return;

        const player = window.player;
        const reviveCost = GAME_RULES.town.reviveCost;
        const cureCost = GAME_RULES.town.curePoisonCost;
        const deadMembers = player.partyMembers.filter(m => !isMemberAlive(m));
        const poisonedMembers = player.partyMembers.filter(m => m.isPoisoned);

        let html = `
            <div class="tavern-columns">
                <!-- 左側: パーティの容態 -->
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【パーティの容態】 (${player.partyMembers.length}名)</span>
                    </div>
                    <div class="tavern-list">
        `;

        if (player.partyMembers.length === 0) {
            html += `
                <div class="party-slot-card empty-slot">
                    <span>パーティがいません (酒場で仲間を編成してください)</span>
                </div>
            `;
        }

        player.partyMembers.forEach(m => {
            const isDead = !isMemberAlive(m);
            let statusBadge = '<span style="color:#00ff88;">[健康]</span>';
            if (isDead && m.isPoisoned) {
                statusBadge = '<span style="color:#ff4444;">[死亡]</span> <span style="color:#aa44ff;">[毒]</span>';
            } else if (isDead) {
                statusBadge = '<span style="color:#ff4444;">[死亡]</span>';
            } else if (m.isPoisoned) {
                statusBadge = '<span style="color:#aa44ff;">[毒]</span>';
            }

            const actions = [];
            if (isDead) {
                // 所持金が足りなくても全財産と引き換えに蘇生してもらえる (救済措置) ので、ボタンは常に出す
                actions.push(`<button class="mini-btn add-btn" onclick="reviveAtChurch('${escapeHtml(m.id)}')">蘇生 (${reviveCost} G)</button>`);
            }
            if (m.isPoisoned) {
                actions.push(player.gold >= cureCost
                    ? `<button class="mini-btn add-btn" onclick="curePoisonAtChurch('${escapeHtml(m.id)}')">毒抜き (${cureCost} G)</button>`
                    : `<span style="font-size: 10px; color: #666;">毒抜き ${cureCost} G (所持金不足)</span>`);
            }

            html += `
                <div class="roster-card">
                    <div>
                        <span style="font-weight: bold; color: ${isDead ? '#aa7777' : '#fff'};">${escapeHtml(m.name)}</span>
                        <span style="font-size: 10px; color: #00ff88; margin-left: 4px;">${m.className || m.job || '冒険者'} L${m.level}</span>
                        <div style="font-size: 9px; color: #888; margin-top: 2px;">
                            HP:${m.hp}/${m.maxHp} ${getSpellUsesText(m)} ${statusBadge}
                        </div>
                    </div>
                    <div class="slot-actions">
                        ${actions.join('')}
                    </div>
                </div>
            `;
        });

        let priestWord = '神父「パーティの皆は息災のようじゃ。神の恵みに感謝しなさい。」';
        if (deadMembers.length > 0) {
            priestWord = `神父「なんと... 息絶えた仲間【${deadMembers.map(m => escapeHtml(m.name)).join('、')}】がおるではないか！ 直ちに神の奇跡『死者の復活』を祈りなさい。」`;
        } else if (poisonedMembers.length > 0) {
            priestWord = `神父「体に邪悪な毒が回っておる仲間【${poisonedMembers.map(m => escapeHtml(m.name)).join('、')}】がおるな... 直ちに『解毒の祈祷』で毒を抜きなさい。」`;
        }

        html += `
                    </div>
                </div>

                <!-- 右側: 教会の御業 -->
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【教会の御業】</span>
                    </div>
                    <div class="tavern-list">
                        <div class="roster-card scout-card">
                            <div>
                                <span style="font-weight: bold; color: #fff;">死者の復活</span>
                                <span style="font-size: 10px; color: #ffaa00; margin-left: 4px;">${reviveCost} G</span>
                                <div style="font-size: 9px; color: #888; margin-top: 2px;">息絶えた仲間を蘇生し、HPを全快させる。<br>寄付金が足りなければ、全財産と引き換えにHP半分で蘇生してもらえる。</div>
                            </div>
                        </div>
                        <div class="roster-card scout-card">
                            <div>
                                <span style="font-weight: bold; color: #fff;">解毒の祈祷</span>
                                <span style="font-size: 10px; color: #ffaa00; margin-left: 4px;">${cureCost} G</span>
                                <div style="font-size: 9px; color: #888; margin-top: 2px;">体に回った毒を浄化の聖水で消し去る。</div>
                            </div>
                        </div>
                        <div style="font-size: 11px; color: #ccc; line-height: 1.5;">${priestWord}</div>
                    </div>
                </div>
            </div>
        `;

        content.innerHTML = html;

        footer.innerHTML = `
            <span style="font-size: 11px; color: #888;">
                所持金: <span style="color: #ffaa00;">${player.gold} G</span> ※治せるのはパーティの仲間だけです。
            </span>
            <div style="display: flex; gap: 8px;">
                <button class="facility-action-btn" style="background: #254425; color: #00ff88;" onclick="closeChurch()">★ 教会を出る</button>
            </div>
        `;
    }

    function findPartyMember(memberId) {
        return window.player ? window.player.partyMembers.find(m => m.id === memberId) : null;
    }

    // 蘇生・毒抜きの後: 保存して描き直す
    function saveAndRenderChurch() {
        syncPartyLeader(window.player, false);
        savePlayer(window.player);
        updateStatusUI();
        renderChurchView();
    }

    /**
     * 死者の復活 (蘇生)
     * ※ 名前は onclick 属性に埋め込まず、ID からパーティを引いて表示する
     */
    function reviveAtChurch(memberId) {
        const player = window.player;
        const target = findPartyMember(memberId);
        if (!target || isMemberAlive(target)) return;
        const cost = GAME_RULES.town.reviveCost;

        if (player.gold < cost) {
            // 所持金不足の救済措置: 手持ちの全ゴールドを喜捨してHP半分で蘇生
            if (!confirm(`神父「『${target.name}』の復活には ${cost} G の寄付が必要じゃが... 足りぬようじゃな。\nしかし目の前の魂を見捨てるわけにはいかぬ。手持ちの全財産を喜捨すれば、HP半分で命を繋ぎ止めよう。」\n\n全財産 (${player.gold} G) と引き換えに蘇生を頼みますか？`)) {
                return;
            }
            playConfirmSE();
            flashScreen('white');
            player.gold = 0;
            target.isDead = false;
            target.hp = Math.max(1, Math.floor(target.maxHp / 2));
            saveAndRenderChurch();
            alertAfterEffect(`【リザレクション！】\n奇跡が起きた！ 『${target.name}』は息を吹き返した！\n（HP半分で蘇生。次は正規の寄付を頼むぞ）`);
            return;
        }

        if (!confirm(`神父「『${target.name}』の魂に神の奇跡を乞い願います。\n『死者の復活』を執り行いますか？」\n(費用: ${cost} G / 所持金: ${player.gold} G)`)) {
            return;
        }

        player.gold -= cost;
        target.isDead = false;
        target.hp = target.maxHp;
        playTone([261.6, 329.6, 392.0, 523.3, 659.3, 783.9, 1046.5], 'triangle', 0.45, 0.25);
        flashScreen('white');
        saveAndRenderChurch();
        alertAfterEffect(`神父「全能の神よ、この迷える魂『${target.name}』に再び肉体の息吹を与え給え...」\n\n【リザレクション！！】\nまばゆい光が包み込み、奇跡が起きた！\n『${target.name}』は息を吹き返し、HPが全快した！`);
    }

    /**
     * 解毒の祈祷 (毒抜き)
     */
    function curePoisonAtChurch(memberId) {
        const player = window.player;
        const target = findPartyMember(memberId);
        if (!target || !target.isPoisoned) return;
        const cost = GAME_RULES.town.curePoisonCost;

        if (player.gold < cost) {
            playCancelSE();
            alert(`神父「おお、聖水を調合するための金（${cost} G）が足りぬようじゃ... 申し訳ないが、タダでは聖水を用意できぬのだ。」\n(必要: ${cost} G / 所持: ${player.gold} G)`);
            return;
        }
        if (!confirm(`神父「『${target.name}』の体内の毒を浄化しますか？」\n(費用: ${cost} G / 所持金: ${player.gold} G)`)) {
            return;
        }

        player.gold -= cost;
        target.isPoisoned = false;
        playTone([523.3, 659.3, 783.9, 1046.5], 'sine', 0.3, 0.2);
        flashScreen('white');
        saveAndRenderChurch();
        alertAfterEffect(`神父「聖水よ、この身を蝕む濁れる毒を浄化せよ...」\n\n【キュアポイズン！】\n清らかな聖水の光が全身を巡り、『${target.name}』の毒が完全に浄化された！`);
    }

    // スクリプトロード時にDOMを自動準備
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureChurchDOM);
    } else {
        ensureChurchDOM();
    }

    // グローバル公開
    window.visitChurch = visitChurch;
    window.closeChurch = closeChurch;
    window.renderChurchView = renderChurchView;
    window.reviveAtChurch = reviveAtChurch;
    window.curePoisonAtChurch = curePoisonAtChurch;

})(window);

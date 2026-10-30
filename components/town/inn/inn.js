/**
 * ========================================================
 * 宿屋 (Inn) コンポーネント
 * ========================================================
 * 馬小屋・スイートルームでのHP・呪文の使用回数の回復、レベルアップ判定・ステータス上昇処理
 */

(function (window) {
    'use strict';

    // 今回の宿泊でレベルアップさせる仲間の ID (レベルアップできる仲間は最初は全員選んでおく)
    let innLevelUpIds = [];

    function ensureInnDOM() {
        return ensureFacilityOverlay({
            id: 'inn',
            title: '=== 宿屋 (Inn) ===',
            subtitle: '宿屋「いらっしゃい！ 冒険者ギルド御用達の宿屋だよ。お部屋を選んでおくれ。」',
            closeFn: 'closeInn'
        });
    }

    function getReadyMembers(player) {
        return player.partyMembers.filter(m => isMemberAlive(m) && (m.exp || 0) >= getNextLevelExp(m.level));
    }

    function resetInnLevelUpSelection() {
        innLevelUpIds = getReadyMembers(window.player).map(m => m.id);
    }

    /**
     * 宿屋を開く
     */
    function visitInn() {
        if (typeof initAudio === 'function') initAudio();
        if (typeof playTone === 'function') playTone([329.6, 392.0, 493.9], 'triangle', 0.14, 0.18); // 宿屋の静けさを思わせる短調の扉SE (Eマイナー)
        if (typeof hideMessage === 'function') hideMessage();
        if (!window.player) return;

        const { overlay } = ensureInnDOM();
        if (overlay) overlay.style.display = 'flex';
        if (typeof playBGM === 'function') playBGM('inn');
        resetInnLevelUpSelection();
        renderInnView();
    }

    /**
     * 宿屋を閉じる (宿泊のたびに保存済み)
     */
    function closeInn() {
        if (typeof playCancelSE === 'function') playCancelSE();
        const { overlay } = ensureInnDOM();
        if (overlay) overlay.style.display = 'none';
        if (typeof playBGM === 'function') playBGM('town');
        if (typeof updateStatusUI === 'function') updateStatusUI();
    }

    /**
     * スイートルームの値段 (生きている仲間の最高レベルで決まる。泊まる前のレベルで計算)
     */
    function getInnSuiteCost(player) {
        const { innSuiteCost, innSuiteCostPerLevel, innSuiteCostMax } = GAME_RULES.town;
        const levels = player.partyMembers.filter(isMemberAlive).map(m => m.level || 1);
        const topLevel = levels.length > 0 ? Math.max(...levels) : 1;
        return Math.min(innSuiteCostMax, innSuiteCost + (topLevel - 1) * innSuiteCostPerLevel);
    }

    /**
     * 宿屋の内容 (左: パーティの様子 / 右: お部屋) を描画
     */
    function renderInnView() {
        const { content, footer } = ensureInnDOM();
        if (!content || !footer) return;

        const player = window.player;
        const suiteCost = getInnSuiteCost(player);
        const livingMembers = player.partyMembers.filter(isMemberAlive);

        let html = `
            <div class="tavern-columns">
                <!-- 左側: パーティの様子 -->
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【パーティの様子】 (${player.partyMembers.length}名)</span>
                        <span style="font-size: 10px; color: #aaa;">1回の宿泊で1レベルまで</span>
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
            const nextExp = getNextLevelExp(m.level);
            const isReady = isMemberAlive(m) && (m.exp || 0) >= nextExp;

            let statusBadge = '';
            if (!isMemberAlive(m)) {
                statusBadge = ' <span style="color:#ff4444;">[死亡: 教会で蘇生が必要]</span>';
            } else if (m.isPoisoned) {
                statusBadge = ' <span style="color:#aa44ff;">[毒: 宿屋では治りません]</span>';
            }

            let actionHtml;
            if (isReady) {
                const selected = innLevelUpIds.includes(m.id);
                actionHtml = selected
                    ? `<button class="mini-btn add-btn" onclick="toggleInnLevelUp('${escapeHtml(m.id)}')">☑ Lv.${m.level + 1} へ上げる</button>`
                    : `<button class="mini-btn" onclick="toggleInnLevelUp('${escapeHtml(m.id)}')">☐ 上げない</button>`;
            } else if (isMemberAlive(m)) {
                actionHtml = `<span style="font-size: 10px; color: #666;">あと ${nextExp - (m.exp || 0)} EXP</span>`;
            } else {
                actionHtml = '';
            }

            html += `
                <div class="roster-card">
                    <div>
                        <span style="font-weight: bold; color: ${isMemberAlive(m) ? '#fff' : '#aa7777'};">${escapeHtml(m.name)}</span>
                        <span style="font-size: 10px; color: #00ff88; margin-left: 4px;">${m.className || m.job || '冒険者'} L${m.level}</span>
                        <div style="font-size: 9px; color: #888; margin-top: 2px;">
                            HP:${m.hp}/${m.maxHp} ${getSpellUsesText(m)} <span style="color:#ffaa00;">EXP:${m.exp || 0}/${nextExp}</span>
                            ${statusBadge}
                        </div>
                    </div>
                    <div>
                        ${actionHtml}
                    </div>
                </div>
            `;
        });

        html += `
                    </div>
                </div>

                <!-- 右側: お部屋 -->
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【お部屋のご案内】</span>
                    </div>
                    <div class="tavern-list">
        `;

        const rooms = [
            { type: 'stable', name: '馬小屋', cost: 0, desc: '藁の上で仮眠。呪文の使用回数のみ全回復 (HPは回復しません)' },
            { type: 'suite', name: 'スイートルーム', cost: suiteCost, desc: 'ふかふかのベッド。HPと呪文の使用回数が完全回復！ (値段は仲間の最高レベルで決まります)' }
        ];
        rooms.forEach(room => {
            let actionHtml;
            if (livingMembers.length === 0) {
                actionHtml = '<span style="font-size: 10px; color: #666;">泊まれる仲間がいない</span>';
            } else if (player.gold < room.cost) {
                actionHtml = '<span style="font-size: 10px; color: #666;">所持金不足</span>';
            } else {
                actionHtml = `<button class="mini-btn add-btn" onclick="stayAtInn('${room.type}')">泊まる</button>`;
            }
            html += `
                <div class="roster-card scout-card">
                    <div>
                        <span style="font-weight: bold; color: #fff;">${room.name}</span>
                        <span style="font-size: 10px; color: #ffaa00; margin-left: 4px;">${room.cost} G</span>
                        <div style="font-size: 9px; color: #888; margin-top: 2px;">${room.desc}</div>
                    </div>
                    <div>
                        ${actionHtml}
                    </div>
                </div>
            `;
        });

        if (livingMembers.length === 0 && player.partyMembers.length > 0) {
            html += `<div style="font-size: 11px; color: #ff6666;">宿屋「うわっ、全員息をしてないじゃないか！ 早く教会へ連れてって蘇生してもらいな！」</div>`;
        }

        html += `
                    </div>
                </div>
            </div>
        `;

        content.innerHTML = html;

        footer.innerHTML = `
            <span style="font-size: 11px; color: #888;">
                所持金: <span style="color: #ffaa00;">${player.gold} G</span> ※レベルアップは経験値が貯まった仲間だけ。☑ を外すと上げずに泊まります。
            </span>
            <div style="display: flex; gap: 8px;">
                <button class="facility-action-btn" style="background: #254425; color: #00ff88;" onclick="closeInn()">★ 街へ戻る</button>
            </div>
        `;
    }

    /**
     * レベルアップさせるかどうかを切り替える
     */
    function toggleInnLevelUp(memberId) {
        if (typeof playTone === 'function') playTone(500, 'sine', 0.05, 0.1);
        if (innLevelUpIds.includes(memberId)) {
            innLevelUpIds = innLevelUpIds.filter(id => id !== memberId);
        } else {
            innLevelUpIds.push(memberId);
        }
        renderInnView();
    }

    /**
     * 宿泊する ('stable' or 'suite')
     */
    function stayAtInn(roomType) {
        const player = window.player;
        if (!player) return;
        const isSuite = (roomType === 'suite');
        const cost = isSuite ? getInnSuiteCost(player) : 0;
        const roomName = isSuite ? 'スイートルーム' : '馬小屋';
        const livingMembers = player.partyMembers.filter(isMemberAlive);
        if (livingMembers.length === 0) return;

        if (player.gold < cost) {
            if (typeof playCancelSE === 'function') playCancelSE();
            alert(`宿屋「おやおや、お金が足りないようだね。\n${roomName}は ${cost} G 必要だよ（所持金: ${player.gold} G）。」`);
            return;
        }

        const membersToLevelUp = getReadyMembers(player).filter(m => innLevelUpIds.includes(m.id));
        const levelUpNote = membersToLevelUp.length > 0
            ? `\nレベルアップ: ${membersToLevelUp.map(m => `${m.name} (Lv.${m.level} → Lv.${m.level + 1})`).join('、')}`
            : '\nレベルアップ: なし';
        if (!confirm(`${roomName} (${cost} G) に泊まりますか？${levelUpNote}\n(所持金: ${player.gold} G)`)) {
            return;
        }

        if (cost > 0) {
            player.gold = Math.max(0, player.gold - cost);
        }

        if (typeof playInnSE === 'function') playInnSE();
        if (typeof flashScreen === 'function') flashScreen('white');

        const levelUpReports = [];

        // 1. 選んだメンバーのレベルアップ実行 (1回の宿泊につき最大1レベルのみ)
        membersToLevelUp.forEach(m => {
            const reqExp = getNextLevelExp(m.level);
            m.exp -= reqExp;
            // スイートルームならHP全快、馬小屋なら増えたhpGainのみ加算
            const res = levelUpMember(m, isSuite);
            if (res) {
                const spellText = res.spellGains.map(g => `, ${g.name}の回数+${g.gain}`).join('');
                levelUpReports.push(`・${m.name} (${m.className || m.classId}): Lv.${m.level} に上がった！ (HP+${res.hpGain}${spellText})`);
            }
        });

        // 2. 回復処理
        // - スイートルーム: 生存メンバー全員のHPと呪文の使用回数を全回復
        // - 馬小屋: 生存メンバー全員の呪文の使用回数のみ全回復 (HPは回復しない)
        livingMembers.forEach(m => {
            if (isSuite) {
                m.hp = m.maxHp;
            }
            restoreSpellUses(m);
        });

        if (typeof syncPartyLeader === 'function') syncPartyLeader(player, false);
        if (typeof savePermanentPlayer === 'function') savePermanentPlayer(player);
        if (typeof updateStatusUI === 'function') updateStatusUI();

        const poisonedMembers = livingMembers.filter(m => m.isPoisoned);
        const poisonNotice = poisonedMembers.length > 0
            ? `\n(※ 毒に冒された仲間【${poisonedMembers.map(m => m.name).join('、')}】がいます！ 教会で毒抜きをしてください)`
            : '';

        const healDesc = isSuite
            ? `生存者全員のHPと呪文の使用回数が完全回復した！`
            : `藁の上で仮眠をとり、生存者全員の呪文の使用回数のみ全回復した！ (HPはそのままです)`;

        let resultMsg = `【${roomName}で一晩休んだ...】\n${healDesc}${poisonNotice}`;

        if (levelUpReports.length > 0) {
            if (typeof playVictorySE === 'function') playVictorySE();
            resultMsg = `【${roomName}で一晩休んだ...】\n\n【LEVEL UP!!】 仲間が成長した！\n${levelUpReports.join('\n')}\n\n${healDesc}${poisonNotice}`;
        }

        resultMsg += `\n★宿泊帳に最新の冒険データが永続記録されました。(所持金: ${player.gold} G)`;

        resetInnLevelUpSelection();
        renderInnView();
        alertAfterEffect(resultMsg);
    }

    // スクリプトロード時にDOMを自動準備
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureInnDOM);
    } else {
        ensureInnDOM();
    }

    // グローバル公開
    window.visitInn = visitInn;
    window.closeInn = closeInn;
    window.renderInnView = renderInnView;
    window.toggleInnLevelUp = toggleInnLevelUp;
    window.stayAtInn = stayAtInn;

})(window);

/**
 * ========================================================
 * 商店 (Shop) コンポーネント
 * ========================================================
 * 武器・防具・アイテムの購入、売却、装備変更、未鑑定の武具の鑑定
 */

(function (window) {
    'use strict';

    let shopActiveTab = 'buy';       // 'buy' (買う) / 'sell' (売る) / 'equip' (装備) / 'identify' (鑑定)
    let shopEquipPromptItemId = null; // 買ったばかりの武具 (誰に装備させるか選んでいる間だけ入る)
    let shopEquipMemberId = null;     // 装備タブで選んでいる仲間

    const SHOP_CATEGORIES = ['消耗品', '武器', '防具'];

    function ensureShopDOM() {
        return ensureFacilityOverlay({
            id: 'shop',
            title: '=== 商店 (Shop) ===',
            subtitle: '店主「へい、いらっしゃい！ 命を預ける武具や道具はケチるもんじゃないぜ。」',
            closeFn: 'closeShop'
        });
    }

    /**
     * 商店を開く
     */
    function visitShop() {
        if (typeof initAudio === 'function') initAudio();
        if (typeof playTone === 'function') playTone([329.6, 349.2, 415.3, 493.9], 'triangle', 0.14, 0.16); // 怪しげなフリジアンの入店SE
        if (typeof hideMessage === 'function') hideMessage();
        if (!window.player) return;

        const { overlay } = ensureShopDOM();
        if (overlay) overlay.style.display = 'flex';
        if (typeof playBGM === 'function') playBGM('shop');
        shopActiveTab = 'buy';
        shopEquipPromptItemId = null;
        shopEquipMemberId = null;
        renderShopView();
    }

    /**
     * 商店を閉じる (売買・装備のたびに保存済み)
     */
    function closeShop() {
        if (typeof playCancelSE === 'function') playCancelSE();
        const { overlay } = ensureShopDOM();
        if (overlay) overlay.style.display = 'none';
        if (typeof playBGM === 'function') playBGM('town');
        shopEquipPromptItemId = null;
        if (typeof updateStatusUI === 'function') updateStatusUI();
    }

    /**
     * タブ切り替え ('buy' / 'sell' / 'equip' / 'identify')
     */
    function switchShopTab(tab) {
        if (typeof playCursorSE === 'function') playCursorSE();
        shopActiveTab = tab;
        shopEquipPromptItemId = null;
        renderShopView();
    }

    // 品物の性能・効果の一文
    function getItemEffectText(item) {
        const spd = item.spdBonus ? ` 速さ ${item.spdBonus > 0 ? '+' : ''}${item.spdBonus}` : '';
        if (item.type === 'weapon') return `攻撃力 +${item.atkBonus}${spd}`;
        if (item.type === 'armor') return `防御力 +${item.defBonus}${spd}`;
        if (item.type === 'heal') return `HP +${item.power} 回復`;
        if (item.type === 'mana') return `呪文の使用回数 +${item.power} 回復`;
        if (item.type === 'cure_poison') return '毒を治す';
        return '';
    }

    // その武具を装備しているメンバーの名前 (武具以外・誰も装備していなければ空配列)
    function getEquippedMemberNames(item) {
        const slot = getEquipSlot(item);
        if (!slot) return [];
        return window.player.partyMembers.filter(m => m[slot] === item.id).map(m => m.name);
    }

    // 荷物に入っているその品の個数
    function getInventoryCount(itemId) {
        return window.player.inventory.filter(id => id === itemId).length;
    }

    // 売買・装備の後: 保存して描き直す
    function saveAndRenderShop() {
        syncPartyLeader(window.player, false);
        savePlayer(window.player);
        updateStatusUI();
        renderShopView();
    }

    /**
     * 商店の内容を描画 (選んでいるタブを表示)
     */
    function renderShopView() {
        const { content, footer } = ensureShopDOM();
        if (!content || !footer) return;

        const player = window.player;
        const tabsHtml = renderFacilityTabsHtml([
            { id: 'buy', label: '1. かう' },
            { id: 'sell', label: '2. うる' },
            { id: 'equip', label: '3. そうび' },
            { id: 'identify', label: `4. かんてい${player.unidentified.length > 0 ? ` (${player.unidentified.length})` : ''}` }
        ], shopActiveTab, 'switchShopTab');

        let bodyHtml;
        if (shopActiveTab === 'sell') bodyHtml = renderSellTabHtml();
        else if (shopActiveTab === 'equip') bodyHtml = renderEquipTabHtml();
        else if (shopActiveTab === 'identify') bodyHtml = renderIdentifyTabHtml();
        else if (shopEquipPromptItemId) bodyHtml = renderEquipPromptHtml();
        else bodyHtml = renderBuyTabHtml();

        content.innerHTML = tabsHtml + bodyHtml;

        footer.innerHTML = `
            <span style="font-size: 11px; color: #888;">
                所持金: <span style="color: #ffaa00;">${player.gold} G</span> ※装備中の品は「そうび」で外してから売れます。
            </span>
            <div style="display: flex; gap: 8px;">
                <button class="facility-action-btn" style="background: #254425; color: #00ff88;" onclick="closeShop()">★ 店を出る</button>
            </div>
        `;
    }

    // ========================================================
    // かう (Buy)
    // ========================================================
    function renderBuyTabHtml() {
        const player = window.player;
        let html = `
            <div class="tavern-section scout-section">
                <div class="tavern-section-title">
                    <span>【品揃え】</span>
                    <span style="font-size: 10px; color: #aaa;">武具は買った後に装備させる仲間を選べる</span>
                </div>
                <div class="tavern-list">
        `;

        SHOP_CATEGORIES.forEach(category => {
            html += `<div class="shop-category-title">― ${category} ―</div>`;
            SHOP_CATALOG.filter(entry => entry.category === category).forEach(entry => {
                const item = getItemDef(entry.id);
                if (!item) return;

                let ownTag;
                if (getEquipSlot(item)) {
                    const owners = getEquippedMemberNames(item);
                    const stock = getInventoryCount(item.id);
                    ownTag = `装備中: ${owners.length > 0 ? owners.map(escapeHtml).join('・') : 'なし'}${stock > 0 ? ` / 荷物: ${stock}` : ''}`;
                } else {
                    ownTag = `所持: ${getInventoryCount(item.id)}`;
                }

                const actionHtml = player.gold >= item.price
                    ? `<button class="mini-btn add-btn" onclick="buyShopItem('${item.id}')">買う (${item.price} G)</button>`
                    : `<span style="font-size: 10px; color: #666;">${item.price} G (所持金不足)</span>`;

                html += `
                    <div class="roster-card scout-card">
                        <div>
                            <span style="font-weight: bold; color: #fff;">${item.name}</span>
                            <span style="font-size: 10px; color: #00ff88; margin-left: 4px;">${getItemEffectText(item)}</span>
                            <div style="font-size: 9px; color: #888; margin-top: 2px;">${item.desc}</div>
                            <div style="font-size: 9px; color: #ffaa00;">${ownTag}</div>
                        </div>
                        <div>
                            ${actionHtml}
                        </div>
                    </div>
                `;
            });
        });

        html += `
                </div>
            </div>
        `;
        return html;
    }

    /**
     * 品物を買う
     */
    function buyShopItem(itemId) {
        const player = window.player;
        const item = getItemDef(itemId);
        if (!player || !item) return;

        if (player.gold < item.price) {
            playCancelSE();
            alert(`店主「おいおい、金が足りないぜ！\nツケはお断りだ。出直してきな！」\n(必要: ${item.price} G / 所持: ${player.gold} G)`);
            return;
        }
        if (!confirm(`【${item.name}】\n価格: ${item.price} G (所持金: ${player.gold} G)\n性能: ${getItemEffectText(item)}\n説明: ${item.desc}\n\nこの品を購入しますか？`)) {
            return;
        }

        player.gold -= item.price;
        player.inventory.push(item.id);
        playConfirmSE();

        // 武具の場合は誰に装備させるか選ぶ画面へ (キーボードの選択は最初の仲間から)
        if (getEquipSlot(item) && player.partyMembers.length > 0) {
            shopEquipPromptItemId = item.id;
            requestShopFocus();
        }
        saveAndRenderShop();
    }

    /**
     * 買ったばかりの武具を誰に装備させるか選ぶ
     */
    function renderEquipPromptHtml() {
        const player = window.player;
        const item = getItemDef(shopEquipPromptItemId);
        const slot = getEquipSlot(item);

        let html = `
            <div class="tavern-section scout-section">
                <div class="tavern-section-title">
                    <span>店主「毎度あり！ 『${item.name}』は誰に装備させるかい？」</span>
                </div>
                <div class="tavern-list">
        `;

        player.partyMembers.forEach(m => {
            const current = getEquipName(m, slot);
            let actionHtml;
            if (m[slot] === item.id) {
                actionHtml = '<span style="font-size: 10px; color: #00ff88;">(装備済み)</span>';
            } else if (canMemberEquip(m, item)) {
                actionHtml = `<button class="mini-btn add-btn" onclick="equipPurchasedItem('${escapeHtml(m.id)}')">装備させる</button>`;
            } else {
                actionHtml = `<span style="font-size: 10px; color: #666;">${MESSAGES.CANNOT_EQUIP_TAG}</span>`;
            }
            html += `
                <div class="roster-card">
                    <div>
                        <span style="font-weight: bold; color: #fff;">${escapeHtml(m.name)}</span>
                        <span style="font-size: 10px; color: #00ff88; margin-left: 4px;">${m.className} L${m.level}</span>
                        <div style="font-size: 9px; color: #888; margin-top: 2px;">今の装備: ${current}</div>
                    </div>
                    <div>
                        ${actionHtml}
                    </div>
                </div>
            `;
        });

        html += `
                    <div style="display: flex; justify-content: flex-end;">
                        <button class="mini-btn" data-kb-back onclick="skipEquipPurchasedItem()">今は装備しない (荷物にしまう)</button>
                    </div>
                </div>
            </div>
        `;
        return html;
    }

    function equipPurchasedItem(memberId) {
        const player = window.player;
        const member = player.partyMembers.find(m => m.id === memberId);
        const itemId = shopEquipPromptItemId;
        if (!member || !itemId) return;
        if (!canMemberEquip(member, itemId)) {
            playCancelSE();
            return;
        }
        // 買った品は所持品から本人へ移り、それまでの装備は荷物に戻る
        equipItemFromInventory(player, member, itemId);
        shopEquipPromptItemId = null;
        requestShopFocus(`buyShopItem('${itemId}')`); // 品揃えに戻ったら、買った品の「買う」を選んだままにする
        playConfirmSE();
        saveAndRenderShop();
    }

    function skipEquipPurchasedItem() {
        if (typeof playCancelSE === 'function') playCancelSE();
        requestShopFocus(`buyShopItem('${shopEquipPromptItemId}')`);
        shopEquipPromptItemId = null;
        renderShopView();
    }

    // キーボード操作 (js/town.js) で描き直し後に選ぶ項目を指定する
    function requestShopFocus(keys) {
        if (typeof requestFacilityFocus === 'function') requestFacilityFocus(keys);
    }

    // ========================================================
    // うる (Sell)
    // ========================================================
    function renderSellTabHtml() {
        const player = window.player;
        // 売れるのは所持品 (誰も装備していない品) だけ。同じ品はまとめて個数を表示
        const sellableIds = [];
        player.inventory.forEach(id => {
            const item = getItemDef(id);
            if (item && !item.noSell && !sellableIds.includes(id)) sellableIds.push(id);
        });

        let html = `
            <div class="tavern-section scout-section">
                <div class="tavern-section-title">
                    <span>【荷物の買い取り】</span>
                    <span style="font-size: 10px; color: #aaa;">1つずつ買い取る</span>
                </div>
                <div class="tavern-list">
        `;

        if (sellableIds.length === 0) {
            html += `
                <div class="party-slot-card empty-slot">
                    <span>店主「買い取れる品物は持っていないようだな。」</span>
                </div>
            `;
        }

        sellableIds.forEach(id => {
            const item = getItemDef(id);
            const price = getSellPrice(item);
            html += `
                <div class="roster-card">
                    <div>
                        <span style="font-weight: bold; color: #fff;">${item.name}</span>
                        <span style="font-size: 10px; color: #ffaa00; margin-left: 4px;">×${getInventoryCount(id)}</span>
                        <div style="font-size: 9px; color: #888; margin-top: 2px;">${getItemEffectText(item)}</div>
                    </div>
                    <div>
                        <button class="mini-btn add-btn" onclick="sellShopItem('${id}')">売る (${price} G)</button>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
        return html;
    }

    function sellShopItem(itemId) {
        const player = window.player;
        const item = getItemDef(itemId);
        const invIndex = player.inventory.indexOf(itemId);
        if (!item || item.noSell || invIndex === -1) return;
        const sellPrice = getSellPrice(item);

        if (!confirm(`【${item.name}】を売却しますか？\n買取額: ${sellPrice} G`)) {
            return;
        }

        player.inventory.splice(invIndex, 1);
        player.gold += sellPrice;
        playConfirmSE();
        saveAndRenderShop();
    }

    // ========================================================
    // そうび (Equip)
    // ========================================================
    function renderEquipTabHtml() {
        const player = window.player;
        if (player.partyMembers.length === 0) {
            return `
                <div class="tavern-section scout-section">
                    <div class="party-slot-card empty-slot">
                        <span>パーティがいません (酒場で仲間を編成してください)</span>
                    </div>
                </div>
            `;
        }

        let selected = player.partyMembers.find(m => m.id === shopEquipMemberId);
        if (!selected) {
            selected = player.partyMembers[0];
            shopEquipMemberId = selected.id;
        }

        let html = `
            <div class="tavern-columns">
                <!-- 左側: 仲間の選択 -->
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【誰の装備を変える？】</span>
                    </div>
                    <div class="tavern-list">
        `;

        player.partyMembers.forEach(m => {
            const isSelected = m.id === selected.id;
            html += `
                <div class="roster-card ${isSelected ? 'shop-member-selected' : ''}">
                    <div>
                        <span style="font-weight: bold; color: #fff;">${escapeHtml(m.name)}</span>
                        <span style="font-size: 10px; color: #00ff88; margin-left: 4px;">${m.className} L${m.level}</span>
                        <div style="font-size: 9px; color: #888; margin-top: 2px;">${getEquipName(m, 'equippedWeapon')} / ${getEquipName(m, 'equippedArmor')}</div>
                    </div>
                    <div>
                        ${isSelected
                            ? `<button class="mini-btn" style="color: #ffff00; border-color: #ffff00;" onclick="selectShopEquipMember('${escapeHtml(m.id)}')">◀ 選択中</button>`
                            : `<button class="mini-btn" onclick="selectShopEquipMember('${escapeHtml(m.id)}')">選ぶ</button>`}
                    </div>
                </div>
            `;
        });

        html += `
                    </div>
                </div>

                <!-- 右側: 選んだ仲間の装備 -->
                <div class="tavern-section">
                    <div class="tavern-section-title">
                        <span>【${escapeHtml(selected.name)} の装備】</span>
                        <span style="font-size: 10px; color: #aaa;">素早さ: ${getMemberTotalSpd(selected)}</span>
                    </div>
                    <div class="tavern-list">
                        ${renderEquipSlotHtml(selected, 'weapon')}
                        ${renderEquipSlotHtml(selected, 'armor')}
                    </div>
                </div>
            </div>
        `;
        return html;
    }

    // 1つの装備欄 (今の装備と、荷物から付け替えられる品)
    function renderEquipSlotHtml(member, type) {
        const player = window.player;
        const isWeapon = type === 'weapon';
        const slot = isWeapon ? 'equippedWeapon' : 'equippedArmor';
        const partName = isWeapon ? '武器' : '防具';
        const currentDef = member[slot] ? getItemDef(member[slot]) : null;
        const currentText = currentDef ? `${currentDef.name} (${getItemEffectText(currentDef)})` : MESSAGES.noEquipment(slot);

        let html = `
            <div class="shop-category-title">― ${partName} ―</div>
            <div class="roster-card">
                <div>
                    <span style="font-size: 10px; color: #888;">今:</span>
                    <span style="font-weight: bold; color: #fff;">${currentText}</span>
                </div>
                <div>
                    ${currentDef ? `<button class="mini-btn remove-btn" onclick="unequipShopMember('${escapeHtml(member.id)}', '${type}')">外す</button>` : ''}
                </div>
            </div>
        `;

        // 荷物の同じ品はまとめて個数を表示
        const candidateIds = [];
        player.inventory.forEach(id => {
            const def = getItemDef(id);
            if (def && def.type === type && !candidateIds.includes(id)) candidateIds.push(id);
        });
        if (candidateIds.length === 0) {
            html += `<div style="font-size: 10px; color: #666; padding-left: 8px;">(荷物に${partName}がありません)</div>`;
        }
        candidateIds.forEach(id => {
            const def = getItemDef(id);
            const count = getInventoryCount(id);
            const actionHtml = canMemberEquip(member, def)
                ? `<button class="mini-btn add-btn" onclick="equipShopMember('${escapeHtml(member.id)}', '${id}')">装備する</button>`
                : `<span style="font-size: 10px; color: #666;">${MESSAGES.CANNOT_EQUIP_TAG}</span>`;
            html += `
                <div class="roster-card">
                    <div>
                        <span style="font-size: 10px; color: #888;">荷物:</span>
                        <span style="color: #fff;">${def.name}</span>
                        <span style="font-size: 10px; color: #00ff88; margin-left: 4px;">${getItemEffectText(def)}</span>
                        ${count > 1 ? `<span style="font-size: 10px; color: #ffaa00;"> ×${count}</span>` : ''}
                    </div>
                    <div>
                        ${actionHtml}
                    </div>
                </div>
            `;
        });
        return html;
    }

    function selectShopEquipMember(memberId) {
        if (typeof playCursorSE === 'function') playCursorSE();
        shopEquipMemberId = memberId;
        renderShopView();
    }

    // 荷物の武具を装備する (それまでの装備は荷物に戻る)
    function equipShopMember(memberId, itemId) {
        const player = window.player;
        const member = player.partyMembers.find(m => m.id === memberId);
        if (!member || !canMemberEquip(member, itemId)) {
            playCancelSE();
            return;
        }
        if (!equipItemFromInventory(player, member, itemId)) return;
        playConfirmSE();
        saveAndRenderShop();
    }

    // 装備を外して荷物に戻す
    function unequipShopMember(memberId, type) {
        const player = window.player;
        const member = player.partyMembers.find(m => m.id === memberId);
        if (!member) return;
        const slot = type === 'weapon' ? 'equippedWeapon' : 'equippedArmor';
        if (!unequipToInventory(player, member, slot)) return;
        playCancelSE();
        saveAndRenderShop();
    }

    // ========================================================
    // かんてい (Identify)
    // ========================================================
    function renderIdentifyTabHtml() {
        const player = window.player;
        const cost = GAME_RULES.town.identifyCost;
        const unidentified = player.unidentified;

        let html = `
            <div class="tavern-section scout-section">
                <div class="tavern-section-title">
                    <span>【未鑑定の品の鑑定】</span>
                    <span style="font-size: 10px; color: #aaa;">鑑定料: 1つ ${cost} G / 鑑定すると装備・売却できる</span>
                </div>
                <div class="tavern-list">
        `;

        if (unidentified.length === 0) {
            html += `
                <div class="party-slot-card empty-slot">
                    <span>店主「鑑定が要る品物は持っていないようだな。迷宮で拾ってきたら見てやるぜ。」</span>
                </div>
            `;
        }

        // 同じ「武器？」でも中身は違うかもしれないので、1つずつ並べる
        unidentified.forEach((id, idx) => {
            const actionHtml = player.gold >= cost
                ? `<button class="mini-btn add-btn" onclick="identifyShopItem(${idx})">鑑定する (${cost} G)</button>`
                : `<span style="font-size: 10px; color: #666;">${cost} G (所持金不足)</span>`;
            html += `
                <div class="roster-card">
                    <div>
                        <span style="font-weight: bold; color: #fff;">${getUnidentifiedName(id)}</span>
                        <div style="font-size: 9px; color: #888; margin-top: 2px;">迷宮で手に入れた正体不明の品</div>
                    </div>
                    <div>
                        ${actionHtml}
                    </div>
                </div>
            `;
        });

        if (unidentified.length > 1) {
            const totalCost = cost * unidentified.length;
            html += `
                <div style="display: flex; justify-content: flex-end;">
                    ${player.gold >= totalCost
                        ? `<button class="mini-btn add-btn" onclick="identifyAllShopItems()">すべて鑑定する (${totalCost} G)</button>`
                        : `<span style="font-size: 10px; color: #666;">すべて鑑定: ${totalCost} G (所持金不足)</span>`}
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;
        return html;
    }

    // 未鑑定の品を index 番目から count 個鑑定し、正体を知らせる
    function identifyShopItems(index, count) {
        const player = window.player;
        const totalCost = GAME_RULES.town.identifyCost * count;
        if (count <= 0 || index < 0 || index + count > player.unidentified.length) return;
        if (player.gold < totalCost) {
            playCancelSE();
            alert(`店主「鑑定もタダじゃないぜ。金を用意してきな！」\n(必要: ${totalCost} G / 所持: ${player.gold} G)`);
            return;
        }

        player.gold -= totalCost;
        const identifiedIds = [];
        for (let i = 0; i < count; i++) {
            identifiedIds.push(identifyItem(player, index));
        }
        playConfirmSE();
        saveAndRenderShop();

        const lines = identifiedIds.map(id => {
            const item = getItemDef(id);
            return `${getUnidentifiedName(id)} → 『${item.name}』 (${getItemEffectText(item)})`;
        });
        alertAfterEffect(`店主「どれどれ...見せてみな。」\n\n${lines.join('\n')}\n\n(鑑定した品は荷物に入った。「そうび」で装備、「うる」で売却できる)`, 200);
    }

    function identifyShopItem(index) {
        identifyShopItems(index, 1);
    }

    function identifyAllShopItems() {
        identifyShopItems(0, window.player.unidentified.length);
    }

    // スクリプトロード時にDOMを自動準備
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureShopDOM);
    } else {
        ensureShopDOM();
    }

    // グローバル公開
    window.visitShop = visitShop;
    window.closeShop = closeShop;
    window.renderShopView = renderShopView;
    window.switchShopTab = switchShopTab;
    window.buyShopItem = buyShopItem;
    window.equipPurchasedItem = equipPurchasedItem;
    window.skipEquipPurchasedItem = skipEquipPurchasedItem;
    window.sellShopItem = sellShopItem;
    window.selectShopEquipMember = selectShopEquipMember;
    window.equipShopMember = equipShopMember;
    window.unequipShopMember = unequipShopMember;
    window.identifyShopItem = identifyShopItem;
    window.identifyAllShopItems = identifyAllShopItems;

})(window);

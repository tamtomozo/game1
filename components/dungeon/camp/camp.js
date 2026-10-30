/**
 * ========================================================
 * キャンプ画面 (Camp) コンポーネント
 * ========================================================
 * 迷宮内の一時休息、呪文(SPELL)・持ち物(ITEM)・つよさ(STATUS)
 * (中断セーブはキャンプの開閉時に自動で行う)
 */

(function (window) {
    'use strict';

    let campOverlayEl = null;
    let campMenuListEl = null;
    let campPanelContentEl = null;
    let campHintEl = null;

    function ensureCampDOM() {
        campOverlayEl = document.getElementById('camp-overlay');
        if (!campOverlayEl) {
            const target = document.getElementById('part-camp') || document.body;
            campOverlayEl = document.createElement('div');
            campOverlayEl.id = 'camp-overlay';
            campOverlayEl.className = 'camp-overlay';
            campOverlayEl.style.display = 'none';
            campOverlayEl.innerHTML = `
                <div class="camp-window">
                    <div class="camp-header">
                        <div class="camp-title">=== CAMP (キャンプ) ===</div>
                        <div class="camp-subtitle">迷宮の安全な一角で休息し、態勢を整えている...</div>
                    </div>

                    <div class="camp-content">
                        <!-- 左側: メインコマンド一覧 -->
                        <div class="camp-menu" id="camp-menu-list">
                            <div class="camp-menu-item selected" data-cmd="spell"><span class="cursor">▶</span> 1. じゅもん (SPELL)</div>
                            <div class="camp-menu-item" data-cmd="item"><span class="cursor">▶</span> 2. もちもの (ITEM)</div>
                            <div class="camp-menu-item" data-cmd="status"><span class="cursor">▶</span> 3. つよさ (STATUS)</div>
                            <div class="camp-menu-item" data-cmd="leave"><span class="cursor">▶</span> 4. もどる (LEAVE)</div>
                        </div>

                        <!-- 右側: サブ詳細パネル -->
                        <div class="camp-panel" id="camp-sub-panel">
                            <div id="camp-panel-content">
                                <!-- 動的に内容を描画 -->
                            </div>
                        </div>
                    </div>

                    <div class="camp-footer">
                        <span id="camp-hint">${MESSAGES.HINT_SELECT}</span>
                    </div>
                </div>
            `;
            if (target && target.id === 'part-camp' && target.parentNode) {
                target.parentNode.replaceChild(campOverlayEl, target);
            } else {
                (target || document.body).appendChild(campOverlayEl);
            }
        }

        campMenuListEl = document.getElementById('camp-menu-list');
        campPanelContentEl = document.getElementById('camp-panel-content');
        campHintEl = document.getElementById('camp-hint');

        bindCampClickEvents();
        return campOverlayEl;
    }

    function bindCampClickEvents() {
        if (!campMenuListEl) return;
        const items = campMenuListEl.querySelectorAll('.camp-menu-item');
        items.forEach((item, idx) => {
            if (!item.hasAttribute('data-camp-bound')) {
                item.setAttribute('data-camp-bound', 'true');
                item.addEventListener('click', () => {
                    if (typeof initAudio === 'function') initAudio();
                    campSelectedIdx = idx;
                    updateCampMenuSelection(0);
                });
            }
        });
    }


// 5.5 キャンプシステム (CAMP)
// ========================================================
// campOverlayEl は ensureCampDOM() で管理
// campMenuListEl は ensureCampDOM() で管理
// campPanelContentEl は ensureCampDOM() で管理
// campHintEl は ensureCampDOM() で管理

let isCampOpen = false;
let campFocusArea = 'menu'; // 'menu' (左側メインコマンド), 'panel' (右側サブパネル), 'target' (対象メンバー選択)
let campSelectedIdx = 0;
let campSubSelectedIdx = 0;
let campStatusMemberIdx = 0; // 0〜5 (つよさ表示中のメンバー)
let campTargetMemberIdx = 0; // 0〜5 (対象選択中のメンバー)
let campTargetMode = null;   // null, 'spell', 'item_heal', 'item_mana', 'item_cure_poison', 'item_equip'
let campPendingItemIdx = null;
let campPendingSpellId = null;
const campCommands = ['spell', 'item', 'status', 'leave'];

// ※ 入力ガード blockInput() / isInputBlocked() は js/dungeon.js で定義

function openCamp() {
    ensureCampDOM();
    if (player.isMoving || player.isEventActive || inBattle || isCampOpen || (typeof isInputBlocked === 'function' && isInputBlocked())) return;
    isCampOpen = true;
    campFocusArea = 'menu';
    campSelectedIdx = 0;
    campSubSelectedIdx = 0;
    campStatusMemberIdx = 0;
    campTargetMemberIdx = 0;
    campTargetMode = null;
    campPendingItemIdx = null;
    campPendingSpellId = null;
    playCursorSE();

    // キャンプ設営時に自動で一時保存（中断セーブ）を実行
    saveTempCampPlayer(player);

    if (campOverlayEl) campOverlayEl.style.display = 'flex';

    blockInput();

    const subtitleEl = campOverlayEl ? campOverlayEl.querySelector('.camp-subtitle') : null;
    if (subtitleEl) {
        subtitleEl.innerHTML = `迷宮の一角にキャンプを設営中... <span style="color:#888;">(態勢を整えています)</span>`;
    }
    if (campHintEl) {
        campHintEl.innerText = '... キャンプを設営中 (準備完了までお待ちください) ...';
    }

    const items = campMenuListEl ? campMenuListEl.querySelectorAll('.camp-menu-item') : [];
    items.forEach((item, idx) => {
        if (idx === 0) item.classList.add('selected');
        else item.classList.remove('selected');
    });

    if (campPanelContentEl) {
        campPanelContentEl.innerHTML = `
            <div style="text-align: center; padding: 40px 10px; color: #888;">
                <div style="font-size: 15px; color: #00ffff; margin-bottom: 8px;">【 キャンプ設営中 】</div>
                <div>迷宮の安全な一角に荷を下ろし、警戒を固めています...</div>
            </div>
        `;
    }

    setTimeout(() => {
        if (!isCampOpen) return;
        if (subtitleEl) {
            subtitleEl.innerHTML = `迷宮の安全な一角で休息中... <span style="color:#00ffff; font-weight:bold;">★パーティ6名の現在地を自動で一時保存しました</span>`;
        }
        updateCampMenuSelection(0);
    }, 1000);
}

function closeCamp() {
    if (!isCampOpen || isInputBlocked()) return;
    isCampOpen = false;
    campFocusArea = 'menu';
    campTargetMode = null;
    playCancelSE();
    if (campOverlayEl) campOverlayEl.style.display = 'none';
    updateStatusUI();
    saveTempCampPlayer(player);

    // 入口 (地上への階段) でキャンプを終えたら、街へ戻るか尋ねる
    const floorData = FLOORS[currentFloorId];
    const stairInfo = (floorData && floorData.stairs) ? floorData.stairs[`${player.gridX},${player.gridZ}`] : null;
    if (stairInfo && stairInfo.isTownExit) {
        triggerStairs();
    }
}

function updateCampMenuSelection(delta = 0) {
    if (!isCampOpen || !campMenuListEl) return;
    if (delta !== 0) playCursorSE();

    campFocusArea = 'menu';
    campTargetMode = null;
    campSelectedIdx = (campSelectedIdx + delta + campCommands.length) % campCommands.length;
    campSubSelectedIdx = 0;

    const items = campMenuListEl.querySelectorAll('.camp-menu-item');
    items.forEach((item, idx) => {
        if (idx === campSelectedIdx) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });

    renderCampPanel(campCommands[campSelectedIdx]);
}

function updateCampSubSelection(delta = 0) {
    if (!isCampOpen || !campPanelContentEl) return;
    const rows = campPanelContentEl.querySelectorAll('.camp-item-row');
    if (rows.length === 0) return;

    if (delta !== 0) playCursorSE();
    campSubSelectedIdx = (campSubSelectedIdx + delta + rows.length) % rows.length;

    rows.forEach((row, idx) => {
        if (idx === campSubSelectedIdx) {
            row.classList.add('selected');
            if (row.scrollIntoView) {
                row.scrollIntoView({ block: 'nearest' });
            }
        } else {
            row.classList.remove('selected');
        }
    });
}

function updateCampTargetSelection(delta = 0) {
    if (!isCampOpen || !campPanelContentEl) return;
    const items = campPanelContentEl.querySelectorAll('.camp-target-item');
    if (items.length === 0) return;

    if (delta !== 0) playCursorSE();
    campTargetMemberIdx = (campTargetMemberIdx + delta + items.length) % items.length;

    items.forEach((item, idx) => {
        if (idx === campTargetMemberIdx) {
            item.classList.add('selected');
            if (item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function switchCampFocus(toArea) {
    if (!isCampOpen) return;
    if (toArea === 'panel') {
        const cmd = campCommands[campSelectedIdx];
        if (cmd === 'spell' || cmd === 'item') {
            const rows = campPanelContentEl ? campPanelContentEl.querySelectorAll('.camp-item-row') : [];
            if (rows.length > 0) {
                campFocusArea = 'panel';
                playConfirmSE();
                campSubSelectedIdx = 0;
                updateCampSubSelection(0);
                if (campHintEl) {
                    campHintEl.innerText = MESSAGES.HINT_SELECT;
                }
                return;
            }
        }
    } else {
        campFocusArea = 'menu';
        campTargetMode = null;
        playCancelSE();
        if (campPanelContentEl) {
            const rows = campPanelContentEl.querySelectorAll('.camp-item-row');
            rows.forEach(r => r.classList.remove('selected'));
        }
        if (campHintEl) {
            campHintEl.innerText = MESSAGES.HINT_SELECT;
        }
    }
}

function selectCampSubItem(idx) {
    campFocusArea = 'panel';
    campSubSelectedIdx = idx;
    updateCampSubSelection(0);
}
window.selectCampSubItem = selectCampSubItem;

// つよさ画面で表示する仲間を番号 (0 始まり) で切り替える
function switchCampStatusMember(idx) {
    const count = (player.partyMembers || []).length;
    if (idx < 0 || idx >= count) return;
    campStatusMemberIdx = idx;
    playCursorSE();
    renderCampPanel('status');
}
window.switchCampStatusMember = switchCampStatusMember;

// つよさ画面で前後の仲間へ移る (delta: -1 / +1。パーティの人数で一周する)
function stepCampStatusMember(delta) {
    const count = (player.partyMembers || []).length;
    if (count === 0) return;
    switchCampStatusMember((campStatusMemberIdx + delta + count) % count);
}

function cancelCampTargetMode() {
    campFocusArea = 'panel';
    campTargetMode = null;
    campPendingItemIdx = null;
    campPendingSpellId = null;
    playCancelSE();
    renderCampPanel(campCommands[campSelectedIdx]);
}
window.cancelCampTargetMode = cancelCampTargetMode;

function selectCampTarget(idx) {
    campTargetMemberIdx = idx;
    executeCampTargetAction();
}
window.selectCampTarget = selectCampTarget;

function renderCampPanel(cmd) {
    if (!campPanelContentEl) return;

    // --- じゅもん (SPELL) ---
    if (cmd === 'spell') {
        if (campTargetMode === 'spell') {
            const pendingSpell = SPELLS.find(sp => sp.id === campPendingSpellId);
            renderCampTargetPicker(`神聖魔法【${pendingSpell ? pendingSpell.name : ''}】(使用回数を1回使う) の対象を選択してください`);
            return;
        }

        const fieldSpells = SPELLS.filter(s => s.fieldUsable);

        // 神聖術士（僧侶・司祭）の呪文の残り使用回数
        const casters = player.partyMembers.filter(isHolyCaster);
        const casterInfo = casters.map(c => `${escapeHtml(c.name)} (${escapeHtml(c.className)} ${getSpellUsesText(c)})`).join('、');

        let html = `
            <div class="camp-panel-title">【 じゅもん (SPELL) 】</div>
            <div style="margin-bottom: 8px; font-size: 12px; color: #aaa;">神聖術師: <span style="color:#00ffff;">${casterInfo || 'なし'}</span></div>
        `;

        fieldSpells.forEach((s, idx) => {
            const isSelected = (campFocusArea === 'panel' && campSubSelectedIdx === idx);
            html += `
                <div class="camp-item-row ${isSelected ? 'selected' : ''}" data-sub-idx="${idx}" onclick="selectCampSubItem(${idx}); startCampSpellTarget('${s.id}')">
                    <div class="camp-item-info">
                        <span class="camp-item-name">${s.name}</span>
                        <span class="camp-item-desc">仲間のHPを約 ${s.power} 回復する神聖魔法 (使用回数を1回使う)</span>
                    </div>
                    <button class="camp-item-btn" onclick="event.stopPropagation(); selectCampSubItem(${idx}); startCampSpellTarget('${s.id}')">対象選択</button>
                </div>
            `;
        });

        html += `
            <div style="font-size: 11px; color: #666; margin-top: 15px;">
                ※戦闘用元素魔法「ファイア」は敵との交戦中のみ詠唱可能です。<br>
                ※神聖魔法は僧侶または司祭の使用回数を1回使って詠唱します。使用回数は宿屋に泊まると全回復します。
            </div>
        `;
        campPanelContentEl.innerHTML = html;
        if (campHintEl) {
            campHintEl.innerText = MESSAGES.HINT_SELECT;
        }

    // --- もちもの (ITEM) ---
    } else if (cmd === 'item') {
        if (campTargetMode) {
            let title = '対象の仲間を選択してください';
            if (campTargetMode === 'item_heal') title = '【回復薬】を使用する仲間を選択';
            else if (campTargetMode === 'item_mana') title = '【魔導の秘薬】を使用する仲間を選択';
            else if (campTargetMode === 'item_cure_poison') title = '【毒消し草】を使用する仲間を選択';
            else if (campTargetMode === 'item_equip') {
                const item = getItemDef(player.inventory[campPendingItemIdx]);
                title = `『${item ? item.name : '武具'}』を装備させる仲間を選択`;
            }
            renderCampTargetPicker(title);
            return;
        }

        let html = `
            <div class="camp-panel-title">【 もちもの (ITEM) 】</div>
            <div style="margin-bottom: 8px; color: #888; font-size: 12px;">所持アイテム数: ${player.inventory ? player.inventory.length : 0} 個</div>
        `;

        const inventory = player.inventory || [];
        const equippedEntries = getCampEquippedEntries();
        const totalRows = inventory.length + equippedEntries.length;
        if (campSubSelectedIdx >= totalRows) {
            campSubSelectedIdx = Math.max(0, totalRows - 1);
        }

        if (inventory.length === 0) {
            html += `<div style="color: #666; padding: 20px 0; text-align: center;">所持品はありません。</div>`;
        }

        inventory.forEach((itemId, idx) => {
            const item = getItemDef(itemId) || { id: itemId, name: itemId, desc: '未知のアイテム', usable: false };
            let actionBtn = '';
            const isSelected = (campFocusArea === 'panel' && campSubSelectedIdx === idx);

            if (item.usable) {
                actionBtn = `<button class="camp-item-btn" onclick="event.stopPropagation(); selectCampSubItem(${idx}); startCampItemTarget(${idx})">つかう</button>`;
            } else if (item.type === 'weapon' || item.type === 'armor') {
                actionBtn = `<button class="camp-item-btn" onclick="event.stopPropagation(); selectCampSubItem(${idx}); startCampEquipTarget(${idx})">そうび</button>`;
            } else {
                actionBtn = `<span style="font-size: 11px; color: #555;">[常時所持]</span>`;
            }

            html += `
                <div class="camp-item-row ${isSelected ? 'selected' : ''}" data-sub-idx="${idx}" onclick="selectCampSubItem(${idx})">
                    <div class="camp-item-info">
                        <span class="camp-item-name">${item.name}</span>
                        <span class="camp-item-desc">${item.desc}</span>
                    </div>
                    ${actionBtn}
                </div>
            `;
        });

        // 装備中の品 (本人が持っている。選ぶと外して荷物に戻す)
        if (equippedEntries.length > 0) {
            html += `<div style="margin: 10px 0 4px; color: #00aaaa; font-size: 12px;">【 装備中の品 】</div>`;
        }
        equippedEntries.forEach((entry, k) => {
            const rowIdx = inventory.length + k;
            const item = getItemDef(entry.itemId) || { name: entry.itemId };
            const isSelected = (campFocusArea === 'panel' && campSubSelectedIdx === rowIdx);
            html += `
                <div class="camp-item-row ${isSelected ? 'selected' : ''}" data-sub-idx="${rowIdx}" onclick="selectCampSubItem(${rowIdx})">
                    <div class="camp-item-info">
                        <span class="camp-item-name">${item.name}</span>
                        <span class="camp-item-desc">${escapeHtml(entry.member.name)} が装備中</span>
                    </div>
                    <button class="camp-item-btn" style="background:#005555; border-color:#00ffff; color:#fff;" onclick="event.stopPropagation(); selectCampSubItem(${rowIdx}); unequipCampEntry(${k})">はずす</button>
                </div>
            `;
        });

        // 未鑑定の品 (選べない。街の商店で鑑定すると荷物に入る)
        const unidentified = player.unidentified || [];
        if (unidentified.length > 0) {
            html += `<div style="margin: 10px 0 4px; color: #aa88ff; font-size: 12px;">【 未鑑定の品 】 <span style="color: #666; font-size: 11px;">※街の商店で鑑定すると使えるようになります</span></div>`;
            html += `<div style="color: #ccc; font-size: 12px; padding: 4px 8px;">${getUnidentifiedListText(unidentified)}</div>`;
        }
        campPanelContentEl.innerHTML = html;
        if (campHintEl) {
            campHintEl.innerText = MESSAGES.HINT_SELECT;
        }

    // --- つよさ (STATUS) ---
    } else if (cmd === 'status') {
        const m = player.partyMembers[campStatusMemberIdx] || player.partyMembers[0];

        // タブボタン
        let tabsHtml = `<div class="camp-member-tabs">`;
        player.partyMembers.forEach((mem, idx) => {
            const isActive = idx === campStatusMemberIdx ? 'active' : '';
            tabsHtml += `<div class="camp-member-tab ${isActive}" onclick="switchCampStatusMember(${idx})">${idx + 1}.${escapeHtml(mem.name)}</div>`;
        });
        tabsHtml += `</div>`;

        const html = `
            <div class="camp-panel-title">【 冒険者のつよさ (STATUS) 】</div>
            ${tabsHtml}
            ${renderMemberDetailRowsHtml(m, campStatusMemberIdx)}
            ${memberDetailStatRowHtml('所持金 (GOLD)', `${player.gold} G`, '#ffaa00')}
            ${memberDetailStatRowHtml('現在地 (LOCATION)', `${FLOORS[currentFloorId].name} (X:${player.gridX}, Z:${player.gridZ})`)}
            ${memberDetailStatRowHtml('方角 (FACING)', `${DIR_ICONS[player.dir]} ${DIR_NAMES[player.dir]}`)}
        `;
        campPanelContentEl.innerHTML = html;
        if (campHintEl) campHintEl.innerText = MESSAGES.HINT_SELECT;

    // --- キャンプを解く (LEAVE) ---
    } else if (cmd === 'leave') {
        const html = `
            <div class="camp-panel-title">【 キャンプを解く (LEAVE) 】</div>
            <p style="color: #aaa; margin-bottom: 20px;">
                前衛・後衛の陣形を整え、迷宮の探索へと戻ります。<br>
                警戒を怠らず前進してください。
            </p>
            <div style="text-align: center;">
                <button class="town-btn" style="padding: 10px 24px; font-size: 14px;" onclick="closeCamp()">探索を再開する</button>
            </div>
        `;
        campPanelContentEl.innerHTML = html;
        if (campHintEl) campHintEl.innerText = MESSAGES.HINT_SELECT;
    }
}

// 対象選択（ターゲットピッカー）の共通レンダラー
function renderCampTargetPicker(headerTitle) {
    if (!campPanelContentEl) return;

    let targetItemToEquip = null;
    if (campTargetMode === 'item_equip' && campPendingItemIdx !== null) {
        targetItemToEquip = getItemDef(player.inventory[campPendingItemIdx]);
    }

    let listHtml = `<div class="camp-target-list">`;
    player.partyMembers.forEach((m, idx) => {
        const isSelected = (idx === campTargetMemberIdx);
        const rowTag = getRowLabel(idx, true);
        const tagClass = isFrontRow(idx) ? 'row-front' : 'row-rear';

        const badgeColors = { good: '#00ff00', dead: '#ff4444', poison: '#dd44ff' };
        const condition = getMemberCondition(m);
        const stBadge = `<span style="color:${badgeColors[condition]};">[${MEMBER_CONDITION_LABELS[condition]}]</span>`;

        let extraNote = '';
        if (targetItemToEquip && !canMemberEquip(m, targetItemToEquip)) {
            extraNote = `<span style="color:#ff6666; font-size:11px;">${MESSAGES.CANNOT_EQUIP_TAG}</span>`;
        }

        listHtml += `
            <div class="camp-target-item ${isSelected ? 'selected' : ''}" onclick="selectCampTarget(${idx})">
                <div>
                    <span style="display:inline-block; width:18px; color:#aaa;">${idx + 1}.</span>
                    <span class="member-row-tag ${tagClass}">${rowTag}</span>
                    <strong style="margin: 0 6px;">${escapeHtml(m.name)}</strong>
                    <span style="color:#888; font-size:11px;">(${escapeHtml(m.className)})</span>
                    ${extraNote}
                </div>
                <div>
                    <span style="color:#00ff00; margin-right:8px;">H:${m.hp}/${m.maxHp}</span>
                    <span style="color:#00ffff; margin-right:8px;">${getSpellUsesText(m, true)}</span>
                    ${stBadge}
                </div>
            </div>
        `;
    });

    // キャンセルボタン
    const isCancelSelected = (campTargetMemberIdx === player.partyMembers.length);
    listHtml += `
        <div class="camp-target-item ${isCancelSelected ? 'selected' : ''}" style="justify-content:center; color:#aaa; margin-top:6px;" onclick="cancelCampTargetMode()">
            [ やめる (一覧へ戻る) ]
        </div>
    `;
    listHtml += `</div>`;

    const html = `
        <div class="camp-panel-title">【 対象選択 】</div>
        <div style="font-size: 13px; color: #00ffff; margin-bottom: 8px;">${headerTitle}</div>
        ${listHtml}
    `;

    campPanelContentEl.innerHTML = html;
    if (campHintEl) {
        campHintEl.innerText = MESSAGES.HINT_SELECT;
    }
}

// --- 呪文の対象選択開始 ---
function startCampSpellTarget(spellId) {
    initAudio();
    const spell = SPELLS.find(s => s.id === spellId);
    if (!spell) return;

    // 詠唱可能な仲間（使用回数が残っている僧侶・司祭）がいるか？
    const casters = player.partyMembers.filter(m => canCastSpell(m, spell));
    if (casters.length === 0) {
        playTone(180, 'sawtooth', 0.15, 0.2);
        alert(MESSAGES.noCasterAvailable(spell));
        return;
    }

    campPendingSpellId = spellId;
    campTargetMode = 'spell';
    campFocusArea = 'target';
    campTargetMemberIdx = 0;
    playConfirmSE();
    renderCampPanel('spell');
}
window.startCampSpellTarget = startCampSpellTarget;

// --- アイテムの対象選択開始 ---
function startCampItemTarget(itemIndex) {
    initAudio();
    if (!player.inventory || !player.inventory[itemIndex]) return;
    const itemId = player.inventory[itemIndex];
    const item = getItemDef(itemId);
    if (!item || !item.usable) return;

    campPendingItemIdx = itemIndex;
    if (item.type === 'heal') campTargetMode = 'item_heal';
    else if (item.type === 'mana') campTargetMode = 'item_mana';
    else if (item.type === 'cure_poison') campTargetMode = 'item_cure_poison';
    else return;

    campFocusArea = 'target';
    campTargetMemberIdx = 0;
    playConfirmSE();
    renderCampPanel('item');
}
window.startCampItemTarget = startCampItemTarget;

// --- 武具の装備対象選択開始 ---
function startCampEquipTarget(itemIndex) {
    initAudio();
    if (!player.inventory || !player.inventory[itemIndex]) return;
    const itemId = player.inventory[itemIndex];
    const item = getItemDef(itemId);
    if (!item || (item.type !== 'weapon' && item.type !== 'armor')) return;

    campPendingItemIdx = itemIndex;
    campTargetMode = 'item_equip';
    campFocusArea = 'target';
    campTargetMemberIdx = 0;
    playConfirmSE();
    renderCampPanel('item');
}
window.startCampEquipTarget = startCampEquipTarget;

// 対象選択時の実行
function executeCampTargetAction() {
    initAudio();
    if (campTargetMemberIdx >= player.partyMembers.length) {
        // 「やめる」を選択
        cancelCampTargetMode();
        return;
    }

    const target = player.partyMembers[campTargetMemberIdx];
    if (!target) return;

    // --- 1. 呪文詠唱 ---
    if (campTargetMode === 'spell') {
        const spell = SPELLS.find(s => s.id === campPendingSpellId);
        if (!spell) return;

        if (!isMemberAlive(target)) {
            playTone(180, 'sawtooth', 0.15, 0.2);
            alert(MESSAGES.CANNOT_HEAL_DEAD);
            return;
        }

        if (target.hp >= target.maxHp) {
            playTone(200, 'triangle', 0.1, 0.15);
            alert(MESSAGES.HP_ALREADY_FULL);
            return;
        }

        // 詠唱者決定 (僧侶優先、なければ司祭)
        const caster = player.partyMembers.find(m => canCastSpell(m, spell));
        if (!caster) {
            playTone(180, 'sawtooth', 0.15, 0.2);
            alert(MESSAGES.NO_SPELL_USES_LEFT);
            return;
        }

        consumeSpellUse(caster, spell.id);
        const oldHp = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + spell.power);
        const healed = target.hp - oldHp;

        playMagicSE();
        syncPartyLeader(player, false);
        saveTempCampPlayer(player);
        updateStatusUI();

        showMessage(`${caster.name} は${spell.name}を唱えた！\n『${target.name}』のHPが ${healed} 回復した！`);
        campTargetMode = null;
        campFocusArea = 'panel';
        renderCampPanel('spell');

    // --- 2. アイテム (回復薬) ---
    } else if (campTargetMode === 'item_heal') {
        const itemId = player.inventory[campPendingItemIdx];
        const item = getItemDef(itemId);
        if (!item) return;

        if (!isMemberAlive(target)) {
            playTone(180, 'sawtooth', 0.15, 0.2);
            alert(MESSAGES.CANNOT_USE_ON_DEAD);
            return;
        }

        if (target.hp >= target.maxHp) {
            playTone(200, 'triangle', 0.1, 0.15);
            alert(MESSAGES.HP_ALREADY_FULL);
            return;
        }

        const oldHp = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + item.power);
        const healed = target.hp - oldHp;

        player.inventory.splice(campPendingItemIdx, 1);
        playTone([440, 660, 880], 'triangle', 0.18, 0.2);
        syncPartyLeader(player, false);
        saveTempCampPlayer(player);
        updateStatusUI();

        showMessage(`『${target.name}』に【${item.name}】を使った！\nHPが ${healed} 回復した！`);
        campTargetMode = null;
        campFocusArea = 'panel';
        renderCampPanel('item');

    // --- 3. アイテム (魔導の秘薬) ---
    } else if (campTargetMode === 'item_mana') {
        const itemId = player.inventory[campPendingItemIdx];
        const item = getItemDef(itemId);
        if (!item) return;

        if (!isMemberAlive(target)) {
            playTone(180, 'sawtooth', 0.15, 0.2);
            alert(MESSAGES.CANNOT_USE_ON_DEAD);
            return;
        }

        if (getKnownSpellIds(target).length === 0) {
            playTone(180, 'sawtooth', 0.15, 0.2);
            alert("呪文を習得していない仲間には使えません！");
            return;
        }

        if (!hasSpentSpellUses(target)) {
            playTone(200, 'triangle', 0.1, 0.15);
            alert(MESSAGES.SPELL_USES_ALREADY_FULL);
            return;
        }

        restoreSpellUses(target, item.power);

        player.inventory.splice(campPendingItemIdx, 1);
        playTone([520, 780, 1040], 'sine', 0.2, 0.25);
        syncPartyLeader(player, false);
        saveTempCampPlayer(player);
        updateStatusUI();

        showMessage(`『${target.name}』に【${item.name}】を使った！\n呪文の使用回数が回復した！ (${getSpellUsesText(target)})`);
        campTargetMode = null;
        campFocusArea = 'panel';
        renderCampPanel('item');

    // --- 4. アイテム (毒消し草) ---
    } else if (campTargetMode === 'item_cure_poison') {
        const itemId = player.inventory[campPendingItemIdx];
        const item = getItemDef(itemId);
        if (!item) return;

        if (!target.isPoisoned) {
            playTone(200, 'triangle', 0.1, 0.15);
            alert("毒には冒されていません！");
            return;
        }

        target.isPoisoned = false;
        player.inventory.splice(campPendingItemIdx, 1);

        playTone([523.3, 659.3, 783.9, 1046.5], 'sine', 0.25, 0.2);
        flashScreen(false, 'white');
        syncPartyLeader(player, false);
        saveTempCampPlayer(player);
        updateStatusUI();

        showMessage(`『${target.name}』に【${item.name}】を使った！\n毒が完全に浄化された！`);
        campTargetMode = null;
        campFocusArea = 'panel';
        renderCampPanel('item');

    // --- 5. 武具装備 / 外し ---
    } else if (campTargetMode === 'item_equip') {
        const itemId = player.inventory[campPendingItemIdx];
        const item = getItemDef(itemId);
        if (!item) return;

        // クラス適性チェック
        if (!canMemberEquip(target, item)) {
            playTone(180, 'sawtooth', 0.15, 0.2);
            alert(`おいおい、${target.name}はその武具を扱えないぜ！\n（${target.className}は${item.name}を装備できません）`);
            return;
        }

        // 装備実行 (荷物から本人へ移し、それまでの装備は荷物に戻す)
        const previousId = equipItemFromInventory(player, target, itemId);

        playTone([440, 660, 880], 'triangle', 0.15, 0.2);
        syncPartyLeader(player, false);
        saveTempCampPlayer(player);
        updateStatusUI();

        const previousNote = MESSAGES.previousEquipStored(previousId);
        showMessage(`『${target.name}』に『${item.name}』を装備させた！${previousNote}`);
        campTargetMode = null;
        campFocusArea = 'panel';
        renderCampPanel('item');
    }
}

// 装備中の品の一覧 (隊列順・武器→防具)。もちもの画面で荷物の後ろに並べる
function getCampEquippedEntries() {
    const entries = [];
    (player.partyMembers || []).forEach(m => {
        ['equippedWeapon', 'equippedArmor'].forEach(slot => {
            if (m[slot]) entries.push({ member: m, slot: slot, itemId: m[slot] });
        });
    });
    return entries;
}

// 装備中の品を外して荷物に戻す
function unequipCampEntry(entryIdx) {
    initAudio();
    const entry = getCampEquippedEntries()[entryIdx];
    if (!entry) return;

    unequipToInventory(player, entry.member, entry.slot);
    playConfirmSE();
    syncPartyLeader(player, false);
    saveTempCampPlayer(player);
    updateStatusUI();

    const item = getItemDef(entry.itemId);
    const bareName = entry.slot === 'equippedWeapon' ? '素手' : '平服';
    showMessage(`『${entry.member.name}』の『${item ? item.name : entry.itemId}』を外して荷物にしまった。(${bareName}になった)`);
    campFocusArea = 'panel';
    renderCampPanel('item');
}
window.unequipCampEntry = unequipCampEntry;

function executeCampAction() {
    const cmd = campCommands[campSelectedIdx];

    // 対象選択中 (target) に決定キー
    if (campFocusArea === 'target') {
        executeCampTargetAction();
        return;
    }

    // サブパネル (panel) にフォーカスがある場合
    if (campFocusArea === 'panel') {
        if (cmd === 'spell') {
            const fieldSpells = SPELLS.filter(s => s.fieldUsable);
            if (fieldSpells[campSubSelectedIdx]) {
                startCampSpellTarget(fieldSpells[campSubSelectedIdx].id);
            }
        } else if (cmd === 'item') {
            const inventory = player.inventory || [];
            if (campSubSelectedIdx >= inventory.length) {
                // 装備中の品の行: 外して荷物に戻す
                unequipCampEntry(campSubSelectedIdx - inventory.length);
                return;
            }
            const itemId = inventory[campSubSelectedIdx];
            const item = getItemDef(itemId);
            if (item && item.usable) {
                startCampItemTarget(campSubSelectedIdx);
            } else if (item && (item.type === 'weapon' || item.type === 'armor')) {
                startCampEquipTarget(campSubSelectedIdx);
            } else {
                playCancelSE();
            }
        }
        return;
    }

    // 左側メインメニューにフォーカスがある場合
    if (cmd === 'leave') {
        closeCamp();
    } else if (cmd === 'spell' || cmd === 'item') {
        switchCampFocus('panel');
    }
}



    // キャンプ専用 キー入力ハンドラ (keydown 委譲用)
    function handleCampKeyDown(e) {
        if (!isCampOpen) return false;

        if (campFocusArea === 'target') {
            // 三階層目 (対象メンバー選択中)
            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                updateCampTargetSelection(-1);
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                updateCampTargetSelection(1);
            } else if (e.key === 'ArrowLeft' || e.key === 'Escape' || e.key === 'Backspace') {
                cancelCampTargetMode();
            } else if (e.key >= '1' && e.key <= '6') {
                const idx = parseInt(e.key, 10) - 1;
                if (player && player.partyMembers && idx < player.partyMembers.length) {
                    campTargetMemberIdx = idx;
                    executeCampTargetAction();
                }
            }
        } else if (campFocusArea === 'panel') {
            // 二階層目 (右側サブパネル: 呪文・アイテム一覧)
            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                updateCampSubSelection(-1);
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                updateCampSubSelection(1);
            } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'Escape') {
                switchCampFocus('menu');
            }
        } else {
            // 一階層目 (左側メインコマンド)
            if (campCommands[campSelectedIdx] === 'status') {
                // つよさ画面表示中は左右キーまたは数字キーで仲間タブを切り替え可能
                if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                    stepCampStatusMember(-1);
                    return true;
                } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                    stepCampStatusMember(1);
                    return true;
                } else if (e.key >= '1' && e.key <= '6') {
                    const idx = parseInt(e.key, 10) - 1;
                    if (player && player.partyMembers && idx < player.partyMembers.length) {
                        switchCampStatusMember(idx);
                        return true;
                    }
                }
            }

            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                updateCampMenuSelection(-1);
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                updateCampMenuSelection(1);
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                switchCampFocus('panel');
            } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
                closeCamp();
            }
        }
        return true;
    }

    // スクリプトロード時にDOMを自動準備
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureCampDOM);
    } else {
        ensureCampDOM();
    }

    // グローバル公開
    window.openCamp = openCamp;
    window.closeCamp = closeCamp;
    window.executeCampAction = executeCampAction;
    window.handleCampKeyDown = handleCampKeyDown;
    window.ensureCampDOM = ensureCampDOM;
    window.bindCampClickEvents = bindCampClickEvents;
    window.getIsCampOpen = () => isCampOpen;

    // isCampOpen の読み書きを同期
    try {
        Object.defineProperty(window, 'isCampOpen', {
            get: () => isCampOpen,
            set: (val) => { isCampOpen = val; },
            configurable: true
        });
    } catch (e) {
        window.isCampOpen = false;
    }

})(window);

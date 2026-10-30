/**
 * ========================================================
 * 冒険者のつよさ (Member Detail) 共通パーツ
 * ========================================================
 * 1人分の詳しい状態 (状態・レベル・HP・能力値・装備・呪文・経験値) の行を作る
 * 街の「パーティの状態」の詳細ウィンドウと、迷宮のキャンプ「つよさ」で使う
 */

(function (window) {
    'use strict';

    const CONDITION_TEXTS = {
        good: '<span style="color:#00ff00;">健康 (GOOD)</span>',
        dead: '<span style="color:#ff3333;">死亡 (DEAD)</span>',
        poison: '<span style="color:#dd44ff;">毒 (POISON)</span>'
    };

    function statRowHtml(label, valueHtml, color) {
        const style = color ? ` style="color:${color};"` : '';
        return `<div class="camp-stat-row"><span class="camp-stat-label">${label}</span><span class="camp-stat-val"${style}>${valueHtml}</span></div>`;
    }

    /**
     * 1人分のつよさの行 (.camp-stat-row) を並べた HTML
     * @param {object} m - パーティのメンバー
     * @param {number} slot - 隊列の番号 (0 始まり。前衛/後衛の表示に使う)
     */
    function renderMemberDetailRowsHtml(m, slot) {
        const clsDef = CLASS_DEFS[m.classId] || {};
        const nextExp = Math.max(0, getNextLevelExp(m.level) - (m.exp || 0));
        const weaponDef = m.equippedWeapon ? getItemDef(m.equippedWeapon) : null;
        const armorDef = m.equippedArmor ? getItemDef(m.equippedArmor) : null;
        const spdBonus = getMemberSpdBonus(m);
        const baseSpd = (clsDef.baseSpd || 10) + ((m.level - 1) * 2);

        const attrText = Object.keys(ATTRIBUTE_DEFS)
            .map(k => `${ATTRIBUTE_DEFS[k].shortName}:${(m.attrs && m.attrs[k]) || '-'}`)
            .join(' ');
        const spellNames = getKnownSpellIds(m)
            .map(id => { const sp = SPELLS.find(s => s.id === id); return sp ? sp.name : id; })
            .join('、');

        return [
            statRowHtml('仲間 (MEMBER)', `<span style="font-weight:bold;">${escapeHtml(m.name)} (${escapeHtml(m.className)}) 【${getRowLabel(slot)}】</span>`, '#00ffff'),
            statRowHtml('状態 (STATUS)', CONDITION_TEXTS[getMemberCondition(m)]),
            statRowHtml('レベル (LEVEL)', `Lv.${m.level}`),
            statRowHtml('生命力 (HP)', `${m.hp} / ${m.maxHp}`, '#00ff00'),
            statRowHtml('呪文回数 (SPELL)', getSpellUsesText(m) || 'なし', '#00ffff'),
            statRowHtml('能力値 (ATTR)', attrText, '#00ff88'),
            statRowHtml('素早さ (SPEED)', `${getMemberTotalSpd(m)} (基礎 ${baseSpd} / 装備 ${spdBonus >= 0 ? '+' : ''}${spdBonus})`, '#ffff88'),
            statRowHtml('装備武器', weaponDef ? `${weaponDef.name} (+${getMemberAtkBonus(m)})` : MESSAGES.noEquipment('equippedWeapon'), '#88ff88'),
            statRowHtml('装備防具', armorDef ? `${armorDef.name} (+${getMemberDefBonus(m)})` : MESSAGES.noEquipment('equippedArmor'), '#88ffff'),
            statRowHtml('習得呪文', spellNames || 'なし', '#dd88ff'),
            statRowHtml('蓄積経験値 (EXP)', `${m.exp || 0}`),
            statRowHtml('次のレベルまで', `あと ${nextExp} EXP (街の宿屋で成長)`, '#ffff00')
        ].join('');
    }

    // グローバル公開
    window.renderMemberDetailRowsHtml = renderMemberDetailRowsHtml;
    window.memberDetailStatRowHtml = statRowHtml;

})(window);

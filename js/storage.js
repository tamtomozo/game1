// ========================================================
// セーブデータ & 共通ステート管理 (localStorage)
// ========================================================
const STORAGE_KEY_PERMANENT = 'wizardry_permanent_save'; // 街で行う公式な永続セーブ
const STORAGE_KEY_TEMP = 'wizardry_temp_save';           // ダンジョン内のキャンプ自動一時保存 (中断セーブ)
const STORAGE_KEY_ROSTER = 'wizardry_character_roster'; // 登録冒険者名簿 (待機所)
const STORAGE_KEY_CORPSES = 'wizardry_corpses';         // ダンジョン内の遺体・遺留品データ
const STORAGE_KEY_SCOUTS = 'wizardry_tavern_scouts';    // 酒場のスカウト候補 (ダンジョンから戻るたびに入れ替わる)
const STORAGE_KEY = 'wizardry_save_data';                // 下位互換用キー

// ========================================================
// ゲームルール・調整値 (街・ダンジョン共通)
// ※ 複数のファイルで使う値やバランス調整で触る値はここに置く。
//    そのファイルの中だけで使う値 (アニメ時間・宝箱の罠の確率など) は各ファイルの冒頭に置く
// ========================================================
const GAME_RULES = {
    party: {
        maxSize: 6,              // パーティの最大人数
        frontRowSize: 3          // 前衛の人数 (先頭から)
    },
    town: {
        reviveCost: 80,          // 教会: 死者の復活
        curePoisonCost: 30,      // 教会: 解毒の祈祷
        innSuiteCost: 10,        // 宿屋: スイートルーム (Lv1 のときの値段。パーティの最高レベルに応じて上がる)
        innSuiteCostPerLevel: 20, // 宿屋: スイートルームの値上がり (レベル1ごと)
        innSuiteCostMax: 200,    // 宿屋: スイートルームの値段の上限
        sellPriceRatio: 0.5,     // 商店: 売値 = 価格 × この割合 (sellPrice 指定がある品はそちら)
        identifyCost: 30         // 商店: 未鑑定の武具の鑑定料 (品によらず一律。値段から正体が分からないように)
    },
    item: {
        plusMax: 20,             // ドロップ品の＋値の上限 (下限は 0。0 のときは＋を表示しない)
        plusCurve: 3,            // ＋値の出やすさ。1 なら 0〜plusMax が均等、大きいほど高い＋値が出にくい
        plusSellRatePerPoint: 0.1 // ＋値 1 ごとに売値を元の売値のこの割合だけ上げる
    },
    dungeon: {
        poisonStepDamage: 2,     // 毒: 1歩ごとのダメージ
        pitTrapDamageMin: 5,     // 落とし穴のダメージ (最小)
        pitTrapDamageMax: 9      // 落とし穴のダメージ (最大)
    },
    battle: {
        encounterRate: 0.25,     // 1歩ごとのエンカウント率
        expRate: 3.9,            // 敵の経験値の倍率 (B1F だけで 200 戦ほどで Lv20 に届くように調整)
        escapeRate: 0.70,        // 逃走成功率
        frontTargetRate: 0.70,   // 敵が前衛を狙う確率 (前衛・後衛の両方に生存者がいるとき)
        defendDamageRate: 0.5,   // 防御中の被ダメージ倍率
        persuadeFailDamage: 15,  // ボスの説得に失敗したときのダメージ
        bossEscapeFailDamage: 10, // ボス戦で逃げようとしたときのダメージ
        actionDelayMs: 1000      // 戦闘の各行動の間の待ち時間
    },
    spell: {
        maxUses: 9,              // 1つの呪文の使用回数の上限
        attrBonusStep: 5         // 呪文の能力値 (知恵/信仰心) が 10 からこの値だけ上がるごとに使用回数 +1
    },
    input: {
        cooldownMs: 150,         // 決定キーの連打防止
        blockMs: 1000            // ウィンドウを開いた直後などの入力ブロック
    }
};

// ========================================================
// 共通の小関数 (街・ダンジョン共通)
// ========================================================
// 冒険者名などの文字列を HTML / 属性値として安全に埋め込む
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isMemberAlive(member) {
    return !!member && !member.isDead && member.hp > 0;
}

// 隊列の位置 (0 始まり) が前衛か
function isFrontRow(idx) {
    return idx < GAME_RULES.party.frontRowSize;
}

// 隊列のラベル (short = true で「前」「後」)
function getRowLabel(idx, short = false) {
    if (short) return isFrontRow(idx) ? '前' : '後';
    return isFrontRow(idx) ? '前衛' : '後衛';
}

// 状態: 'dead' (死亡) / 'poison' (毒) / 'good' (健康)。表示ラベルは MEMBER_CONDITION_LABELS
const MEMBER_CONDITION_LABELS = { good: '生', dead: '死', poison: '毒' };
function getMemberCondition(member) {
    if (!isMemberAlive(member)) return 'dead';
    if (member.isPoisoned) return 'poison';
    return 'good';
}

// 装備名 (slot = 'equippedWeapon' | 'equippedArmor')。何も装備していなければ「素手」「平服」
function getEquipName(member, slot) {
    const itemId = member ? member[slot] : null;
    if (itemId) return getItemDef(itemId) ? getItemDef(itemId).name : itemId;
    return slot === 'equippedWeapon' ? '素手' : '平服';
}

// 神聖魔法 (ヒール) を唱えられる職業か
function isHolyCaster(member) {
    return !!member && (member.classId === 'priest' || member.classId === 'bishop');
}

// 習得している呪文の ID 一覧 (名簿に記録がなければ職業の初期呪文)
function getKnownSpellIds(member) {
    if (!member) return [];
    if (Array.isArray(member.spells) && member.spells.length > 0) return member.spells;
    const cls = CLASS_DEFS[member.classId];
    return (cls && Array.isArray(cls.initialSpells)) ? cls.initialSpells : [];
}

// 呪文の最大使用回数 = 職業の spellUseLevels のうち現在のレベル以下の数 + 能力値ボーナス (上限 GAME_RULES.spell.maxUses)
function getSpellMaxUses(member, spellId) {
    if (!member || !getKnownSpellIds(member).includes(spellId)) return 0;
    const cls = CLASS_DEFS[member.classId] || {};
    const levels = (cls.spellUseLevels && cls.spellUseLevels[spellId]) || [];
    const byLevel = levels.filter(lv => lv <= (member.level || 1)).length;
    if (byLevel === 0) return 0;
    const spell = SPELLS.find(s => s.id === spellId);
    const attrVal = (spell && member.attrs && member.attrs[spell.attr]) || 10;
    const attrBonus = Math.max(0, Math.floor((attrVal - 10) / GAME_RULES.spell.attrBonusStep));
    return Math.min(GAME_RULES.spell.maxUses, byLevel + attrBonus);
}

// 呪文の残り使用回数 (記録がない古いセーブデータは最大回数とみなす)
function getSpellUses(member, spellId) {
    const max = getSpellMaxUses(member, spellId);
    const uses = member && member.spellUses ? member.spellUses[spellId] : undefined;
    return typeof uses === 'number' ? Math.max(0, Math.min(max, uses)) : max;
}

// 呪文を1回使う
function consumeSpellUse(member, spellId) {
    if (!member.spellUses) member.spellUses = {};
    member.spellUses[spellId] = Math.max(0, getSpellUses(member, spellId) - 1);
}

// 習得している呪文の使用回数を amount 回ずつ回復 (amount 省略で全回復)。回復した回数の合計を返す
function restoreSpellUses(member, amount = Infinity) {
    if (!member) return 0;
    const before = Object.assign({}, member.spellUses);
    const uses = {};
    let restored = 0;
    getKnownSpellIds(member).forEach(id => {
        const max = getSpellMaxUses(member, id);
        const current = typeof before[id] === 'number' ? Math.min(max, before[id]) : max;
        uses[id] = Math.min(max, current + amount);
        restored += uses[id] - current;
    });
    member.spellUses = uses;
    return restored;
}

// 使用回数が減っている呪文があるか
function hasSpentSpellUses(member) {
    return getKnownSpellIds(member).some(id => getSpellUses(member, id) < getSpellMaxUses(member, id));
}

// 呪文の使用回数の表示 (例: 「ヒール 3/4 ファイア 2/3」、short = true で「ヒ3/4 フ2/3」)。呪文がなければ空文字
function getSpellUsesText(member, short = false) {
    return getKnownSpellIds(member).map(id => {
        const spell = SPELLS.find(s => s.id === id);
        const name = spell ? spell.name : id;
        const count = `${getSpellUses(member, id)}/${getSpellMaxUses(member, id)}`;
        return short ? `${name.charAt(0)}${count}` : `${name} ${count}`;
    }).join(' ');
}

// 古いセーブデータの MP を取り除き、呪文の使用回数を最大回数の範囲に収める
function normalizeSpellUses(member) {
    if (!member) return;
    delete member.mp;
    delete member.maxMp;
    const uses = {};
    getKnownSpellIds(member).forEach(id => { uses[id] = getSpellUses(member, id); });
    member.spellUses = uses;
}

// その呪文を今唱えられるか (生存していて、その呪文を習得し、使用回数が残っている)
function canCastSpell(member, spell) {
    return isMemberAlive(member) && !!spell && getSpellUses(member, spell.id) > 0;
}

function getSellPrice(item) {
    return item.sellPrice || Math.floor((item.price || 20) * GAME_RULES.town.sellPriceRatio);
}

// ========================================================
// 選択肢の文言 (表示と分岐の両方でこの定数を使い、文言を変えても分岐が壊れないようにする)
// ※ 複数の画面で使う選択肢だけをここに置く。画面ごとの選択肢は各ファイルの冒頭で定義する
// ========================================================
const COMMON_COMMANDS = {
    BACK: 'もどる',
    CANCEL: 'やめる',
    LEAVE: '立ち去る',
    DONE: '完了',
    OK: 'わかりました'
};

// 「(はい)」「(いいえ)」を含む選択肢は [Y] / [N] キーで選べる。
// [Esc] / [Backspace] は「もどる」「やめる」と「(いいえ)」を含む選択肢を選ぶ
const YES_MARK = '(はい)';
const NO_MARK = '(いいえ)';

function isCancelCommand(label) {
    return label === COMMON_COMMANDS.BACK || label === COMMON_COMMANDS.CANCEL || label.includes(NO_MARK);
}
function isYesCommand(label) {
    return label.includes(YES_MARK) || label === 'はい';
}
function isNoCommand(label) {
    return label.includes(NO_MARK) || label === 'いいえ';
}

// ========================================================
// 決まり文句 (複数の箇所で使う案内文・短い定型文)
// ※ イベントや施設の長いセリフは、流れと一緒に読めるよう各ファイルに置く
// ========================================================
const MESSAGES = {
    // ウィンドウ右下の案内 (操作説明の文言は出さず「＊」だけを表示する)
    HINT_CLOSE: '＊',
    HINT_SELECT: '＊',
    HINT_CLICK: '＊',

    CORPSE_AT_FEET: '足元に以前倒れた冒険者の遺体が横たわっている... [Space/Enterで調べる]',
    CANNOT_HEAL_DEAD: '息絶えた仲間は回復できません！ (教会で蘇生してください)',
    CANNOT_USE_ON_DEAD: '息絶えた仲間には使えません！ (教会で蘇生してください)',
    HP_ALREADY_FULL: 'HPはすでに満タンです！',
    SPELL_USES_ALREADY_FULL: '呪文の使用回数はすでに満タンです！',
    NO_SPELL_USES_LEFT: 'その呪文はもう唱えられません！ (使用回数切れ)',
    CANNOT_EQUIP_TAG: '[※装備不可]',
    TOWN_TITLE: '[ 王都ルミナリア ]',

    noCasterAvailable: (spell) => `【${spell.name}】を唱えられる仲間（使用回数が残っている者）がいません！`,
    // 持ち替えで荷物に戻した装備の一文 (戻した品がなければ空文字)
    previousEquipStored: (previousId) =>
        previousId && getItemDef(previousId) ? `\n(それまでの『${getItemDef(previousId).name}』は荷物にしまった)` : '',
    // 何も装備していないときの表示 (slot = 'equippedWeapon' | 'equippedArmor')
    noEquipment: (slot) => `なし (${getEquipName(null, slot)})`
};

// 戦闘行動のバッジ { cls, text } (ステータス欄の各冒険者に表示)。表示しないときは null
function getActionBadge(action) {
    if (!action) return null;
    switch (action.type) {
        case '_selecting': return { cls: 'action-selecting', text: '選択中...' };
        case 'attack': return { cls: 'action-attack', text: action.isRanged ? '🏹 援護' : '⚔ たたかう' };
        case 'defend': return { cls: 'action-defend', text: '🛡 ぼうぎょ' };
        case 'magic': return { cls: 'action-magic', text: `✨ ${action.spell ? action.spell.name : 'まほう'}` };
        case 'item': return { cls: 'action-item', text: `🧪 ${action.itemDef ? action.itemDef.name : 'どうぐ'}` };
        case 'escape': return { cls: 'action-escape', text: '🏃 にげる' };
        case 'persuade': return { cls: 'action-persuade', text: '💬 説得' };
        default: return null;
    }
}

// ========================================================
// 遭難データ (遺体・遺品) 管理
// ========================================================
function loadCorpses() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_CORPSES);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) return list;
        }
    } catch (e) {
        console.warn('Failed to load corpses:', e);
    }
    return [];
}

// 遺体マス判定用のキャッシュ。getCorpseAt は1歩ごとに呼ばれるため、遺体データが保存されるまで解析結果を使い回す
let corpseLookupCache = null;

function saveCorpses(corpses) {
    corpseLookupCache = null;
    try {
        localStorage.setItem(STORAGE_KEY_CORPSES, JSON.stringify(corpses || []));
    } catch (e) {
        console.error('Failed to save corpses:', e);
    }
}

function addCorpse(entry) {
    const list = loadCorpses();
    list.push(entry);
    saveCorpses(list);
    return list;
}

function removeCorpse(id) {
    const list = loadCorpses();
    const updated = list.filter(c => c.id !== id);
    saveCorpses(updated);
    return updated;
}

// ※ 返す遺体データは参照専用。書き換えるときは loadCorpses で取り直し、updateCorpse / removeCorpse で保存する
function getCorpseAt(floorId, x, z) {
    if (!corpseLookupCache) corpseLookupCache = loadCorpses();
    return corpseLookupCache.find(c => c.floorId === floorId && c.x === x && c.z === z);
}

function updateCorpse(entry) {
    const list = loadCorpses();
    const idx = list.findIndex(c => c.id === entry.id);
    if (idx !== -1) {
        list[idx] = entry;
        saveCorpses(list);
    }
    return list;
}

function isCharacterLostInDungeon(charId) {
    const list = loadCorpses();
    return list.some(c => Array.isArray(c.members) && c.members.some(m => m.id === charId));
}

function getLostCharacterInfo(charId) {
    const list = loadCorpses();
    for (const c of list) {
        if (Array.isArray(c.members)) {
            const found = c.members.find(m => m.id === charId);
            if (found) {
                return { corpse: c, member: found };
            }
        }
    }
    return null;
}

// 冒険者能力値 (Attributes) 定義
const ATTRIBUTE_DEFS = {
    str: { id: 'str', name: '力 (STR)', shortName: '力', desc: '近接物理攻撃力・重装備の扱いやすさに影響' },
    int: { id: 'int', name: '知恵 (INT)', shortName: '知', desc: '魔術師系呪文 (ファイア) の使用回数に影響' },
    pie: { id: 'pie', name: '信仰心 (PIE)', shortName: '信', desc: '僧侶系神聖呪文 (ヒール) の使用回数に影響' },
    vit: { id: 'vit', name: '生命力 (VIT)', shortName: '生', desc: '最大HP・レベルアップ時のHP成長に影響' },
    agi: { id: 'agi', name: '素早さ (AGI)', shortName: '速', desc: '戦闘での行動順(SPD)・回避に影響' },
    luc: { id: 'luc', name: '運 (LUC)', shortName: '運', desc: '宝箱の罠解除成功率・致命傷回避に影響' }
};

const CLASS_DEFS = {
    'fighter': {
        id: 'fighter',
        name: '戦士',
        nameEn: 'Fighter',
        desc: '強靭な肉体と高い攻撃力を誇る前衛の要。',
        row: 'front',
        baseHp: 32,
        hpGrowth: 8,
        baseSpd: 11,
        baseAttrs: { str: 12, int: 8, pie: 8, vit: 13, agi: 10, luc: 9 },
        initialWeapon: 'broadsword',
        initialArmor: 'chain_mail',
        canEquipWeapons: ['dagger', 'broadsword', 'battle_axe'],
        canEquipArmors: ['leather_armor', 'chain_mail', 'plate_armor']
    },
    'knight': {
        id: 'knight',
        name: '騎士',
        nameEn: 'Knight',
        desc: '重装甲で身を固め、味方を守る鉄壁の盾。',
        row: 'front',
        baseHp: 36,
        hpGrowth: 9,
        baseSpd: 9,
        baseAttrs: { str: 11, int: 8, pie: 10, vit: 14, agi: 8, luc: 9 },
        initialWeapon: 'broadsword',
        initialArmor: 'leather_armor',
        canEquipWeapons: ['dagger', 'broadsword', 'battle_axe'],
        canEquipArmors: ['leather_armor', 'chain_mail', 'plate_armor']
    },
    'thief': {
        id: 'thief',
        name: '盗賊',
        nameEn: 'Thief',
        desc: '素早い身のこなしと宝箱の罠解除を得意とする。',
        row: 'front',
        baseHp: 24,
        hpGrowth: 6,
        baseSpd: 14,
        baseAttrs: { str: 9, int: 9, pie: 7, vit: 10, agi: 14, luc: 12 },
        initialWeapon: 'dagger',
        initialArmor: 'leather_armor',
        canEquipWeapons: ['dagger', 'broadsword'],
        canEquipArmors: ['leather_armor']
    },
    'priest': {
        id: 'priest',
        name: '僧侶',
        nameEn: 'Priest',
        desc: '神聖魔法を操り、傷ついた仲間を癒やす聖職者。',
        row: 'rear',
        baseHp: 22,
        hpGrowth: 5,
        baseSpd: 10,
        baseAttrs: { str: 9, int: 9, pie: 13, vit: 11, agi: 9, luc: 9 },
        initialWeapon: 'dagger',
        initialArmor: 'leather_armor',
        canEquipWeapons: ['dagger'],
        canEquipArmors: ['leather_armor', 'chain_mail'],
        initialSpells: ['heal'],
        // 呪文の使用回数が1回増えるレベル (このレベル以下の数が最大使用回数)
        spellUseLevels: { heal: [1, 1, 1, 2, 4, 6, 8, 11, 14] }
    },
    'mage': {
        id: 'mage',
        name: '魔術師',
        nameEn: 'Mage',
        desc: '破壊的な元素魔法で敵を焼き払う賢者。',
        row: 'rear',
        baseHp: 16,
        hpGrowth: 4,
        baseSpd: 10,
        baseAttrs: { str: 7, int: 14, pie: 8, vit: 9, agi: 10, luc: 10 },
        initialWeapon: 'dagger',
        initialArmor: null,
        canEquipWeapons: ['dagger'],
        canEquipArmors: [],
        initialSpells: ['fire'],
        spellUseLevels: { fire: [1, 1, 2, 3, 5, 7, 9, 12, 15] }
    },
    'bishop': {
        id: 'bishop',
        name: '司祭',
        nameEn: 'Bishop',
        desc: '僧侶と魔術師の双方の呪文を修める高位聖職者。',
        row: 'rear',
        baseHp: 18,
        hpGrowth: 4,
        baseSpd: 8,
        baseAttrs: { str: 8, int: 12, pie: 12, vit: 10, agi: 8, luc: 10 },
        initialWeapon: 'dagger',
        initialArmor: null,
        canEquipWeapons: ['dagger'],
        canEquipArmors: ['leather_armor'],
        initialSpells: ['heal', 'fire'],
        // 2系統を修めるぶん、それぞれの回数の伸びは遅い
        spellUseLevels: {
            heal: [1, 2, 4, 6, 8, 11, 14, 17, 20],
            fire: [1, 2, 4, 6, 8, 11, 14, 17, 20]
        }
    }
};

/**
 * キャラ作成時のボーナスポイントを抽選
 * Wizardryクラシック準拠:
 * 通常: 7〜10pt (70%)
 * 好調: 11〜15pt (25%)
 * ゴールドロール: 16〜25pt (5%)
 */
function rollBonusPoints() {
    const r = Math.random();
    if (r < 0.70) {
        return Math.floor(Math.random() * 4) + 7; // 7〜10
    } else if (r < 0.95) {
        return Math.floor(Math.random() * 5) + 11; // 11〜15
    } else {
        return Math.floor(Math.random() * 10) + 16; // 16〜25
    }
}

/**
 * 新規カスタムキャラクター生成
 */
function createCustomCharacter(name, classId, allocatedAttrs) {
    const cls = CLASS_DEFS[classId] || CLASS_DEFS['fighter'];
    const baseAttrs = cls.baseAttrs || { str: 10, int: 10, pie: 10, vit: 10, agi: 10, luc: 10 };
    const attrs = {};
    Object.keys(baseAttrs).forEach(k => {
        attrs[k] = (baseAttrs[k] || 10) + ((allocatedAttrs && allocatedAttrs[k]) || 0);
    });



    // 生命力 (VIT) によるHP補正: (vit - 10) * 2
    const vitBonus = Math.max(0, (attrs.vit - 10) * 2);
    const startHp = (cls.baseHp || 24) + vitBonus;

    const member = {
        id: 'char_custom_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
        name: (name && name.trim()) ? name.trim() : '名無しの冒険者',
        classId: classId,
        className: cls.name,
        level: 1,
        hp: startHp, maxHp: startHp,
        exp: 0,
        isPoisoned: false,
        isDead: false,
        equippedWeapon: cls.initialWeapon || null,
        equippedArmor: cls.initialArmor || null,
        spells: Array.isArray(cls.initialSpells) ? [...cls.initialSpells] : [],
        attrs: attrs,
        createdAt: Date.now()
    };
    restoreSpellUses(member);
    return member;
}

// ========================================================
// 登録冒険者名簿 (Character Roster) 管理
// ========================================================
function loadCharacterRoster() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_ROSTER);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
                // 既存メンバーの未定義プロパティ補完
                list.forEach(m => {
                    if (!m.attrs) {
                        const cls = CLASS_DEFS[m.classId] || {};
                        m.attrs = Object.assign({ str: 10, int: 10, pie: 10, vit: 10, agi: 10, luc: 10 }, cls.baseAttrs);
                    }
                    normalizeSpellUses(m);
                });
                return list;
            }
        }
    } catch (e) {
        console.warn('Failed to load character roster:', e);
    }
    // 初回は名簿が空 (冒険者は訓練場で作成する)
    return [];
}

function saveCharacterRoster(roster) {
    try {
        localStorage.setItem(STORAGE_KEY_ROSTER, JSON.stringify(roster));
    } catch (e) {
        console.error('Failed to save character roster:', e);
    }
}

function addCharacterToRoster(charObj) {
    const roster = loadCharacterRoster();
    roster.push(charObj);
    saveCharacterRoster(roster);
    return roster;
}

function removeCharacterFromRoster(charId) {
    const roster = loadCharacterRoster();
    const updated = roster.filter(c => c.id !== charId);
    saveCharacterRoster(updated);
    return updated;
}

// ========================================================
// 酒場のスカウト候補 (候補の生成は components/town/tavern/tavern.js)
// { candidates: [{ member, rank, bonusPoints, fee }] | null, refreshPending: bool }
// ※ 酒場を開き直すたびに入れ替わると良い候補が出るまで粘れてしまうため、候補は保存しておき、
//    ダンジョンへ出発したときに「次に酒場を開いたら入れ替える」印だけを付ける
// ========================================================
function loadScoutData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_SCOUTS);
        if (raw) {
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                return {
                    candidates: Array.isArray(data.candidates) ? data.candidates : null,
                    refreshPending: !!data.refreshPending
                };
            }
        }
    } catch (e) {
        console.warn('Failed to load scout data:', e);
    }
    return { candidates: null, refreshPending: false };
}

function saveScoutData(data) {
    try {
        localStorage.setItem(STORAGE_KEY_SCOUTS, JSON.stringify(data));
    } catch (e) {
        console.error('Failed to save scout data:', e);
    }
}

// ダンジョンへ出発するときに呼ぶ (街へ戻って酒場を開いたとき候補が入れ替わる)
function markScoutRefreshPending() {
    const data = loadScoutData();
    data.refreshPending = true;
    saveScoutData(data);
}

function syncPartyWithRoster(partyMembers) {
    if (!Array.isArray(partyMembers)) return;
    const roster = loadCharacterRoster();
    partyMembers.forEach(m => {
        const idx = roster.findIndex(r => r.id === m.id);
        const mSafe = Object.assign({}, m);
        delete mSafe.currentBattleAction;
        delete mSafe.lastBattleAction;
        if (idx !== -1) {
            roster[idx] = Object.assign({}, roster[idx], mSafe);
        } else {
            // 名簿に未登録のメンバーがいれば追加
            roster.push(mSafe);
        }
    });
    saveCharacterRoster(roster);
}


const DEFAULT_PLAYER = {
    level: 1,
    hp: 0,
    maxHp: 0,
    exp: 0,
    gold: 0,
    hasKey: false,
    inventory: ['potion', 'antidote'], // 所持アイテムIDリスト
    unidentified: [],                   // 未鑑定の武具IDリスト (エネミーのドロップ品。商店で鑑定すると inventory へ移る)
    equippedWeapon: null,              // 装備中武器ID (リーダーと同期)
    equippedArmor: null,                // 装備中防具ID (リーダーと同期)
    isPoisoned: false,                  // 毒状態フラグ (ダンジョン歩行時にスリップダメージ)
    isDead: false,                      // 死亡状態フラグ (教会で蘇生するまで出撃・宿泊不可)
    gridX: 1,
    gridZ: 1,
    dir: 2, // 南向き
    currentFloorId: 'B1F',
    partyMembers: []
};

// DEFAULT_PLAYER の複製 (配列は共有しない。共有すると所持品への追加が初期値まで書き換える)
function createDefaultPlayer() {
    return Object.assign({}, DEFAULT_PLAYER, {
        inventory: DEFAULT_PLAYER.inventory.slice(),
        unidentified: DEFAULT_PLAYER.unidentified.slice()
    });
}

const ITEM_DEFS = {
    // --- 消耗品アイテム ---
    'potion': {
        id: 'potion',
        name: '上質な回復薬',
        desc: 'HPを 25 回復する薬草の秘薬。',
        usable: true,
        type: 'heal',
        power: 25,
        price: 50,
        sellPrice: 25
    },
    'mana_potion': {
        id: 'mana_potion',
        name: '魔導の秘薬',
        desc: '習得している呪文すべての使用回数を 1 回ずつ回復する神秘の青い霊薬。',
        usable: true,
        type: 'mana',
        power: 1,
        price: 80,
        sellPrice: 40
    },
    'antidote': {
        id: 'antidote',
        name: '毒消し草',
        desc: '体内に回った毒を完全に消し去る薬草。',
        usable: true,
        type: 'cure_poison',
        price: 40,
        sellPrice: 20
    },
    // --- 武器 ---
    'dagger': {
        id: 'dagger',
        name: '鋭利な鋼鉄の短剣',
        desc: '美しく研ぎ澄まされた短剣。(攻撃力 +4 / 素早さ +3)',
        usable: false,
        type: 'weapon',
        equipSlot: 'weapon',
        atkBonus: 4,
        spdBonus: 3,
        price: 120,
        sellPrice: 60
    },
    'broadsword': {
        id: 'broadsword',
        name: 'ブロードソード',
        desc: '騎士が愛用する標準的な鋼鉄の片手剣。(攻撃力 +8)',
        usable: false,
        type: 'weapon',
        equipSlot: 'weapon',
        atkBonus: 8,
        spdBonus: 0,
        price: 260,
        sellPrice: 130
    },
    'battle_axe': {
        id: 'battle_axe',
        name: 'バトルアックス',
        desc: '重量級の両手斧。圧倒的な破壊力を誇る。(攻撃力 +14 / 素早さ -2)',
        usable: false,
        type: 'weapon',
        equipSlot: 'weapon',
        atkBonus: 14,
        spdBonus: -2,
        price: 520,
        sellPrice: 260
    },
    // --- 防具 ---
    'leather_armor': {
        id: 'leather_armor',
        name: 'レザーアーマー',
        desc: 'なめし革で作られた軽量な鎧。(防御力 +3 / 素早さ +1)',
        usable: false,
        type: 'armor',
        equipSlot: 'armor',
        defBonus: 3,
        spdBonus: 1,
        price: 100,
        sellPrice: 50
    },
    'chain_mail': {
        id: 'chain_mail',
        name: 'チェインメイル',
        desc: '金属の輪を編み込んだ堅牢な鎖帷子。(防御力 +6 / 素早さ -1)',
        usable: false,
        type: 'armor',
        equipSlot: 'armor',
        defBonus: 6,
        spdBonus: -1,
        price: 240,
        sellPrice: 120
    },
    'plate_armor': {
        id: 'plate_armor',
        name: 'プレートメイル',
        desc: '全身を厚い鋼鉄で覆う重装甲。(防御力 +12 / 素早さ -3)',
        usable: false,
        type: 'armor',
        equipSlot: 'armor',
        defBonus: 12,
        spdBonus: -3,
        price: 550,
        sellPrice: 275
    },
    // --- 貴重品・イベントアイテム ---
    'key': {
        id: 'key',
        name: '扉の鍵',
        desc: '鉄格子を開放する古の刻印が刻まれた鍵。',
        usable: false,
        noSell: true,
        price: 0,
        sellPrice: 0
    }
};

const SHOP_CATALOG = [
    { id: 'potion', category: '消耗品' },
    { id: 'mana_potion', category: '消耗品' },
    { id: 'antidote', category: '消耗品' },
    { id: 'dagger', category: '武器' },
    { id: 'broadsword', category: '武器' },
    { id: 'battle_axe', category: '武器' },
    { id: 'leather_armor', category: '防具' },
    { id: 'chain_mail', category: '防具' },
    { id: 'plate_armor', category: '防具' }
];

// ========================================================
// ＋値付きの武具 (エネミーのドロップ品)
// ID は「元の品の ID + '+' + ＋値」(例: 'broadsword+5')。＋値 0 の品は元の品と同じ ID (＋を表示しない)。
// ＋値の分だけ武器は攻撃力、防具は防御力が上がり、売値も上がる。名前は「ブロードソード+5」
// ※ 品の定義は ITEM_DEFS を直接引かず、＋値付きの ID にも対応する getItemDef() で引く
// ========================================================
const plusItemDefCache = {};

// 品の ID を { baseId, plus } に分ける ('broadsword+5' → { baseId: 'broadsword', plus: 5 })
function parseItemId(itemId) {
    const match = /^(.+)\+(\d+)$/.exec(itemId || '');
    return match ? { baseId: match[1], plus: parseInt(match[2], 10) } : { baseId: itemId, plus: 0 };
}

function makeItemId(baseId, plus) {
    return plus > 0 ? `${baseId}+${plus}` : baseId;
}

// 品の定義 (＋値付きの ID なら性能・名前・売値に＋値を反映した定義)。無い品は undefined
function getItemDef(itemId) {
    if (ITEM_DEFS[itemId]) return ITEM_DEFS[itemId];
    if (plusItemDefCache[itemId]) return plusItemDefCache[itemId];
    const { baseId, plus } = parseItemId(itemId);
    const base = ITEM_DEFS[baseId];
    if (!base || plus <= 0 || !getEquipSlot(base)) return undefined;

    const isWeapon = base.type === 'weapon';
    const bonusKey = isWeapon ? 'atkBonus' : 'defBonus';
    const def = Object.assign({}, base, {
        id: itemId,
        baseId: baseId,
        plus: plus,
        name: `${base.name}+${plus}`,
        desc: `${base.desc} 【+${plus}: ${isWeapon ? '攻撃力' : '防御力'}がさらに +${plus}】`,
        [bonusKey]: (base[bonusKey] || 0) + plus,
        sellPrice: Math.floor(getSellPrice(base) * (1 + plus * GAME_RULES.item.plusSellRatePerPoint))
    });
    plusItemDefCache[itemId] = def;
    return def;
}

// ドロップ品の＋値を抽選する (0〜plusMax。plusCurve が大きいほど高い＋値が出にくい)
function rollItemPlus() {
    const { plusMax, plusCurve } = GAME_RULES.item;
    return Math.min(plusMax, Math.floor(Math.pow(Math.random(), plusCurve) * (plusMax + 1)));
}

function getMemberAtkBonus(m) {
    if (!m || !m.equippedWeapon) return 0;
    const def = getItemDef(m.equippedWeapon);
    return (def && def.atkBonus) ? def.atkBonus : 0;
}

function getMemberDefBonus(m) {
    if (!m || !m.equippedArmor) return 0;
    const def = getItemDef(m.equippedArmor);
    return (def && def.defBonus) ? def.defBonus : 0;
}

function getMemberSpdBonus(m) {
    if (!m) return 0;
    let bonus = 0;
    if (m.equippedWeapon && getItemDef(m.equippedWeapon) && getItemDef(m.equippedWeapon).spdBonus) {
        bonus += getItemDef(m.equippedWeapon).spdBonus;
    }
    if (m.equippedArmor && getItemDef(m.equippedArmor) && getItemDef(m.equippedArmor).spdBonus) {
        bonus += getItemDef(m.equippedArmor).spdBonus;
    }
    return bonus;
}

function getMemberTotalSpd(m) {
    if (!m) return 10;
    const cls = CLASS_DEFS[m.classId] || {};
    const baseSpd = (cls.baseSpd || 10) + ((m.level - 1) * 2);
    return baseSpd + getMemberSpdBonus(m);
}

// メンバーが指定のアイテムを装備可能か判定
function canMemberEquip(member, itemOrId) {
    if (!member || !itemOrId) return false;
    const itemId = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
    const item = typeof itemOrId === 'object' ? itemOrId : getItemDef(itemId);
    if (!item) return false;
    const cls = CLASS_DEFS[member.classId];
    if (!cls) return true;

    // ＋値付きの品は元の品で判定する
    const baseId = item.baseId || itemId;
    if (item.type === 'weapon') {
        return Array.isArray(cls.canEquipWeapons) && cls.canEquipWeapons.includes(baseId);
    } else if (item.type === 'armor') {
        return Array.isArray(cls.canEquipArmors) && cls.canEquipArmors.includes(baseId);
    }
    return true;
}

// ========================================================
// 装備品の所持 (装備した品は本人が持つ)
// 装備すると共有の所持品 (inventory) から本人へ移り、外すと所持品へ戻る。
// 1つの品を装備できるのは1人だけ (同じ品が2つあれば2人が装備できる)
// ========================================================
const EQUIPMENT_MODEL_VERSION = 2;

function getEquipSlot(itemOrId) {
    const item = typeof itemOrId === 'string' ? getItemDef(itemOrId) : itemOrId;
    if (!item) return null;
    if (item.type === 'weapon') return 'equippedWeapon';
    if (item.type === 'armor') return 'equippedArmor';
    return null;
}

// 所持品の itemId を1つ member に装備させる。それまでの装備は所持品へ戻し、その ID を返す
// (所持品に無い場合や武具でない場合は false)
function equipItemFromInventory(p, member, itemId) {
    const slot = getEquipSlot(itemId);
    if (!p || !member || !slot || !Array.isArray(p.inventory)) return false;
    const idx = p.inventory.indexOf(itemId);
    if (idx === -1) return false;
    p.inventory.splice(idx, 1);
    const previousId = member[slot] || null;
    if (previousId) p.inventory.push(previousId);
    member[slot] = itemId;
    return previousId;
}

// member の装備 (slot = 'equippedWeapon' | 'equippedArmor') を外して所持品へ戻し、その ID を返す
function unequipToInventory(p, member, slot) {
    if (!p || !member || !member[slot]) return null;
    if (!Array.isArray(p.inventory)) p.inventory = [];
    const itemId = member[slot];
    p.inventory.push(itemId);
    member[slot] = null;
    return itemId;
}

// ========================================================
// 未鑑定の武具 (エネミーのドロップ品)
// player.unidentified に品の ID を入れておき、商店で鑑定すると所持品 (inventory) へ移る。
// 鑑定するまでは装備・売却できず、名前の代わりに「武器？」「防具？」と表示する
// ========================================================
function getUnidentifiedName(itemOrId) {
    const item = typeof itemOrId === 'string' ? getItemDef(itemOrId) : itemOrId;
    if (item && item.type === 'weapon') return '武器？';
    if (item && item.type === 'armor') return '防具？';
    return '？';
}

// 未鑑定の品 (ID リスト) の表示 (例: 「武器？ ×2、防具？」)。なければ空文字
function getUnidentifiedListText(ids) {
    const counts = {};
    (ids || []).forEach(id => {
        const name = getUnidentifiedName(id);
        counts[name] = (counts[name] || 0) + 1;
    });
    return Object.keys(counts).map(name => `${name}${counts[name] > 1 ? ` ×${counts[name]}` : ''}`).join('、');
}

// 未鑑定の品を index 番目から1つ鑑定して所持品へ移し、その ID を返す (無ければ null)
function identifyItem(p, index) {
    if (!p || !Array.isArray(p.unidentified) || !p.unidentified[index]) return null;
    const itemId = p.unidentified.splice(index, 1)[0];
    if (!Array.isArray(p.inventory)) p.inventory = [];
    p.inventory.push(itemId);
    return itemId;
}

// 旧バージョンで最初から名簿にいた6人 (char_1〜char_6) の初期装備。旧方式セーブの移行判定にのみ使う
const LEGACY_PRESET_EQUIPMENT = {
    char_1: { equippedWeapon: 'broadsword', equippedArmor: 'chain_mail' },
    char_2: { equippedWeapon: 'broadsword', equippedArmor: 'leather_armor' },
    char_3: { equippedWeapon: 'dagger', equippedArmor: 'leather_armor' },
    char_4: { equippedWeapon: null, equippedArmor: 'leather_armor' },
    char_5: { equippedWeapon: null, equippedArmor: null },
    char_6: { equippedWeapon: null, equippedArmor: null }
};

// 冒険者の初期装備 (旧既定の6人はその装備、それ以外は職業の初期装備)
function getStartingEquipment(member) {
    const preset = LEGACY_PRESET_EQUIPMENT[member.id];
    if (preset) return { equippedWeapon: preset.equippedWeapon, equippedArmor: preset.equippedArmor };
    const cls = CLASS_DEFS[member.classId] || {};
    return { equippedWeapon: cls.initialWeapon || null, equippedArmor: cls.initialArmor || null };
}

// 旧方式 (買った武具は装備しても所持品に残り、初期装備は所持品に入らない) のセーブを移行する。
// 買って装備した品の二重計上をなくすため、パーティの装備1つにつき所持品の同じ品を1つ取り除く。
// 初期装備のままの装備は所持品に元々無いので取り除かない (同じ品の予備を消さないため)。
// 所持品に足りなくても装備は外さない
function migrateEquipmentOwnership(p) {
    if (!p || p.equipmentModel >= EQUIPMENT_MODEL_VERSION) return;
    if (!Array.isArray(p.inventory)) p.inventory = [];
    (p.partyMembers || []).forEach(m => {
        const starting = getStartingEquipment(m);
        ['equippedWeapon', 'equippedArmor'].forEach(slot => {
            if (!m[slot] || m[slot] === starting[slot]) return;
            const idx = p.inventory.indexOf(m[slot]);
            if (idx !== -1) p.inventory.splice(idx, 1);
        });
    });
    p.equipmentModel = EQUIPMENT_MODEL_VERSION;
}

// メンバーのレベルアップ処理 (クラス成長補正に応じたHP増加と、規定のレベルでの呪文の使用回数の増加)
function levelUpMember(member, fullHeal = true) {
    if (!member) return null;
    const cls = CLASS_DEFS[member.classId] || {};
    const spellIds = getKnownSpellIds(member);
    const maxUsesBefore = spellIds.map(id => getSpellMaxUses(member, id));
    member.level += 1;

    const hpGain = cls.hpGrowth || 6;
    // 使用回数が増えた呪文 [{ name, gain }]
    const spellGains = spellIds.map((id, i) => {
        const spell = SPELLS.find(s => s.id === id);
        return { name: spell ? spell.name : id, gain: getSpellMaxUses(member, id) - maxUsesBefore[i] };
    }).filter(g => g.gain > 0);

    member.maxHp += hpGain;

    if (fullHeal) {
        member.hp = member.maxHp;
    } else {
        // 馬小屋等の場合: 最大HPが増加した分だけ現在HPにも加算 (全快はしない)
        member.hp = Math.min(member.maxHp, (member.hp || 0) + hpGain);
    }
    restoreSpellUses(member); // 呪文の使用回数は全回復

    return {
        level: member.level,
        hpGain: hpGain,
        spellGains: spellGains
    };
}

function getPlayerAtkBonus(p) {
    if (p && Array.isArray(p.partyMembers) && p.partyMembers[0]) {
        return getMemberAtkBonus(p.partyMembers[0]);
    }
    if (!p || !p.equippedWeapon) return 0;
    const def = getItemDef(p.equippedWeapon);
    return (def && def.atkBonus) ? def.atkBonus : 0;
}

function getPlayerDefBonus(p) {
    if (p && Array.isArray(p.partyMembers) && p.partyMembers[0]) {
        return getMemberDefBonus(p.partyMembers[0]);
    }
    if (!p || !p.equippedArmor) return 0;
    const def = getItemDef(p.equippedArmor);
    return (def && def.defBonus) ? def.defBonus : 0;
}

function getPlayerSpdBonus(p) {
    if (p && Array.isArray(p.partyMembers) && p.partyMembers[0]) {
        return getMemberSpdBonus(p.partyMembers[0]);
    }
    if (!p) return 0;
    let bonus = 0;
    if (p.equippedWeapon && getItemDef(p.equippedWeapon) && getItemDef(p.equippedWeapon).spdBonus) {
        bonus += getItemDef(p.equippedWeapon).spdBonus;
    }
    if (p.equippedArmor && getItemDef(p.equippedArmor) && getItemDef(p.equippedArmor).spdBonus) {
        bonus += getItemDef(p.equippedArmor).spdBonus;
    }
    return bonus;
}

// リーダー (partyMembers[0]) とプレイヤー共通プロパティの双方向同期
// ※ パーティメンバー側の値が正。保存関数はリーダー個体 → トップレベルの向き (toMember = false) で同期する
function syncPartyLeader(p, toMember = false) {
    if (!p || !Array.isArray(p.partyMembers) || p.partyMembers.length === 0) return;
    const leader = p.partyMembers[0];

    if (toMember) {
        // トップレベルの最新値をリーダー個体に同期
        leader.level = p.level;
        leader.hp = p.hp;
        leader.maxHp = p.maxHp;
        leader.exp = p.exp;
        leader.isPoisoned = !!p.isPoisoned;
        leader.isDead = !!p.isDead;
        leader.equippedWeapon = p.equippedWeapon;
        leader.equippedArmor = p.equippedArmor;
    } else {
        // リーダー個体の値をトップレベルに同期
        p.level = leader.level;
        p.hp = leader.hp;
        p.maxHp = leader.maxHp;
        p.exp = leader.exp;
        p.isPoisoned = !!leader.isPoisoned;
        p.isDead = !!leader.isDead;
        p.equippedWeapon = leader.equippedWeapon;
        p.equippedArmor = leader.equippedArmor;
    }
}

const DIR_OFFSET = [
    [0, -1], [1, 0], [0, 1], [-1, 0]
];
const DIR_ICONS = ['▲', '▶', '▼', '◀'];
const DIR_NAMES = ['北 (N)', '東 (E)', '南 (S)', '西 (W)'];

const SPELLS = [
    {
        id: 'heal',
        name: 'ヒール',
        attr: 'pie',            // 使用回数のボーナスに使う能力値
        type: 'heal',
        power: 15,
        fieldUsable: true,
        battleUsable: true
    },
    {
        id: 'fire',
        name: 'ファイア',
        attr: 'int',
        type: 'damage',
        power: 25,
        fieldUsable: false,
        battleUsable: true
    }
];

function getNextLevelExp(level) {
    return level * 20;
}

function loadPlayer() {
    let p = createDefaultPlayer();
    p.partyMembers = [];

    try {
        // 優先順位: 1. ダンジョン内のキャンプ一時保存 -> 2. 街での永続記録 -> 3. レガシーデータ
        const rawTemp = localStorage.getItem(STORAGE_KEY_TEMP);
        const rawPerm = localStorage.getItem(STORAGE_KEY_PERMANENT);
        const rawLegacy = localStorage.getItem(STORAGE_KEY);

        const targetRaw = rawTemp || rawPerm || rawLegacy;
        if (targetRaw) {
            const parsed = JSON.parse(targetRaw);
            p = Object.assign(createDefaultPlayer(), parsed);
            // partyMembers の復元: 配列として保存されていれば（空配列[]も含む）そのまま尊重
            if (Array.isArray(parsed.partyMembers)) {
                p.partyMembers = parsed.partyMembers;
            } else {
                p.partyMembers = [];
            }
        }
    } catch (e) {
        console.warn('Failed to load save data, using defaults:', e);
        p.partyMembers = [];
    }

    if (!Array.isArray(p.partyMembers)) {
        p.partyMembers = [];
    }

    // 各メンバーのステータス・死亡フラグ検証 & 名簿属性補完
    p.partyMembers.forEach(m => {
        m.isDead = !!m.isDead || m.hp <= 0;
        if (m.isDead) m.hp = 0;
        m.isPoisoned = !!m.isPoisoned;
        if (!m.attrs) {
            const cls = CLASS_DEFS[m.classId] || {};
            m.attrs = Object.assign({ str: 10, int: 10, pie: 10, vit: 10, agi: 10, luc: 10 }, cls.baseAttrs);
        }
        normalizeSpellUses(m);
    });
    delete p.mp;
    delete p.maxMp;

    if (!Array.isArray(p.inventory)) {
        p.inventory = [];
    }
    if (!Array.isArray(p.unidentified)) {
        p.unidentified = [];
    }
    if (p.hasKey &&!p.inventory.includes('key')) {
        p.inventory.push('key');
    }
    migrateEquipmentOwnership(p);

    // リーダーと同期 (メンバーが存在する場合のみ)
    if (p.partyMembers.length > 0) {
        syncPartyLeader(p, false);
        const allDead = p.partyMembers.every(m => m.isDead);
        if (allDead) {
            p.isDead = true;
            p.hp = 0;
        }
    } else {
        p.isDead = false;
        p.hp = 0;
        p.maxHp = 0;
    }

    return p;
}

// 街での公式永続保存 (街に無事帰還しているため、一時保存はクリアして公式永続記録を更新)
/**
 * セーブデータサニタイズ:
 * 戦闘中の一時プロパティ (lastBattleAction, currentBattleAction 等の循環参照) を完全除去
 */
function sanitizePlayerSaveData(playerData) {
    if (!playerData) return playerData;
    const copy = Object.assign({}, playerData);
    if (Array.isArray(copy.partyMembers)) {
        copy.partyMembers = copy.partyMembers.map(m => {
            const mCopy = Object.assign({}, m);
            delete mCopy.currentBattleAction;
            delete mCopy.lastBattleAction;
            return mCopy;
        });
    }
    return copy;
}

// 街での公式永続保存 (街に無事帰還しているため、一時保存はクリアして公式永続記録を更新)
function savePermanentPlayer(playerData) {
    try {
        syncPartyLeader(playerData, false);
        syncPartyWithRoster(playerData.partyMembers);
        const safeData = sanitizePlayerSaveData(playerData);
        const cleanData = Object.assign({}, safeData, { isTempSave: false, savedAt: Date.now() });
        localStorage.setItem(STORAGE_KEY_PERMANENT, JSON.stringify(cleanData));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanData));
        localStorage.removeItem(STORAGE_KEY_TEMP);
    } catch (e) {
        console.error('Failed to save permanent data:', e);
    }
}

// ダンジョン内キャンプ自動一時保存 (中断セーブ)
function saveTempCampPlayer(playerData) {
    try {
        syncPartyLeader(playerData, false);
        const safeData = sanitizePlayerSaveData(playerData);
        const tempData = Object.assign({}, safeData, { isTempSave: true, savedAt: Date.now() });
        localStorage.setItem(STORAGE_KEY_TEMP, JSON.stringify(tempData));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tempData));
    } catch (e) {
        console.error('Failed to save temp camp data:', e);
    }
}

// ダンジョン一時保存データの破棄 (街帰還時・全滅死亡時など)
function clearTempCampPlayer() {
    try {
        localStorage.removeItem(STORAGE_KEY_TEMP);
    } catch (e) {
        console.error('Failed to clear temp camp data:', e);
    }
}

// 一時保存データが存在するか確認
function hasTempCampSave() {
    return !!localStorage.getItem(STORAGE_KEY_TEMP);
}

// 汎用セーブ (街の施設で使用。ダンジョン内では saveTempCampPlayer を使う)
// 街にいる時点で中断セーブは不要なため、永続セーブと同じく中断セーブを破棄する
// (残っていると loadPlayer が中断セーブを優先し、街での買い物・蘇生が取り消される)
function savePlayer(playerData) {
    savePermanentPlayer(playerData);
}

// 全データ初期化 (名簿・パーティを空にし、初期状態を永続セーブする)
function resetPlayer() {
    try {
        localStorage.removeItem(STORAGE_KEY_TEMP);
        localStorage.removeItem(STORAGE_KEY_PERMANENT);
        localStorage.removeItem(STORAGE_KEY_CORPSES);
        corpseLookupCache = null;
        localStorage.removeItem(STORAGE_KEY_ROSTER);
        localStorage.removeItem(STORAGE_KEY_SCOUTS);
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.error('Failed to reset save data:', e);
    }
    const freshPlayer = createDefaultPlayer();
    freshPlayer.partyMembers = [];
    freshPlayer.equipmentModel = EQUIPMENT_MODEL_VERSION;
    syncPartyLeader(freshPlayer, false);
    savePermanentPlayer(freshPlayer);
    return freshPlayer;
}

// ダンジョン状態だけを初期化 (デバッグ用。宝箱・ボス・遺体を元に戻し、次の出撃を B1F の入口からにする)
// 名簿・パーティ・所持品・ゴールドはそのまま。遺体の遺留品は失われ、遺体だった冒険者は名簿に死亡状態で残る
function resetDungeonState(playerData) {
    try {
        localStorage.removeItem(STORAGE_KEY_TEMP);
        localStorage.removeItem(STORAGE_KEY_CORPSES);
        corpseLookupCache = null;
    } catch (e) {
        console.error('Failed to reset dungeon data:', e);
    }
    playerData.openedChests = [];
    playerData.defeatedBosses = [];
    playerData.currentFloorId = DEFAULT_PLAYER.currentFloorId;
    playerData.gridX = DEFAULT_PLAYER.gridX;
    playerData.gridZ = DEFAULT_PLAYER.gridZ;
    playerData.dir = DEFAULT_PLAYER.dir;
    delete playerData.prevGridX;
    delete playerData.prevGridZ;
    savePermanentPlayer(playerData);
    return playerData;
}

// ========================================================
// ※ renderPartyHUD は components/common/status-box/status-box.js に共通パーツ化されました
// ========================================================

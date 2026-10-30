/**
 * 迷宮宝箱システム (Chest Component)
 * - components/dungeon/chest/chest.js
 *
 * 責務:
 * 1. 現在フロアの宝箱の登録・リセット (dungeon.js の loadFloor から呼ばれる)
 * 2. 宝箱イベント (罠識別・罠解除・罠発動・報酬獲得)
 * 3. 開封状態の永続化 (player.openedChests に「フロアID:x,z」で記録。一度開けた宝箱は復活しない)
 *
 * ※ 宝箱の定義データ (罠・ダメージ・報酬) は dungeon.js の FLOORS[].chests に置く
 * ※ メッセージ表示・選択肢は探索用メッセージボックス (dungeon.js) を利用する
 */

(function (window) {
    'use strict';

    // 罠の識別・解除の成功率 (担当者の運 LUC と職業で補正)
    const TRAP_CHANCE = {
        inspectBase: 0.50,  // 罠識別の基本成功率
        disarmBase: 0.45,   // 罠解除の基本成功率
        lucPerPoint: 0.03,  // LUC 10 を基準に 1 ポイントごとの補正
        thiefBonus: 0.25,   // 盗賊の職業補正
        min: 0.10,
        max: 0.95
    };
    const CHEST_EXP = 20;
    // 宝箱イベントの選択肢 (「立ち去る」は storage.js の COMMON_COMMANDS)
    const CHEST_COMMANDS = {
        OPEN: 'そのまま開ける',
        INSPECT: '慎重に調べる (罠識別)',
        DISARM: '罠を解除して開ける',
        FORCE: '無理やり開ける',
        OPEN_ANYWAY: '思い切って開ける',
        ENDURE: '痛みに耐えて中身を回収する',
        OUCH: 'くっ...！'
    };
    const DEFAULT_CHEST = { trap: 'poison', trapName: '毒針の罠', damage: 8, gold: 50, itemId: 'potion' };

    let chests = {}; // 現在フロアの宝箱 { 'x,z': { floorId, x, z, data } }

    // ========================================================
    // 登録 & 開封状態
    // ========================================================
    function registerChest(floorId, x, z, data) {
        chests[`${x},${z}`] = { floorId, x, z, data: Object.assign({}, DEFAULT_CHEST, data || {}) };
    }

    function resetChests() {
        chests = {};
    }

    function getOpenedChestKeys() {
        if (!Array.isArray(player.openedChests)) player.openedChests = [];
        return player.openedChests;
    }

    function chestKey(chest) {
        return `${chest.floorId}:${chest.x},${chest.z}`;
    }

    function isChestOpened(chest) {
        return getOpenedChestKeys().includes(chestKey(chest));
    }

    function markChestOpened(chest) {
        const keys = getOpenedChestKeys();
        if (!keys.includes(chestKey(chest))) keys.push(chestKey(chest));
    }

    // ========================================================
    // 罠の扱い (担当者・成功率)
    // ========================================================
    function getTrapChances(member) {
        const luc = (member && member.attrs && member.attrs.luc) || 10;
        const bonus = (luc - 10) * TRAP_CHANCE.lucPerPoint
            + (member && member.classId === 'thief' ? TRAP_CHANCE.thiefBonus : 0);
        const clamp = (v) => Math.min(TRAP_CHANCE.max, Math.max(TRAP_CHANCE.min, v));
        return {
            inspect: clamp(TRAP_CHANCE.inspectBase + bonus),
            disarm: clamp(TRAP_CHANCE.disarmBase + bonus)
        };
    }

    // 生存メンバーのうち罠の扱いが最も得意な者が宝箱を担当する (同率なら隊列の前の者)
    function getChestHandler() {
        const living = (player.partyMembers || []).filter(isMemberAlive);
        let handler = null;
        let best = -1;
        living.forEach(m => {
            const chance = getTrapChances(m).disarm;
            if (chance > best) {
                handler = m;
                best = chance;
            }
        });
        return handler;
    }

    function setPromptHint(text) {
        const hintEl = document.getElementById('prompt-hint');
        if (hintEl) hintEl.innerText = text;
    }

    // ========================================================
    // 宝箱イベント
    // ========================================================
    function triggerChestEvent(chestX, chestZ) {
        const chest = chests[`${chestX},${chestZ}`];
        if (!chest) return;

        if (isChestOpened(chest)) {
            showMessage("宝箱はすでに開いており、中は空っぽだ。");
            setPromptHint(MESSAGES.HINT_CLOSE);
            return;
        }

        const handler = getChestHandler();
        if (!handler) return;
        const chances = getTrapChances(handler);
        const trapName = chest.data.trapName;

        showEventImage('chest');
        showMessage(`【TREASURE CHEST】\n頑丈な装飾が施された宝箱を発見した！\nしかし、不穏な気配が漂っている...\n仕掛け（罠）が施されているようだ！\n\n(罠の担当: ${handler.name} / ${handler.className})`);

        const giveRewards = (isDisarmed) => {
            playDoorOpenSE();
            markChestOpened(chest);
            playVictorySE();

            const gold = chest.data.gold || 0;
            const itemDef = chest.data.itemId ? getItemDef(chest.data.itemId) : null;
            player.gold += gold;
            if (itemDef) {
                if (!Array.isArray(player.inventory)) player.inventory = [];
                player.inventory.push(itemDef.id);
            }
            gainExp(CHEST_EXP);
            updateStatusUI();
            saveTempCampPlayer(player);

            let text = "カチリ... 宝箱の蓋が開いた！\n";
            if (isDisarmed) {
                text += `【★ ${handler.name} が見事に罠を解除した！】\n`;
            }
            text += `\n★ ${gold} GOLD を獲得！`;
            if (itemDef) {
                text += `\n★ 『${itemDef.name}』 を手に入れた！`;
            }
            text += `\n(${CHEST_EXP} の経験値を獲得)`;
            showEventImage('chestOpen');
            showMessage(text);
            setPromptHint(MESSAGES.HINT_CLOSE);
        };

        // 罠は宝箱を扱った担当者が受ける
        const triggerTrap = () => {
            const isPoisonTrap = (chest.data.trap === 'poison');
            flashScreen(true, isPoisonTrap ? 'purple' : 'red');
            playDamageSE();

            const trapDmg = chest.data.damage || 0;
            damagePartyMember(handler, trapDmg);
            const handlerAlive = isMemberAlive(handler);
            if (isPoisonTrap && handlerAlive) {
                handler.isPoisoned = true;
                syncPartyLeader(player, false);
                updateStatusUI();
                saveTempCampPlayer(player);
            }

            const living = (player.partyMembers || []).filter(isMemberAlive);
            if (living.length === 0) {
                triggerPartyWipeout([`カチッ...！ 罠が作動した！\n【${trapName}】をまともに受け、パーティ全員が力尽きてしまった...`]);
                return;
            }

            let text = `カチッ...！ 罠が作動した！\n【${trapName}】が発動し、${handler.name} は ${trapDmg} のダメージを受けた！`;
            if (!handlerAlive) {
                text += `\n${handler.name} は力尽きてしまった...`;
            } else if (isPoisonTrap) {
                text += `\n【警告】毒針が皮膚を貫き、${handler.name} は毒に冒されてしまった！(歩くたびにダメージ)`;
            }
            showMessage(text);
            showCommands([CHEST_COMMANDS.ENDURE], () => {
                giveRewards(false);
            });
        };

        showCommands([CHEST_COMMANDS.OPEN, CHEST_COMMANDS.INSPECT, COMMON_COMMANDS.LEAVE], (choice) => {
            if (choice === COMMON_COMMANDS.LEAVE) {
                hideMessage();
            } else if (choice === CHEST_COMMANDS.OPEN) {
                triggerTrap();
            } else if (choice === CHEST_COMMANDS.INSPECT) {
                if (Math.random() < chances.inspect) {
                    showMessage(`${handler.name} は鍵穴の隙間を慎重に覗き込んだ...\n【${trapName}】の仕掛けを発見した！\nどうしますか？`);
                    showCommands([CHEST_COMMANDS.DISARM, CHEST_COMMANDS.FORCE, COMMON_COMMANDS.LEAVE], (subChoice) => {
                        if (subChoice === COMMON_COMMANDS.LEAVE) {
                            hideMessage();
                        } else if (subChoice === CHEST_COMMANDS.FORCE) {
                            triggerTrap();
                        } else if (subChoice === CHEST_COMMANDS.DISARM) {
                            if (Math.random() < chances.disarm) {
                                giveRewards(true);
                            } else {
                                showMessage(`カチッ...！\n${handler.name} の解除の針が滑り、罠が誤作動してしまった！`);
                                showCommands([CHEST_COMMANDS.OUCH], () => {
                                    triggerTrap();
                                });
                            }
                        }
                    });
                } else {
                    showMessage(`${handler.name} は仕掛けを詳しく調べたが、どんな罠か見破れなかった...`);
                    showCommands([CHEST_COMMANDS.OPEN_ANYWAY, COMMON_COMMANDS.LEAVE], (subChoice) => {
                        if (subChoice === COMMON_COMMANDS.LEAVE) {
                            hideMessage();
                        } else {
                            triggerTrap();
                        }
                    });
                }
            }
        });
    }

    // ========================================================
    // グローバル公開
    // ========================================================
    window.registerChest = registerChest;
    window.resetChests = resetChests;
    window.triggerChestEvent = triggerChestEvent;
    window.getTrapChances = getTrapChances;
    window.getChestHandler = getChestHandler;

})(window);

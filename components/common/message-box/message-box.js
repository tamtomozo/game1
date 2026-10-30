/**
 * ========================================================
 * メッセージボックス (Message Box) 共通コンポーネント
 * ========================================================
 * 街・ダンジョン共通の会話・イベントメッセージおよび選択肢コマンドUI
 */

(function (window) {
    'use strict';

    let messageBoxEl = null;
    let messageTextEl = null;
    let commandListEl = null;
    let promptHintEl = null;

    let currentCommands = [];
    let selectedIndex = 0;
    let onCommandSelect = null;
    let isEventActive = false;
    let lastActionTime = 0;
    const INPUT_COOLDOWN_MS = GAME_RULES.input.cooldownMs;

    // 外部フック用オブジェクト (ダンジョン・戦闘・全滅判定等の連携用)
    const hooks = {
        onShow: null,
        onHide: null,
        canHide: null,
        onConfirm: null
    };

    function ensureMessageBoxDOM() {
        messageBoxEl = document.getElementById('message-box');
        if (!messageBoxEl) {
            const target = document.getElementById('part-message-box') || document.body;
            messageBoxEl = document.createElement('div');
            messageBoxEl.id = 'message-box';
            messageBoxEl.innerHTML = `
                <div id="message-text"></div>
                <div id="command-list" style="display: none;"></div>
                <div class="prompt-hint" id="prompt-hint">${MESSAGES.HINT_CLICK}</div>
            `;
            if (target && target.id === 'part-message-box' && target.parentNode) {
                target.parentNode.replaceChild(messageBoxEl, target);
            } else {
                (target || document.body).appendChild(messageBoxEl);
            }
        }

        messageTextEl = document.getElementById('message-text');
        commandListEl = document.getElementById('command-list');
        promptHintEl = document.getElementById('prompt-hint');

        window.messageBox = messageBoxEl;
        window.messageBoxEl = messageBoxEl;
        window.messageTextEl = messageTextEl;
        window.commandListEl = commandListEl;
        window.promptHintEl = promptHintEl;

        // クリックで進める (選択肢がない場合)
        if (messageBoxEl && !messageBoxEl.hasAttribute('data-mb-bound')) {
            messageBoxEl.setAttribute('data-mb-bound', 'true');
            messageBoxEl.addEventListener('click', () => {
                if (typeof initAudio === 'function') initAudio();
                if (isEventActive && currentCommands.length === 0) {
                    hideMessage();
                }
            });
        }

        return messageBoxEl;
    }

    function showMessage(text) {
        ensureMessageBoxDOM();

        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }

        isEventActive = true;
        window.isEventActive = true;
        if (window.player) {
            window.player.isEventActive = true;
        }

        if (messageTextEl) {
            messageTextEl.innerText = text;
        }
        if (messageBoxEl) {
            messageBoxEl.style.display = 'flex';
            messageBoxEl.scrollTop = messageBoxEl.scrollHeight;
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => {
                    if (messageBoxEl) messageBoxEl.scrollTop = messageBoxEl.scrollHeight;
                });
            }
        }

        // 外部フック実行 (ダンジョンの addMessageLog 等)
        if (typeof hooks.onShow === 'function') {
            try {
                hooks.onShow(text);
            } catch (err) {
                console.error('[MessageBox] onShow hook error:', err);
            }
        }
    }

    function hideMessage() {
        // 外部ガードチェック (全滅演出中など閉じられない場合)
        if (typeof hooks.canHide === 'function') {
            if (!hooks.canHide()) return;
        }

        lastActionTime = performance.now();
        if (typeof playCancelSE === 'function') playCancelSE();

        ensureMessageBoxDOM();
        if (messageBoxEl) messageBoxEl.style.display = 'none';

        isEventActive = false;
        window.isEventActive = false;
        if (window.player) {
            window.player.isEventActive = false;
        }

        currentCommands = [];
        window.currentCommands = [];
        onCommandSelect = null;

        if (commandListEl) {
            commandListEl.style.display = 'none';
            commandListEl.innerHTML = '';
        }

        // 外部フック実行 (ダンジョンの移動再開・戦闘画面クリア・全滅判定等)
        if (typeof hooks.onHide === 'function') {
            try {
                hooks.onHide();
            } catch (err) {
                console.error('[MessageBox] onHide hook error:', err);
            }
        }
    }

    function showCommands(options, onSelectCallback) {
        ensureMessageBoxDOM();

        currentCommands = options || [];
        window.currentCommands = currentCommands;
        selectedIndex = 0;
        onCommandSelect = onSelectCallback;
        lastActionTime = 0; // 階層メニュー表示直後の誤ブロック防止

        if (commandListEl) {
            commandListEl.innerHTML = '';
            currentCommands.forEach((opt, index) => {
                const item = document.createElement('div');
                item.className = `command-item ${index === 0 ? 'selected' : ''}`;
                item.innerHTML = '<span class="cursor">▶</span><span></span>';
                item.lastElementChild.textContent = opt; // 選択肢 (冒険者名を含む) は文字列として表示
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectedIndex = index;
                    confirmCommand();
                });
                commandListEl.appendChild(item);
            });
            commandListEl.style.display = 'flex';
        }

        if (promptHintEl) {
            promptHintEl.innerText = MESSAGES.HINT_SELECT;
        }
    }

    function updateCommandSelection(delta) {
        if (!currentCommands || currentCommands.length === 0) return;
        if (typeof playCursorSE === 'function') playCursorSE();

        ensureMessageBoxDOM();
        if (!commandListEl) return;

        const items = commandListEl.querySelectorAll('.command-item');
        if (items.length > selectedIndex && items[selectedIndex]) {
            items[selectedIndex].classList.remove('selected');
        }

        selectedIndex = (selectedIndex + delta + currentCommands.length) % currentCommands.length;

        if (items.length > selectedIndex && items[selectedIndex]) {
            items[selectedIndex].classList.add('selected');
        }
    }

    function confirmCommand() {
        if (!onCommandSelect) return;
        lastActionTime = performance.now();
        if (typeof playConfirmSE === 'function') playConfirmSE();

        const selectedValue = currentCommands[selectedIndex];

        ensureMessageBoxDOM();
        if (commandListEl) {
            commandListEl.style.display = 'none';
            commandListEl.innerHTML = '';
        }
        currentCommands = [];
        window.currentCommands = [];

        const callback = onCommandSelect;
        onCommandSelect = null;

        if (typeof hooks.onConfirm === 'function') {
            try {
                hooks.onConfirm(selectedValue);
            } catch (err) {
                console.error('[MessageBox] onConfirm hook error:', err);
            }
        }

        if (typeof callback === 'function') {
            callback(selectedValue);
        }
    }

    function isMessageBoxActive() {
        return isEventActive;
    }

    function getSelectedCommandIndex() {
        return selectedIndex;
    }

    function setSelectedCommandIndex(idx) {
        selectedIndex = idx;
    }

    function getLastActionTime() {
        return lastActionTime;
    }

    function setLastActionTime(t) {
        lastActionTime = t;
    }

    // スクリプトロード時にDOMを自動準備
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureMessageBoxDOM);
    } else {
        ensureMessageBoxDOM();
    }

    // グローバル公開
    window.showMessage = showMessage;
    window.hideMessage = hideMessage;
    window.showCommands = showCommands;
    window.updateCommandSelection = updateCommandSelection;
    window.confirmCommand = confirmCommand;
    window.isMessageBoxActive = isMessageBoxActive;
    window.ensureMessageBoxDOM = ensureMessageBoxDOM;
    // town.js のキー処理がグローバル参照するため初期値を公開しておく
    // (未定義のままだと、選択肢なしの最初のメッセージがキーで閉じられない)
    window.isEventActive = isEventActive;
    window.currentCommands = currentCommands;
    window.lastActionTime = lastActionTime;
    window.INPUT_COOLDOWN_MS = INPUT_COOLDOWN_MS;
    window.commandListEl = commandListEl;
    window.promptHintEl = promptHintEl;
    window.messageBox = messageBoxEl;


    // フック登録用API
    window.MessageBox = {
        show: showMessage,
        hide: hideMessage,
        showCommands: showCommands,
        updateSelection: updateCommandSelection,
        confirm: confirmCommand,
        isActive: isMessageBoxActive,
        getSelectedIndex: getSelectedCommandIndex,
        setSelectedIndex: setSelectedCommandIndex,
        getLastActionTime: getLastActionTime,
        setLastActionTime: setLastActionTime,
        hooks: hooks
    };

})(window);

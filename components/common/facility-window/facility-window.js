/**
 * ========================================================
 * 施設画面 (Facility Window) 共通パーツ
 * ========================================================
 * 宿屋・商店・教会の画面枠 (酒場・訓練場と同じ facility-overlay) と上部タブ
 */

(function (window) {
    'use strict';

    /**
     * 施設画面のDOM要素を取得・未配置なら自動修復生成
     * ※ HTMLパーツ (components/town/<施設>/<施設>.html) が file:// で読み込めなくても動くように、同じ枠をここで作る
     * @param {{ id: string, title: string, subtitle: string, closeFn: string, sub?: boolean }} opts
     *   id: 'inn' なら inn-overlay / inn-content / inn-footer / part-inn を使う。closeFn: 「とじる」で呼ぶ関数名
     *   sub: true なら、ほかの施設画面の上に重ねて出す小さめのウィンドウにする
     */
    function ensureFacilityOverlay(opts) {
        const id = opts.id;
        let overlay = document.getElementById(id + '-overlay');
        if (!overlay) {
            const container = document.getElementById('part-' + id) || document.body;
            const temp = document.createElement('div');
            temp.innerHTML = `
                <div id="${id}-overlay" class="facility-overlay${opts.sub ? ' facility-overlay-sub' : ''}" style="display: none;">
                    <div class="facility-window">
                        <div class="facility-header">
                            <div>
                                <div class="facility-title">${opts.title}</div>
                                <div class="facility-subtitle" id="${id}-subtitle">${opts.subtitle}</div>
                            </div>
                            <div>
                                <button class="facility-action-btn btn-close" onclick="${opts.closeFn}()">× とじる</button>
                            </div>
                        </div>
                        <div class="facility-content" id="${id}-content"></div>
                        <div class="facility-footer" id="${id}-footer"></div>
                    </div>
                </div>
            `.trim();
            overlay = temp.firstElementChild;
            if (container && container.id === 'part-' + id && container.parentNode) {
                container.parentNode.replaceChild(overlay, container);
            } else {
                (container || document.body).appendChild(overlay);
            }
        }
        return {
            overlay: overlay,
            subtitle: document.getElementById(id + '-subtitle'),
            content: document.getElementById(id + '-content'),
            footer: document.getElementById(id + '-footer')
        };
    }

    /**
     * 画面上部のタブ (選択中のタブは押せない見出しにする)
     * 各タブには data-facility-tab="1〜" を付け、数字キーで選べるようにする (js/town.js)
     * @param {Array<{id: string, label: string}>} tabs
     * @param {string} activeId
     * @param {string} switchFn - タブを押したときに呼ぶ関数名 (タブの id を渡す)
     */
    function renderFacilityTabsHtml(tabs, activeId, switchFn) {
        return `
            <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                ${tabs.map((t, i) => t.id === activeId
                    ? `<button class="facility-action-btn" data-facility-tab="${i + 1}" style="background: #253520; color: #ffff00; border-color: #ffff00;">${t.label}</button>`
                    : `<button class="facility-action-btn btn-close" data-facility-tab="${i + 1}" onclick="${switchFn}('${t.id}')">${t.label}</button>`
                ).join('')}
            </div>
        `;
    }

    /**
     * 演出 (画面フラッシュ・効果音) が見えてから結果のポップアップを出す
     * ※ alert は表示中の描画を止めるため、すぐに出すとフラッシュが見えない
     */
    function alertAfterEffect(message, delayMs = 500) {
        setTimeout(() => alert(message), delayMs);
    }

    // グローバル公開
    window.ensureFacilityOverlay = ensureFacilityOverlay;
    window.renderFacilityTabsHtml = renderFacilityTabsHtml;
    window.alertAfterEffect = alertAfterEffect;

})(window);

/**
 * 3Dダンジョン描画 (View3D Component)
 * - components/dungeon/view3d/view3d.js
 *
 * 責務:
 * 1. Three.js のシーン / カメラ / レンダラーの生成と描画ループ・リサイズ対応
 * 2. フロアのワイヤーフレーム描画 (壁・床・天井・扉)
 * 3. カメラ演出 (歩行・壁への衝突・旋回・振り向き) と扉の開放アニメ、画面揺れ
 * 4. WebGL / Three.js が使えない環境での代替表示 (ゲーム進行は止めない)
 *
 * ※ マップ・座標・扉の開閉状態などのゲーム状態は dungeon.js が持ち、ここは描画だけを担当する
 * ※ アニメの完了コールバックは、3D表示が使えない場合も同じ所要時間の後に必ず呼ぶ
 */

(function (window) {
    'use strict';

    const GRID_SIZE = 4;                        // グリッド1マスの実空間サイズ
    const EYE_HEIGHT = (GRID_SIZE / 2) * 0.75;  // カメラ (目線) の高さ
    const BUMP_DISTANCE = GRID_SIZE * 0.15;     // 壁に衝突したときにカメラが押し出される距離

    // アニメの所要時間 (ミリ秒)
    const DURATION = {
        step: 180,
        bump: 140,
        turn: 140,
        turnAround: 160,
        door: 300
    };

    let scene = null;
    let camera = null;
    let renderer = null;
    let isAvailable = false;
    let doorGroups = {};

    let wallLineMat, floorLineMat, ceilLineMat, doorLineMat, occluderMat;
    let wallBoxGeo, wallEdgesGeo, planeGeo, planeEdgesGeo;

    let fallbackEl = null;
    let shakeTimeoutId = null;

    // ========================================================
    // 初期化 (読み込み時に実行。失敗した場合は代替表示に切り替える)
    // ========================================================
    function init() {
        if (typeof THREE === 'undefined') {
            console.warn('[View3D] Three.js を読み込めなかったため、3D表示なしで動作します。');
            showFallback('Three.js を読み込めませんでした');
            return;
        }
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true });
        } catch (e) {
            console.warn('[View3D] WebGL を初期化できなかったため、3D表示なしで動作します。', e);
            renderer = null;
            showFallback('WebGL を利用できません');
            return;
        }

        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        document.body.appendChild(renderer.domElement);

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.1, 100);

        wallLineMat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
        floorLineMat = new THREE.LineBasicMaterial({ color: 0x00aaaa, linewidth: 1 });
        ceilLineMat = new THREE.LineBasicMaterial({ color: 0x008888, linewidth: 1 });
        doorLineMat = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });

        occluderMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });

        wallBoxGeo = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, GRID_SIZE);
        wallEdgesGeo = new THREE.EdgesGeometry(wallBoxGeo);

        planeGeo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);
        planeEdgesGeo = new THREE.EdgesGeometry(planeGeo);

        // コンテキスト喪失中は代替表示を出す (復帰は Three.js が自動で行う)
        renderer.domElement.addEventListener('webglcontextlost', () => showFallback('3D表示が一時的に失われました'));
        renderer.domElement.addEventListener('webglcontextrestored', hideFallback);

        window.addEventListener('resize', onResize);
        isAvailable = true;
        animate();
    }

    function onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;

        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }

    // 3D表示が使えないときの代替表示 (座標表示 POS / DIR を頼りに探索を続けられる)
    function showFallback(reason) {
        if (!fallbackEl) {
            fallbackEl = document.createElement('div');
            fallbackEl.id = 'view3d-fallback';
            document.body.appendChild(fallbackEl);
        }
        fallbackEl.innerText = `【3D表示なし】${reason}\n画面下部の POS / DIR を頼りに探索できます。`;
        fallbackEl.style.display = '';
    }

    function hideFallback() {
        if (fallbackEl) fallbackEl.style.display = 'none';
    }

    // ========================================================
    // フロア描画
    // ========================================================
    function clearScene() {
        for (let i = scene.children.length - 1; i >= 0; i--) {
            const obj = scene.children[i];
            if (obj !== camera && !obj.isLight) {
                scene.remove(obj);
            }
        }
        doorGroups = {};
    }

    // マップ配列から壁・床・天井・扉を描画する (前のフロアは破棄)
    function buildFloor(mapData) {
        if (!isAvailable) return;
        clearScene();

        for (let z = 0; z < mapData.length; z++) {
            for (let x = 0; x < mapData[z].length; x++) {
                const posX = x * GRID_SIZE;
                const posZ = z * GRID_SIZE;
                const cell = mapData[z][x];

                if (cell === 1) {
                    // 壁
                    const wallMesh = new THREE.Mesh(wallBoxGeo, occluderMat);
                    wallMesh.position.set(posX, GRID_SIZE / 2, posZ);
                    scene.add(wallMesh);

                    const wallLines = new THREE.LineSegments(wallEdgesGeo, wallLineMat);
                    wallLines.position.set(posX, GRID_SIZE / 2, posZ);
                    scene.add(wallLines);

                } else if (cell === 2) {
                    // 扉 (閉じた状態で描画)
                    createFloorAndCeil(posX, posZ);

                    const doorGroup = new THREE.Group();
                    doorGroup.position.set(posX - GRID_SIZE / 2, 0, posZ);

                    const doorGeo = new THREE.BoxGeometry(GRID_SIZE, GRID_SIZE, 0.2);
                    const doorEdgesGeo = new THREE.EdgesGeometry(doorGeo);

                    const doorMesh = new THREE.Mesh(doorGeo, occluderMat);
                    doorMesh.position.set(GRID_SIZE / 2, GRID_SIZE / 2, 0);

                    const doorLines = new THREE.LineSegments(doorEdgesGeo, doorLineMat);
                    doorLines.position.set(GRID_SIZE / 2, GRID_SIZE / 2, 0);

                    doorGroup.add(doorMesh);
                    doorGroup.add(doorLines);
                    scene.add(doorGroup);

                    doorGroups[`${x},${z}`] = doorGroup;

                } else {
                    // 通路(0), 鍵(3), 階段・出口(4, 5), 罠(6), ボス(7), 宝箱(8) などは床と天井のみ描画
                    createFloorAndCeil(posX, posZ);
                }
            }
        }
    }

    function createFloorAndCeil(posX, posZ) {
        const floorMesh = new THREE.Mesh(planeGeo, occluderMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.set(posX, 0, posZ);
        scene.add(floorMesh);

        const floorLines = new THREE.LineSegments(planeEdgesGeo, floorLineMat);
        floorLines.rotation.x = -Math.PI / 2;
        floorLines.position.set(posX, 0, posZ);
        scene.add(floorLines);

        const ceilMesh = new THREE.Mesh(planeGeo, occluderMat);
        ceilMesh.rotation.x = Math.PI / 2;
        ceilMesh.position.set(posX, GRID_SIZE, posZ);
        scene.add(ceilMesh);

        const ceilLines = new THREE.LineSegments(planeEdgesGeo, ceilLineMat);
        ceilLines.rotation.x = Math.PI / 2;
        ceilLines.position.set(posX, GRID_SIZE, posZ);
        scene.add(ceilLines);
    }

    // ========================================================
    // カメラ・演出
    // ========================================================
    function dirToRotation(dir) {
        return -dir * (Math.PI / 2);
    }

    // カメラをグリッド座標・方角に瞬時に合わせる
    function setCamera(x, z, dir) {
        if (!isAvailable) return;
        camera.position.set(x * GRID_SIZE, EYE_HEIGHT, z * GRID_SIZE);
        camera.rotation.y = dirToRotation(dir);
    }

    // 隣のマス (x, z) へ歩く
    function animateStep(x, z, onDone) {
        if (!isAvailable) return animateTween(DURATION.step, null, onDone);

        const startPos = camera.position.clone();
        const endPos = new THREE.Vector3(x * GRID_SIZE, EYE_HEIGHT, z * GRID_SIZE);

        animateTween(DURATION.step, (progress) => {
            camera.position.lerpVectors(startPos, endPos, progress);
        }, onDone);
    }

    // 壁に衝突して押し戻される (offsetX, offsetZ は進もうとしたグリッド方向)
    function animateBump(offsetX, offsetZ, onDone) {
        if (!isAvailable) return animateTween(DURATION.bump, null, onDone);

        const startPos = camera.position.clone();
        const bumpTarget = new THREE.Vector3(
            startPos.x + offsetX * BUMP_DISTANCE,
            startPos.y,
            startPos.z + offsetZ * BUMP_DISTANCE
        );

        animateTween(DURATION.bump, (progress) => {
            if (progress < 0.5) {
                const p = progress * 2;
                camera.position.lerpVectors(startPos, bumpTarget, p * (2 - p));
            } else {
                const p = (progress - 0.5) * 2;
                camera.position.lerpVectors(bumpTarget, startPos, p * (2 - p));
            }
        }, () => {
            camera.position.copy(startPos);
            if (onDone) onDone();
        });
    }

    // 旋回 (quarterTurns: 右 +1 / 左 -1 / 振り向き 2)。finalDir は旋回後の方角
    function animateTurn(quarterTurns, finalDir, onDone) {
        const duration = Math.abs(quarterTurns) === 2 ? DURATION.turnAround : DURATION.turn;
        if (!isAvailable) return animateTween(duration, null, onDone);

        const startRot = camera.rotation.y;
        const endRot = startRot - quarterTurns * (Math.PI / 2);

        animateTween(duration, (progress) => {
            camera.rotation.y = THREE.MathUtils.lerp(startRot, endRot, progress);
        }, () => {
            camera.rotation.y = dirToRotation(finalDir);
            if (onDone) onDone();
        });
    }

    // (x, z) の扉を開く
    function animateDoorOpen(x, z, onDone) {
        const doorGroup = doorGroups[`${x},${z}`];
        if (!isAvailable || !doorGroup) return animateTween(DURATION.door, null, onDone);

        const startRot = doorGroup.rotation.y;
        const endRot = -Math.PI / 2;

        animateTween(DURATION.door, (progress) => {
            doorGroup.rotation.y = THREE.MathUtils.lerp(startRot, endRot, progress);
        }, onDone);
    }

    // 被ダメージ時の画面揺れ (3D表示なしの場合は代替表示を揺らす)
    function shake() {
        const target = renderer ? renderer.domElement : fallbackEl;
        if (!target) return;
        if (shakeTimeoutId) {
            clearTimeout(shakeTimeoutId);
            shakeTimeoutId = null;
        }
        target.classList.remove('screen-shake');
        void target.offsetWidth;
        target.classList.add('screen-shake');

        const cleanUpShake = () => {
            target.classList.remove('screen-shake');
            if (shakeTimeoutId) {
                clearTimeout(shakeTimeoutId);
                shakeTimeoutId = null;
            }
        };
        target.addEventListener('animationend', cleanUpShake, { once: true });
        shakeTimeoutId = setTimeout(cleanUpShake, 400);
    }

    // 現在のカメラ位置 (グリッド単位) と向き (デバッグ・テスト用。3D表示なしの場合は null)
    function getCameraState() {
        if (!isAvailable) return null;
        return {
            x: camera.position.x / GRID_SIZE,
            z: camera.position.z / GRID_SIZE,
            rotY: camera.rotation.y
        };
    }

    // requestAnimationFrame による補間 (onUpdate が null なら待つだけ)
    function animateTween(duration, onUpdate, onComplete) {
        const startTime = performance.now();
        function loop(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            if (onUpdate) onUpdate(progress);
            if (progress < 1) {
                requestAnimationFrame(loop);
            } else {
                if (onComplete) onComplete();
            }
        }
        requestAnimationFrame(loop);
    }

    init();

    // ========================================================
    // グローバル公開
    // ========================================================
    window.DungeonView = {
        buildFloor: buildFloor,
        setCamera: setCamera,
        animateStep: animateStep,
        animateBump: animateBump,
        animateTurn: animateTurn,
        animateDoorOpen: animateDoorOpen,
        shake: shake,
        getCameraState: getCameraState,
        isAvailable: () => isAvailable
    };

})(window);

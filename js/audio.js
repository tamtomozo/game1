// ========================================================
// 3D Dungeon RPG - Audio Engine (SE & Hybrid BGM)
// ========================================================
// 1. Web Audio API SE Engine (レトロ効果音)
// 2. Hybrid BGM Engine (外部MP3 優先 / プログラムシンセ フォールバック)
// ========================================================

let audioCtx = null;
let bgmGainNode = null;
let isAudioInitialized = false;

// BGM 状態管理
let bgmVolume = 0.25; // デフォルトBGM音量 (0.0 ~ 1.0)
let isBGMMuted = false;
let currentBGMTrack = null;
let activeBgmAudio = null;
let synthSchedulerTimer = null;
let isPlayingSynth = false;

// localStorage から BGM 設定を読み込み
try {
    const savedMuted = localStorage.getItem('rpg_bgm_muted');
    if (savedMuted !== null) isBGMMuted = (savedMuted === 'true');
    const savedVol = localStorage.getItem('rpg_bgm_volume');
    if (savedVol !== null) bgmVolume = Math.max(0, Math.min(1, parseFloat(savedVol)));
} catch (e) {
    console.warn('Storage access warning for BGM settings:', e);
}

// --------------------------------------------------------
// AudioContext 初期化 (ユーザー操作時に復帰)
// --------------------------------------------------------
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        bgmGainNode = audioCtx.createGain();
        bgmGainNode.gain.setValueAtTime(isBGMMuted ? 0 : bgmVolume, audioCtx.currentTime);
        bgmGainNode.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    isAudioInitialized = true;
}

// ユーザーの最初の操作時に AudioContext を解除＆BGM再開待機をキック
['click', 'keydown', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, () => {
        if (!audioCtx || audioCtx.state === 'suspended') {
            initAudio();
            if (currentBGMTrack && !isBGMMuted && !activeBgmAudio && !isPlayingSynth) {
                playBGM(currentBGMTrack, true);
            }
        }
    }, { once: false, passive: true });
});

// --------------------------------------------------------
// 効果音 (SE) 再生
// --------------------------------------------------------
function playTone(freqs, type = 'square', duration = 0.08, volume = 0.1) {
    initAudio();
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;

    if (Array.isArray(freqs)) {
        freqs.forEach((f, i) => {
            osc.frequency.setValueAtTime(f, now + (duration / freqs.length) * i);
        });
    } else {
        osc.frequency.setValueAtTime(freqs, now);
    }

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + duration);
}

const playStepSE = () => playTone([150, 80], 'square', 0.04, 0.08);
const playBumpSE = () => playTone([120, 80], 'triangle', 0.08, 0.15);
const playCursorSE = () => playTone(880, 'square', 0.05, 0.08);
const playConfirmSE = () => playTone([1046, 1318], 'square', 0.1, 0.1);
const playCancelSE = () => playTone([440, 330], 'square', 0.08, 0.08);
const playDoorOpenSE = () => playTone([200, 300, 450], 'sawtooth', 0.25, 0.08);
const playItemGetSE = () => playTone([523, 659, 783, 1046], 'square', 0.15, 0.1);
const playStairsSE = () => playTone([300, 400, 500, 600], 'square', 0.2, 0.1);
const playDamageSE = () => playTone([180, 100, 50], 'sawtooth', 0.2, 0.15);
const playMagicSE = () => playTone([440, 554, 659, 880, 1108, 1318], 'square', 0.25, 0.1);
const playVictorySE = () => playTone([523, 659, 783, 1046, 1318, 1568], 'square', 0.4, 0.12);
const playEscapeSuccessSE = () => playTone([523, 659, 783, 1046], 'square', 0.18, 0.1);
const playEscapeFailureSE = () => playTone([392, 349, 277], 'sawtooth', 0.25, 0.12);
const playInnSE = () => playTone([440, 554, 659, 880, 659, 880], 'triangle', 0.5, 0.15);
const playSaveSE = () => playTone([523, 659, 783, 1046, 1318], 'triangle', 0.4, 0.16);

// ========================================================
// 2. Hybrid BGM Engine
// ========================================================

// 音名からMIDIノート番号
// 音名は「音 + 変化記号 + オクターブ」(例: 'A4', 'Cs3' = C#3, 'Bb1' = B♭1)。'R' は休符
const NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteToMidi(name) {
    const m = /^([A-G])(s|b)?(\d)$/.exec(name);
    if (!m) {
        if (name !== 'R') console.warn(`[Audio] 解釈できない音名: ${name}`);
        return 0;
    }
    const accidental = m[2] === 's' ? 1 : (m[2] === 'b' ? -1 : 0);
    return (parseInt(m[3], 10) + 1) * 12 + NOTE_OFFSETS[m[1]] + accidental;
}

function noteToFreq(noteVal) {
    if (!noteVal || noteVal === 0) return 0;
    const num = typeof noteVal === 'string' ? noteToMidi(noteVal) : noteVal;
    if (num <= 0) return 0;
    return 440 * Math.pow(2, (num - 69) / 12);
}

// ホワイトノイズ生成用バッファ (パーカッション用)
let noiseBuffer = null;
function getNoiseBuffer() {
    if (!audioCtx) return null;
    if (!noiseBuffer) {
        const bufferSize = audioCtx.sampleRate * 0.1; // 0.1秒のノイズ
        noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
    }
    return noiseBuffer;
}

// --------------------------------------------------------
// プログラマブル BGM 曲定義 (BPM, ループ, トラック)
// 各音符は [音名, ステップ数 (16分音符単位)]
// --------------------------------------------------------
const SYNTH_TRACKS = {
    // 街: 王都ルミナリア (深淵の境界・黄昏の都。哀愁漂うDマイナーの静謐な旋律)
    town: {
        bpm: 104,
        loop: true,
        leadWave: 'triangle',
        lead: [
            ['D4', 4], ['F4', 4], ['A4', 4], ['D5', 4],
            ['C5', 4], ['Bb4', 4], ['A4', 4], ['G4', 4],
            ['F4', 2], ['E4', 2], ['D4', 4], ['Cs4', 4], ['E4', 4],
            ['D4', 6], ['F4', 2], ['E4', 4], ['R', 4],
            ['D4', 2], ['F4', 2], ['Bb4', 4], ['A4', 4], ['G4', 4],
            ['F4', 4], ['A4', 4], ['C5', 4], ['F5', 4],
            ['E5', 4], ['D5', 2], ['C5', 2], ['Bb4', 4], ['A4', 4],
            ['Gs4', 2], ['A4', 2], ['F4', 4], ['D4', 6], ['R', 2]
        ],
        bass: [
            ['D2', 4], ['A2', 4], ['F2', 4], ['A2', 4],
            ['G2', 4], ['D3', 4], ['Bb2', 4], ['D3', 4],
            ['A2', 4], ['E3', 4], ['Cs3', 4], ['E3', 4],
            ['D3', 4], ['A2', 4], ['F2', 4], ['D2', 4],
            ['Bb1', 4], ['F2', 4], ['D3', 4], ['F2', 4],
            ['F2', 4], ['C3', 4], ['A2', 4], ['C3', 4],
            ['G2', 4], ['D3', 4], ['A2', 4], ['Cs3', 4],
            ['D2', 4], ['A2', 4], ['D3', 4], ['D2', 4]
        ]
    },

    // 酒場 (宵闇の酒場。死線をくぐる傭兵たちの退廃的な短調スウィング)
    tavern: {
        bpm: 122,
        loop: true,
        lead: [
            ['D4', 2], ['F4', 2], ['A4', 2], ['D5', 2], ['Cs5', 3], ['D5', 1], ['F5', 2], ['D5', 2],
            ['E5', 2], ['D5', 2], ['Bb4', 2], ['G4', 2], ['Bb4', 3], ['C5', 1], ['D5', 2], ['Bb4', 2],
            ['A4', 2], ['Cs5', 2], ['E5', 2], ['G5', 2], ['F5', 2], ['E5', 2], ['D5', 2], ['Cs5', 2],
            ['D5', 4], ['A4', 2], ['F4', 2], ['D4', 4], ['R', 4],
            ['F5', 3], ['G5', 1], ['F5', 2], ['D5', 2], ['E5', 3], ['F5', 1], ['E5', 2], ['C5', 2],
            ['D5', 2], ['F5', 2], ['A5', 2], ['F5', 2], ['G5', 3], ['F5', 1], ['E5', 2], ['D5', 2],
            ['Cs5', 2], ['E5', 2], ['A5', 2], ['G5', 2], ['F5', 2], ['E5', 2], ['D5', 2], ['Cs5', 2],
            ['D5', 4], ['A4', 4], ['D4', 4], ['R', 4]
        ],
        bass: [
            ['D2', 2], ['A2', 2], ['F2', 2], ['A2', 2], ['D2', 2], ['A2', 2], ['F2', 2], ['A2', 2],
            ['G2', 2], ['D3', 2], ['Bb2', 2], ['D3', 2], ['G2', 2], ['D3', 2], ['Bb2', 2], ['D3', 2],
            ['A2', 2], ['E3', 2], ['Cs3', 2], ['E3', 2], ['A2', 2], ['E3', 2], ['Cs3', 2], ['E3', 2],
            ['D3', 2], ['A2', 2], ['F2', 2], ['A2', 2], ['D2', 4], ['A1', 4],
            ['Bb2', 2], ['F3', 2], ['D3', 2], ['F3', 2], ['C3', 2], ['G3', 2], ['E3', 2], ['G3', 2],
            ['D3', 2], ['A2', 2], ['F2', 2], ['A2', 2], ['G2', 2], ['D3', 2], ['Bb2', 2], ['D3', 2],
            ['A2', 2], ['E3', 2], ['G2', 2], ['E3', 2], ['A2', 2], ['Cs3', 2], ['E3', 2], ['A2', 2],
            ['D2', 4], ['A2', 4], ['D2', 4], ['R', 4]
        ],
        drums: true
    },

    // 訓練場: 錬成の兵舎 (不屈の鉄騎。冷徹で重厚なCマイナーの軍楽マーチ)
    training: {
        bpm: 108,
        loop: true,
        lead: [
            ['C4', 2], ['R', 1], ['C4', 1], ['C4', 2], ['Eb4', 2], ['G4', 4], ['C5', 4],
            ['Bb4', 4], ['Ab4', 2], ['G4', 2], ['F4', 4], ['G4', 4],
            ['F4', 2], ['R', 1], ['F4', 1], ['F4', 2], ['Ab4', 2], ['C5', 4], ['D5', 4],
            ['Eb5', 6], ['D5', 2], ['C5', 4], ['G4', 4],
            ['Ab4', 2], ['R', 1], ['Ab4', 1], ['C5', 2], ['Eb5', 2], ['D5', 4], ['Bb4', 4],
            ['C5', 4], ['G4', 2], ['Eb4', 2], ['F4', 4], ['Ab4', 4],
            ['G4', 2], ['B4', 2], ['D5', 2], ['F5', 2], ['Eb5', 4], ['D5', 4],
            ['C5', 6], ['G4', 2], ['Eb4', 4], ['C4', 4]
        ],
        bass: [
            ['C2', 4], ['G2', 4], ['C2', 4], ['G2', 4],
            ['Ab2', 4], ['Eb3', 4], ['G2', 4], ['D3', 4],
            ['F2', 4], ['C3', 4], ['G2', 4], ['D3', 4],
            ['C3', 4], ['G2', 4], ['C2', 4], ['G1', 4],
            ['Ab2', 4], ['Eb3', 4], ['Bb2', 4], ['F3', 4],
            ['C3', 4], ['G2', 4], ['F2', 4], ['C3', 4],
            ['G2', 4], ['D3', 4], ['G1', 4], ['F2', 4],
            ['Eb2', 4], ['G2', 4], ['C2', 4], ['R', 4]
        ],
        drums: true
    },

    // 宿屋: 儚き安息 (深き眠りと悪夢の狭間。オルゴールのように儚く切ないEマイナーの子守唄)
    inn: {
        bpm: 76,
        loop: true,
        leadWave: 'triangle',
        lead: [
            ['E4', 4], ['G4', 4], ['B4', 4],
            ['E5', 6], ['D5', 2], ['C5', 4],
            ['B4', 4], ['A4', 4], ['Fs4', 4],
            ['Ds4', 8], ['B4', 4],
            ['G4', 4], ['B4', 4], ['E5', 4],
            ['Fs5', 4], ['G5', 2], ['Fs5', 2], ['D5', 4],
            ['E5', 4], ['C5', 4], ['Ds5', 4],
            ['E5', 8], ['R', 4]
        ],
        bass: [
            ['E3', 4], ['B3', 4], ['G3', 4],
            ['C3', 4], ['G3', 4], ['E3', 4],
            ['A2', 4], ['E3', 4], ['C3', 4],
            ['B2', 4], ['Fs3', 4], ['Ds3', 4],
            ['E3', 4], ['B3', 4], ['G3', 4],
            ['A2', 4], ['C3', 4], ['D3', 4],
            ['C3', 4], ['G2', 4], ['B2', 4],
            ['E3', 4], ['B2', 4], ['E2', 4]
        ]
    },

    // 商店 (怪異と呪具の市。怪しげなフリジアン・ドミナントの忍び足)
    shop: {
        bpm: 136,
        loop: true,
        lead: [
            ['E4', 2], ['Gs4', 2], ['B4', 2], ['R', 2], ['C5', 2], ['B4', 2], ['Gs4', 2], ['F4', 2],
            ['E4', 2], ['F4', 2], ['Gs4', 2], ['A4', 2], ['B4', 4], ['Gs4', 2], ['R', 2],
            ['C5', 2], ['A4', 2], ['F4', 2], ['D4', 2], ['E4', 2], ['F4', 2], ['Gs4', 2], ['R', 2],
            ['B4', 2], ['Gs4', 2], ['E4', 2], ['F4', 2], ['E4', 4], ['R', 4],
            ['D5', 2], ['F5', 2], ['E5', 2], ['D5', 2], ['C5', 2], ['B4', 2], ['A4', 2], ['R', 2],
            ['B4', 2], ['C5', 2], ['D5', 2], ['F5', 2], ['E5', 2], ['D5', 2], ['C5', 2], ['B4', 2],
            ['C5', 2], ['B4', 2], ['A4', 2], ['Gs4', 2], ['A4', 2], ['B4', 2], ['C5', 2], ['D5', 2],
            ['E5', 4], ['B4', 2], ['Gs4', 2], ['E4', 4], ['R', 4]
        ],
        bass: [
            ['E2', 4], ['B2', 4], ['E3', 4], ['B2', 4],
            ['F2', 4], ['C3', 4], ['E2', 4], ['B2', 4],
            ['A2', 4], ['E3', 4], ['E2', 4], ['B2', 4],
            ['E2', 2], ['Gs2', 2], ['B2', 2], ['D3', 2], ['E2', 4], ['B1', 4],
            ['D3', 4], ['A2', 4], ['C3', 4], ['A2', 4],
            ['F2', 4], ['C3', 4], ['Gs2', 4], ['D3', 4],
            ['A2', 4], ['E3', 4], ['B2', 4], ['Gs2', 4],
            ['E2', 4], ['B2', 4], ['E2', 4], ['R', 4]
        ]
    },

    // 教会 (死霊の鎮魂歌。灰と祈りのオルガナム・荘厳なDマイナーのレクイエム)
    church: {
        bpm: 54,
        loop: true,
        leadWave: 'triangle',
        lead: [
            ['D4', 8], ['F4', 4], ['A4', 4],
            ['Bb4', 6], ['A4', 2], ['G4', 8],
            ['E4', 4], ['G4', 4], ['F4', 4], ['E4', 4],
            ['D4', 12], ['R', 4],
            ['F4', 6], ['G4', 2], ['A4', 4], ['Bb4', 4],
            ['C5', 6], ['Bb4', 2], ['A4', 8],
            ['G4', 4], ['Bb4', 4], ['A4', 4], ['Cs5', 4],
            ['D5', 8], ['D4', 6], ['R', 2]
        ],
        bass: [
            ['D2', 8], ['A2', 8],
            ['G2', 8], ['D3', 8],
            ['Cs2', 8], ['A1', 8],
            ['D2', 12], ['R', 4],
            ['Bb1', 8], ['F2', 8],
            ['C2', 8], ['F2', 8],
            ['G2', 8], ['A1', 8],
            ['D2', 8], ['D1', 6], ['R', 2]
        ]
    },

    // ダンジョン: 迷宮探索 (低音の這う不気味なダークアンビエント)
    dungeon: {
        bpm: 96,
        loop: true,
        lead: [
            ['D4', 8], ['R', 4], ['F4', 2], ['A4', 2],
            ['Gs4', 6], ['A4', 2], ['F4', 4], ['E4', 4],
            ['D4', 8], ['Cs4', 4], ['E4', 4],
            ['D4', 12], ['R', 4],
            ['F4', 4], ['A4', 4], ['D5', 4], ['Cs5', 4],
            ['Bb4', 6], ['A4', 2], ['G4', 4], ['Gs4', 4],
            ['A4', 8], ['E4', 4], ['F4', 4],
            ['D4', 12], ['R', 4]
        ],
        bass: [
            ['D2', 2], ['D2', 2], ['F2', 2], ['E2', 2], ['D2', 4], ['A2', 4],
            ['Cs2', 2], ['Cs2', 2], ['E2', 2], ['D2', 2], ['Cs2', 4], ['A2', 4],
            ['D2', 2], ['F2', 2], ['Gs2', 2], ['A2', 2], ['G2', 4], ['F2', 4],
            ['E2', 2], ['Eb2', 2], ['D2', 4], ['D2', 4], ['A2', 4],
            ['D2', 2], ['D2', 2], ['F2', 2], ['E2', 2], ['D2', 4], ['A2', 4],
            ['Bb1', 2], ['Bb1', 2], ['D2', 2], ['F2', 2], ['Gs2', 4], ['E2', 4],
            ['A1', 4], ['Cs2', 4], ['E2', 4], ['A2', 4],
            ['D2', 4], ['A1', 4], ['D2', 6], ['R', 2]
        ]
    },

    // 通常戦闘: バトル (アップテンポで緊迫感のある疾走曲)
    battle: {
        bpm: 144,
        loop: true,
        lead: [
            ['E4', 2], ['E4', 2], ['B4', 2], ['A4', 2], ['G4', 2], ['Fs4', 2], ['E4', 2], ['Eb4', 2],
            ['E4', 2], ['G4', 2], ['A4', 2], ['B4', 2], ['C5', 4], ['B4', 2], ['A4', 2],
            ['B4', 4], ['E5', 4], ['D5', 2], ['C5', 2], ['B4', 2], ['A4', 2],
            ['G4', 2], ['A4', 2], ['B4', 2], ['G4', 2], ['Fs4', 4], ['Eb4', 4],
            ['E4', 2], ['E4', 2], ['B4', 2], ['A4', 2], ['G4', 2], ['Fs4', 2], ['E4', 2], ['Eb4', 2],
            ['E4', 2], ['G4', 2], ['A4', 2], ['B4', 2], ['D5', 4], ['C5', 2], ['B4', 2],
            ['C5', 2], ['D5', 2], ['E5', 4], ['D5', 2], ['C5', 2], ['B4', 2], ['A4', 2],
            ['B4', 4], ['Eb4', 4], ['E4', 6], ['R', 2]
        ],
        bass: [
            ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1],
            ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1], ['G2', 1], ['G3', 1], ['G2', 1], ['G3', 1],
            ['A2', 1], ['A3', 1], ['A2', 1], ['A3', 1], ['A2', 1], ['A3', 1], ['A2', 1], ['A3', 1],
            ['Fs2', 1], ['Fs3', 1], ['Fs2', 1], ['Fs3', 1], ['D2', 1], ['D3', 1], ['D2', 1], ['D3', 1],
            ['C3', 1], ['C4', 1], ['C3', 1], ['C4', 1], ['C3', 1], ['C4', 1], ['C3', 1], ['C4', 1],
            ['B2', 1], ['B3', 1], ['B2', 1], ['B3', 1], ['G2', 1], ['G3', 1], ['G2', 1], ['G3', 1],
            ['A2', 1], ['A3', 1], ['A2', 1], ['A3', 1], ['B2', 1], ['B3', 1], ['B2', 1], ['B3', 1],
            ['C3', 1], ['C4', 1], ['C3', 1], ['C4', 1], ['B2', 1], ['B3', 1], ['B2', 1], ['B3', 1],
            ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1],
            ['E2', 1], ['E3', 1], ['E2', 1], ['E3', 1], ['G2', 1], ['G3', 1], ['G2', 1], ['G3', 1],
            ['A2', 1], ['A3', 1], ['A2', 1], ['A3', 1], ['A2', 1], ['A3', 1], ['A2', 1], ['A3', 1],
            ['B2', 1], ['B3', 1], ['B2', 1], ['B3', 1], ['C3', 1], ['C4', 1], ['C3', 1], ['C4', 1],
            ['C3', 1], ['C4', 1], ['C3', 1], ['C4', 1], ['D3', 1], ['D4', 1], ['D3', 1], ['D4', 1],
            ['E3', 1], ['E4', 1], ['E3', 1], ['E4', 1], ['D3', 1], ['D4', 1], ['D3', 1], ['D4', 1],
            ['B2', 2], ['B2', 2], ['Eb3', 2], ['Eb3', 2], ['E2', 6], ['R', 2]
        ],
        drums: true // ハイハット/スネア打楽器パターン
    },

    // ボス戦: 魔王戦 (重厚で凶悪なヘビーバトル)
    boss: {
        bpm: 134,
        loop: true,
        lead: [
            ['C4', 2], ['Eb4', 2], ['Fs4', 2], ['G4', 4], ['Fs4', 2], ['Eb4', 2], ['C4', 2],
            ['B3', 4], ['D4', 4], ['F4', 4], ['Ab4', 4],
            ['G4', 2], ['F4', 2], ['Eb4', 2], ['D4', 2], ['Eb4', 4], ['C4', 4],
            ['Cs4', 4], ['Eb4', 4], ['D4', 6], ['R', 2],
            ['C5', 4], ['B4', 2], ['Ab4', 2], ['G4', 4], ['Fs4', 4],
            ['F4', 2], ['Ab4', 2], ['C5', 2], ['D5', 2], ['Eb5', 4], ['D5', 4],
            ['C5', 2], ['B4', 2], ['Ab4', 2], ['G4', 2], ['Fs4', 4], ['Eb4', 4],
            ['D4', 4], ['B3', 4], ['C4', 6], ['R', 2]
        ],
        bass: [
            ['C2', 2], ['C2', 2], ['Eb2', 2], ['D2', 2], ['C2', 2], ['Fs2', 2], ['F2', 2], ['Eb2', 2],
            ['G1', 2], ['G1', 2], ['B1', 2], ['D2', 2], ['F2', 2], ['D2', 2], ['B1', 2], ['G1', 2],
            ['C2', 2], ['C2', 2], ['Eb2', 2], ['G2', 2], ['Ab2', 4], ['F2', 4],
            ['Cs2', 2], ['Cs2', 2], ['Eb2', 2], ['F2', 2], ['G2', 4], ['G1', 4],
            ['C2', 2], ['C3', 2], ['B2', 2], ['Ab2', 2], ['G2', 2], ['Fs2', 2], ['F2', 2], ['Eb2', 2],
            ['F2', 2], ['Ab2', 2], ['C3', 2], ['D3', 2], ['Eb3', 4], ['D3', 4],
            ['C2', 2], ['C2', 2], ['Eb2', 2], ['G2', 2], ['Fs2', 4], ['Eb2', 4],
            ['G1', 4], ['B1', 4], ['C2', 6], ['R', 2]
        ],
        drums: true
    },

    // 勝利ファンファーレ (1ループで終了)
    victory: {
        bpm: 132,
        loop: false,
        lead: [
            ['C4', 1], ['E4', 1], ['G4', 1], ['C5', 3], ['R', 2],
            ['A4', 1], ['B4', 1], ['C5', 1], ['D5', 2], ['C5', 5]
        ],
        bass: [
            ['C3', 1], ['G3', 1], ['C4', 1], ['C3', 3], ['R', 2],
            ['F3', 1], ['G3', 1], ['A3', 1], ['G3', 2], ['C3', 5]
        ]
    }
};

// --------------------------------------------------------
// プログラマブル BGM スケジューラー
// Lookahead 方式 (currentTime 基準で先読みキューイング)
// --------------------------------------------------------
let synthState = {
    track: null,
    stepDuration: 0,
    currentStepTime: 0,
    leadIdx: 0,
    leadRemaining: 0,
    bassIdx: 0,
    bassRemaining: 0,
    stepCount: 0
};

function scheduleSynthNotes() {
    if (!isPlayingSynth || !audioCtx || !synthState.track) return;

    const lookAheadTime = 0.15; // 0.15秒先までキューイング
    const stepDur = synthState.stepDuration;
    const track = synthState.track;

    while (synthState.currentStepTime < audioCtx.currentTime + lookAheadTime) {
        const t = synthState.currentStepTime;

        // 1. Lead メロディ
        if (synthState.leadRemaining <= 0) {
            if (synthState.leadIdx >= track.lead.length) {
                if (track.loop) {
                    synthState.leadIdx = 0;
                } else {
                    stopBGM();
                    return;
                }
            }
            const noteData = track.lead[synthState.leadIdx];
            synthState.leadRemaining = noteData[1];
            const freq = noteToFreq(noteData[0]);
            if (freq > 0) {
                playSynthLeadNote(freq, t, noteData[1] * stepDur, track.leadWave);
            }
            synthState.leadIdx++;
        }
        synthState.leadRemaining--;

        // 2. Bass ベース
        if (track.bass) {
            if (synthState.bassRemaining <= 0) {
                if (synthState.bassIdx >= track.bass.length) {
                    synthState.bassIdx = 0;
                }
                const noteData = track.bass[synthState.bassIdx];
                synthState.bassRemaining = noteData[1];
                const freq = noteToFreq(noteData[0]);
                if (freq > 0) {
                    playSynthBassNote(freq, t, noteData[1] * stepDur);
                }
                synthState.bassIdx++;
            }
            synthState.bassRemaining--;
        }

        // 3. ドラム (ノイズパーカッション)
        if (track.drums) {
            const beat = synthState.stepCount % 16;
            if (beat === 0 || beat === 8) {
                // バスドラム風 (低音パルス)
                playSynthKick(t);
            } else if (beat === 4 || beat === 12) {
                // スネア風 (ノイズ)
                playSynthSnare(t);
            } else if (beat % 2 === 0) {
                // ハイハット (ショートノイズ)
                playSynthHiHat(t);
            }
        }

        synthState.stepCount++;
        synthState.currentStepTime += stepDur;
    }
}

// Lead 音色 (矩形波 + ローパスフィルターでレトロで耳当たりの良いファミコン音)
// 曲定義の leadWave で波形を変えられる (例: 'triangle' で穏やか・厳かな曲向けのやわらかい音)
function playSynthLeadNote(freq, startTime, duration, wave = 'square') {
    if (!audioCtx || !bgmGainNode) return;

    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();

    osc.type = wave;
    osc.frequency.setValueAtTime(freq, startTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, startTime);

    const noteDur = Math.max(0.04, duration * 0.88); // 歯切れの良いゲートタイム
    const vol = wave === 'square' ? 0.09 : 0.15; // 三角波は矩形波より小さく聞こえるので音量を補う

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + 0.012);
    gain.gain.setValueAtTime(vol * 0.75, startTime + noteDur * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bgmGainNode);

    osc.start(startTime);
    osc.stop(startTime + noteDur);
}

// Bass 音色 (三角波による太く温かみのあるベースライン)
function playSynthBassNote(freq, startTime, duration) {
    if (!audioCtx || !bgmGainNode) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);

    const noteDur = Math.max(0.05, duration * 0.92);
    const vol = 0.16;

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(vol, startTime + 0.015);
    gain.gain.setValueAtTime(vol * 0.8, startTime + noteDur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDur);

    osc.connect(gain);
    gain.connect(bgmGainNode);

    osc.start(startTime);
    osc.stop(startTime + noteDur);
}

// パーカッション: キック
function playSynthKick(startTime) {
    if (!audioCtx || !bgmGainNode) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, startTime);
    osc.frequency.exponentialRampToValueAtTime(35, startTime + 0.08);

    gain.gain.setValueAtTime(0.18, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);

    osc.connect(gain);
    gain.connect(bgmGainNode);

    osc.start(startTime);
    osc.stop(startTime + 0.08);
}

// パーカッション: スネア
function playSynthSnare(startTime) {
    if (!audioCtx || !bgmGainNode) return;
    const nBuf = getNoiseBuffer();
    if (!nBuf) return;

    const noise = audioCtx.createBufferSource();
    noise.buffer = nBuf;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(800, startTime);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.06, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.07);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(bgmGainNode);

    noise.start(startTime);
    noise.stop(startTime + 0.07);
}

// パーカッション: ハイハット
function playSynthHiHat(startTime) {
    if (!audioCtx || !bgmGainNode) return;
    const nBuf = getNoiseBuffer();
    if (!nBuf) return;

    const noise = audioCtx.createBufferSource();
    noise.buffer = nBuf;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(5000, startTime);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.025, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.025);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(bgmGainNode);

    noise.start(startTime);
    noise.stop(startTime + 0.025);
}

function startSynthBGM(trackId) {
    stopSynthBGM();
    initAudio();
    if (!audioCtx || !SYNTH_TRACKS[trackId]) return;

    const track = SYNTH_TRACKS[trackId];
    const secondsPerBeat = 60 / track.bpm;
    const stepDuration = secondsPerBeat / 4; // 16分音符あたりの秒数

    synthState = {
        track: track,
        stepDuration: stepDuration,
        currentStepTime: audioCtx.currentTime + 0.05,
        leadIdx: 0,
        leadRemaining: 0,
        bassIdx: 0,
        bassRemaining: 0,
        stepCount: 0
    };

    isPlayingSynth = true;
    synthSchedulerTimer = setInterval(scheduleSynthNotes, 40);
}

function stopSynthBGM() {
    isPlayingSynth = false;
    if (synthSchedulerTimer) {
        clearInterval(synthSchedulerTimer);
        synthSchedulerTimer = null;
    }
}

// --------------------------------------------------------
// ハイブリッド再生統括関数
// 1. 外部ファイル audio/${trackId}.mp3 の再生を試行
// 2. 存在しない場合やエラー時はプログラマブルシンセで即座に演奏
// --------------------------------------------------------
function playBGM(trackId, force = false) {
    if (!trackId) return;
    if (!force && currentBGMTrack === trackId && (isPlayingSynth || (activeBgmAudio && !activeBgmAudio.paused))) {
        return;
    }

    stopBGM();
    currentBGMTrack = trackId;

    if (isBGMMuted) {
        return;
    }

    initAudio();

    // 外部ファイル読み込み試行
    const extAudio = new Audio();
    extAudio.src = `audio/${trackId}.mp3`;
    extAudio.volume = bgmVolume;
    extAudio.loop = (trackId !== 'victory');

    let isAudioValid = false;

    extAudio.addEventListener('canplaythrough', () => {
        if (currentBGMTrack !== trackId || isBGMMuted) return;
        isAudioValid = true;
        stopSynthBGM();
        activeBgmAudio = extAudio;
        extAudio.play().catch(err => {
            console.warn('Autoplay blocked or audio playback error:', err);
            startSynthBGM(trackId);
        });
    }, { once: true });

    extAudio.addEventListener('error', () => {
        // 外部ファイル未配置の場合はプログラマブル・シンセ音源で演奏！
        if (currentBGMTrack !== trackId || isBGMMuted) return;
        if (!isAudioValid) {
            startSynthBGM(trackId);
        }
    }, { once: true });

    extAudio.load();
}

function stopBGM() {
    if (activeBgmAudio) {
        try {
            activeBgmAudio.pause();
            activeBgmAudio.currentTime = 0;
        } catch (e) {}
        activeBgmAudio = null;
    }
    stopSynthBGM();
}

function pauseBGM() {
    if (activeBgmAudio) {
        try { activeBgmAudio.pause(); } catch (e) {}
    }
    stopSynthBGM();
}

function resumeBGM() {
    if (!isBGMMuted && currentBGMTrack) {
        playBGM(currentBGMTrack, true);
    }
}

// BGM ON / OFF トグル切り替え
function toggleBGM() {
    initAudio();
    isBGMMuted = !isBGMMuted;
    try {
        localStorage.setItem('rpg_bgm_muted', isBGMMuted ? 'true' : 'false');
    } catch (e) {}

    if (bgmGainNode && audioCtx) {
        bgmGainNode.gain.setValueAtTime(isBGMMuted ? 0 : bgmVolume, audioCtx.currentTime);
    }

    if (isBGMMuted) {
        stopBGM();
        showBGMToast('BGM: OFF (ミュート)');
    } else {
        showBGMToast('BGM: ON');
        if (currentBGMTrack) {
            playBGM(currentBGMTrack, true);
        }
    }
    return !isBGMMuted;
}

function setBGMVolume(val) {
    bgmVolume = Math.max(0, Math.min(1, val));
    try {
        localStorage.setItem('rpg_bgm_volume', bgmVolume.toString());
    } catch (e) {}

    if (activeBgmAudio) {
        activeBgmAudio.volume = bgmVolume;
    }
    if (bgmGainNode && audioCtx && !isBGMMuted) {
        bgmGainNode.gain.setValueAtTime(bgmVolume, audioCtx.currentTime);
    }
}

// トースト通知 (画面中央上部に1.5秒間ふわっと表示)
function showBGMToast(text) {
    let toast = document.getElementById('bgm-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'bgm-toast';
        toast.style.position = 'fixed';
        toast.style.top = '18px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.background = 'rgba(0, 0, 0, 0.88)';
        toast.style.border = '2px solid #00ff00';
        toast.style.color = '#00ff00';
        toast.style.padding = '6px 16px';
        toast.style.fontFamily = 'monospace';
        toast.style.fontSize = '12px';
        toast.style.zIndex = '9999';
        toast.style.borderRadius = '3px';
        toast.style.boxShadow = '0 0 12px rgba(0, 255, 0, 0.4)';
        toast.style.pointerEvents = 'none';
        toast.style.transition = 'opacity 0.3s ease';
        document.body.appendChild(toast);
    }
    toast.innerText = `♪ ${text}`;
    toast.style.display = 'block';
    toast.style.opacity = '1';

    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.style.opacity === '0') toast.style.display = 'none';
        }, 300);
    }, 1500);
}

// グローバル参照エクスポート
window.playBGM = playBGM;
window.stopBGM = stopBGM;
window.pauseBGM = pauseBGM;
window.resumeBGM = resumeBGM;
window.toggleBGM = toggleBGM;
window.setBGMVolume = setBGMVolume;
window.getCurrentBGMTrack = () => currentBGMTrack;


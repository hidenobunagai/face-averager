import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import Delaunator from 'delaunator';

const WORK_SIZE = 1024;
const slots = [
  { file: null, img: null },
  { file: null, img: null },
  { file: null, img: null }
];

let landmarkerInstance = null;
let landmarkerDelegate = null;

// DOM要素
const mixButton = document.getElementById('mix-button');
const statusBox = document.getElementById('status-message');
const errorBox = document.getElementById('error-message');
const resultSection = document.getElementById('result-section');
const resultCanvas = document.getElementById('result-canvas');
const downloadButton = document.getElementById('download-button');
const loadSamplesBtn = document.getElementById('load-samples-btn');
const loadErrorSampleBtn = document.getElementById('load-error-sample-btn');

function setStatus(msg) {
  if (!msg) {
    statusBox.hidden = true;
    statusBox.textContent = '';
  } else {
    statusBox.hidden = false;
    statusBox.textContent = msg;
  }
}

function setError(msg) {
  if (!msg) {
    errorBox.hidden = true;
    errorBox.textContent = '';
  } else {
    errorBox.hidden = false;
    errorBox.textContent = msg;
  }
}

function updateMixButtonState() {
  const allLoaded = slots.every(s => s.img !== null);
  mixButton.disabled = !allLoaded;
}

// 顔検出の閾値を既定(0.5)から緩める。古い写真ではスコアが閾値付近で跨ぎ、
// デリゲート(CPU/GPU)や端末の数値微差で「検出0件」になることが実測で発生したため。
const LANDMARKER_OPTIONS = {
  runningMode: 'IMAGE',
  numFaces: 1,
  minFaceDetectionConfidence: 0.3,
  minFacePresenceConfidence: 0.3
};

async function createLandmarker(delegate) {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
  );
  const modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath, delegate },
    ...LANDMARKER_OPTIONS
  });
}

// MediaPipe FaceLandmarker の遅延初期化（GPU優先、初期化失敗時はCPU）
async function getLandmarker() {
  if (landmarkerInstance) return landmarkerInstance;
  setStatus('顔認識AIモデル（MediaPipe）を読み込み中...');
  try {
    landmarkerInstance = await createLandmarker('GPU');
    landmarkerDelegate = 'GPU';
  } catch (err) {
    console.warn('[FaceMix] GPU初期化に失敗したためCPUで再試行します:', err);
    landmarkerInstance = await createLandmarker('CPU');
    landmarkerDelegate = 'CPU';
  }
  return landmarkerInstance;
}

// 顔検出。GPUでは空/例外が返る端末があるため、失敗時はCPUに切り替えて再試行する
async function detectFace(canvas) {
  let detection = null;
  try {
    detection = landmarkerInstance.detect(canvas);
  } catch (err) {
    console.warn('[FaceMix] 検出で例外:', err);
  }
  const found = detection && detection.faceLandmarks && detection.faceLandmarks.length > 0;
  if (!found && landmarkerDelegate === 'GPU') {
    console.warn('[FaceMix] GPUで顔検出に失敗。CPUに切り替えて再試行します');
    try { landmarkerInstance.close(); } catch (_) { /* 前回分の後始末は失敗しても無視 */ }
    landmarkerInstance = await createLandmarker('CPU');
    landmarkerDelegate = 'CPU';
    detection = landmarkerInstance.detect(canvas);
  }
  return detection;
}

// スロットに画像を設定
function setSlotImage(slotIndex, file, dataUrl) {
  const img = new Image();
  img.onload = () => {
    slots[slotIndex] = { file, img };
    const previewImg = document.getElementById(`preview-img-${slotIndex + 1}`);
    const previewContent = document.getElementById(`preview-content-${slotIndex + 1}`);
    const slotStatus = document.getElementById(`slot-status-${slotIndex + 1}`);

    previewImg.src = dataUrl;
    previewImg.hidden = false;
    previewContent.hidden = true;
    slotStatus.textContent = '読込完了';
    setError('');
    updateMixButtonState();
  };
  img.src = dataUrl;
}

// ファイル読み込み処理
function handleFileInput(slotIndex, file) {
  if (!file || !file.type.startsWith('image/')) {
    setError(`画像 ${slotIndex + 1} には有効な画像ファイル（JPEG / PNG など）を選択してください。`);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    setSlotImage(slotIndex, file, e.target.result);
  };
  reader.readAsDataURL(file);
}

// 各スロットのイベント登録
for (let i = 0; i < 3; i++) {
  const slotIdx = i;
  const inputEl = document.getElementById(`file-input-${slotIdx + 1}`);
  const dropZone = document.getElementById(`drop-zone-${slotIdx + 1}`);

  inputEl.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileInput(slotIdx, e.target.files[0]);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileInput(slotIdx, e.dataTransfer.files[0]);
    }
  });
}

// 画像を長辺1024pxの中央配置キャンバスに描画
function createWorkCanvas(img) {
  const canvas = document.createElement('canvas');
  canvas.width = WORK_SIZE;
  canvas.height = WORK_SIZE;
  const ctx = canvas.getContext('2d');
  const scale = Math.min(WORK_SIZE / img.naturalWidth, WORK_SIZE / img.naturalHeight);
  const drawW = Math.round(img.naturalWidth * scale);
  const drawH = Math.round(img.naturalHeight * scale);
  const offsetX = Math.round((WORK_SIZE - drawW) / 2);
  const offsetY = Math.round((WORK_SIZE - drawH) / 2);
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  return canvas;
}

// 2D凸包（Monotone Chain アルゴリズム）
function getConvexHull(points) {
  const pts = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  if (pts.length <= 1) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// 三角形アフィン変形で画像をワープ
function warpImage(srcCanvas, srcLandmarks, dstLandmarks, triangles) {
  const canvas = document.createElement('canvas');
  canvas.width = WORK_SIZE;
  canvas.height = WORK_SIZE;
  const ctx = canvas.getContext('2d');

  let drawnCount = 0;
  let skipCount = 0;

  for (let t = 0; t < triangles.length; t += 3) {
    const i0 = triangles[t];
    const i1 = triangles[t + 1];
    const i2 = triangles[t + 2];

    const p0s = srcLandmarks[i0], p1s = srcLandmarks[i1], p2s = srcLandmarks[i2];
    const p0d = dstLandmarks[i0], p1d = dstLandmarks[i1], p2d = dstLandmarks[i2];

    // 重心から1.2px外側に拡張して三角形同士のシーム（アンチエイリアスの隙間）を防止
    const cx = (p0d.x + p1d.x + p2d.x) / 3;
    const cy = (p0d.y + p1d.y + p2d.y) / 3;
    const expand = (p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist === 0) return { x: p.x, y: p.y };
      const f = (dist + 1.2) / dist;
      return { x: cx + dx * f, y: cy + dy * f };
    };
    const ep0 = expand(p0d), ep1 = expand(p1d), ep2 = expand(p2d);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ep0.x, ep0.y);
    ctx.lineTo(ep1.x, ep1.y);
    ctx.lineTo(ep2.x, ep2.y);
    ctx.closePath();
    ctx.clip();

    // ソースからデスティネーションへのアフィン変換行列
    const u0 = p0s.x, v0 = p0s.y;
    const u1 = p1s.x, v1 = p1s.y;
    const u2 = p2s.x, v2 = p2s.y;
    const x0 = p0d.x, y0 = p0d.y;
    const x1 = p1d.x, y1 = p1d.y;
    const x2 = p2d.x, y2 = p2d.y;

    const det = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
    if (Math.abs(det) < 1e-6) {
      ctx.restore();
      skipCount++;
      continue;
    }
    drawnCount++;

    const w00 = (v1 - v2) / det;
    const w01 = (u2 - u1) / det;
    const w02 = (u1 * v2 - u2 * v1) / det;

    const w10 = (v2 - v0) / det;
    const w11 = (u0 - u2) / det;
    const w12 = (u2 * v0 - u0 * v2) / det;

    const w20 = (v0 - v1) / det;
    const w21 = (u1 - u0) / det;
    const w22 = (u0 * v1 - u1 * v0) / det;

    const a = x0 * w00 + x1 * w10 + x2 * w20;
    const c = x0 * w01 + x1 * w11 + x2 * w21;
    const e = x0 * w02 + x1 * w12 + x2 * w22;

    const b = y0 * w00 + y1 * w10 + y2 * w20;
    const d = y0 * w01 + y1 * w11 + y2 * w21;
    const f = y0 * w02 + y1 * w12 + y2 * w22;

    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.restore();
  }
  console.log(`[FaceMix warp] 描画: ${drawnCount}, スキップ: ${skipCount}`);
  return canvas;
}

// 凸包を膨らませてぼかしたフェザーアルファマスクを作成
function createFeatheredMask(avgLandmarks) {
  const hull = getConvexHull(avgLandmarks);
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = WORK_SIZE;
  maskCanvas.height = WORK_SIZE;
  const mCtx = maskCanvas.getContext('2d');

  if (hull.length >= 3) {
    mCtx.beginPath();
    mCtx.moveTo(hull[0].x, hull[0].y);
    for (let i = 1; i < hull.length; i++) {
      mCtx.lineTo(hull[i].x, hull[i].y);
    }
    mCtx.closePath();
    mCtx.fillStyle = '#ffffff';
    mCtx.strokeStyle = '#ffffff';
    mCtx.lineWidth = 20; // 凸包を少し膨らませる
    mCtx.lineJoin = 'round';
    mCtx.stroke();
    mCtx.fill();
  }

  // ガウシアンぼかしで境界をフェザー
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = WORK_SIZE;
  blurCanvas.height = WORK_SIZE;
  const bCtx = blurCanvas.getContext('2d');
  bCtx.filter = 'blur(12px)';
  bCtx.drawImage(maskCanvas, 0, 0);
  bCtx.filter = 'none';
  return blurCanvas;
}

// メイン合成処理
async function runFaceMix() {
  setError('');
  mixButton.disabled = true;

  try {
    await getLandmarker();

    setStatus('作業解像度にリサイズ中...');
    const workCanvases = slots.map(s => createWorkCanvas(s.img));

    // 各画像からランドマーク検出
    const allLandmarks = [];
    for (let i = 0; i < 3; i++) {
      setStatus(`画像 ${i + 1} の顔とランドマークを検出中...`);
      const detection = await detectFace(workCanvases[i]);
      if (!detection || !detection.faceLandmarks || detection.faceLandmarks.length === 0) {
        throw new Error(`画像 ${i + 1} から顔を検出できませんでした。正面を向いた鮮明な顔写真を選択してください。`);
      }
      // 478ランドマークをピクセル座標系に変換
      const lms = detection.faceLandmarks[0].map(pt => ({
        x: pt.x * WORK_SIZE,
        y: pt.y * WORK_SIZE
      }));
      allLandmarks.push(lms);
    }

    setStatus('3人の平均形状を計算中...');
    const avgLandmarks = [];
    for (let k = 0; k < allLandmarks[0].length; k++) {
      avgLandmarks.push({
        x: (allLandmarks[0][k].x + allLandmarks[1][k].x + allLandmarks[2][k].x) / 3,
        y: (allLandmarks[0][k].y + allLandmarks[1][k].y + allLandmarks[2][k].y) / 3
      });
    }

    setStatus('Delaunay 三角分割を実行中...');
    const points = avgLandmarks.map(p => [p.x, p.y]);
    const delaunay = Delaunator.from(points);
    const triangles = delaunay.triangles;
    console.log(`[FaceMix] ランドマーク数: ${avgLandmarks.length}, 三角形数: ${triangles.length / 3}`);

    setStatus('各画像を平均形状へワープ変形中...');
    const warpedCanvases = [];
    for (let i = 0; i < 3; i++) {
      setStatus(`画像 ${i + 1} をワープ中 (${i + 1}/3)...`);
      const warped = warpImage(workCanvases[i], allLandmarks[i], avgLandmarks, triangles);
      warpedCanvases.push(warped);
    }

    setStatus('フェザーマスクの生成と加重平均ブレンド中...');
    const maskCanvas = createFeatheredMask(avgLandmarks);
    const mCtx = maskCanvas.getContext('2d');
    const maskData = mCtx.getImageData(0, 0, WORK_SIZE, WORK_SIZE).data;

    const imgData1 = warpedCanvases[0].getContext('2d').getImageData(0, 0, WORK_SIZE, WORK_SIZE).data;
    const imgData2 = warpedCanvases[1].getContext('2d').getImageData(0, 0, WORK_SIZE, WORK_SIZE).data;
    const imgData3 = warpedCanvases[2].getContext('2d').getImageData(0, 0, WORK_SIZE, WORK_SIZE).data;

    const rCtx = resultCanvas.getContext('2d');
    const outImgData = rCtx.createImageData(WORK_SIZE, WORK_SIZE);
    const outData = outImgData.data;

    const totalPixels = WORK_SIZE * WORK_SIZE;
    for (let p = 0; p < totalPixels; p++) {
      const idx = p * 4;
      const maskVal = maskData[idx] / 255; // 白=1, 黒=0

      if (maskVal > 0.001) {
        outData[idx] = Math.round((imgData1[idx] + imgData2[idx] + imgData3[idx]) / 3);
        outData[idx + 1] = Math.round((imgData1[idx + 1] + imgData2[idx + 1] + imgData3[idx + 1]) / 3);
        outData[idx + 2] = Math.round((imgData1[idx + 2] + imgData2[idx + 2] + imgData3[idx + 2]) / 3);
        const avgAlpha = (imgData1[idx + 3] + imgData2[idx + 3] + imgData3[idx + 3]) / 3;
        outData[idx + 3] = Math.round(avgAlpha * maskVal);
      } else {
        outData[idx + 3] = 0;
      }
    }

    // 合成結果を一時キャンバスに書き出し
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = WORK_SIZE;
    fullCanvas.height = WORK_SIZE;
    fullCanvas.getContext('2d').putImageData(outImgData, 0, 0);

    // 顔のバウンディングボックス＋余白で切り抜いて表示（透明背景に顔が浮く仮面感を回避）
    let minX = WORK_SIZE, minY = WORK_SIZE, maxX = 0, maxY = 0;
    for (const p of avgLandmarks) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const padX = (maxX - minX) * 0.15;
    const padY = (maxY - minY) * 0.15;
    const bx = Math.max(0, Math.floor(minX - padX));
    const by = Math.max(0, Math.floor(minY - padY));
    const bw = Math.min(WORK_SIZE - bx, Math.ceil(maxX + padX) - bx);
    const bh = Math.min(WORK_SIZE - by, Math.ceil(maxY + padY) - by);
    resultCanvas.width = bw;
    resultCanvas.height = bh;
    resultCanvas.getContext('2d').drawImage(fullCanvas, bx, by, bw, bh, 0, 0, bw, bh);

    resultSection.hidden = false;
    downloadButton.disabled = false;
    aiFinishBtn.hidden = false;
    aiResult.hidden = true;
    setStatus('合成が完了しました！');
    resultSection.scrollIntoView({ behavior: 'smooth' });
    downloadButton.focus({ preventScroll: true });
  } catch (err) {
    console.warn('[FaceMix]', err.message);
    setError(err.message || '合成処理中にエラーが発生しました。');
    setStatus('');
  } finally {
    updateMixButtonState();
  }
}

mixButton.addEventListener('click', runFaceMix);

// PNGダウンロード
downloadButton.addEventListener('click', () => {
  resultCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facemix-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png');
});

// サンプル画像読み込みヘルパー
async function loadSampleUrls(urls) {
  setStatus('サンプル画像を読み込み中...');
  setError('');
  try {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(urls[i]);
      if (!res.ok) throw new Error(`サンプル画像の読み込みに失敗しました: ${urls[i]}`);
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      setSlotImage(i, blob, dataUrl);
    }
    setStatus('サンプル画像をセットしました。「3人の顔を合成する」をクリックしてください。');
  } catch (err) {
    console.error(err);
    setError(`サンプル画像の読み込みエラー: ${err.message}`);
    setStatus('');
  }
}

loadSamplesBtn.addEventListener('click', () => {
  loadSampleUrls([
    'samples/face1_lincoln.jpg',
    'samples/face2_einstein.jpg',
    'samples/face3_curie.jpg'
  ]);
});

loadErrorSampleBtn.addEventListener('click', () => {
  loadSampleUrls([
    'samples/face1_lincoln.jpg',
    'samples/noface_landscape.jpg',
    'samples/face3_curie.jpg'
  ]);
});

// ===== AI仕上げ（Gemini API・ユーザー持ち込みキー） =====
// 通常の合成は完全にブラウザ内で完結。この機能を使う時だけ Google に送信される。
const GEMINI_MODEL_DEFAULT = 'gemini-3.1-flash-image';
const GEMINI_KEY_STORAGE = 'facemix.gemini.key';
const GEMINI_MODEL_STORAGE = 'facemix.gemini.model';
const AI_FINISH_PROMPT =
  'この画像は3人の顔を機械的に平均して合成したものです。顔の特徴・表情・向き・肌の色合いは変えずに、' +
  '自然な1枚の肖像写真へ仕上げてください。髪型と背景はこの顔に似合う自然なものを補完してください。' +
  '合成由来の歪みやゴーストがあれば解消してください。';

const aiSettings = document.getElementById('ai-settings');
const geminiKeyInput = document.getElementById('gemini-key-input');
const geminiModelSelect = document.getElementById('gemini-model-select');
const saveKeyBtn = document.getElementById('save-key-btn');
const clearKeyBtn = document.getElementById('clear-key-btn');
const keyStatus = document.getElementById('key-status');
const aiFinishBtn = document.getElementById('ai-finish-button');
const aiResult = document.getElementById('ai-result');
const aiResultImg = document.getElementById('ai-result-img');
const aiDownloadBtn = document.getElementById('ai-download-button');

function getGeminiKey() {
  return (localStorage.getItem(GEMINI_KEY_STORAGE) || '').trim();
}
function getGeminiModel() {
  return localStorage.getItem(GEMINI_MODEL_STORAGE) || GEMINI_MODEL_DEFAULT;
}

geminiKeyInput.value = getGeminiKey();
geminiModelSelect.value = getGeminiModel();

saveKeyBtn.addEventListener('click', () => {
  localStorage.setItem(GEMINI_KEY_STORAGE, geminiKeyInput.value.trim());
  keyStatus.textContent = '保存しました（この端末のみ）';
});
clearKeyBtn.addEventListener('click', () => {
  localStorage.removeItem(GEMINI_KEY_STORAGE);
  geminiKeyInput.value = '';
  keyStatus.textContent = '削除しました';
});
geminiModelSelect.addEventListener('change', () => {
  localStorage.setItem(GEMINI_MODEL_STORAGE, geminiModelSelect.value);
});

// 結果キャンバスを白背景に展開して base64 PNG を返す（透過PNGのまま送ると Gemini が黒抜きで解釈するため）
function flattenResultToBase64(canvas) {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}

function firstLine(s, max = 220) {
  return String(s).split('\n')[0].slice(0, max);
}

function geminiErrorMessage(status, body) {
  // Google の実際のエラー理由を切り出せるようにする（キー値は表示しない）
  let apiMsg = '';
  let reasons = '';
  try {
    const parsed = JSON.parse(body);
    apiMsg = (parsed.error && parsed.error.message) || '';
    reasons = ((parsed.error && parsed.error.details) || [])
      .map(d => d.reason || '').filter(Boolean).join(',');
  } catch (_) {
    apiMsg = firstLine(body, 200);
  }
  console.warn('[FaceMix AI] Gemini API error:', status, apiMsg, reasons);

  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(apiMsg)) {
    return 'APIキーが無効です。設定欄のキーを確認してください。';
  }
  if (status === 403) {
    if (/has not been used in project|disabled|SERVICE_DISABLED/i.test(apiMsg + reasons)) {
      return 'APIキーのプロジェクトで Generative Language API が無効のようです。AI Studio (aistudio.google.com/apikey) で新しいキーを作り直してください。'
        + `（Google: ${firstLine(apiMsg)}）`;
    }
    if (/REFERRER|referrer/i.test(apiMsg + reasons)) {
      return 'APIキーにリファラ制限が付いています。設定を解除するか facemix.misato-labs.com を許可してください。'
        + `（Google: ${firstLine(apiMsg)}）`;
    }
    if (/free tier|tier/i.test(apiMsg)) {
      return 'このモデルはそのキーの無料枠で使えません。設定から gemini-2.5-flash-image に変えて試してください。'
        + `（Google: ${firstLine(apiMsg)}）`;
    }
    return `AIを呼び出せませんでした（403）。設定のキー・モデルを確認してください。（Google: ${firstLine(apiMsg)}）`;
  }
  if (status === 429) {
    return 'レート制限または無料枠の上限に達しました。少し待ってから再試行するか、モデルを変えて試してください。'
      + (apiMsg ? `（Google: ${firstLine(apiMsg, 120)}）` : '');
  }
  return `AI仕上げに失敗しました（HTTP ${status}）。` + (apiMsg ? `（Google: ${firstLine(apiMsg)}）` : '');
}

async function callGeminiImage(key, model, imageBase64) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: AI_FINISH_PROMPT },
            { inline_data: { mime_type: 'image/png', data: imageBase64 } }
          ]
        }]
      })
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(geminiErrorMessage(res.status, body));
  }
  const data = await res.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const imgPart = parts.find(p => p.inlineData || p.inline_data);
  const inline = imgPart && (imgPart.inlineData || imgPart.inline_data);
  if (!inline || !inline.data) {
    throw new Error('AIから画像が返されませんでした。少し待ってから再試行してください。');
  }
  return `data:${inline.mimeType || inline.mime_type || 'image/jpeg'};base64,${inline.data}`;
}

aiFinishBtn.addEventListener('click', async () => {
  const key = getGeminiKey();
  if (!key) {
    setError('AI仕上げには Gemini APIキーが必要です。下の「✨ AI仕上げの設定」から入力して「保存」してください。');
    aiSettings.open = true;
    aiSettings.scrollIntoView({ behavior: 'smooth', block: 'center' });
    geminiKeyInput.focus();
    return;
  }
  setError('');
  aiFinishBtn.disabled = true;
  const label = aiFinishBtn.textContent;
  aiFinishBtn.textContent = '✨ AIで仕上げ中...（10〜30秒）';
  setStatus('Gemini API に送信して仕上げています...');
  try {
    const imageBase64 = flattenResultToBase64(resultCanvas);
    const dataUrl = await callGeminiImage(key, getGeminiModel(), imageBase64);
    aiResultImg.src = dataUrl;
    aiResult.hidden = false;
    setStatus('AI仕上げが完了しました！');
    aiResult.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.warn('[FaceMix AI]', err.message);
    setError(err.message);
    setStatus('');
  } finally {
    aiFinishBtn.disabled = false;
    aiFinishBtn.textContent = label;
  }
});

aiDownloadBtn.addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = aiResultImg.src;
  a.download = `facemix-ai-${Date.now()}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// Barcode scanning engine: Bluetooth/USB keyboard-wedge + Camera (BarcodeDetector / ZXing fallback)
import { state } from './state.js';
import { normalizeBarcode } from './utils.js';

let audioCtx = null;
let zxingLoadPromise = null;

let activeSession = {
  stream: null,
  timerId: null,
  zxingReader: null,
  continuous: false,
  onDetected: null,
  lastCode: '',
  lastCodeAt: 0,
  torchOn: false,
  boundModalClose: false
};

export function playScanFeedback(success = true) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(success ? 45 : [60, 40, 60]);
    }
  } catch (_) {}

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    const playTone = (freq, startOffset, duration) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = success ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + startOffset + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + startOffset);
      osc.stop(audioCtx.currentTime + startOffset + duration);
    };

    if (success) {
      playTone(1046, 0, 0.09);
    } else {
      playTone(260, 0, 0.09);
      playTone(210, 0.11, 0.12);
    }
  } catch (_) {}
}

export function createWedgeScanner({
  inputEl,
  onScan,
  isActive = () => false,
  maxInterKeyMs = 80,
  minLength = 3
}) {
  let buffer = '';
  let lastTs = 0;

  const onInputKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    const code = normalizeBarcode(inputEl.value);
    if (!code) return;
    e.preventDefault();
    inputEl.value = '';
    buffer = '';
    onScan?.(code);
  };

  const onWindowKeyDown = (e) => {
    if (!isActive()) {
      buffer = '';
      return;
    }

    const targetTag = (e.target?.tagName || '').toUpperCase();
    const activeTag = (document.activeElement?.tagName || '').toUpperCase();
    if (
      e.target === inputEl ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag) ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)
    ) {
      return;
    }

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (e.key === 'Enter' || (e.key === 'Tab' && buffer.length >= 4)) {
      if (buffer.length >= minLength && now - lastTs <= maxInterKeyMs * 2) {
        e.preventDefault();
        const code = normalizeBarcode(buffer);
        buffer = '';
        lastTs = 0;
        if (code) onScan?.(code);
        return;
      }
      buffer = '';
      lastTs = 0;
      return;
    }

    if (e.key === 'Shift') return;

    if (e.key && e.key.length === 1) {
      if (buffer.length > 0 && now - lastTs > maxInterKeyMs) {
        buffer = '';
      }
      buffer += e.key;
      lastTs = now;
    } else {
      buffer = '';
      lastTs = 0;
    }
  };

  inputEl?.addEventListener('keydown', onInputKeyDown);
  window.addEventListener('keydown', onWindowKeyDown);

  return {
    destroy() {
      inputEl?.removeEventListener('keydown', onInputKeyDown);
      window.removeEventListener('keydown', onWindowKeyDown);
    }
  };
}

function loadZXingLibrary() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (zxingLoadPromise) return zxingLoadPromise;

  zxingLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './js/vendor/zxing.min.js';
    script.onload = () => {
      if (window.ZXing) resolve(window.ZXing);
      else reject(new Error('ZXing failed to initialize.'));
    };
    script.onerror = () => {
      zxingLoadPromise = null;
      reject(new Error('Failed to load offline barcode decoder library.'));
    };
    document.head.appendChild(script);
  });

  return zxingLoadPromise;
}

function showScannerBanner(text, isSuccess = true) {
  const banner = document.getElementById('camera-scanner-banner');
  if (!banner) return;
  banner.textContent = text;
  banner.style.display = 'flex';
  banner.classList.toggle('error', !isSuccess);
  clearTimeout(banner._hideTimer);
  banner._hideTimer = setTimeout(() => {
    banner.style.display = 'none';
  }, 1400);
}

function setScannerStatus(msg) {
  const el = document.getElementById('camera-scanner-status');
  if (el) el.textContent = msg;
}

function setScannerEngineBadge(label) {
  const el = document.getElementById('camera-scanner-engine');
  if (el) el.textContent = label;
}

function bindScannerModalControls() {
  if (activeSession.boundModalClose) return;
  const modal = document.getElementById('camera-scanner-modal');
  const closeBtn = document.getElementById('btn-close-camera-scanner');
  const torchBtn = document.getElementById('btn-camera-torch');

  closeBtn?.addEventListener('click', () => closeCameraScanner());
  modal?.addEventListener('cancel', () => closeCameraScanner());
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeCameraScanner();
  });

  torchBtn?.addEventListener('click', async () => {
    const track = activeSession.stream?.getVideoTracks?.()?.[0];
    if (!track) return;
    try {
      activeSession.torchOn = !activeSession.torchOn;
      await track.applyConstraints({ advanced: [{ torch: activeSession.torchOn }] });
      torchBtn.classList.toggle('active', activeSession.torchOn);
    } catch (_) {
      activeSession.torchOn = false;
      torchBtn.style.display = 'none';
    }
  });

  activeSession.boundModalClose = true;
}

export function closeCameraScanner() {
  if (activeSession.timerId) {
    clearTimeout(activeSession.timerId);
    activeSession.timerId = null;
  }
  if (activeSession.zxingReader) {
    try {
      activeSession.zxingReader.reset();
    } catch (_) {}
    activeSession.zxingReader = null;
  }
  if (activeSession.stream) {
    try {
      activeSession.stream.getTracks().forEach((track) => track.stop());
    } catch (_) {}
    activeSession.stream = null;
  }
  activeSession.torchOn = false;

  const video = document.getElementById('camera-scanner-video');
  if (video) {
    video.pause?.();
    video.srcObject = null;
  }

  const torchBtn = document.getElementById('btn-camera-torch');
  if (torchBtn) {
    torchBtn.style.display = 'none';
    torchBtn.classList.remove('active');
  }

  const banner = document.getElementById('camera-scanner-banner');
  if (banner) banner.style.display = 'none';

  const modal = document.getElementById('camera-scanner-modal');
  if (modal?.open) modal.close();
}

async function handleRawCameraHit(rawCode) {
  const code = normalizeBarcode(rawCode);
  if (!code) return;

  const now = Date.now();
  if (activeSession.continuous && code === activeSession.lastCode && now - activeSession.lastCodeAt < 1200) {
    return;
  }
  activeSession.lastCode = code;
  activeSession.lastCodeAt = now;

  if (!activeSession.continuous) {
    const cb = activeSession.onDetected;
    closeCameraScanner();
    playScanFeedback(true);
    cb?.(code);
    return;
  }

  const res = activeSession.onDetected?.(code);
  if (res && typeof res === 'object' && res.itemName) {
    showScannerBanner(`+1 ${res.itemName} (${code})`, true);
  } else if (res === false) {
    showScannerBanner(
      state.currentLanguage === 'pt' ? `Não encontrado: ${code}` : `Not found: ${code}`,
      false
    );
  } else {
    showScannerBanner(code, true);
  }
}

export async function openCameraScanner({ onDetected, continuous = false, title = '' } = {}) {
  const modal = document.getElementById('camera-scanner-modal');
  const video = document.getElementById('camera-scanner-video');
  const titleEl = document.getElementById('camera-scanner-title');
  const torchBtn = document.getElementById('btn-camera-torch');
  if (!modal || !video) return;

  closeCameraScanner();
  bindScannerModalControls();

  activeSession.continuous = Boolean(continuous);
  activeSession.onDetected = onDetected || null;
  activeSession.lastCode = '';
  activeSession.lastCodeAt = 0;

  const pt = state.currentLanguage === 'pt';
  if (titleEl) {
    titleEl.textContent = title || (pt ? 'Leitor de Código de Barras (Câmera)' : 'Camera Barcode Scanner');
  }
  setScannerStatus(pt ? 'Abrindo câmera traseira...' : 'Opening rear camera...');
  setScannerEngineBadge('...');

  if (!modal.open) modal.showModal();

  if (!navigator.mediaDevices?.getUserMedia) {
    setScannerStatus(
      pt
        ? 'Câmera indisponível neste navegador (verifique HTTPS e permissões).'
        : 'Camera unavailable in this browser (check HTTPS and permissions).'
    );
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
  } catch (_) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (err) {
      setScannerStatus(
        pt ? `Permissão de câmera negada ou erro: ${err.message}` : `Camera permission denied or error: ${err.message}`
      );
      return;
    }
  }

  if (!modal.open) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  activeSession.stream = stream;
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => {});

  const track = stream.getVideoTracks?.()?.[0];
  const caps = track?.getCapabilities ? track.getCapabilities() : {};
  if (torchBtn) {
    torchBtn.style.display = caps?.torch ? 'inline-flex' : 'none';
  }

  // Try native BarcodeDetector first
  let nativeDetector = null;
  if ('BarcodeDetector' in window) {
    try {
      const desired = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
      let supported = desired;
      if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
        const available = await window.BarcodeDetector.getSupportedFormats();
        supported = desired.filter((f) => available.includes(f));
      }
      if (supported.length > 0) {
        nativeDetector = new window.BarcodeDetector({ formats: supported });
      }
    } catch (_) {
      nativeDetector = null;
    }
  }

  if (nativeDetector) {
    setScannerEngineBadge('BarcodeDetector');
    setScannerStatus(
      continuous
        ? pt
          ? 'Aponte para os códigos de barras — leitura contínua ativa'
          : 'Point at barcodes — continuous scanning active'
        : pt
          ? 'Aponte a câmera para o código de barras'
          : 'Point camera at a barcode'
    );

    const tickNative = async () => {
      if (!activeSession.stream || !modal.open) return;
      try {
        if (video.readyState >= 2) {
          const hits = await nativeDetector.detect(video);
          if (hits && hits.length > 0 && hits[0].rawValue) {
            await handleRawCameraHit(hits[0].rawValue);
            if (!activeSession.continuous || !modal.open) return;
          }
        }
      } catch (_) {}
      activeSession.timerId = setTimeout(tickNative, 150);
    };
    activeSession.timerId = setTimeout(tickNative, 150);
    return;
  }

  // Offline bundled ZXing fallback (iOS Safari, Firefox, Desktop browsers without BarcodeDetector)
  try {
    setScannerEngineBadge('ZXing');
    setScannerStatus(pt ? 'Carregando leitor offline...' : 'Loading offline decoder...');
    const ZXing = await loadZXingLibrary();
    if (!modal.open || !activeSession.stream) return;

    const hints = new Map();
    if (ZXing.DecodeHintType && ZXing.BarcodeFormat) {
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.UPC_E,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.ITF,
        ZXing.BarcodeFormat.QR_CODE
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    }

    const reader = new ZXing.BrowserMultiFormatReader(hints, 200);
    activeSession.zxingReader = reader;
    setScannerStatus(
      continuous
        ? pt
          ? 'Aponte para os códigos de barras — leitura contínua ativa'
          : 'Point at barcodes — continuous scanning active'
        : pt
          ? 'Aponte a câmera para o código de barras'
          : 'Point camera at a barcode'
    );

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tickZxing = () => {
      if (!activeSession.stream || !modal.open) return;
      try {
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const lumSource = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
          const binBitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lumSource));
          const result = reader.decodeWithState ? reader.decodeWithState(binBitmap) : reader.decode(binBitmap);
          if (result) {
            const text = typeof result.getText === 'function' ? result.getText() : result.text;
            if (text) {
              handleRawCameraHit(text);
              if (!activeSession.continuous || !modal.open) return;
            }
          }
        }
      } catch (_) {
        // NotFoundException on frames without a barcode is expected
      }
      activeSession.timerId = setTimeout(tickZxing, 180);
    };
    activeSession.timerId = setTimeout(tickZxing, 180);
  } catch (err) {
    setScannerStatus(err.message);
  }
}

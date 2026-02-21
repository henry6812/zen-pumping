import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const STORAGE_KEY = 'zen_pumping_v2';
const MILK_RECORDS_STORAGE_KEY = 'zen_pumping_records_v1';

const DEFAULT_SETTINGS = {
  s1Min: '2',
  s1Alarm: '3',
  s1Sound: 'bell',
  s1OnlyFirst: true,
  s2Min: '15',
  s2Alarm: '5',
  s2Sound: 'alert',
  s3Min: '5',
  s3Alarm: '3',
  s3Sound: 'wood',
  totalRounds: '2',
  volume: '50',
};

// 將秒數格式化為 mm:ss 顯示字串。
function formatClock(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 從 localStorage 載入產量紀錄，若資料無效則回傳空陣列。
function loadMilkRecordsFromStorage() {
  try {
    const raw = localStorage.getItem(MILK_RECORDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (error) {
    return [];
  }
}

function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [isRunning, setIsRunning] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [masterSequence, setMasterSequence] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalSecondsLeft, setTotalSecondsLeft] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [startTimeLabel, setStartTimeLabel] = useState('--:--');
  const [etaLabel, setEtaLabel] = useState('--:--');
  const [modal, setModal] = useState({ active: false, title: '階段切換' });
  const [milkInput, setMilkInput] = useState({ left: '', right: '' });
  const [milkRecords, setMilkRecords] = useState(loadMilkRecordsFromStorage);

  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const masterSequenceRef = useRef(masterSequence);
  const currentIdxRef = useRef(currentIdx);
  const timeLeftRef = useRef(timeLeft);
  const totalSecondsLeftRef = useRef(totalSecondsLeft);
  const stageDeadlineRef = useRef(0);
  const totalDeadlineRef = useRef(0);
  const playToneRef = useRef(() => {});
  const showModalRef = useRef(() => {});
  const hideModalRef = useRef(() => {});
  const finishRef = useRef(() => {});

  useEffect(() => {
    masterSequenceRef.current = masterSequence;
  }, [masterSequence]);

  useEffect(() => {
    currentIdxRef.current = currentIdx;
  }, [currentIdx]);

  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  useEffect(() => {
    totalSecondsLeftRef.current = totalSecondsLeft;
  }, [totalSecondsLeft]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      setSettings((prev) => ({
        ...prev,
        s1Min: d.s1m ?? prev.s1Min,
        s1Alarm: d.s1a ?? prev.s1Alarm,
        s1OnlyFirst: d.s1o ?? prev.s1OnlyFirst,
        s2Min: d.s2m ?? prev.s2Min,
        s2Alarm: d.s2a ?? prev.s2Alarm,
        s3Min: d.s3m ?? prev.s3Min,
        s3Alarm: d.s3a ?? prev.s3Alarm,
        totalRounds: d.tr ?? prev.totalRounds,
        volume: d.vl ?? prev.volume,
      }));
    } catch (error) {
      // Ignore corrupted localStorage payload.
    }
  }, []);

  useEffect(() => {
    if (!isRunning) return undefined;

    const now = Date.now();
    stageDeadlineRef.current = now + timeLeftRef.current * 1000;
    totalDeadlineRef.current = now + totalSecondsLeftRef.current * 1000;

    timerRef.current = setInterval(() => {
      const tickNow = Date.now();
      const stageLeft = Math.max(0, Math.ceil((stageDeadlineRef.current - tickNow) / 1000));
      const totalLeft = Math.max(0, Math.ceil((totalDeadlineRef.current - tickNow) / 1000));

      if (stageLeft !== timeLeftRef.current) {
        setTimeLeft(stageLeft);
      }
      if (totalLeft !== totalSecondsLeftRef.current) {
        setTotalSecondsLeft(totalLeft);
      }

      if (stageLeft > 0) return;

      const nextIdx = currentIdxRef.current + 1;
      const sequence = masterSequenceRef.current;

      if (nextIdx < sequence.length) {
        const nextTask = sequence[nextIdx];
        setCurrentIdx(nextIdx);
        currentIdxRef.current = nextIdx;
        setTimeLeft(nextTask.sec);
        timeLeftRef.current = nextTask.sec;
        stageDeadlineRef.current = tickNow + nextTask.sec * 1000;

        if (nextTask.type === 'alarm') {
          playToneRef.current(nextTask.sound, nextTask.sec);
          showModalRef.current(nextTask.label);
        } else {
          hideModalRef.current();
        }
      } else {
        setTotalSecondsLeft(0);
        totalSecondsLeftRef.current = 0;
        stageDeadlineRef.current = 0;
        totalDeadlineRef.current = 0;
        finishRef.current();
      }
    }, 250);

    return () => {
      clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [isRunning]);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(MILK_RECORDS_STORAGE_KEY, JSON.stringify(milkRecords));
  }, [milkRecords]);

  const currentTask = masterSequence[currentIdx];
  const stepLabel = masterSequence.length
    ? `${Math.min(currentIdx + 1, masterSequence.length)} / ${masterSequence.length}`
    : '0 / 0';

  const stageName = useMemo(() => {
    if (isFinished) return '程序結束';
    if (currentTask) return currentTask.label;
    return 'READY';
  }, [currentTask, isFinished]);

  const displayTimer = isFinished ? 'DONE' : formatClock(timeLeft);
  const displayTotalMinutes = totalSeconds ? Math.ceil(totalSeconds / 60) : '--';
  const progressPercent = totalSeconds > 0 ? ((totalSeconds - totalSecondsLeft) / totalSeconds) * 100 : 0;

  const hasStarted = isFinished || masterSequence.length > 0 || currentIdx > 0 || timeLeft > 0;
  const mainBtnLabel = isRunning ? '暫停' : hasStarted ? '繼續' : '開始計時';

  // 延遲建立並快取 AudioContext，避免重複初始化。
  function getAudioContext() {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  }

  // 依音效類型播放指定秒數提示音，並嘗試觸發裝置震動。
  function playTone(type, duration) {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    if (navigator.vibrate) {
      navigator.vibrate(Array.from({ length: Math.max(1, duration) }, () => 300));
    }

    const vol = (Number(settings.volume) || 0) / 100;
    const now = audioCtx.currentTime;

    for (let i = 0; i < duration; i += 1) {
      const beat = now + i;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(vol, beat);

      if (type === 'bell') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, beat);
        gain.gain.exponentialRampToValueAtTime(0.01, beat + 0.8);
      } else if (type === 'wood') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, beat);
        gain.gain.exponentialRampToValueAtTime(0.01, beat + 0.4);
      } else {
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, beat);
        gain.gain.exponentialRampToValueAtTime(0.01, beat + 0.5);
      }

      osc.start(beat);
      osc.stop(beat + 0.9);
    }
  }

  // 依照目前設定組出完整 A/B/C 階段執行序列（含 alarm 任務）。
  function buildSequence() {
    const rounds = Number.parseInt(settings.totalRounds, 10) || 1;
    const s1 = {
      min: Number.parseInt(settings.s1Min, 10) || 0,
      alarm: Number.parseInt(settings.s1Alarm, 10) || 0,
      sound: settings.s1Sound,
      onlyFirst: settings.s1OnlyFirst,
      name: '促乳階段 (A)',
    };
    const s2 = {
      min: Number.parseInt(settings.s2Min, 10) || 0,
      alarm: Number.parseInt(settings.s2Alarm, 10) || 0,
      sound: settings.s2Sound,
      name: '擠乳階段 (B)',
    };
    const s3 = {
      min: Number.parseInt(settings.s3Min, 10) || 0,
      alarm: Number.parseInt(settings.s3Alarm, 10) || 0,
      sound: settings.s3Sound,
      name: '休息階段 (C)',
    };

    const list = [];

    for (let r = 0; r < rounds; r += 1) {
      if ((r === 0 || !s1.onlyFirst) && s1.min > 0) {
        list.push({ type: 'timer', label: s1.name, sec: s1.min * 60 });
        if (s1.alarm > 0) {
          list.push({ type: 'alarm', label: `${s1.name} 完成`, sec: s1.alarm, sound: s1.sound });
        }
      }

      if (s2.min > 0) {
        list.push({ type: 'timer', label: s2.name, sec: s2.min * 60 });
        if (s2.alarm > 0) {
          list.push({ type: 'alarm', label: `${s2.name} 完成`, sec: s2.alarm, sound: s2.sound });
        }
      }

      if (s3.min > 0) {
        list.push({ type: 'timer', label: s3.name, sec: s3.min * 60 });
        if (s3.alarm > 0) {
          list.push({ type: 'alarm', label: `${s3.name} 完成`, sec: s3.alarm, sound: s3.sound });
        }
      }
    }

    return list;
  }

  // 將目前循環設定寫入 localStorage。
  function saveToStorage() {
    const data = {
      s1m: settings.s1Min,
      s1a: settings.s1Alarm,
      s1o: settings.s1OnlyFirst,
      s2m: settings.s2Min,
      s2a: settings.s2Alarm,
      s3m: settings.s3Min,
      s3a: settings.s3Alarm,
      tr: settings.totalRounds,
      vl: settings.volume,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // 初始化一次新的計時流程，計算總時長、開始時間與 ETA。
  function init() {
    const sequence = buildSequence();
    if (!sequence.length) return false;

    saveToStorage();
    setIsFinished(false);
    hideModal();
    setMasterSequence(sequence);
    setCurrentIdx(0);
    currentIdxRef.current = 0;
    setTimeLeft(sequence[0].sec);
    timeLeftRef.current = sequence[0].sec;

    const total = sequence.reduce((acc, item) => acc + item.sec, 0);
    setTotalSeconds(total);
    setTotalSecondsLeft(total);
    totalSecondsLeftRef.current = total;
    stageDeadlineRef.current = 0;
    totalDeadlineRef.current = 0;

    const now = new Date();
    setStartTimeLabel(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    const eta = new Date(now.getTime() + total * 1000);
    setEtaLabel(eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    return true;
  }

  // 開始計時（啟用 interval 流程）。
  function start() {
    setIsRunning(true);
  }

  // 暫停計時（停止 interval 流程）。
  function pause() {
    setIsRunning(false);
  }

  // 所有任務結束時收尾：暫停並顯示完成提示。
  function finish() {
    pause();
    setIsFinished(true);
    showModal('全部完成');
  }

  // 將計時器與畫面狀態重設回初始值。
  function reset() {
    pause();
    hideModal();
    setIsFinished(false);
    setMasterSequence([]);
    setCurrentIdx(0);
    currentIdxRef.current = 0;
    setTimeLeft(0);
    timeLeftRef.current = 0;
    setTotalSeconds(0);
    setTotalSecondsLeft(0);
    totalSecondsLeftRef.current = 0;
    stageDeadlineRef.current = 0;
    totalDeadlineRef.current = 0;
    setStartTimeLabel('--:--');
    setEtaLabel('--:--');
  }

  // 主按鈕行為：在開始/暫停/繼續之間切換，必要時先初始化。
  function togglePlay() {
    if (isRunning) {
      pause();
      return;
    }

    if (!masterSequence.length && timeLeft === 0 && !isFinished) {
      const ready = init();
      if (!ready) return;
    }

    if (isFinished) {
      const ready = init();
      if (!ready) return;
    }

    start();
  }

  // 顯示階段切換/完成提示 modal。
  function showModal(title) {
    setModal({ active: true, title });
  }

  // 隱藏 modal 並還原預設標題。
  function hideModal() {
    setModal({ active: false, title: '階段切換' });
  }

  // 更新循環設定欄位（通用 setter）。
  function handleInputChange(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  // 更新左乳/右乳輸入欄位。
  function handleMilkInputChange(side, value) {
    setMilkInput((prev) => ({ ...prev, [side]: value }));
  }

  // 送出單次產量紀錄，附上送出時間並加入清單最前面。
  function submitMilkRecord(event) {
    event.preventDefault();
    const left = Number.parseFloat(milkInput.left) || 0;
    const right = Number.parseFloat(milkInput.right) || 0;
    if (left <= 0 && right <= 0) return;

    const record = {
      id: `${Date.now()}-${Math.random()}`,
      left,
      right,
      submittedAt: new Date().toLocaleString('zh-TW', { hour12: false }),
    };

    setMilkRecords((prev) => [record, ...prev]);
    setMilkInput({ left: '', right: '' });
  }

  // 刪除單筆產量紀錄（含確認視窗）。
  function handleDeleteMilkRecord(recordId) {
    const confirmed = window.confirm('確定要刪除此筆產量紀錄嗎？');
    if (!confirmed) return;
    setMilkRecords((prev) => prev.filter((item) => item.id !== recordId));
  }

  // 將目前產量紀錄匯出為 CSV 並觸發下載。
  function exportMilkRecordsCsv() {
    if (!milkRecords.length) return;
    const header = ['submitted_at', 'left_ml', 'right_ml', 'total_ml'];
    const rows = milkRecords.map((item) => [item.submittedAt, item.left, item.right, item.left + item.right]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((value) => {
            const str = String(value ?? '');
            const escaped = str.replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(',')
      )
      .join('\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.href = url;
    link.download = `milk-records-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    playToneRef.current = playTone;
    showModalRef.current = showModal;
    hideModalRef.current = hideModal;
    finishRef.current = finish;
  });

  return (
    <div className="zen-app-shell">
      <div className={`stage-modal ${modal.active ? 'active' : ''}`}>
        <div className="modal-inner">
          <div className="modal-icon">🔔</div>
          <h2 className="modal-title">{modal.title}</h2>
          <p className="modal-body">請準備切換至下一階段</p>
          <div className="modal-countdown">鈴聲播放中...</div>
        </div>
      </div>

      <main className="zen-main">
        <header className="zen-header">
          <h1>Zen Pumping</h1>
          <p>Japanese Modern Design / Efficient Logic</p>
        </header>

        <section className="card-zen display-card">
          <div className="current-stage-name">{stageName}</div>
          <div className="timer-display">{displayTimer}</div>

          <div className="progress-container">
            <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }} />
          </div>

          <div className="stats-grid">
            <div>START / <span>{startTimeLabel}</span></div>
            <div className="text-right">TOTAL / <span>{displayTotalMinutes}</span> min</div>
            <div className="eta">ETA / <span>{etaLabel}</span></div>
            <div className="step">STEP / <span>{stepLabel}</span></div>
          </div>
        </section>

        <div className="actions">
          <button type="button" className="btn-oak main-btn" onClick={togglePlay}>{mainBtnLabel}</button>
          <button type="button" className="card-zen reset-btn" onClick={reset}>重設</button>
        </div>

        <section className="card-zen config-card">
          <h2>Configuration / 循環設定</h2>

          <div className="stage-block">
            <div className="stage-title-row">
              <span>A. 促乳階段</span>
              <select value={settings.s1Sound} onChange={(e) => handleInputChange('s1Sound', e.target.value)}>
                <option value="bell">清脆風鈴</option>
                <option value="wood">禪意木魚</option>
                <option value="alert">標準提示音</option>
              </select>
            </div>
            <div className="input-grid">
              <label>
                <input
                  type="number"
                  className="input-zen"
                  value={settings.s1Min}
                  onChange={(e) => handleInputChange('s1Min', e.target.value)}
                />
                <span>min</span>
              </label>
              <label>
                <input
                  type="number"
                  className="input-zen"
                  value={settings.s1Alarm}
                  onChange={(e) => handleInputChange('s1Alarm', e.target.value)}
                />
                <span>響鈴 (sec)</span>
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.s1OnlyFirst}
                onChange={(e) => handleInputChange('s1OnlyFirst', e.target.checked)}
              />
              <span>僅在第一輪執行 A 階段</span>
            </label>
          </div>

          <div className="stage-block with-top-border">
            <div className="stage-title-row">
              <span>B. 擠乳階段</span>
              <select value={settings.s2Sound} onChange={(e) => handleInputChange('s2Sound', e.target.value)}>
                <option value="bell">清脆風鈴</option>
                <option value="wood">禪意木魚</option>
                <option value="alert">標準提示音</option>
              </select>
            </div>
            <div className="input-grid">
              <label>
                <input
                  type="number"
                  className="input-zen"
                  value={settings.s2Min}
                  onChange={(e) => handleInputChange('s2Min', e.target.value)}
                />
                <span>min</span>
              </label>
              <label>
                <input
                  type="number"
                  className="input-zen"
                  value={settings.s2Alarm}
                  onChange={(e) => handleInputChange('s2Alarm', e.target.value)}
                />
                <span>響鈴 (sec)</span>
              </label>
            </div>
          </div>

          <div className="stage-block with-top-border">
            <div className="stage-title-row">
              <span>C. 休息階段</span>
              <select value={settings.s3Sound} onChange={(e) => handleInputChange('s3Sound', e.target.value)}>
                <option value="bell">清脆風鈴</option>
                <option value="wood">禪意木魚</option>
                <option value="alert">標準提示音</option>
              </select>
            </div>
            <div className="input-grid">
              <label>
                <input
                  type="number"
                  className="input-zen"
                  value={settings.s3Min}
                  onChange={(e) => handleInputChange('s3Min', e.target.value)}
                />
                <span>min</span>
              </label>
              <label>
                <input
                  type="number"
                  className="input-zen"
                  value={settings.s3Alarm}
                  onChange={(e) => handleInputChange('s3Alarm', e.target.value)}
                />
                <span>響鈴 (sec)</span>
              </label>
            </div>
          </div>

          <div className="footer-settings">
            <div className="rounds">
              <span>總執行輪數</span>
              <input
                type="number"
                className="input-zen"
                value={settings.totalRounds}
                onChange={(e) => handleInputChange('totalRounds', e.target.value)}
              />
            </div>

            <div className="volume-wrap">
              <div className="volume-meta">
                <span>Volume</span>
                <span>{settings.volume}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.volume}
                onChange={(e) => handleInputChange('volume', e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="card-zen milk-card">
          <div className="milk-card-header">
            <h2>Milk Output Log / 產量紀錄</h2>
            <button type="button" className="milk-export-btn" onClick={exportMilkRecordsCsv} disabled={!milkRecords.length}>
              匯出 CSV
            </button>
          </div>

          <form className="milk-form" onSubmit={submitMilkRecord}>
            <label className="milk-input-group">
              <span>左乳 (ml)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="input-zen milk-input"
                value={milkInput.left}
                onChange={(e) => handleMilkInputChange('left', e.target.value)}
                placeholder="0"
              />
            </label>

            <label className="milk-input-group">
              <span>右乳 (ml)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                className="input-zen milk-input"
                value={milkInput.right}
                onChange={(e) => handleMilkInputChange('right', e.target.value)}
                placeholder="0"
              />
            </label>

            <button type="submit" className="btn-oak milk-submit-btn">送出紀錄</button>
          </form>

          {milkRecords.length === 0 ? (
            <p className="milk-empty">尚無紀錄</p>
          ) : (
            <ul className="milk-record-list">
              {milkRecords.map((item) => (
                <li key={item.id} className="milk-record-item">
                  <button
                    type="button"
                    className="milk-record-delete-btn"
                    onClick={() => handleDeleteMilkRecord(item.id)}
                    aria-label="刪除紀錄"
                  >
                    X
                  </button>
                  <div className="milk-record-time">{item.submittedAt}</div>
                  <div className="milk-record-values">
                    <span>左乳: {item.left} ml</span>
                    <span>右乳: {item.right} ml</span>
                    <span>總量: {item.left + item.right} ml</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;

/* ================================================================
   APPLICATION STATE - 13 SETS READY
================================================================ */
let currentSet    = null;
let questions     = [];
let qi            = 0;
let correctCount  = 0;
let wrongCount    = 0;
let wrongWords    = [];
let quizMode      = 'mcq';
let directionMode = 'random';
let quizDirection = 'kr2en';
let soundOn       = true;
let isWeakReview  = false;
let isPinnedQuiz  = false;
let audioCtx      = null;
let questionLimit = 0;

/* ================================================================
   STORAGE HELPERS
================================================================ */
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('kq_' + key);
      return v != null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem('kq_' + key, JSON.stringify(val)); } catch {}
  },
};

/* ================================================================
   SET PROGRESS TRACKING
================================================================ */
function getSetProgress(id) {
  return store.get(`progress_${id}`, { correct: 0, total: 0, mastered: 0 });
}

function updateSetProgress(id, correct, total) {
  const stats = getSetProgress(id);
  stats.correct += correct;
  stats.total += total;
  stats.mastered = stats.total > 0 ? Math.round(stats.correct / stats.total * 100) : 0;
  store.set(`progress_${id}`, stats);
}

/* ================================================================
   WEAK-WORD HELPERS
================================================================ */
function getWeakWords()     { return store.get('weak', {}); }
function saveWeakWords(obj) { store.set('weak', obj); }

function addWeakWord(word) {
  const ww = getWeakWords();
  ww[word.k] = { ...word, count: (ww[word.k]?.count ?? 0) + 1 };
  saveWeakWords(ww);
}

function removeWeakWord(key) {
  const ww = getWeakWords();
  delete ww[key];
  saveWeakWords(ww);
}

/* ================================================================
   📌 PINNED-WORD HELPERS
   - Pinned words are INDEPENDENT from weak words
   - Manual pin = manual unpin only
   - Weak words still auto-remove on correct answer as before
================================================================ */
function getPinnedWords()     { return store.get('pinned', {}); }
function savePinnedWords(obj) { store.set('pinned', obj); }

function isPinned(wordKey) {
  return !!getPinnedWords()[wordKey];
}

function pinWord(word) {
  const pw = getPinnedWords();
  if (!pw[word.k]) {
    pw[word.k] = { ...word, pinnedAt: Date.now() };
    savePinnedWords(pw);
    showToast('📌 Pinned: ' + word.k);
  }
}

function unpinWord(wordKey) {
  const pw = getPinnedWords();
  if (pw[wordKey]) {
    delete pw[wordKey];
    savePinnedWords(pw);
    showToast('📌 Unpinned');
  }
}

function togglePin(word) {
  if (isPinned(word.k)) {
    unpinWord(word.k);
    return false; // now unpinned
  } else {
    pinWord(word);
    return true; // now pinned
  }
}

/* ================================================================
   PIN CURRENT QUIZ QUESTION (called from quiz screen buttons)
================================================================ */
function togglePinCurrentQuestion() {
  const q = questions[qi];
  if (!q) return;
  const nowPinned = togglePin(q);
  updateQuizPinUI(nowPinned);
  // Also refresh study pin icons if present
  const existingBtn = document.querySelector(`.vocab-item[data-key="${CSS.escape(q.k)}"] .btn-pin`);
  if (existingBtn) setPinBtnState(existingBtn, nowPinned);
}

function updateQuizPinUI(pinned) {
  // Top meta pin button (always visible)
  const topBtn = document.getElementById('btn-pin-quiz');
  if (topBtn) {
    topBtn.classList.toggle('pinned', pinned);
    topBtn.title = pinned ? 'Unpin this word' : 'Pin this word';
  }
  // After-answer pin button
  const afterIcon  = document.getElementById('pin-after-icon');
  const afterLabel = document.getElementById('pin-after-label');
  if (afterIcon)  afterIcon.textContent  = pinned ? '📌' : '📌';
  if (afterLabel) afterLabel.textContent = pinned ? 'Unpin this word' : 'Pin this word';
  const afterBtn = document.getElementById('btn-pin-after');
  if (afterBtn) afterBtn.classList.toggle('pinned', pinned);
}

function refreshQuizPinUI() {
  const q = questions[qi];
  if (!q) return;
  const pinned = isPinned(q.k);
  updateQuizPinUI(pinned);
}

/* ================================================================
   PIN BANNER ON HUB
================================================================ */
function updatePinnedBanner() {
  const pw    = getPinnedWords();
  const cnt   = Object.keys(pw).length;
  const banner = document.getElementById('pinned-banner');
  if (cnt > 0) {
    banner.style.display = 'flex';
    document.getElementById('pinned-count-hub').textContent = cnt;
    document.getElementById('pinned-sub').textContent       = `${cnt} word${cnt !== 1 ? 's' : ''} pinned`;
  } else {
    banner.style.display = 'none';
  }
}

/* ================================================================
   START PINNED STUDY (study mode, read-only browse)
================================================================ */
function startPinnedStudy() {
  const pw    = getPinnedWords();
  const words = Object.values(pw);
  if (words.length === 0) { showToast('No pinned words yet!'); return; }

  currentSet = { id: 0, name: '📌 Pinned Words', vocab: words, color: '#f0c060' };
  showScreen('study-screen');
  document.getElementById('study-title').textContent = '📌 Pinned Words';
  document.getElementById('study-search').value = '';
  renderStudyList(words);
}

/* ================================================================
   START PINNED QUIZ
================================================================ */
function startPinnedQuiz() {
  const pw    = getPinnedWords();
  const words = Object.values(pw);
  if (words.length === 0) { showToast('No pinned words yet!'); return; }

  currentSet   = { id: 0, name: '📌 Pinned Words Quiz', vocab: words, color: '#f0c060' };
  isWeakReview = false;
  isPinnedQuiz = true;
  questions    = buildQuestionPool(words);
  resetQuizState();
  initQuizScreen();
  loadQuestion();
}

/* ================================================================
   LEADERBOARD HELPERS
================================================================ */
function getLeaderboard()   { return store.get('lb', []); }
function saveLeaderboard(a) { store.set('lb', a); }

/* ================================================================
   STREAK & SCORE HELPERS
================================================================ */
function getStreak() { return store.get('streak', { count: 0, lastDate: '' }); }

function updateStreak() {
  const s         = getStreak();
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  if (s.lastDate === today) return s.count;
  const count = s.lastDate === yesterday ? s.count + 1 : 1;
  store.set('streak', { count, lastDate: today });
  return count;
}

function getTotalScore()    { return store.get('totalScore', 0); }
function addTotalScore(pts) { store.set('totalScore', getTotalScore() + pts); }

/* ================================================================
   DYNAMIC TOTAL WORD COUNT
================================================================ */
function getTotalWordCount() {
  let total = 0;
  for (let i = 1; i <= 13; i++) {
    if (SETS[i] && SETS[i].vocab) total += SETS[i].vocab.length;
  }
  return total;
}

/* ================================================================
   HUB META
================================================================ */
function updateHubMeta() {
  const s       = getStreak();
  const studied = store.get('studied', 0);
  const total   = getTotalWordCount();

  document.getElementById('streak-txt').textContent      = `${s.count} day streak`;
  document.getElementById('total-score-txt').textContent = `${getTotalScore()} pts`;
  document.getElementById('hub-subtitle').textContent    = `13 quiz sets · ${total}+ words · ${studied} answered`;
}

/* ================================================================
   INITIALISATION
================================================================ */
function init() {
  buildHub();
  updateHubMeta();
}

function buildHub() {
  const grid = document.getElementById('sets-grid');
  grid.innerHTML = '';

  for (let i = 1; i <= 13; i++) {
    const m        = SET_META[i];
    const progress = getSetProgress(i);
    const card     = document.createElement('div');
    card.className = 'set-card';
    card.setAttribute('data-id', i);
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      <span class="set-card__emoji" aria-hidden="true">${m.emoji}</span>
      <div class="set-card__name">${m.name}</div>
      <div class="set-card__desc">${m.desc}</div>
      <div class="set-card__meta">
        <span class="set-card__count" style="color:${m.color}">${SETS[i].vocab.length} words</span>
        <div class="set-card__progress">
          <div class="progress-bar-mini">
            <div class="progress-fill-mini" style="width:${progress.mastered}%"></div>
          </div>
          <span class="progress-text">${progress.mastered}%</span>
        </div>
      </div>
      <div class="set-card__actions">
        <button class="btn-set btn-set--study" onclick="startStudy(${i})">📖 Study</button>
        <button class="btn-set btn-set--quiz"  onclick="startSet(${i})" style="background:${m.color};color:#1a1200">🎯 Quiz</button>
      </div>`;
    grid.appendChild(card);
  }

  updatePinnedBanner();
  updateWeakBanner();
}

function updateWeakBanner() {
  const ww     = getWeakWords();
  const cnt    = Object.keys(ww).length;
  const banner = document.getElementById('weak-banner');

  if (cnt > 0) {
    banner.style.display = 'flex';
    document.getElementById('weak-count-hub').textContent = cnt;
    document.getElementById('weak-sub').textContent       = `${cnt} word${cnt !== 1 ? 's' : ''} to review`;
  } else {
    banner.style.display = 'none';
  }
}

/* ================================================================
   STUDY MODE
================================================================ */
function startStudy(id) {
  currentSet = SETS[id];
  showScreen('study-screen');
  document.getElementById('study-title').textContent = currentSet.name;
  document.getElementById('study-search').value = '';
  renderStudyList(currentSet.vocab);
}

function filterStudy() {
  if (!currentSet) return;
  const q = document.getElementById('study-search').value.toLowerCase();
  const filtered = currentSet.vocab.filter(w =>
    w.k.includes(q) || w.en.toLowerCase().includes(q) || (w.r && w.r.toLowerCase().includes(q))
  );
  renderStudyList(filtered);
}

/* ================================================================
   PIN BUTTON STATE HELPER
================================================================ */
function setPinBtnState(btn, pinned) {
  btn.textContent = pinned ? '📌' : '📍';
  btn.classList.toggle('pinned', pinned);
  btn.title = pinned ? 'Unpin this word' : 'Pin this word';
}

/* ================================================================
   RENDER STUDY LIST (with pin buttons)
================================================================ */
function renderStudyList(list) {
  const grid   = document.getElementById('vocab-grid');
  const weakMap = getWeakWords();
  grid.innerHTML = '';
  document.getElementById('study-count').textContent = `${list.length} words`;

  list.forEach(w => {
    const isWeak   = !!weakMap[w.k];
    const pinned   = isPinned(w.k);
    const item     = document.createElement('div');
    item.className = 'vocab-item';
    item.setAttribute('role', 'listitem');
    item.setAttribute('data-key', w.k);

    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
        <span class="vocab-item__korean">${w.k}</span>
        ${isWeak ? '<span class="vocab-item__weak" title="Weak word">🎯</span>' : ''}
      </div>
      <div class="vocab-item__right">
        <div class="vocab-item__english">${w.en}</div>
        <div class="vocab-item__rom">${w.r || ''}</div>
        <div class="vocab-item__pos"><span class="badge badge--${w.pos === 'adverb' ? 'adv' : w.pos}">${w.pos}</span></div>
      </div>
      <div class="vocab-item__btns">
        <button class="btn-speak" onclick="speakKorean('${w.k.replace(/'/g, "\\'")}');event.stopPropagation()" aria-label="Hear ${w.k}">🔊</button>
        <button class="btn-pin ${pinned ? 'pinned' : ''}" data-key="${w.k.replace(/"/g, '&quot;')}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${w.k}" title="${pinned ? 'Unpin' : 'Pin'} this word">${pinned ? '📌' : '📍'}</button>
      </div>`;

    // Pin button handler
    const pinBtn = item.querySelector('.btn-pin');
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowPinned = togglePin(w);
      setPinBtnState(pinBtn, nowPinned);
      updatePinnedBanner();
    });

    grid.appendChild(item);
  });
}

/* ================================================================
   QUIZ ENGINE
================================================================ */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuestionPool(vocab) {
  const pool = shuffle(vocab);
  return questionLimit > 0 ? pool.slice(0, questionLimit) : pool;
}

function resetQuizState() {
  qi           = 0;
  correctCount = 0;
  wrongCount   = 0;
  wrongWords   = [];
}

function startSet(id) {
  currentSet   = SETS[id];
  isWeakReview = false;
  isPinnedQuiz = false;
  questions    = buildQuestionPool(currentSet.vocab);
  resetQuizState();
  initQuizScreen();
  loadQuestion();
}

function startWeakReview() {
  const ww = getWeakWords();
  const words = Object.values(ww);
  if (words.length === 0) {
    showToast('No weak words yet! Complete a quiz first.');
    return;
  }
  currentSet   = { id: 0, name: '🎯 Weak Word Review', vocab: words, color: '#f05a7e' };
  isWeakReview = true;
  isPinnedQuiz = false;
  questions    = buildQuestionPool(words);
  resetQuizState();
  initQuizScreen();
  loadQuestion();
}

function initQuizScreen() {
  showScreen('quiz-screen');
  document.getElementById('quiz-set-label').textContent = currentSet.name;
  document.getElementById('progress-fill').style.background =
    `linear-gradient(90deg, ${currentSet.color}, rgba(255,255,255,.5))`;
  document.getElementById('q-word').style.color = currentSet.color;

  document.getElementById('mode-mcq').classList.toggle('active', quizMode === 'mcq');
  document.getElementById('mode-type').classList.toggle('active', quizMode === 'type');
  document.getElementById('q-limit').value = String(questionLimit);

  // Hide pin-after row until an answer is given
  document.getElementById('quiz-pin-row').style.display = 'none';
}

/* ================================================================
   MODE / DIRECTION / LIMIT CONTROLS
================================================================ */
function setMode(m) {
  quizMode = m;
  document.getElementById('mode-mcq').classList.toggle('active', m === 'mcq');
  document.getElementById('mode-type').classList.toggle('active', m === 'type');
  if (questions.length > 0 && qi < questions.length) loadQuestion();
}

function setDir(d) {
  directionMode = d;
  document.getElementById('dir-random').classList.toggle('active', d === 'random');
  document.getElementById('dir-kr2en').classList.toggle('active', d === 'kr2en');
  document.getElementById('dir-en2kr').classList.toggle('active', d === 'en2kr');
  if (questions.length > 0 && qi < questions.length) loadQuestion();
}

function setQLimit() {
  questionLimit = parseInt(document.getElementById('q-limit').value, 10) || 0;
  if (!currentSet) return;
  questions = buildQuestionPool(currentSet.vocab);
  resetQuizState();
  loadQuestion();
}

/* ================================================================
   LOAD A QUESTION
================================================================ */
function loadQuestion() {
  const total = questions.length;
  const q     = questions[qi];
  if (!q) return;

  // Hide pin-after row for new question
  document.getElementById('quiz-pin-row').style.display = 'none';

  quizDirection = directionMode === 'random'
    ? (Math.random() > 0.5 ? 'kr2en' : 'en2kr')
    : directionMode;

  document.getElementById('stat-question').textContent = `${qi + 1}/${total}`;
  document.getElementById('stat-correct').textContent  = correctCount;
  document.getElementById('stat-wrong').textContent    = wrongCount;
  const answered = correctCount + wrongCount;
  document.getElementById('stat-pct').textContent = answered > 0
    ? `${Math.round(correctCount / answered * 100)}%` : '—';

  document.getElementById('progress-fill').style.width = `${qi / total * 100}%`;

  const dirBadge = document.getElementById('dir-badge');
  const wordEl   = document.getElementById('q-word');

  if (quizDirection === 'kr2en') {
    dirBadge.textContent  = '🇰🇷 → 🇬🇧';
    wordEl.className      = 'q-word';
    wordEl.textContent    = q.k;
    document.getElementById('q-rom').textContent = q.r || '';
  } else {
    dirBadge.textContent  = '🇬🇧 → 🇰🇷';
    wordEl.className      = 'q-word--english';
    wordEl.textContent    = q.en;
    document.getElementById('q-rom').textContent = '';
  }
  document.getElementById('q-speak-hint').style.display = 'block';
  wordEl.style.color = currentSet.color;

  const pos      = (q.pos || 'noun').toLowerCase();
  const posBadge = document.getElementById('pos-badge');
  posBadge.textContent = pos;
  posBadge.className   = `badge badge--${pos === 'adverb' ? 'adv' : pos}`;

  document.getElementById('feedback').textContent = '';
  document.getElementById('btn-next').style.display = 'none';

  // Update top pin button state
  refreshQuizPinUI();

  const pool   = currentSet.vocab.filter(w => quizDirection === 'kr2en' ? w.en !== q.en : w.k !== q.k);
  const wrongs = shuffle(pool).slice(0, 3);

  if (quizMode === 'mcq') {
    document.getElementById('options').style.display  = 'grid';
    document.getElementById('type-wrap').style.display = 'none';
    renderMCQOptions(q, wrongs);
  } else {
    document.getElementById('options').style.display  = 'none';
    document.getElementById('type-wrap').style.display = 'block';
    initTypingInput(q);
  }

  if (soundOn) setTimeout(() => speakCurrentWord(), 300);
}

/* ================================================================
   MCQ
================================================================ */
function renderMCQOptions(q, wrongs) {
  const correctOpt = quizDirection === 'kr2en' ? q.en : q.k;
  const wrongOpts  = wrongs.map(w => quizDirection === 'kr2en' ? w.en : w.k);
  const allOpts    = shuffle([correctOpt, ...wrongOpts]);
  const container  = document.getElementById('options');
  container.innerHTML = '';

  allOpts.forEach(opt => {
    const btn = document.createElement('button');
    btn.className   = 'opt';
    btn.textContent = opt;
    if (quizDirection === 'en2kr') btn.style.fontFamily = 'var(--korean)';
    btn.addEventListener('click', () => handleMCQAnswer(opt, correctOpt, q));
    container.appendChild(btn);
  });
}

function handleMCQAnswer(chosen, correctOpt, q) {
  const buttons = document.querySelectorAll('.opt');
  buttons.forEach(b => { b.disabled = true; });

  const isRight = chosen === correctOpt;
  buttons.forEach(b => {
    if (b.textContent === correctOpt) b.classList.add('correct');
    else if (b.textContent === chosen && !isRight) b.classList.add('wrong');
  });

  recordAnswer(isRight, q, correctOpt);
}

/* ================================================================
   TYPING MODE
================================================================ */
function initTypingInput(q) {
  const input    = document.getElementById('type-input');
  input.value    = '';
  input.className = 'type-input';
  input.disabled  = false;
  input.style.fontFamily  = quizDirection === 'en2kr' ? 'var(--korean)' : 'var(--font)';
  input.placeholder       = quizDirection === 'kr2en' ? 'Type English meaning…' : 'Type Korean word…';
  document.getElementById('type-hint').textContent = '';
  input.onkeydown = (e) => { if (e.key === 'Enter') submitTyping(); };
  setTimeout(() => input.focus(), 100);
}

function submitTyping() {
  const q          = questions[qi];
  const correctAns = quizDirection === 'kr2en' ? q.en : q.k;
  const raw        = document.getElementById('type-input').value.trim();
  const input      = raw.toLowerCase();
  const correct    = correctAns.toLowerCase();

  let isRight = input === correct;
  if (!isRight && correct.length > 4 && input.length === correct.length) {
    let diff = 0;
    for (let i = 0; i < input.length; i++) if (input[i] !== correct[i]) diff++;
    if (diff <= 1) isRight = true;
  }

  const inputEl   = document.getElementById('type-input');
  inputEl.disabled = true;
  inputEl.classList.add(isRight ? 'correct' : 'wrong');

  if (!isRight) document.getElementById('type-hint').textContent = `Answer: ${correctAns}`;
  recordAnswer(isRight, q, correctAns);
}

/* ================================================================
   SHARED ANSWER HANDLING
================================================================ */
function recordAnswer(isRight, q, correctAns) {
  const feedback = document.getElementById('feedback');

  if (isRight) {
    correctCount++;
    playSound('correct');
    store.set('studied', store.get('studied', 0) + 1);
    feedback.textContent = '✓ Correct!';
    feedback.style.color = 'var(--green)';

    // Weak words: auto-remove on correct (unchanged behaviour)
    if (isWeakReview) {
      const ww = getWeakWords();
      if (ww[q.k]) {
        ww[q.k].count--;
        if (ww[q.k].count <= 0) removeWeakWord(q.k);
        else saveWeakWords(ww);
      }
    }
    // Pinned quiz: pinned words are NEVER auto-removed — user must unpin manually

  } else {
    wrongCount++;
    playSound('wrong');
    addWeakWord(q);
    if (!wrongWords.find(w => w.k === q.k)) wrongWords.push(q);
    feedback.textContent = `✗ The answer is: ${correctAns}`;
    feedback.style.color = 'var(--red)';
  }

  document.getElementById('stat-correct').textContent = correctCount;
  document.getElementById('stat-wrong').textContent   = wrongCount;
  const answered = correctCount + wrongCount;
  document.getElementById('stat-pct').textContent = `${Math.round(correctCount / answered * 100)}%`;
  document.getElementById('btn-next').style.display = 'block';

  // Show the pin-after row once an answer is given
  const pinRow = document.getElementById('quiz-pin-row');
  pinRow.style.display = 'flex';
  const pinned = isPinned(q.k);
  const afterBtn   = document.getElementById('btn-pin-after');
  const afterIcon  = document.getElementById('pin-after-icon');
  const afterLabel = document.getElementById('pin-after-label');
  afterBtn.classList.toggle('pinned', pinned);
  afterIcon.textContent  = '📌';
  afterLabel.textContent = pinned ? 'Unpin this word' : 'Pin this word';
}

function nextQuestion() {
  qi++;
  if (qi >= questions.length) showResult();
  else loadQuestion();
}

/* ================================================================
   RESULT SCREEN
================================================================ */
function showResult() {
  showScreen('result-screen');
  const total = questions.length;
  const pct   = Math.round(correctCount / total * 100);

  document.getElementById('result-score').textContent = `${correctCount}/${total}`;
  document.getElementById('result-pct').textContent   = `${pct}% correct`;

  const tiers = [
    [90, '🏆', 'Outstanding! You know your Korean!'],
    [75, '🎉', 'Great job! Keep up the momentum.'],
    [55, '💪', 'Good effort — practice makes perfect!'],
    [35, '📖', "Keep studying — you're making progress."],
    [0,  '🌱', "Review the set and try again — you've got this!"],
  ];
  const [, emoji, msg] = tiers.find(([threshold]) => pct >= threshold);
  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-msg').textContent   = msg;

  setTimeout(() => {
    const fill = document.getElementById('result-acc-fill');
    fill.style.width      = `${pct}%`;
    fill.style.background = pct >= 75 ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : 'var(--red)';
  }, 100);

  if (pct >= 70) launchConfetti();

  addTotalScore(correctCount * 10);
  updateStreak();

  if (!isWeakReview && !isPinnedQuiz && currentSet?.id) {
    updateSetProgress(currentSet.id, correctCount, questions.length);
  }

  document.getElementById('lb-name').value = store.get('lastName', '');

  if (wrongWords.length > 0) {
    const wrongList  = document.getElementById('wrong-list');
    const wrongItems = document.getElementById('wrong-items');
    wrongList.style.display = 'block';
    wrongItems.innerHTML    = '';

    wrongWords.forEach(w => {
      const row = document.createElement('div');
      row.className = 'wrong-item';
      const pinned = isPinned(w.k);
      row.innerHTML = `
        <span class="wrong-item__korean">${w.k}</span>
        <span class="wrong-item__english">${w.en}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn-speak" onclick="speakKorean('${w.k.replace(/'/g, "\\'")}')">🔊</button>
          <button class="btn-pin result-pin ${pinned ? 'pinned' : ''}" data-key="${w.k.replace(/"/g, '&quot;')}" title="${pinned ? 'Unpin' : 'Pin'} this word">${pinned ? '📌' : '📍'}</button>
        </div>`;

      const pinBtn = row.querySelector('.btn-pin');
      pinBtn.addEventListener('click', () => {
        const nowPinned = togglePin(w);
        setPinBtnState(pinBtn, nowPinned);
        updatePinnedBanner();
      });

      wrongItems.appendChild(row);
    });

    document.getElementById('btn-review-missed').style.display = 'inline-block';
  } else {
    document.getElementById('wrong-list').style.display = 'none';
    document.getElementById('btn-review-missed').style.display = 'none';
  }

  updateWeakBanner();
  updatePinnedBanner();
  updateHubMeta();

  // Reset pinned quiz flag
  isPinnedQuiz = false;
}

/* ================================================================
   LEADERBOARD
================================================================ */
function saveToLeaderboard() {
  const name = document.getElementById('lb-name').value.trim();
  if (!name) { showToast('Enter your name first!'); return; }

  store.set('lastName', name);

  const total = questions.length;
  const pct   = Math.round(correctCount / total * 100);
  let lb      = getLeaderboard();

  const alreadyExists = lb.some(e =>
    e.name === name && e.set === currentSet.name && e.pct === pct
  );
  if (alreadyExists) { showToast('⚠️ Score already saved!'); return; }

  lb.push({ name, score: correctCount, total, pct, set: currentSet.name, date: new Date().toLocaleDateString() });
  lb.sort((a, b) => b.pct - a.pct || b.score - a.score);
  saveLeaderboard(lb);
  showToast('🏆 Score saved!');
}

let lbFilter = 'all';

function showLeaderboard() {
  document.body.classList.add('modal-open');
  document.getElementById('lb-modal').classList.remove('hidden');
  renderLeaderboard();
}

function closeLeaderboard() {
  document.body.classList.remove('modal-open');
  document.getElementById('lb-modal').classList.add('hidden');
}

function renderLeaderboard() {
  const lb       = getLeaderboard();
  const tabsEl   = document.getElementById('lb-tabs');
  const filterIds = ['all', ...Array.from({length: 13}, (_, i) => i + 1)];
  const tabLabels = ['All Sets', ...SET_META.slice(1).map(m => `${m.emoji} ${m.name.split(':')[0].trim()}`)];

  tabsEl.innerHTML = '';
  filterIds.forEach((fid, idx) => {
    const btn = document.createElement('button');
    btn.className = `lb-tab${lbFilter === fid ? ' active' : ''}`;
    btn.textContent = tabLabels[idx];
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', lbFilter === fid);
    btn.addEventListener('click', () => { lbFilter = fid; renderLeaderboard(); });
    tabsEl.appendChild(btn);
  });

  const filtered = lbFilter === 'all' ? lb : lb.filter(e => e.set === SETS[lbFilter]?.name);
  const list     = document.getElementById('lb-list');
  list.innerHTML  = '';

  if (filtered.length === 0) {
    list.innerHTML = '<li class="lb-empty">No scores yet. Complete a quiz!</li>';
    return;
  }

  filtered.slice(0, 3).forEach((e, i) => {
    const rank      = i + 1;
    const rankClass = rank === 1 ? 'lb-rank--gold' : rank === 2 ? 'lb-rank--silver' : rank === 3 ? 'lb-rank--bronze' : '';
    const medal     = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
    const li        = document.createElement('li');
    li.className    = 'lb-item';
    li.innerHTML    = `
      <span class="lb-rank ${rankClass}" aria-label="Rank ${rank}">${medal}</span>
      <div class="lb-info">
        <div class="lb-name">${e.name}</div>
        <div class="lb-detail">${e.set} · ${e.date}</div>
      </div>
      <span class="lb-score">${e.score}/${e.total}</span>`;
    list.appendChild(li);
  });
}

/* ================================================================
   SPEECH SYNTHESIS
================================================================ */
function speakCurrentWord() {
  if (!questions[qi]) return;
  const q = questions[qi];
  if (quizDirection === 'kr2en') speakKorean(q.k);
  else speakText(q.en, 'en-US');
}

function speakKorean(text) { speakText(text, 'ko-KR'); }

function speakText(text, lang) {
  if (!soundOn || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u   = new SpeechSynthesisUtterance(text);
  u.lang    = lang;
  u.rate    = 0.85;
  u.pitch   = 1;
  window.speechSynthesis.speak(u);
}

/* ================================================================
   SOUND EFFECTS
================================================================ */
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  if (!soundOn) return;
  try {
    const ctx  = getAudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === 'correct') {
      osc.frequency.setValueAtTime(523, ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } else {
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.setValueAtTime(220, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {}
}

function toggleSound() {
  soundOn = !soundOn;
  const btn = document.getElementById('btn-sound');
  btn.textContent = soundOn ? '🔊' : '🔇';
  btn.classList.toggle('on', soundOn);
  btn.setAttribute('aria-pressed', soundOn);
}

/* ================================================================
   CONFETTI
================================================================ */
function launchConfetti() {
  const colours = ['#5e6ad2','#f0c060','#3ddba4','#f05a7e','#58a6ff','#e91e8c','#64ffda'];
  for (let i = 0; i < 80; i++) {
    setTimeout(() => {
      const el        = document.createElement('div');
      el.className    = 'confetti-piece';
      el.style.left   = `${Math.random() * 100}vw`;
      el.style.background       = colours[Math.floor(Math.random() * colours.length)];
      el.style.animationDuration = `${2 + Math.random() * 2}s`;
      el.style.width  = `${6 + Math.random() * 8}px`;
      el.style.height = `${6 + Math.random() * 8}px`;
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }, i * 30);
  }
}

/* ================================================================
   TOAST
================================================================ */
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity    = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

/* ================================================================
   SCREEN ROUTING
================================================================ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goHub() {
  showScreen('hub-screen');
  updateHubMeta();
  updateWeakBanner();
  updatePinnedBanner();
  buildHub();
}

function retryQuiz() {
  if (isWeakReview)  { startWeakReview(); return; }
  if (isPinnedQuiz)  { startPinnedQuiz(); return; }
  if (currentSet?.id) { startSet(currentSet.id); return; }
  goHub();
}

/* ================================================================
   KEYBOARD SHORTCUTS
================================================================ */
document.addEventListener('keydown', e => {
  const quizEl = document.getElementById('quiz-screen');
  if (!quizEl.classList.contains('active') || quizMode === 'type') return;

  if (e.key === 'ArrowRight' || e.key === ' ') {
    e.preventDefault();
    const nb = document.getElementById('btn-next');
    if (nb.style.display !== 'none') nextQuestion();
  }

  if (['1','2','3','4'].includes(e.key)) {
    const opts = document.querySelectorAll('.opt:not(:disabled)');
    const idx  = parseInt(e.key, 10) - 1;
    if (opts[idx]) opts[idx].click();
  }

  // P key to pin/unpin current question
  if (e.key === 'p' || e.key === 'P') {
    togglePinCurrentQuestion();
  }
});

document.getElementById('lb-modal').addEventListener('click', function(e) {
  if (e.target === this) closeLeaderboard();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeLeaderboard();
});

/* ================================================================
   START APP
================================================================ */
init();
// ── State ───────────────────────────────────────────
let dailyHome = 0;
let dailyAway = 0;
let currentDay = '';
let games = [];
let feedItems = [];
let ws = null;
let reconnectTimer = null;

// ── DOM ─────────────────────────────────────────────
const $homeScore = document.getElementById('home-score');
const $awayScore = document.getElementById('away-score');
const $feedInner = document.getElementById('feed-inner');
const $flashHome = document.getElementById('flash-home');
const $flashAway = document.getElementById('flash-away');
const $infoBtn = document.getElementById('info-btn');
const $infoModal = document.getElementById('info-modal');
const $infoClose = document.getElementById('info-close');
const $infoLiveCount = document.getElementById('info-live-count');
const $infoTotalCount = document.getElementById('info-total-count');
const $infoSports = document.getElementById('info-sports');
const $infoLeagues = document.getElementById('info-leagues');
const $infoResumeRow = document.getElementById('info-resume-row');
const $infoResume = document.getElementById('info-resume');
const $themeToggle = document.getElementById('theme-toggle');
const $winnerOverlay = document.getElementById('winner-overlay');
const $winnerSide = document.getElementById('winner-side');
const $winnerFinalScore = document.getElementById('winner-final-score');
const $winnerLabel = document.getElementById('winner-label');
const $winnerCountdown = document.getElementById('winner-countdown');
const $statsHomeWins = document.getElementById('stats-home-wins');
const $statsAwayWins = document.getElementById('stats-away-wins');
const $statsDraws = document.getElementById('stats-draws');
const $statsHistory = document.getElementById('stats-history');

// ── Tabs ────────────────────────────────────────────
document.getElementById('modal-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('#modal-tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  if (tab.dataset.tab === 'stats') loadStats();
});

// ── Theme ───────────────────────────────────────────
let theme = localStorage.getItem('allscores-theme') || 'dark';
applyTheme(theme);

function applyTheme(t) {
  theme = t;
  document.documentElement.setAttribute('data-theme', t);
  $themeToggle.textContent = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  localStorage.setItem('allscores-theme', t);
}

$themeToggle.addEventListener('click', () => {
  applyTheme(theme === 'dark' ? 'light' : 'dark');
});

// ── Time Ago ────────────────────────────────────────
function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ── Next Game Countdown ─────────────────────────────
function updateResumeCountdown() {
  const upcoming = games
    .filter(g => !g.isLive && g.startTime)
    .map(g => ({ ...g, start: new Date(g.startTime) }))
    .filter(g => g.start > new Date())
    .sort((a, b) => a.start - b.start);

  const liveCount = games.filter(g => g.isLive).length;

  if (liveCount > 0) {
    $infoResumeRow.classList.add('hidden');
    return;
  }

  if (upcoming.length > 0) {
    const diff = upcoming[0].start - new Date();
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    $infoResume.textContent = hrs > 0 ? `~${hrs}h ${mins}m` : `~${mins}m`;
    $infoResumeRow.classList.remove('hidden');
  } else {
    $infoResume.textContent = 'checking schedules...';
    $infoResumeRow.classList.remove('hidden');
  }
}

// ── Day Countdown ───────────────────────────────────
const $infoCountdown = document.getElementById('info-countdown');

function updateDayCountdown() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const diff = midnight - now;
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  $infoCountdown.textContent = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

updateDayCountdown();
setInterval(updateDayCountdown, 1000);

// ── Stats ───────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();

    $statsHomeWins.textContent = data.homeWins;
    $statsAwayWins.textContent = data.awayWins;
    $statsDraws.textContent = data.draws;

    $statsHistory.innerHTML = data.days.map(d => {
      let winnerLabel, winnerClass;
      if (!d.winner) {
        winnerLabel = 'LIVE';
        winnerClass = 'live';
      } else if (d.winner === 'home') {
        winnerLabel = 'HOME';
        winnerClass = 'home';
      } else if (d.winner === 'away') {
        winnerLabel = 'AWAY';
        winnerClass = 'away';
      } else {
        winnerLabel = 'DRAW';
        winnerClass = 'draw';
      }

      const dateStr = formatDate(d.date);
      return `<div class="history-row">
        <span class="history-date">${dateStr}</span>
        <span class="history-score">${d.home} — ${d.away}</span>
        <span class="history-winner ${winnerClass}">${winnerLabel}</span>
      </div>`;
    }).join('');
  } catch (err) {
    $statsHistory.innerHTML = '<p style="color:var(--text-dim);font-size:12px">Failed to load stats</p>';
  }
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

// ── WebSocket ───────────────────────────────────────
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'init' || data.type === 'games') {
      games = data.games || [];
      const liveCount = games.filter(g => g.isLive).length;
      $infoLiveCount.textContent = liveCount;
      $infoTotalCount.textContent = games.length;
      $infoSports.textContent = [...new Set(games.map(g => g.sport))].join(', ') || '—';
      $infoLeagues.textContent = [...new Set(games.map(g => g.league))].join(', ') || '—';
      updateResumeCountdown();

      // Update daily scores from server
      if (data.dailyHome !== undefined) {
        dailyHome = data.dailyHome;
        dailyAway = data.dailyAway;
        currentDay = data.day;
        $homeScore.textContent = dailyHome;
        $awayScore.textContent = dailyAway;
      }
    }

    if (data.type === 'events') {
      for (const event of data.events) {
        addScoreEvent(event);
      }
    }

    if (data.type === 'dayReset') {
      showWinnerAnimation(data.winner, data.finalHome, data.finalAway, () => {
        dailyHome = 0;
        dailyAway = 0;
        currentDay = data.day;
        games = [];
        feedItems = [];
        animateScore($homeScore, 0);
        animateScore($awayScore, 0);
        $infoLiveCount.textContent = '0';
        $infoTotalCount.textContent = '0';
        renderFeed();
      });
    }
  };

  ws.onclose = () => {
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// ── Score Events ────────────────────────────────────
function addScoreEvent(event) {
  if (event.side === 'home') {
    dailyHome += event.points;
    triggerFlash('home');
  } else {
    dailyAway += event.points;
    triggerFlash('away');
  }

  animateScore($homeScore, dailyHome);
  animateScore($awayScore, dailyAway);

  feedItems.push({ ...event, receivedAt: Date.now() });
  if (feedItems.length > 200) feedItems = feedItems.slice(-200);
  renderFeed();
}

// ── Flash Effect ────────────────────────────────────
function triggerFlash(side) {
  const $el = side === 'home' ? $flashHome : $flashAway;
  $el.classList.add('active');
  setTimeout(() => $el.classList.remove('active'), 800);
}

// ── Animate Score ───────────────────────────────────
function animateScore($el, target) {
  const current = parseInt($el.textContent, 10) || 0;
  if (current === target) {
    $el.textContent = target;
    return;
  }

  const diff = target - current;
  const steps = Math.min(Math.abs(diff), 20);
  const stepSize = diff / steps;
  let step = 0;

  function tick() {
    step++;
    if (step >= steps) {
      $el.textContent = target;
      return;
    }
    $el.textContent = Math.round(current + stepSize * step);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Render Feed ─────────────────────────────────────
let lastFeedLength = 0;

function buildFeedHTML(items) {
  return items.map(e => {
    const scorer = e.scorer || e.team;
    const ago = timeAgo(e.receivedAt);
    return `<span class="feed-item ${e.side}">${scorer} ${e.verb} <span class="feed-time">${ago}</span></span>`;
  }).join('');
}

function getRecentFeed() {
  return feedItems.slice(-10).reverse();
}

function renderFeed() {
  const recent = getRecentFeed();
  const html = buildFeedHTML(recent);
  $feedInner.innerHTML = `<span class="feed-set">${html}</span><span class="feed-set">${html}</span>`;

  // Only restart animation if item count changed (avoids jank on rapid scores)
  if (recent.length !== lastFeedLength) {
    $feedInner.style.animation = 'none';
    $feedInner.offsetHeight;
    const duration = Math.max(30, recent.length * 4);
    $feedInner.style.animation = `scroll-feed ${duration}s linear infinite`;
    lastFeedLength = recent.length;
  }
}

function updateFeedTimes() {
  const spans = $feedInner.querySelectorAll('.feed-time');
  const recent = getRecentFeed();
  if (spans.length === 0 || recent.length === 0) return;
  recent.forEach((e, i) => {
    const ago = timeAgo(e.receivedAt);
    if (spans[i]) spans[i].textContent = ago;
    if (spans[i + recent.length]) spans[i + recent.length].textContent = ago;
  });
}

// Update time-ago labels every 10s without restarting animation
setInterval(() => {
  if (feedItems.length > 0) updateFeedTimes();
}, 10000);

// ── Winner Animation ────────────────────────────────
function showWinnerAnimation(winner, finalHome, finalAway, onComplete) {
  $winnerOverlay.className = winner || 'draw';

  if (winner === 'home') {
    $winnerLabel.textContent = 'WINNER';
    $winnerSide.textContent = 'HOME';
  } else if (winner === 'away') {
    $winnerLabel.textContent = 'WINNER';
    $winnerSide.textContent = 'AWAY';
  } else {
    $winnerLabel.textContent = 'DRAW';
    $winnerSide.textContent = '';
  }

  $winnerFinalScore.textContent = `${finalHome} — ${finalAway}`;

  let countdown = 5;
  $winnerCountdown.textContent = countdown;

  const tick = setInterval(() => {
    countdown--;
    $winnerCountdown.textContent = countdown;
    if (countdown <= 0) {
      clearInterval(tick);
      $winnerOverlay.classList.add('hidden');
      $winnerOverlay.className = 'hidden';
      onComplete();
    }
  }, 1000);
}

// Update resume countdown every 60s
setInterval(updateResumeCountdown, 60000);

// ── Info Modal ──────────────────────────────────────
$infoBtn.addEventListener('click', () => {
  $infoModal.classList.remove('hidden');
});

$infoClose.addEventListener('click', () => {
  $infoModal.classList.add('hidden');
});

$infoModal.addEventListener('click', (e) => {
  if (e.target === $infoModal) {
    $infoModal.classList.add('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $infoModal.classList.add('hidden');
  }
});

// ── Init ────────────────────────────────────────────
$homeScore.textContent = '0';
$awayScore.textContent = '0';
connect();

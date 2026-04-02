const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ── Daily Score Persistence ────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // "2026-03-31"
}

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[data] failed to load history:', err.message);
  }
  return { days: {} };
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('[data] failed to save history:', err.message);
  }
}

let history = loadHistory();
let currentDay = todayUTC();

// Ensure today exists in history
if (!history.days[currentDay]) {
  history.days[currentDay] = { home: 0, away: 0, winner: null };
}

let dailyHome = history.days[currentDay].home;
let dailyAway = history.days[currentDay].away;

// Check for day rollover
function checkDayRollover() {
  const today = todayUTC();
  if (today !== currentDay) {
    // Finalize yesterday
    const yesterday = history.days[currentDay];
    if (yesterday) {
      if (yesterday.home > yesterday.away) yesterday.winner = 'home';
      else if (yesterday.away > yesterday.home) yesterday.winner = 'away';
      else yesterday.winner = 'draw';
    }

    const finalHome = dailyHome;
    const finalAway = dailyAway;
    const winner = finalHome > finalAway ? 'home' : finalAway > finalHome ? 'away' : 'draw';

    // Start new day
    currentDay = today;
    dailyHome = 0;
    dailyAway = 0;
    history.days[currentDay] = { home: 0, away: 0, winner: null };
    saveHistory();

    // Reset score tracking so first poll doesn't generate phantom events
    lastScores = {};
    lastScoringPlays = {};
    gamesContributed = new Set();

    console.log(`[day] rolled over to ${currentDay}`);
    broadcast({ type: 'dayReset', day: currentDay, finalHome, finalAway, winner });
  }
}

// Save to disk every 30s
setInterval(saveHistory, 30_000);

// Check for day rollover every 10s
setInterval(checkDayRollover, 10_000);

// ── State ──────────────────────────────────────────────
let liveGames = [];
let scoreEvents = [];
let lastScores = {};
let lastScoringPlays = {};
let activeGameCount = 0;
let gamesContributed = new Set(); // games that have actually scored today
let cachedClientGames = null;
let lastGamesHash = '';

const POLL_LIVE_MIN = 10_000;
const POLL_LIVE_MAX = 15_000;
const POLL_IDLE = 60_000;

// ── ESPN Endpoints ─────────────────────────────────────
const ESPN_SOURCES = [
  { url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard', sport: 'Basketball', league: 'NBA', summaryPath: 'basketball/nba' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard', sport: 'Basketball', league: 'WNBA', summaryPath: 'basketball/wnba' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard', sport: 'Basketball', league: 'NCAA', summaryPath: 'basketball/mens-college-basketball' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard', sport: 'Ice Hockey', league: 'NHL', summaryPath: 'hockey/nhl' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard', sport: 'Baseball', league: 'MLB', summaryPath: 'baseball/mlb' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', sport: 'American Football', league: 'NFL', summaryPath: 'football/nfl' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard', sport: 'American Football', league: 'NCAAF', summaryPath: 'football/college-football' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard', sport: 'Soccer', league: 'Premier League', summaryPath: 'soccer/eng.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard', sport: 'Soccer', league: 'La Liga', summaryPath: 'soccer/esp.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard', sport: 'Soccer', league: 'Bundesliga', summaryPath: 'soccer/ger.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1/scoreboard', sport: 'Soccer', league: 'Serie A', summaryPath: 'soccer/ita.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/fra.1/scoreboard', sport: 'Soccer', league: 'Ligue 1', summaryPath: 'soccer/fra.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard', sport: 'Soccer', league: 'Champions League', summaryPath: 'soccer/uefa.champions' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard', sport: 'Soccer', league: 'MLS', summaryPath: 'soccer/usa.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.europa/scoreboard', sport: 'Soccer', league: 'Europa League', summaryPath: 'soccer/uefa.europa' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard', sport: 'Soccer', league: 'Brasileirao', summaryPath: 'soccer/bra.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/arg.1/scoreboard', sport: 'Soccer', league: 'Liga Argentina', summaryPath: 'soccer/arg.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard', sport: 'Soccer', league: 'Liga MX', summaryPath: 'soccer/mex.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/ned.1/scoreboard', sport: 'Soccer', league: 'Eredivisie', summaryPath: 'soccer/ned.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/por.1/scoreboard', sport: 'Soccer', league: 'Primeira Liga', summaryPath: 'soccer/por.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/tur.1/scoreboard', sport: 'Soccer', league: 'Super Lig', summaryPath: 'soccer/tur.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/sco.1/scoreboard', sport: 'Soccer', league: 'Scottish Premiership', summaryPath: 'soccer/sco.1' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard', sport: 'Tennis', league: 'ATP', summaryPath: 'tennis/atp' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard', sport: 'Tennis', league: 'WTA', summaryPath: 'tennis/wta' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard', sport: 'MMA', league: 'UFC', summaryPath: 'mma/ufc' },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/rugby/270557/scoreboard', sport: 'Rugby', league: 'Six Nations', summaryPath: null },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard', sport: 'Golf', league: 'PGA', summaryPath: null },
  { url: 'https://site.api.espn.com/apis/site/v2/sports/cricket/8676/scoreboard', sport: 'Cricket', league: 'IPL', summaryPath: null },
];

// ── Helpers ────────────────────────────────────────────
function sportVerb(sport, points) {
  const verbs = {
    soccer: points === 1 ? 'scored a goal!' : `scored ${points} goals!`,
    basketball: `scored ${points} point${points !== 1 ? 's' : ''}!`,
    tennis: `won a game!`,
    baseball: `scored ${points} run${points !== 1 ? 's' : ''}!`,
    'ice hockey': points === 1 ? 'scored a goal!' : `scored ${points} goals!`,
    rugby: `scored ${points} point${points !== 1 ? 's' : ''}!`,
    cricket: `scored ${points} run${points !== 1 ? 's' : ''}!`,
    'american football': `scored ${points} point${points !== 1 ? 's' : ''}!`,
    mma: `won!`,
    golf: `gained ${points} stroke${points !== 1 ? 's' : ''}!`,
  };
  return verbs[sport.toLowerCase()] || `scored ${points} point${points !== 1 ? 's' : ''}!`;
}

// ── ESPN Fetcher ───────────────────────────────────────
function parseESPNEvent(event, sport, league, summaryPath) {
  const comp = event.competitions?.[0];
  if (!comp) return null;

  const state = event.status?.type?.state;
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  return {
    id: `espn:${event.id}`,
    espnId: event.id,
    sport,
    league,
    summaryPath,
    homeTeam: home.team?.shortDisplayName || home.team?.displayName || 'Home',
    awayTeam: away.team?.shortDisplayName || away.team?.displayName || 'Away',
    homeScore: parseInt(home.score, 10) || 0,
    awayScore: parseInt(away.score, 10) || 0,
    status: state === 'in' ? 'LIVE' : state === 'post' ? 'FT' : 'PRE',
    time: event.status?.type?.shortDetail || '',
    isLive: state === 'in',
    startTime: event.date || null,
  };
}

async function fetchESPNSource(source) {
  try {
    const res = await fetch(source.url, { timeout: 10000 });
    if (!res.ok) return [];
    const data = await res.json();
    const events = data.events || [];
    return events
      .map(e => parseESPNEvent(e, source.sport, source.league, source.summaryPath))
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

// ── Fetch Scorer Details ───────────────────────────────
async function fetchScorerDetails(game) {
  if (!game.summaryPath || !game.espnId) return null;
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${game.summaryPath}/summary?event=${game.espnId}`;
    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) return null;
    const data = await res.json();

    const keyEvents = data.keyEvents || [];
    const scoringPlays = keyEvents.filter(e => e.scoringPlay);

    const seenPlays = lastScoringPlays[game.id] || new Set();
    const newPlays = scoringPlays.filter(p => !seenPlays.has(p.id));
    lastScoringPlays[game.id] = new Set(scoringPlays.map(p => p.id));

    return newPlays.map(play => {
      const scorer = play.shortText
        ? play.shortText.replace(/ Goal$| Touchdown$| Field Goal$| Run$| Home Run$/i, '').trim()
        : null;

      let side = null;
      if (play.team?.displayName) {
        const teamName = play.team.displayName.toLowerCase();
        if (game.homeTeam.toLowerCase().includes(teamName.split(' ').pop()) ||
            teamName.includes(game.homeTeam.toLowerCase().split(' ').pop())) {
          side = 'home';
        } else {
          side = 'away';
        }
      }

      return { scorer, side, playText: play.shortText || play.text };
    });
  } catch (err) {
    return null;
  }
}

// ── Score Change Detection ─────────────────────────────
async function detectAndEnrichScoreChanges(newGames) {
  const changedGames = [];

  for (const game of newGames) {
    const prev = lastScores[game.id];
    if (prev) {
      const homeDiff = game.homeScore - prev.home;
      const awayDiff = game.awayScore - prev.away;
      if (homeDiff > 0 || awayDiff > 0) {
        changedGames.push({ game, homeDiff, awayDiff });
        gamesContributed.add(game.id);
      }
    }
    lastScores[game.id] = { home: game.homeScore, away: game.awayScore };
  }

  if (changedGames.length === 0) return [];

  const events = [];
  const detailFetches = changedGames
    .filter(({ game }) => game.summaryPath)
    .map(async ({ game, homeDiff, awayDiff }) => {
    const scorerDetails = await fetchScorerDetails(game);

    if (scorerDetails && scorerDetails.length > 0) {
      for (const detail of scorerDetails) {
        const side = detail.side || (homeDiff > 0 ? 'home' : 'away');
        const points = side === 'home' ? homeDiff : awayDiff;
        const verb = sportVerb(game.sport, points > 0 ? points : 1);
        events.push({
          time: Date.now(),
          side,
          team: side === 'home' ? game.homeTeam : game.awayTeam,
          scorer: detail.scorer || (side === 'home' ? game.homeTeam : game.awayTeam),
          points: points > 0 ? points : 1,
          sport: game.sport,
          league: game.league,
          verb,
          newScore: `${game.homeScore}-${game.awayScore}`,
        });
      }
    } else {
      if (homeDiff > 0) {
        events.push({
          time: Date.now(),
          side: 'home',
          team: game.homeTeam,
          scorer: game.homeTeam,
          points: homeDiff,
          sport: game.sport,
          league: game.league,
          verb: sportVerb(game.sport, homeDiff),
          newScore: `${game.homeScore}-${game.awayScore}`,
        });
      }
      if (awayDiff > 0) {
        events.push({
          time: Date.now(),
          side: 'away',
          team: game.awayTeam,
          scorer: game.awayTeam,
          points: awayDiff,
          sport: game.sport,
          league: game.league,
          verb: sportVerb(game.sport, awayDiff),
          newScore: `${game.homeScore}-${game.awayScore}`,
        });
      }
    }
  });

  // Emit fallback events for games without summaryPath (no detail fetch)
  for (const { game, homeDiff, awayDiff } of changedGames.filter(({ game }) => !game.summaryPath)) {
    if (homeDiff > 0) {
      events.push({
        time: Date.now(), side: 'home', team: game.homeTeam, scorer: game.homeTeam,
        points: homeDiff, sport: game.sport, league: game.league,
        verb: sportVerb(game.sport, homeDiff), newScore: `${game.homeScore}-${game.awayScore}`,
      });
    }
    if (awayDiff > 0) {
      events.push({
        time: Date.now(), side: 'away', team: game.awayTeam, scorer: game.awayTeam,
        points: awayDiff, sport: game.sport, league: game.league,
        verb: sportVerb(game.sport, awayDiff), newScore: `${game.homeScore}-${game.awayScore}`,
      });
    }
  }

  await Promise.allSettled(detailFetches);

  // Update daily totals
  for (const event of events) {
    if (event.side === 'home') {
      dailyHome += event.points;
    } else {
      dailyAway += event.points;
    }
  }
  history.days[currentDay] = { home: dailyHome, away: dailyAway, winner: null };

  return events;
}

// ── Main Poll Loop ─────────────────────────────────────
function gamesHash(games) {
  let h = '';
  for (const g of games) h += `${g.id}:${g.homeScore}-${g.awayScore}:${g.status},`;
  return h;
}

async function pollAllSources() {
  try {
    checkDayRollover();

    // Fetch all sources in parallel
    const results = await Promise.allSettled(ESPN_SOURCES.map(fetchESPNSource));

    const allGames = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allGames.push(...r.value);
    }

    const liveOnly = allGames.filter(g => g.isLive);
    const newEvents = await detectAndEnrichScoreChanges(allGames);

    liveGames = allGames;
    activeGameCount = liveOnly.length;

    if (newEvents.length > 0) {
      scoreEvents.push(...newEvents);
      if (scoreEvents.length > 500) {
        scoreEvents = scoreEvents.slice(-500);
      }
      broadcast({ type: 'events', events: newEvents });
    }

    // Only broadcast games update if something changed
    const hash = gamesHash(allGames);
    if (hash !== lastGamesHash) {
      lastGamesHash = hash;
      cachedClientGames = allGames.map(({ summaryPath, espnId, ...rest }) => rest);
      broadcast({
        type: 'games',
        games: cachedClientGames,
        activeGameCount,
        gamesContributed: gamesContributed.size,
        dailyHome,
        dailyAway,
        day: currentDay,
      });
    }

    console.log(`[poll] ${liveOnly.length} live / ${allGames.length} total, daily: H${dailyHome}-A${dailyAway}, ${newEvents.length} events`);
  } catch (err) {
    console.error('[poll] error:', err.message);
  }
}

// ── WebSocket ──────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'init',
    games: cachedClientGames || [],
    activeGameCount,
    gamesContributed: gamesContributed.size,
    dailyHome,
    dailyAway,
    day: currentDay,
    recentEvents: scoreEvents.slice(-10),
  }));
});

// ── API: History ───────────────────────────────────────
app.get('/api/history', (req, res) => {
  // Return last 30 days of results
  const days = Object.entries(history.days)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 30)
    .map(([date, data]) => ({
      date,
      home: data.home,
      away: data.away,
      winner: date === currentDay ? null : data.winner,
    }));

  const homeWins = days.filter(d => d.winner === 'home').length;
  const awayWins = days.filter(d => d.winner === 'away').length;
  const draws = days.filter(d => d.winner === 'draw').length;

  res.json({ days, homeWins, awayWins, draws });
});

app.get('/api/info', (req, res) => {
  res.json({
    activeGameCount,
    totalGamesTracked: Object.keys(lastScores).length,
    sports: [...new Set(liveGames.map(g => g.sport))],
    eventsInMemory: scoreEvents.length,
    dailyHome,
    dailyAway,
    day: currentDay,
  });
});

// ── Graceful shutdown ──────────────────────────────────
function shutdown() {
  console.log('[shutdown] saving history...');
  // Finalize today if we have scores
  if (dailyHome > 0 || dailyAway > 0) {
    history.days[currentDay] = { home: dailyHome, away: dailyAway, winner: null };
  }
  saveHistory();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ── Stale State Cleanup ───────────────────────────────
// Prune finished games from tracking maps every 10 minutes
setInterval(() => {
  const activeIds = new Set(liveGames.map(g => g.id));
  for (const id of Object.keys(lastScoringPlays)) {
    if (!activeIds.has(id)) delete lastScoringPlays[id];
  }
}, 600_000);

// ── Adaptive Poll Loop ────────────────────────────────
let pollTimer = null;

function schedulePoll() {
  const interval = activeGameCount > 0
    ? POLL_LIVE_MIN + Math.random() * (POLL_LIVE_MAX - POLL_LIVE_MIN)
    : POLL_IDLE;
  pollTimer = setTimeout(async () => {
    await pollAllSources();
    schedulePoll();
  }, interval);
}

// ── Start ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ALLSCORES running on port ${PORT}`);
  console.log(`Polling ${ESPN_SOURCES.length} ESPN endpoints (${POLL_LIVE_MIN / 1000}-${POLL_LIVE_MAX / 1000}s live / ${POLL_IDLE / 1000}s idle)`);
  console.log(`Today: ${currentDay}, daily: H${dailyHome}-A${dailyAway}`);
  pollAllSources().then(schedulePoll);
});

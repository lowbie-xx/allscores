# AllScores

**Live at [allscores.online](https://allscores.online/)**

AllScores tracks sports games live, every day, and counts every point as if all the teams are one collective: **Home vs Away**.

The only goal: for the home team to beat the away team, and the away team to beat the home team. Every point scored by a home side in any game goes on the Home total, and every point by an away side goes on the Away total. Scores reset at midnight UTC and the day's winner is recorded.

## Features

- **One scoreboard** showing the combined Home and Away score for the day, with a winner indicator
- **Live feed** of each score as it happens, across every tracked game
- **Stats bar:** games live, games scored, sports, leagues, time to the next game, and time until the day ends
- **Daily results:** running tally of Home wins, Away wins, and draws
- **Next-game countdown** when nothing is live
- Light and dark mode

## Coverage

28 leagues across 10 sports:

| Sport | Leagues |
| --- | --- |
| Soccer | Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, Europa League, MLS, Brasileirão, Liga Argentina, Liga MX, Eredivisie, Primeira Liga, Süper Lig, Scottish Premiership |
| Basketball | NBA, WNBA, NCAA |
| American Football | NFL, NCAAF |
| Ice Hockey | NHL |
| Baseball | MLB |
| Tennis | ATP, WTA |
| MMA | UFC |
| Rugby | Six Nations |
| Golf | PGA |
| Cricket | IPL |

Data from ESPN.

## Running locally

Requires Node.js.

```bash
npm install
npm start
```

Then open http://localhost:3000. To change the port, or add an optional API-Sports key, copy `.env.example` to `.env` and edit it.

## How it works

`server.js` is an Express + WebSocket server. It polls ESPN's public scoreboard endpoints for every league (every 10–15s while games are live, every 60s otherwise), works out score changes, and broadcasts them to connected clients. The frontend in `public/` is plain HTML, CSS, and JavaScript.

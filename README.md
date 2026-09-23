# Clan game

Basic real-time 4-player base-battler. Node.js + Express + Socket.io backend,
vanilla HTML/CSS/JS frontend. In-memory lobbies, JSON-file leaderboard.

## Run it

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a few browser tabs (or share your local
network IP / deployed URL with friends) to test multiplayer.

## How to play

1. Enter a nickname → **Create Lobby** (get a 5-letter code) or **Join Lobby**
   with a friend's code.
2. In the lobby, hit **Ready**. The host clicks **Start Game** once 2–4
   players are in (works with 2+, doesn't require exactly 4).
3. In the match:
   - Gold trickles in automatically over time.
   - **Train Troops**: spend gold on Barbarians / Archers / Giants / Wizards.
   - **Attack**: pick a target and how many of each troop type to send.
     Combat is resolved instantly — your attack power chews through the
     defender's garrisoned troops (weakest first); if you break through,
     leftover power damages their base and your troops return home. If you
     don't break through, your sent troops are lost.
   - **Ally**: propose an alliance with another player; once accepted you
     can't attack each other and their base is marked as an ally.
   - **Private Chat**: pick a player from the dropdown to message just them.
   - Watch the live **Scoreboard** and **Battle Log**.
4. Match ends when only one base is left standing, or the 10-minute timer
   runs out (highest score wins). Winner gets a +100 point bonus.
5. Results feed the **Global Leaderboard** (persisted to `leaderboard.json`),
   shown back on the home screen.

## Deploying

- Backend (Node + Socket.io): Railway, Render, Fly.io, etc.
- The frontend is served as static files by the same Express app, so a
  single deploy covers both — no separate static host needed.

## Notes / what's intentionally left simple

- No accounts/login — just nicknames.
- No persistent clans, buildings, or upgrades beyond training troops.
- Leaderboard keys off nickname (not unique accounts), fine for casual play.
- Lobbies and match state live in memory — restarting the server clears
  active games (leaderboard.json survives since it's written to disk).

## Files

```
server.js        - Express + Socket.io server, all game/lobby logic
troops.js         - Troop stats (cost / power / kill points)
leaderboard.json  - Persisted global leaderboard (auto-created/updated)
public/index.html - Home / Lobby / Game screens
public/style.css  - Dark Clash-of-Clans-ish theme
public/app.js     - Client logic (sockets, rendering, chat, attacks)
```

# Liverpool Rummy Tracker

Node.js 10.24.1-compatible app for tracking Liverpool Rummy players, games, score sheets, and manual joker hands.

## Local setup

1. Create the Neon tables with sql/schema.sql.
2. Set DATABASE_URL to the Neon connection string.
3. Run npm install.
4. Start the app with npm start.

## Features

- Add, edit, and delete players.
- Record, edit, and delete games with per-player scores.
- Browse game history with player/date filters and pagination.
- Track manual joker-hand entries.
- Review an audit trail for score edits and game deletions.
- Compute leaderboard stats:
	- Most wins.
	- Lowest score ever recorded.
	- Most Jokers in a single hand.

## Production deploy (Node runtime)

The deploy.sh script now deploys the Node app over SSH instead of mirroring static files.

### First-time server setup

1. Install Node and npm on the server.
2. Install PM2 globally:
	 npm install -g pm2
3. Create a shared environment file on the server:
	 apps/liverpool-rummy/shared/.env
4. Put DATABASE_URL in that .env file.

### Deploy

- Dry run:
	./deploy.sh --dry-run
- Real deploy:
	./deploy.sh

The script creates a timestamped release, installs production dependencies, updates apps/liverpool-rummy/current, and restarts the PM2 process named liverpool-rummy.
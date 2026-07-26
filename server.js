var express = require('express');
var path = require('path');
var Pool = require('pg').Pool;

var app = express();
var port = process.env.PORT || 3000;
var databaseUrl = process.env.DATABASE_URL;
var pool = null;

if (databaseUrl) {
  pool = new Pool({
    connectionString: databaseUrl
  });
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

function requirePool() {
  if (!pool) {
    throw new Error('DATABASE_URL is not set. Configure Neon before starting the app.');
  }

  return pool;
}

function toInteger(value) {
  var parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'undefined' || value === null || value === '') {
    return [];
  }

  return [value];
}

function toPositiveInteger(value, fallback) {
  var parsed = toInteger(value);
  if (parsed === null || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function parseGameEntries(playerIds, scores) {
  var entries = [];

  for (var i = 0; i < Math.max(playerIds.length, scores.length); i += 1) {
    var playerId = toInteger(playerIds[i]);
    var score = toInteger(scores[i]);

    if (playerId !== null && score !== null) {
      entries.push({ playerId: playerId, score: score });
    }
  }

  return entries;
}

function validateGameEntries(entries) {
  if (entries.length < 2) {
    return 'Enter at least two player scores.';
  }

  var uniquePlayers = {};
  for (var i = 0; i < entries.length; i += 1) {
    if (uniquePlayers[entries[i].playerId]) {
      return 'Each player can only appear once per game.';
    }

    uniquePlayers[entries[i].playerId] = true;
  }

  return null;
}

function formatDate(value) {
  if (!value) {
    return 'Unknown';
  }

  var date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatDateInput(value) {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  var date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) {
    return 'Unknown';
  }

  var date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function buildGamesPageUrl(filters, page) {
  var pairs = ['page=' + page];

  if (filters.playerId !== null) {
    pairs.push('player_id=' + filters.playerId);
  }

  if (filters.dateFrom) {
    pairs.push('date_from=' + encodeURIComponent(filters.dateFrom));
  }

  if (filters.dateTo) {
    pairs.push('date_to=' + encodeURIComponent(filters.dateTo));
  }

  return '/games?' + pairs.join('&');
}

function safeParseJsonArray(value) {
  try {
    var parsed = JSON.parse(value || '[]');
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    return [];
  }

  return [];
}

function wrapAsync(handler) {
  return function (req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function loadPlayers(client) {
  var db = client || requirePool();
  var result = await db.query('select id, name, created_at from players order by name asc');
  return result.rows;
}

async function loadGameScores(client, gameId) {
  var scoreResult = await client.query(
    'select p.id as player_id, p.name as player_name, s.score from game_scores s join players p on p.id = s.player_id where s.game_id = $1 order by s.score asc, p.name asc',
    [gameId]
  );

  return scoreResult.rows.map(function (row) {
    return {
      playerId: row.player_id,
      playerName: row.player_name,
      score: row.score
    };
  });
}

async function loadRecentGames(client, limit) {
  var db = client || requirePool();
  var gameResult = await db.query(
    'select id, played_on, notes, created_at from games order by played_on desc, id desc limit $1',
    [limit]
  );

  var games = [];
  for (var i = 0; i < gameResult.rows.length; i += 1) {
    var game = gameResult.rows[i];
    var scores = await loadGameScores(db, game.id);

    games.push({
      id: game.id,
      playedOn: formatDate(game.played_on),
      notes: game.notes,
      scores: scores,
      winner: scores.length ? scores[0] : null
    });
  }

  return games;
}

async function loadGamesPage(query) {
  var db = requirePool();
  var players = await loadPlayers(db);
  var playerId = toInteger(query.player_id);
  var dateFrom = (query.date_from || '').trim();
  var dateTo = (query.date_to || '').trim();
  var pageSize = 10;
  var page = toPositiveInteger(query.page, 1);
  var whereClauses = [];
  var params = [];

  if (playerId !== null) {
    params.push(playerId);
    whereClauses.push('exists (select 1 from game_scores f where f.game_id = g.id and f.player_id = $' + params.length + ')');
  }

  if (dateFrom) {
    params.push(dateFrom);
    whereClauses.push('g.played_on >= $' + params.length);
  }

  if (dateTo) {
    params.push(dateTo);
    whereClauses.push('g.played_on <= $' + params.length);
  }

  var whereSql = whereClauses.length ? (' where ' + whereClauses.join(' and ')) : '';
  var countResult = await db.query('select count(*)::int as count from games g' + whereSql, params);
  var totalGames = countResult.rows[0].count;
  var totalPages = Math.max(1, Math.ceil(totalGames / pageSize));
  if (page > totalPages) {
    page = totalPages;
  }

  var pageParams = params.slice();
  pageParams.push(pageSize);
  pageParams.push((page - 1) * pageSize);

  var gameResult = await db.query(
    'select g.id, g.played_on, g.notes, g.created_at from games g' + whereSql + ' order by g.played_on desc, g.id desc limit $' + (params.length + 1) + ' offset $' + (params.length + 2),
    pageParams
  );

  var games = [];
  for (var i = 0; i < gameResult.rows.length; i += 1) {
    var game = gameResult.rows[i];
    var scores = await loadGameScores(db, game.id);
    games.push({
      id: game.id,
      playedOn: formatDate(game.played_on),
      notes: game.notes,
      scores: scores,
      winner: scores.length ? scores[0] : null
    });
  }

  var filters = {
    playerId: playerId,
    dateFrom: dateFrom,
    dateTo: dateTo
  };

  return {
    title: 'Games',
    players: players,
    games: games,
    filters: filters,
    pagination: {
      page: page,
      pageSize: pageSize,
      totalGames: totalGames,
      totalPages: totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
      prevUrl: page > 1 ? buildGamesPageUrl(filters, page - 1) : null,
      nextUrl: page < totalPages ? buildGamesPageUrl(filters, page + 1) : null
    }
  };
}

async function loadAuditPage() {
  var db = requirePool();
  var result = await db.query(
    'select id, game_id, action, actor, old_played_on, new_played_on, old_notes, new_notes, old_scores::text as old_scores, new_scores::text as new_scores, created_at from game_audit_log order by created_at desc limit 40'
  );

  return {
    title: 'Audit log',
    entries: result.rows.map(function (row) {
      return {
        id: row.id,
        gameId: row.game_id,
        action: row.action,
        actor: row.actor,
        oldPlayedOn: row.old_played_on ? formatDate(row.old_played_on) : null,
        newPlayedOn: row.new_played_on ? formatDate(row.new_played_on) : null,
        oldNotes: row.old_notes,
        newNotes: row.new_notes,
        oldScores: safeParseJsonArray(row.old_scores),
        newScores: safeParseJsonArray(row.new_scores),
        createdAt: formatDateTime(row.created_at)
      };
    })
  };
}

async function loadLeaderboards(client) {
  var db = client || requirePool();

  var topWinnerResult = await db.query(
    'with lowest_scores as (select game_id, min(score) as min_score from game_scores group by game_id), winners as (select gs.player_id from game_scores gs join lowest_scores ls on ls.game_id = gs.game_id and ls.min_score = gs.score) select p.id, p.name, count(*)::int as wins from winners w join players p on p.id = w.player_id group by p.id, p.name order by wins desc, p.name asc limit 1'
  );

  var lowestScoreResult = await db.query(
    'select p.id as player_id, p.name as player_name, g.id as game_id, g.played_on, s.score from game_scores s join players p on p.id = s.player_id join games g on g.id = s.game_id order by s.score asc, g.played_on asc, g.id asc limit 1'
  );

  var jokerResult = await db.query(
    'select p.id as player_id, p.name as player_name, h.jokers_count, h.hand_label, h.created_at from joker_hands h join players p on p.id = h.player_id order by h.jokers_count desc, h.created_at desc limit 1'
  );

  return {
    topWinner: topWinnerResult.rows.length
      ? {
          id: topWinnerResult.rows[0].id,
          name: topWinnerResult.rows[0].name,
          wins: topWinnerResult.rows[0].wins
        }
      : null,
    lowestScore: lowestScoreResult.rows.length
      ? {
          playerId: lowestScoreResult.rows[0].player_id,
          playerName: lowestScoreResult.rows[0].player_name,
          gameId: lowestScoreResult.rows[0].game_id,
          playedOn: formatDate(lowestScoreResult.rows[0].played_on),
          score: lowestScoreResult.rows[0].score
        }
      : null,
    mostJokers: jokerResult.rows.length
      ? {
          playerId: jokerResult.rows[0].player_id,
          playerName: jokerResult.rows[0].player_name,
          jokersCount: jokerResult.rows[0].jokers_count,
          handLabel: jokerResult.rows[0].hand_label || 'Manual hand entry'
        }
      : null
  };
}

async function loadDashboard() {
  var db = requirePool();
  var playersResult = await db.query('select count(*)::int as count from players');
  var gamesResult = await db.query('select count(*)::int as count from games');
  var players = await loadPlayers(db);
  var games = await loadRecentGames(db, 5);
  var leaderboards = await loadLeaderboards(db);
  var recentJokersResult = await db.query(
    'select p.name as player_name, h.jokers_count, h.hand_label, h.created_at from joker_hands h join players p on p.id = h.player_id order by h.created_at desc limit 5'
  );

  return {
    title: 'Dashboard',
    players: players,
    games: games,
    recentJokers: recentJokersResult.rows.map(function (row) {
      return {
        playerName: row.player_name,
        jokersCount: row.jokers_count,
        handLabel: row.hand_label,
        createdAt: formatDate(row.created_at)
      };
    }),
    playerCount: playersResult.rows[0].count,
    gameCount: gamesResult.rows[0].count,
    topWinner: leaderboards.topWinner,
    lowestScore: leaderboards.lowestScore,
    mostJokers: leaderboards.mostJokers,
    success: null,
    error: null
  };
}

async function loadPlayersPage() {
  var db = requirePool();
  var players = await loadPlayers(db);
  var winsResult = await db.query(
    'with lowest_scores as (select game_id, min(score) as min_score from game_scores group by game_id), winners as (select gs.player_id from game_scores gs join lowest_scores ls on ls.game_id = gs.game_id and ls.min_score = gs.score) select player_id, count(*)::int as wins from winners group by player_id'
  );

  var winMap = {};
  winsResult.rows.forEach(function (row) {
    winMap[row.player_id] = row.wins;
  });

  return {
    title: 'Players',
    players: players.map(function (player) {
      return {
        id: player.id,
        name: player.name,
        createdAt: formatDate(player.created_at),
        wins: winMap[player.id] || 0
      };
    }),
    error: null,
    success: null
  };
}

async function loadGameForm() {
  var players = await loadPlayers(requirePool());

  return {
    title: 'Record a game',
    players: players,
    error: null
  };
}

async function loadGameEditForm(gameId) {
  var db = requirePool();
  var players = await loadPlayers(db);
  var gameResult = await db.query('select id, played_on, notes from games where id = $1', [gameId]);

  if (!gameResult.rows.length) {
    return null;
  }

  var scoreResult = await db.query(
    'select player_id, score from game_scores where game_id = $1 order by score asc, player_id asc',
    [gameId]
  );

  var scoreEntries = scoreResult.rows.map(function (row) {
    return {
      playerId: row.player_id,
      score: row.score
    };
  });

  return {
    title: 'Edit game',
    gameId: gameResult.rows[0].id,
    playedOn: formatDateInput(gameResult.rows[0].played_on),
    notes: gameResult.rows[0].notes || '',
    players: players,
    scoreEntries: scoreEntries,
    error: null
  };
}

async function loadJokerForm() {
  var players = await loadPlayers(requirePool());
  var entries = await requirePool().query(
    'select h.id, h.hand_label, h.jokers_count, h.notes, h.created_at, p.name as player_name from joker_hands h join players p on p.id = h.player_id order by h.created_at desc limit 12'
  );

  return {
    title: 'Joker log',
    players: players,
    entries: entries.rows.map(function (row) {
      return {
        playerName: row.player_name,
        handLabel: row.hand_label,
        jokersCount: row.jokers_count,
        notes: row.notes,
        createdAt: formatDate(row.created_at)
      };
    }),
    error: null
  };
}

app.get('/', wrapAsync(async function (req, res) {
  var dashboard = await loadDashboard();
  dashboard.success = req.query.success || null;
  res.render('dashboard', dashboard);
}));

app.get('/players', wrapAsync(async function (req, res) {
  var playersPage = await loadPlayersPage();
  playersPage.success = req.query.success || null;
  res.render('players', playersPage);
}));

app.get('/games', wrapAsync(async function (req, res) {
  var gamesPage = await loadGamesPage(req.query);
  res.render('games', gamesPage);
}));

app.post('/players', wrapAsync(async function (req, res) {
  var name = (req.body.name || '').trim();
  if (!name) {
    var invalidPlayers = await loadPlayersPage();
    invalidPlayers.error = 'Player name is required.';
    return res.status(400).render('players', invalidPlayers);
  }

  await requirePool().query('insert into players (name) values ($1)', [name]);
  res.redirect('/players?success=Player%20added');
}));

app.post('/players/:id/update', wrapAsync(async function (req, res) {
  var playerId = toInteger(req.params.id);
  if (playerId === null) {
    return res.status(404).send('Player not found');
  }

  var name = (req.body.name || '').trim();
  var playersPage = await loadPlayersPage();

  if (!name) {
    playersPage.error = 'Player name is required.';
    return res.status(400).render('players', playersPage);
  }

  try {
    var result = await requirePool().query('update players set name = $1 where id = $2', [name, playerId]);
    if (!result.rowCount) {
      return res.status(404).send('Player not found');
    }
  } catch (err) {
    if (err && err.code === '23505') {
      playersPage.error = 'A player with that name already exists.';
      return res.status(400).render('players', playersPage);
    }

    throw err;
  }

  res.redirect('/players?success=Player%20updated');
}));

app.post('/players/:id/delete', wrapAsync(async function (req, res) {
  var playerId = toInteger(req.params.id);
  if (playerId === null) {
    return res.status(404).send('Player not found');
  }

  var playersPage = await loadPlayersPage();
  var usageResult = await requirePool().query(
    'select (select count(*)::int from game_scores where player_id = $1) as game_count, (select count(*)::int from joker_hands where player_id = $1) as joker_count',
    [playerId]
  );

  if (!usageResult.rows.length) {
    return res.status(404).send('Player not found');
  }

  var gameCount = usageResult.rows[0].game_count;
  var jokerCount = usageResult.rows[0].joker_count;

  if (gameCount > 0 || jokerCount > 0) {
    playersPage.error = 'Cannot delete a player with recorded games or joker logs.';
    return res.status(400).render('players', playersPage);
  }

  await requirePool().query('delete from players where id = $1', [playerId]);
  res.redirect('/players?success=Player%20deleted');
}));

app.get('/games/new', wrapAsync(async function (req, res) {
  var gameForm = await loadGameForm();
  res.render('game-form', gameForm);
}));

app.post('/games', wrapAsync(async function (req, res) {
  var playedOn = (req.body.played_on || '').trim() || new Date().toISOString().slice(0, 10);
  var notes = (req.body.notes || '').trim();
  var playerIds = normalizeList(req.body.player_id);
  var scores = normalizeList(req.body.score);
  var entries = parseGameEntries(playerIds, scores);
  var gameValidationError = validateGameEntries(entries);

  if (gameValidationError) {
    var invalidGame = await loadGameForm();
    invalidGame.error = gameValidationError;
    return res.status(400).render('game-form', invalidGame);
  }

  var client = await requirePool().connect();
  var gameId = null;

  try {
    await client.query('begin');
    var gameResult = await client.query('insert into games (played_on, notes) values ($1, $2) returning id', [playedOn, notes]);
    gameId = gameResult.rows[0].id;

    for (var i = 0; i < entries.length; i += 1) {
      await client.query('insert into game_scores (game_id, player_id, score) values ($1, $2, $3)', [gameId, entries[i].playerId, entries[i].score]);
    }

    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  res.redirect('/games/' + gameId);
}));

app.get('/games/:id', wrapAsync(async function (req, res) {
  var gameId = toInteger(req.params.id);
  if (gameId === null) {
    return res.status(404).send('Game not found');
  }

  var db = requirePool();
  var gameResult = await db.query('select id, played_on, notes, created_at from games where id = $1', [gameId]);
  if (!gameResult.rows.length) {
    return res.status(404).send('Game not found');
  }

  var scores = await loadGameScores(db, gameId);

  res.render('game-show', {
    title: 'Game #' + gameId,
    game: {
      id: gameResult.rows[0].id,
      playedOn: formatDate(gameResult.rows[0].played_on),
      notes: gameResult.rows[0].notes,
      createdAt: formatDate(gameResult.rows[0].created_at)
    },
    scores: scores,
    winner: scores.length ? scores[0] : null
  });
}));

app.get('/games/:id/edit', wrapAsync(async function (req, res) {
  var gameId = toInteger(req.params.id);
  if (gameId === null) {
    return res.status(404).send('Game not found');
  }

  var gameForm = await loadGameEditForm(gameId);
  if (!gameForm) {
    return res.status(404).send('Game not found');
  }

  res.render('game-edit', gameForm);
}));

app.post('/games/:id/update', wrapAsync(async function (req, res) {
  var gameId = toInteger(req.params.id);
  if (gameId === null) {
    return res.status(404).send('Game not found');
  }

  var playedOn = (req.body.played_on || '').trim() || new Date().toISOString().slice(0, 10);
  var notes = (req.body.notes || '').trim();
  var playerIds = normalizeList(req.body.player_id);
  var scores = normalizeList(req.body.score);
  var entries = parseGameEntries(playerIds, scores);
  var gameValidationError = validateGameEntries(entries);

  if (gameValidationError) {
    var invalidGame = await loadGameEditForm(gameId);
    if (!invalidGame) {
      return res.status(404).send('Game not found');
    }

    invalidGame.error = gameValidationError;
    invalidGame.playedOn = playedOn;
    invalidGame.notes = notes;
    invalidGame.scoreEntries = entries;
    return res.status(400).render('game-edit', invalidGame);
  }

  var client = await requirePool().connect();

  try {
    await client.query('begin');
    var beforeGameResult = await client.query('select id, played_on, notes from games where id = $1 for update', [gameId]);
    if (!beforeGameResult.rows.length) {
      await client.query('rollback');
      return res.status(404).send('Game not found');
    }

    var beforeScoresResult = await client.query(
      'select p.id as player_id, p.name as player_name, s.score from game_scores s join players p on p.id = s.player_id where s.game_id = $1 order by s.score asc, p.name asc',
      [gameId]
    );

    var playerIdList = entries.map(function (entry) {
      return entry.playerId;
    });
    var playerNameResult = await client.query('select id, name from players where id = any($1::int[])', [playerIdList]);
    var playerNameMap = {};
    playerNameResult.rows.forEach(function (row) {
      playerNameMap[row.id] = row.name;
    });

    var newScoresForAudit = entries.map(function (entry) {
      return {
        playerId: entry.playerId,
        playerName: playerNameMap[entry.playerId] || 'Unknown',
        score: entry.score
      };
    });

    await client.query(
      'insert into game_audit_log (game_id, action, actor, old_played_on, new_played_on, old_notes, new_notes, old_scores, new_scores) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)',
      [
        gameId,
        'update_scores',
        req.ip || 'unknown',
        beforeGameResult.rows[0].played_on,
        playedOn,
        beforeGameResult.rows[0].notes,
        notes,
        JSON.stringify(beforeScoresResult.rows.map(function (row) {
          return {
            playerId: row.player_id,
            playerName: row.player_name,
            score: row.score
          };
        })),
        JSON.stringify(newScoresForAudit)
      ]
    );

    var gameResult = await client.query('update games set played_on = $1, notes = $2 where id = $3', [playedOn, notes, gameId]);
    if (!gameResult.rowCount) {
      await client.query('rollback');
      return res.status(404).send('Game not found');
    }

    await client.query('delete from game_scores where game_id = $1', [gameId]);

    for (var i = 0; i < entries.length; i += 1) {
      await client.query('insert into game_scores (game_id, player_id, score) values ($1, $2, $3)', [gameId, entries[i].playerId, entries[i].score]);
    }

    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  res.redirect('/games/' + gameId);
}));

app.post('/games/:id/delete', wrapAsync(async function (req, res) {
  var gameId = toInteger(req.params.id);
  if (gameId === null) {
    return res.status(404).send('Game not found');
  }

  var client = await requirePool().connect();

  try {
    await client.query('begin');
    var beforeGameResult = await client.query('select id, played_on, notes from games where id = $1 for update', [gameId]);
    if (!beforeGameResult.rows.length) {
      await client.query('rollback');
      return res.status(404).send('Game not found');
    }

    var beforeScoresResult = await client.query(
      'select p.id as player_id, p.name as player_name, s.score from game_scores s join players p on p.id = s.player_id where s.game_id = $1 order by s.score asc, p.name asc',
      [gameId]
    );

    await client.query(
      'insert into game_audit_log (game_id, action, actor, old_played_on, new_played_on, old_notes, new_notes, old_scores, new_scores) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)',
      [
        gameId,
        'delete_game',
        req.ip || 'unknown',
        beforeGameResult.rows[0].played_on,
        null,
        beforeGameResult.rows[0].notes,
        null,
        JSON.stringify(beforeScoresResult.rows.map(function (row) {
          return {
            playerId: row.player_id,
            playerName: row.player_name,
            score: row.score
          };
        })),
        JSON.stringify([])
      ]
    );

    await client.query('delete from games where id = $1', [gameId]);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  res.redirect('/?success=Game%20deleted');
}));

app.get('/audit', wrapAsync(async function (req, res) {
  var auditPage = await loadAuditPage();
  res.render('audit', auditPage);
}));

app.get('/jokers/new', wrapAsync(async function (req, res) {
  var jokerForm = await loadJokerForm();
  res.render('jokers', jokerForm);
}));

app.post('/jokers', wrapAsync(async function (req, res) {
  var playerId = toInteger(req.body.player_id);
  var jokersCount = toInteger(req.body.jokers_count);
  var gameId = toInteger(req.body.game_id);
  var handLabel = (req.body.hand_label || '').trim();
  var notes = (req.body.notes || '').trim();

  if (playerId === null || jokersCount === null) {
    var invalidJokers = await loadJokerForm();
    invalidJokers.error = 'Player and joker count are required.';
    return res.status(400).render('jokers', invalidJokers);
  }

  await requirePool().query(
    'insert into joker_hands (player_id, game_id, hand_label, jokers_count, notes) values ($1, $2, $3, $4, $5)',
    [playerId, gameId, handLabel || null, jokersCount, notes || null]
  );

  res.redirect('/jokers/new');
}));

app.get('/health', function (req, res) {
  res.json({ status: 'ok' });
});

app.use(function (err, req, res, next) {
  console.error(err);
  res.status(500).render('error', {
    title: 'Server error',
    error: err.message || 'Unexpected server error'
  });
});

app.listen(port, function () {
  console.log('Liverpool Rummy tracker listening on port ' + port);
});
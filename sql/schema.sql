create table if not exists players (
  id serial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id serial primary key,
  played_on date not null default current_date,
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table games add column if not exists completed_at timestamptz;

create table if not exists game_players (
  id serial primary key,
  game_id integer not null references games(id) on delete cascade,
  player_id integer not null references players(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (game_id, player_id)
);

create table if not exists game_hands (
  id serial primary key,
  game_id integer not null references games(id) on delete cascade,
  hand_number integer not null check (hand_number > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (game_id, hand_number)
);

create table if not exists hand_scores (
  id serial primary key,
  hand_id integer not null references game_hands(id) on delete cascade,
  player_id integer not null references players(id) on delete restrict,
  score integer not null check (score >= 0),
  created_at timestamptz not null default now(),
  unique (hand_id, player_id)
);

insert into game_players (game_id, player_id)
select distinct gs.game_id, gs.player_id
from game_scores gs
left join game_players gp on gp.game_id = gs.game_id and gp.player_id = gs.player_id
where gp.id is null;

insert into game_hands (game_id, hand_number, notes)
select distinct gs.game_id, 1, 'Imported from legacy final scores'
from game_scores gs
left join game_hands gh on gh.game_id = gs.game_id
where gh.id is null;

insert into hand_scores (hand_id, player_id, score)
select gh.id, gs.player_id, gs.score
from game_hands gh
join game_scores gs on gs.game_id = gh.game_id
left join hand_scores hs on hs.hand_id = gh.id and hs.player_id = gs.player_id
where gh.hand_number = 1 and hs.id is null;

create table if not exists game_scores (
  id serial primary key,
  game_id integer not null references games(id) on delete cascade,
  player_id integer not null references players(id) on delete restrict,
  score integer not null check (score >= 0),
  created_at timestamptz not null default now(),
  unique (game_id, player_id)
);

create table if not exists joker_hands (
  id serial primary key,
  player_id integer not null references players(id) on delete restrict,
  game_id integer references games(id) on delete set null,
  hand_label text,
  jokers_count integer not null check (jokers_count >= 0),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists game_audit_log (
  id serial primary key,
  game_id integer not null,
  action text not null check (action in ('update_scores', 'delete_game')),
  actor text,
  old_played_on date,
  new_played_on date,
  old_notes text,
  new_notes text,
  old_scores jsonb not null default '[]'::jsonb,
  new_scores jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_games_played_on on games (played_on desc, id desc);
create index if not exists idx_game_scores_game_id on game_scores (game_id);
create index if not exists idx_game_scores_player_id on game_scores (player_id);
create index if not exists idx_game_players_game_id on game_players (game_id);
create index if not exists idx_game_hands_game_id on game_hands (game_id, hand_number);
create index if not exists idx_hand_scores_hand_id on hand_scores (hand_id);
create index if not exists idx_joker_hands_player_id on joker_hands (player_id);
create index if not exists idx_joker_hands_jokers_count on joker_hands (jokers_count desc, created_at desc);
create index if not exists idx_game_audit_log_game_id on game_audit_log (game_id, created_at desc);
create index if not exists idx_game_audit_log_created_at on game_audit_log (created_at desc);
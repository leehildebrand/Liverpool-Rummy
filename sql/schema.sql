create table if not exists players (
  id serial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists games (
  id serial primary key,
  played_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

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
create index if not exists idx_joker_hands_player_id on joker_hands (player_id);
create index if not exists idx_joker_hands_jokers_count on joker_hands (jokers_count desc, created_at desc);
create index if not exists idx_game_audit_log_game_id on game_audit_log (game_id, created_at desc);
create index if not exists idx_game_audit_log_created_at on game_audit_log (created_at desc);
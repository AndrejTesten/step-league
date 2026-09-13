-- StepLeague database schema for Supabase (Postgres).
-- Run this once in the Supabase SQL editor (or via `supabase db push`)
-- against a fresh project. Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- profiles — one row per auth.users row, created client-side right after
-- sign-up (see lib/auth-context.tsx). Stores the device's IANA timezone so
-- the nightly rollup function (which runs server-side with no local clock
-- of its own) knows when 22:00 actually is for this person.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  timezone text not null default 'UTC',
  is_pro boolean not null default false,
  avatar_url text,
  city text,
  country text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists daily_goal integer not null default 10000 check (daily_goal > 0);
-- roast_mode shipped in an earlier version and was removed along with the
-- "roast mode" UI (see commit "Restyle leaderboards and leagues, remove
-- roast mode") — dropped here too so it doesn't linger as dead schema.
alter table public.profiles drop column if exists roast_mode;

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by any signed-in user" on public.profiles;
create policy "profiles are readable by any signed-in user"
  on public.profiles for select
  to authenticated
  using (true);
  -- Fine for v1 (username/display_name/timezone/city/country aren't
  -- sensitive). This also backs the city/country/global leaderboards in
  -- get_leaderboard() below — note the README's original call to cut public
  -- geographic leaderboards for anti-cheat/moderation reasons still applies
  -- once this ships to real users; get_leaderboard() only exposes aggregated
  -- step totals, not raw daily_steps, as a partial mitigation.

drop policy if exists "users insert their own profile" on public.profiles;
create policy "users insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- leagues + league_members — table definitions are grouped before any
-- policies because the two tables' RLS policies each reference the other
-- table (leagues.select checks league_members; league_members.insert checks
-- leagues), so both must exist before either policy can be created.
-- ---------------------------------------------------------------------------
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  deadline date not null,
  -- Null means "never restarted" — keeps existing leagues counting steps
  -- from each member's own join date, exactly as before this column
  -- existed. Only set (to today) by restart_league() below, at which point
  -- everyone's total for THIS round starts counting from that date instead
  -- of their original join date.
  current_round_start date,
  round_number integer not null default 1,
  created_at timestamptz not null default now()
);

alter table public.leagues add column if not exists current_round_start date;
alter table public.leagues add column if not exists round_number integer not null default 1;

create table if not exists public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;

-- Members can see the leagues they belong to. Non-members can't SELECT a
-- league by guessing its id/invite_code directly — joining goes through the
-- join_league() function below (SECURITY DEFINER), which validates the
-- invite code and the deadline before adding anyone.
-- created_by = auth.uid() is listed explicitly (not just "you're a member")
-- because createLeague() does an INSERT ... RETURNING, and Postgres applies
-- this SELECT policy to that returned row. The creator is only added to
-- league_members by an AFTER INSERT trigger (add_creator_as_member below),
-- which loses the race against RETURNING's own permission check — without
-- this clause, creating a league fails with "new row violates row-level
-- security policy for table leagues" every time.
drop policy if exists "members can view their leagues" on public.leagues;
create policy "members can view their leagues"
  on public.leagues for select
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.league_members lm
      where lm.league_id = leagues.id and lm.user_id = auth.uid()
    )
  );

drop policy if exists "users create leagues as themselves" on public.leagues;
create policy "users create leagues as themselves"
  on public.leagues for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "creator can update league" on public.leagues;
create policy "creator can update league"
  on public.leagues for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- A SELECT policy on league_members that subqueries league_members itself
-- (e.g. "exists (select 1 from league_members mine where ...)") causes
-- Postgres to recurse: evaluating the policy re-triggers the same policy
-- for the subquery's own scan of the table, forever (error 42P17,
-- "infinite recursion detected in policy"). Routing the membership check
-- through a SECURITY DEFINER function sidesteps this — the function's
-- internal query runs as the function owner and bypasses RLS entirely, so
-- it never re-enters this policy. Every other policy that subqueries
-- league_members (on leagues, daily_steps, leaderboard_snapshots) is
-- downstream of this one and is fixed the same way it's fixed here.
create or replace function public.is_league_member(p_league_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.league_members
    where league_id = p_league_id and user_id = p_user_id
  );
$$;

drop policy if exists "members can view fellow members" on public.league_members;
create policy "members can view fellow members"
  on public.league_members for select
  to authenticated
  using (public.is_league_member(league_members.league_id, auth.uid()));

drop policy if exists "creator adds themself on league creation" on public.league_members;
create policy "creator adds themself on league creation"
  on public.league_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.leagues l
      where l.id = league_members.league_id and l.created_by = auth.uid()
    )
  );
  -- Joining an *existing* league (someone else's) always goes through
  -- join_league() below, which runs as SECURITY DEFINER and bypasses this
  -- policy after validating the invite code and deadline.

-- ---------------------------------------------------------------------------
-- daily_steps — one row per user per calendar day, in the user's own
-- timezone. Upserted from the device whenever HealthKit / Health Connect
-- reports new data (see lib/steps.ts).
-- ---------------------------------------------------------------------------
create table if not exists public.daily_steps (
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  steps integer not null default 0 check (steps >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.daily_steps enable row level security;

-- No insert/update/delete policy for regular users at all, on purpose — the
-- old "for all" policy here let a client issue a raw insert/update on their
-- own daily_steps rows with only `steps >= 0` enforced, which meant setting
-- an arbitrary step count for any day and winning every leaderboard/league
-- it feeds. Every write now has to go through upsert_daily_steps_monotonic()
-- (SECURITY DEFINER, below), the only place the monotonic/anti-cheat
-- guarantee is enforced.
drop policy if exists "users manage their own steps" on public.daily_steps;
drop policy if exists "users view their own steps" on public.daily_steps;
create policy "users view their own steps"
  on public.daily_steps for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "league-mates can view today's live steps" on public.daily_steps;
create policy "league-mates can view today's live steps"
  on public.daily_steps for select
  to authenticated
  using (
    exists (
      select 1
      from public.league_members mine
      join public.league_members theirs on theirs.league_id = mine.league_id
      where mine.user_id = auth.uid() and theirs.user_id = daily_steps.user_id
    )
  );

-- lifetime_steps — a running total of daily_steps, maintained incrementally
-- by upsert_daily_steps_monotonic() below instead of recomputed with
-- sum(daily_steps.steps) on every leaderboard request. At friend-group
-- scale the join+aggregate was fine; at real scale it's work proportional
-- to every day of history of every user in scope, on every single request,
-- forever. Reading one column instead is O(1) per user.
alter table public.profiles add column if not exists lifetime_steps bigint not null default 0;

-- One-time (and safe-to-repeat) backfill for rows that predate the column —
-- only touches profiles still sitting at the default, so it never clobbers
-- a value the incremental updates have already gotten right.
update public.profiles p
set lifetime_steps = coalesce((select sum(ds.steps) from public.daily_steps ds where ds.user_id = p.id), 0)
where lifetime_steps = 0;

-- HealthKit/Health Connect periodically *revise* a day's total, and not
-- always upward — a contributing app can overcount a burst of arm motion as
-- steps and correct it back down minutes later, or a permission hiccup can
-- make a sync see a narrower window than a previous one did. A plain upsert
-- would make the user's displayed step count visibly drop, which reads as
-- broken no matter how technically accurate. Taking the greatest of the
-- existing and incoming value — atomically, so two concurrent syncs can't
-- race each other into a lower result — means the count can only go up
-- within a day, matching what every other step-counting app does.
--
-- Also maintains profiles.lifetime_steps (see below) incrementally: computes
-- each affected day's real delta (0 if the incoming value doesn't actually
-- raise it) *before* the upsert runs, using a temp table rather than nested
-- JSON lookups so the arithmetic stays easy to verify by reading it. This is
-- the only place daily_steps is ever written to, so it's the only place that
-- needs to keep the running total honest.
create or replace function public.upsert_daily_steps_monotonic(p_entries jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta bigint;
begin
  -- 120 calls per rolling 10 minutes — the client syncs roughly every 15s
  -- while foregrounded (~40 calls/10min steady state), so this leaves
  -- headroom for foreground/background bursts while still blocking a
  -- compromised client from hammering this RPC to load the DB.
  if not public.check_rate_limit('sync_steps', 120, 600) then
    raise exception 'Too many step syncs — please slow down.';
  end if;

  create temporary table if not exists tmp_step_entries (date date primary key, steps integer) on commit drop;
  delete from tmp_step_entries;
  insert into tmp_step_entries (date, steps)
  select (e->>'date')::date, (e->>'steps')::integer
  from jsonb_array_elements(p_entries) as e;

  select coalesce(sum(greatest(coalesce(ds.steps, 0), t.steps) - coalesce(ds.steps, 0)), 0)
  into v_delta
  from tmp_step_entries t
  left join public.daily_steps ds on ds.user_id = auth.uid() and ds.date = t.date;

  insert into public.daily_steps (user_id, date, steps, updated_at)
  select auth.uid(), t.date, t.steps, now()
  from tmp_step_entries t
  on conflict (user_id, date) do update
    set steps = greatest(public.daily_steps.steps, excluded.steps),
        updated_at = excluded.updated_at;

  if v_delta <> 0 then
    update public.profiles set lifetime_steps = lifetime_steps + v_delta where id = auth.uid();
  end if;
end;
$$;

grant execute on function public.upsert_daily_steps_monotonic(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- leaderboard_snapshots — written only by the nightly rollup Edge Function
-- (using the service_role key, which bypasses RLS entirely). No insert
-- policy for regular users is defined on purpose: the standings are only
-- ever official once the server has computed them.
-- ---------------------------------------------------------------------------
create table if not exists public.leaderboard_snapshots (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  snapshot_date date not null,
  total_steps bigint not null default 0,
  rank integer not null,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id, snapshot_date)
);

alter table public.leaderboard_snapshots enable row level security;

drop policy if exists "members can view league snapshots" on public.leaderboard_snapshots;
create policy "members can view league snapshots"
  on public.leaderboard_snapshots for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members lm
      where lm.league_id = leaderboard_snapshots.league_id and lm.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Invite codes: short, unambiguous (no 0/O/1/I), auto-generated on insert.
-- ---------------------------------------------------------------------------
create or replace function public.generate_invite_code() returns text
language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  exists_already boolean;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;
    select exists(select 1 from public.leagues where invite_code = code) into exists_already;
    exit when not exists_already;
  end loop;
  return code;
end;
$$;

create or replace function public.set_invite_code() returns trigger
language plpgsql as $$
begin
  if new.invite_code is null or new.invite_code = '' then
    new.invite_code := public.generate_invite_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leagues_invite_code on public.leagues;
create trigger trg_leagues_invite_code
  before insert on public.leagues
  for each row execute function public.set_invite_code();

-- Creator becomes a member automatically, right after a league is created.
create or replace function public.add_creator_as_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.league_members (league_id, user_id)
  values (new.id, new.created_by)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_leagues_add_creator on public.leagues;
create trigger trg_leagues_add_creator
  after insert on public.leagues
  for each row execute function public.add_creator_as_member();

-- ---------------------------------------------------------------------------
-- join_league(code) — the only way to join a league you didn't create.
-- SECURITY DEFINER so it can look up a league by invite code even though the
-- caller has no SELECT rights on it yet, but it only ever returns/uses the
-- minimal fields needed and validates the deadline before inserting.
-- ---------------------------------------------------------------------------
create or replace function public.join_league(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league_id uuid;
  v_deadline date;
begin
  -- 10 attempts per rolling 10 minutes — a 6-char invite code is 32^6
  -- combinations, not guessable by a person mistyping, but scriptable
  -- without this cap. Checked before the lookup so even failed guesses
  -- count against the limit.
  if not public.check_rate_limit('join_league', 10, 600) then
    raise exception 'Too many join attempts — wait a few minutes and try again.';
  end if;

  select id, deadline into v_league_id, v_deadline
  from public.leagues
  where invite_code = upper(p_invite_code);

  if v_league_id is null then
    raise exception 'No league found for that invite code.';
  end if;

  if v_deadline < current_date then
    raise exception 'This league has already ended.';
  end if;

  insert into public.league_members (league_id, user_id)
  values (v_league_id, auth.uid())
  on conflict do nothing;

  return v_league_id;
end;
$$;

grant execute on function public.join_league(text) to authenticated;

-- get_league_preview(code) — lets the join screen show "Marko's Friends,
-- 5 members, ends Sep 30" before the user commits to joining.
create or replace function public.get_league_preview(p_invite_code text)
returns table (id uuid, name text, deadline date, member_count bigint)
language sql
security definer
set search_path = public
as $$
  select l.id, l.name, l.deadline, count(lm.user_id) as member_count
  from public.leagues l
  left join public.league_members lm on lm.league_id = l.id
  where l.invite_code = upper(p_invite_code)
  group by l.id, l.name, l.deadline;
$$;

grant execute on function public.get_league_preview(text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_leaderboard(scope, value, search, limit, offset) — the City / Country /
-- Global leaderboard tabs. Ranks every profile by lifetime_steps (see the
-- running-total column above) — simplest definition that needs no
-- timezone-aware "which day is it for them" logic, unlike the friend-league
-- leaderboard above. SECURITY DEFINER so it can rank across every profile
-- without needing to open up daily_steps' own RLS.
-- p_scope is 'global' | 'city' | 'country'; p_value is the city/country name
-- to filter to (ignored for 'global'). p_search matches display_name and is
-- applied *after* ranking, so a searched-for user still shows their true
-- rank rather than a position within just the filtered set. p_limit/p_offset
-- page through the (already-ranked) result, e.g. 20 rows at a time.
-- ---------------------------------------------------------------------------
drop function if exists public.get_leaderboard(text, text);

create or replace function public.get_leaderboard(
  p_scope text,
  p_value text default null,
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  city text,
  country text,
  total_steps bigint,
  rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select
      p.id as user_id,
      p.display_name,
      p.avatar_url,
      p.city,
      p.country,
      p.lifetime_steps as total_steps
    from public.profiles p
    where
      p_scope = 'global'
      or (p_scope = 'country' and p.country is not distinct from p_value)
      or (p_scope = 'city' and p.city is not distinct from p_value)
  ),
  ranked as (
    select *, rank() over (order by total_steps desc) as rank
    from scoped
  )
  select user_id, display_name, avatar_url, city, country, total_steps, rank
  from ranked
  where p_search is null or p_search = '' or display_name ilike '%' || p_search || '%'
  order by rank asc
  limit least(greatest(coalesce(p_limit, 20), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.get_leaderboard(text, text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- get_leaderboard_rank_summary(scope, value) — "Your place in Poland: 4,182
-- of 91,203, top 5%" hero stat on the global leaderboard screen. Same
-- ranking definition as get_leaderboard() above (kept in sync manually,
-- since Postgres has no clean way to share a CTE between two functions);
-- returns nulls for my_rank when the caller has no steps logged in scope.
-- ---------------------------------------------------------------------------
create or replace function public.get_leaderboard_rank_summary(
  p_scope text,
  p_value text default null
)
returns table (my_rank bigint, total bigint)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select
      p.id as user_id,
      p.lifetime_steps as total_steps
    from public.profiles p
    where
      p_scope = 'global'
      or (p_scope = 'country' and p.country is not distinct from p_value)
      or (p_scope = 'city' and p.city is not distinct from p_value)
  ),
  ranked as (
    select *, rank() over (order by total_steps desc) as rank
    from scoped
  )
  select
    (select rank from ranked where user_id = auth.uid()) as my_rank,
    (select count(*) from ranked) as total;
$$;

grant execute on function public.get_leaderboard_rank_summary(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- search_locations(scope, query) — powers the city/country picker above the
-- leaderboard tabs. Only surfaces cities/countries that at least one profile
-- has actually set (searching the whole world's cities would mostly return
-- leaderboards with zero people in them), ordered by member count so the
-- most relevant matches sort first. SECURITY DEFINER for the same reason as
-- get_leaderboard: callers only get back city/country names and counts, no
-- other profile columns.
-- ---------------------------------------------------------------------------
create or replace function public.search_locations(p_scope text, p_query text default '')
returns table (value text, member_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when p_scope = 'city' then p.city else p.country end as value,
    count(*) as member_count
  from public.profiles p
  where
    (p_scope = 'city' and p.city is not null and p.city ilike '%' || coalesce(p_query, '') || '%')
    or (p_scope = 'country' and p.country is not null and p.country ilike '%' || coalesce(p_query, '') || '%')
  group by case when p_scope = 'city' then p.city else p.country end
  order by member_count desc, value asc
  limit 30;
$$;

grant execute on function public.search_locations(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Avatar photos — public read (they're profile pictures shown to anyone
-- sharing a league or leaderboard with you), write restricted to a user's
-- own folder (avatars/<user_id>/...).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar images are publicly accessible" on storage.objects;
create policy "avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users update their own avatar" on storage.objects;
create policy "users update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- league_nemeses — one optional rival pick per (league, user). Purely a
-- personal display preference (no gameplay effect), so a user only ever
-- needs to read/write their own row.
-- ---------------------------------------------------------------------------
create table if not exists public.league_nemeses (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  nemesis_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id),
  check (user_id <> nemesis_user_id)
);

alter table public.league_nemeses enable row level security;

drop policy if exists "users manage their own nemesis pick" on public.league_nemeses;
create policy "users manage their own nemesis pick"
  on public.league_nemeses for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- reactions — one emoji per (reactor, target, day) within a league, e.g.
-- tapping 🔥 on a league-mate's big day. Upserted client-side (same reactor
-- reacting again just changes the emoji, see lib/leagues.ts).
-- ---------------------------------------------------------------------------
create table if not exists public.reactions (
  league_id uuid not null references public.leagues (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (league_id, from_user_id, to_user_id, date)
);

alter table public.reactions enable row level security;

drop policy if exists "league-mates can view reactions" on public.reactions;
create policy "league-mates can view reactions"
  on public.reactions for select
  to authenticated
  using (public.is_league_member(reactions.league_id, auth.uid()));

drop policy if exists "league-mates can react as themselves" on public.reactions;
create policy "league-mates can react as themselves"
  on public.reactions for insert
  to authenticated
  with check (
    from_user_id = auth.uid()
    and public.is_league_member(reactions.league_id, auth.uid())
    and public.is_league_member(reactions.league_id, reactions.to_user_id)
  );

drop policy if exists "users update their own reaction" on public.reactions;
create policy "users update their own reaction"
  on public.reactions for update
  to authenticated
  using (from_user_id = auth.uid())
  with check (from_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- league_round_history — one row per *finished* round of a league, written
-- only by restart_league() below. Standings for a past round aren't stored
-- here (they're recomputed on demand from daily_steps, which is never
-- deleted — see lib/leagues.ts getLeagueHistory), just the date range that
-- round covered.
-- ---------------------------------------------------------------------------
create table if not exists public.league_round_history (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  round_number integer not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);

alter table public.league_round_history enable row level security;

drop policy if exists "league-mates can view round history" on public.league_round_history;
create policy "league-mates can view round history"
  on public.league_round_history for select
  to authenticated
  using (public.is_league_member(league_round_history.league_id, auth.uid()));
  -- No insert policy for regular users — only restart_league() (SECURITY
  -- DEFINER) writes here, after checking the caller is the league creator
  -- and the current round has actually ended.

-- ---------------------------------------------------------------------------
-- restart_league(league_id, new_deadline) — archives the just-ended round
-- into league_round_history, then resets the league for a new one. Only the
-- creator can do this, and only after the current round's deadline has
-- passed. Every daily_steps row from the old round stays exactly where it
-- is (that's what makes past standings still recomputable afterward) — this
-- only moves the goalposts (current_round_start, deadline, round_number)
-- for what counts toward the *new* round.
-- ---------------------------------------------------------------------------
-- p_member_ids: when provided, everyone currently in league_members who is
-- NOT the creator and NOT in this list is removed as part of the restart —
-- the rematch screen's "who's playing this round" picker. Null (the
-- default) means "keep everyone," so older clients calling this with just
-- the first two arguments still work unchanged. The creator is never
-- removable this way — see leave_league() below for exits.
create or replace function public.restart_league(
  p_league_id uuid,
  p_new_deadline date,
  p_member_ids uuid[] default null,
  p_winner_stakes text default null,
  p_loser_stakes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league public.leagues;
begin
  select * into v_league from public.leagues where id = p_league_id;

  if v_league is null then
    raise exception 'League not found.';
  end if;
  if v_league.created_by <> auth.uid() then
    raise exception 'Only the league creator can start a new round.';
  end if;
  if v_league.deadline >= current_date then
    raise exception 'This round has not ended yet.';
  end if;
  if p_new_deadline < current_date then
    raise exception 'Pick a date in the future.';
  end if;

  insert into public.league_round_history (league_id, round_number, start_date, end_date)
  values (
    p_league_id,
    v_league.round_number,
    coalesce(v_league.current_round_start, v_league.created_at::date),
    v_league.deadline
  );

  update public.leagues
  set deadline = p_new_deadline,
      current_round_start = current_date,
      round_number = v_league.round_number + 1,
      winner_stakes = p_winner_stakes,
      loser_stakes = p_loser_stakes
  where id = p_league_id;

  if p_member_ids is not null then
    delete from public.league_members
    where league_id = p_league_id
      and user_id <> v_league.created_by
      and user_id <> all(p_member_ids);
  end if;
end;
$$;

grant execute on function public.restart_league(uuid, date, uuid[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- leave_league() — a member removes themselves. The creator can't use this
-- (their league would be left with no owner able to restart it or manage
-- it) — they'd need a "delete league" or "transfer ownership" feature,
-- neither of which exists yet, so for now the creator simply can't exit
-- their own league at all.
-- ---------------------------------------------------------------------------
create or replace function public.leave_league(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_by uuid;
begin
  select created_by into v_created_by from public.leagues where id = p_league_id;

  if v_created_by is null then
    raise exception 'League not found.';
  end if;
  if v_created_by = auth.uid() then
    raise exception 'As the creator, you can''t leave your own league.';
  end if;

  delete from public.league_members
  where league_id = p_league_id and user_id = auth.uid();
end;
$$;

grant execute on function public.leave_league(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- scoring_mode + is_public — added for the "Modernist" redesign's create-
-- league screen. scoring_mode is informational for now (leaderboards still
-- rank by total_steps either way; 'daily_wins' just changes what the create
-- screen's copy promises and which stat the UI leads with) — the "Pts"
-- column shown on every league (see getLeagueDailyWins in lib/leagues.ts) is
-- derived from leaderboard_snapshots and needs no schema support of its own.
-- ---------------------------------------------------------------------------
alter table public.leagues add column if not exists scoring_mode text not null default 'total_steps'
  check (scoring_mode in ('total_steps', 'daily_wins'));
alter table public.leagues add column if not exists is_public boolean not null default false;

-- winner_stakes / loser_stakes — both optional, purely informational
-- (freeform text the league creator writes, e.g. "Winner picks the next
-- restaurant" / "Loser buys coffee for a week"). Nothing in the app
-- enforces or verifies these get honored — it's a house-rule the members
-- agree to themselves, the same way a real office pool works.
alter table public.leagues add column if not exists winner_stakes text check (char_length(winner_stakes) <= 140);
alter table public.leagues add column if not exists loser_stakes text check (char_length(loser_stakes) <= 140);

-- ---------------------------------------------------------------------------
-- search_public_leagues / join_public_league — the join screen's "Open
-- leagues near you" section. Mirrors get_league_preview()/join_league()
-- above, but keyed by public.leagues.is_public instead of an invite code.
-- ---------------------------------------------------------------------------
create or replace function public.search_public_leagues(
  p_city text default null,
  p_country text default null,
  p_query text default null
)
returns table (id uuid, name text, deadline date, member_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.name, l.deadline, count(lm.user_id) as member_count
  from public.leagues l
  left join public.league_members lm on lm.league_id = l.id
  where l.is_public = true
    and l.deadline >= current_date
    and (p_query is null or p_query = '' or l.name ilike '%' || p_query || '%')
  group by l.id, l.name, l.deadline
  order by
    -- Leagues with a member from the same city/country as the caller sort
    -- first, then everything else, newest-created first within each group.
    case
      when p_city is not null and exists (
        select 1 from public.league_members m2
        join public.profiles p2 on p2.id = m2.user_id
        where m2.league_id = l.id and p2.city is not distinct from p_city
      ) then 0
      when p_country is not null and exists (
        select 1 from public.league_members m3
        join public.profiles p3 on p3.id = m3.user_id
        where m3.league_id = l.id and p3.country is not distinct from p_country
      ) then 1
      else 2
    end,
    l.created_at desc
  limit 30;
$$;

grant execute on function public.search_public_leagues(text, text, text) to authenticated;

create or replace function public.join_public_league(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_public boolean;
  v_deadline date;
begin
  if not public.check_rate_limit('join_public_league', 20, 600) then
    raise exception 'Too many join attempts — wait a few minutes and try again.';
  end if;

  select is_public, deadline into v_is_public, v_deadline
  from public.leagues where id = p_league_id;

  if v_is_public is null or v_is_public = false then
    raise exception 'This league is not open to join.';
  end if;
  if v_deadline < current_date then
    raise exception 'This league has already ended.';
  end if;

  insert into public.league_members (league_id, user_id)
  values (p_league_id, auth.uid())
  on conflict do nothing;
end;
$$;

grant execute on function public.join_public_league(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- messages — league chat (design screen "1g"). One flat table per league;
-- members can read and post, using the same is_league_member() helper every
-- other league-scoped policy above uses (avoids the RLS self-recursion that
-- function exists to sidestep).
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists messages_league_id_created_at_idx on public.messages (league_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "league-mates can view messages" on public.messages;
create policy "league-mates can view messages"
  on public.messages for select
  to authenticated
  using (public.is_league_member(messages.league_id, auth.uid()));

drop policy if exists "league-mates can post messages" on public.messages;
create policy "league-mates can post messages"
  on public.messages for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_league_member(messages.league_id, auth.uid()));

-- Realtime: lets the league chat UI subscribe to new rows instead of
-- polling. Safe to re-run — Postgres just errors quietly if already added,
-- which this ignores.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Premium: is_pro (already existed as a stub) now actually gates something.
-- color_theme is the chosen accent palette — 'lime' is the free default; the
-- other four (cyan/ember/violet/mono) are premium. Enforcement of "premium
-- only" happens client-side for theme selection (cosmetic, low stakes) but
-- server-side for peeks below (a real quota worth actually enforcing).
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists color_theme text not null default 'lime'
  check (color_theme in ('lime', 'cyan', 'ember', 'violet', 'paper', 'mono'));

-- is_pro must never be settable by the client SDK — the "users update their
-- own profile" policy above is a row-level check (id = auth.uid()), which
-- says nothing about which *columns* a user may touch, so without this an
-- authenticated client can run `update profiles set is_pro = true` on their
-- own row and grant themselves premium for free.
--
-- A column-level `revoke update (is_pro) ...` alone does NOT fix this: every
-- Supabase project grants table-wide `update` on all public tables to
-- anon/authenticated by default (so RLS policies, not column grants, are
-- normally what limits writes), and a table-wide grant covers every column
-- regardless of a more specific column-level revoke layered on top. The only
-- way to actually carve out one column is to revoke the table-wide privilege
-- entirely and re-grant UPDATE on an explicit allow-list of the columns the
-- app's UI actually lets a user edit — leaving is_pro (and username,
-- display_name, timezone, created_at) off that list.
--
-- The service_role key — used only by Edge Functions / a verified-purchase
-- webhook, never shipped to the app — bypasses grants entirely, so that
-- remains the sole way to flip is_pro once real billing is wired up. Until
-- then, flip it manually for testing via the Supabase SQL editor:
-- update public.profiles set is_pro = true where id = '<uuid>';
revoke update on public.profiles from authenticated, anon;
grant update (city, country, daily_goal, color_theme, avatar_url) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- peek_usage — one row per (user, local day), counting how many times
-- they've used a live "Peek" today. Free = 1/day, premium = 3/day. Written
-- only through use_peek() below so the limit can't be bypassed by a client
-- just upserting a higher count into its own row.
-- ---------------------------------------------------------------------------
create table if not exists public.peek_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  count integer not null default 0,
  primary key (user_id, date)
);

alter table public.peek_usage enable row level security;

drop policy if exists "users view their own peek usage" on public.peek_usage;
create policy "users view their own peek usage"
  on public.peek_usage for select
  to authenticated
  using (user_id = auth.uid());
  -- No insert/update policy for regular users — only use_peek() (SECURITY
  -- DEFINER) writes here, so the daily cap is actually enforced server-side.

-- use_peek() — atomically checks today's count against the caller's limit
-- (1 free, 3 premium) and increments it if allowed. Returns whether this
-- call was allowed and how many peeks remain today, so the client can show
-- "2 of 3 left" without a second round trip.
create or replace function public.use_peek()
returns table (allowed boolean, remaining integer, is_pro boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_pro boolean;
  v_limit integer;
  v_today date := current_date;
  v_count integer;
begin
  select p.is_pro into v_is_pro from public.profiles p where p.id = auth.uid();
  v_limit := case when v_is_pro then 3 else 1 end;

  insert into public.peek_usage (user_id, date, count)
  values (auth.uid(), v_today, 0)
  on conflict (user_id, date) do nothing;

  select pu.count into v_count
  from public.peek_usage pu
  where pu.user_id = auth.uid() and pu.date = v_today
  for update;

  if v_count >= v_limit then
    return query select false, greatest(v_limit - v_count, 0), coalesce(v_is_pro, false);
    return;
  end if;

  update public.peek_usage
  set count = count + 1
  where user_id = auth.uid() and date = v_today;

  return query select true, (v_limit - (v_count + 1)), coalesce(v_is_pro, false);
end;
$$;

grant execute on function public.use_peek() to authenticated;

-- peeks_remaining_today() — read-only version of the same limit check, so
-- the UI can show "2 of 3 left" on screen load without consuming a peek.
create or replace function public.peeks_remaining_today()
returns table (remaining integer, is_pro boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_pro boolean;
  v_limit integer;
  v_count integer;
begin
  select p.is_pro into v_is_pro from public.profiles p where p.id = auth.uid();
  v_limit := case when v_is_pro then 3 else 1 end;

  select pu.count into v_count
  from public.peek_usage pu
  where pu.user_id = auth.uid() and pu.date = current_date;

  return query select greatest(v_limit - coalesce(v_count, 0), 0), coalesce(v_is_pro, false);
end;
$$;

grant execute on function public.peeks_remaining_today() to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_league_history() — every league (finished or live) the caller has
-- ever been a member of, with their finishing/current position and total —
-- powers the premium Stat History screen's "Every league you've played"
-- list. Recomputed from daily_steps like every other standings query in
-- this app (see lib/leagues.ts), not stored.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_league_ids()
returns table (league_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select league_id from public.league_members where user_id = auth.uid();
$$;

grant execute on function public.get_my_league_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Performance indexes. Every table so far has relied on its primary key for
-- lookups, which only helps when the PK's *leading* column is what you're
-- filtering by — league_members' PK is (league_id, user_id), so "leagues
-- this user belongs to" (listMyLeagues, get_my_league_ids, and the
-- correlated-subquery membership checks inside several RLS policies above)
-- was a full scan on user_id, not an index lookup. Same story for
-- leaderboard_snapshots: PK is (league_id, user_id, snapshot_date), but
-- getMyTotalWins()/getMySnapshotWinStats() (profile "Wins" stat, premium
-- Stat History's win rate) filter by user_id first. And get_leaderboard()'s
-- city/country scoping had nothing but a sequential scan over all of
-- profiles to find matches (reactions' own PK already leads with league_id,
-- so no extra index needed there). None of this broke anything at friend-group
-- scale; all of it gets linearly worse as the user base grows, which is
-- exactly when it's hardest to fix without downtime — adding these now,
-- while the tables are still small and the index builds are instant, is the
-- cheap time to do it.
-- ---------------------------------------------------------------------------
create index if not exists league_members_user_id_idx on public.league_members (user_id);
create index if not exists leaderboard_snapshots_user_id_snapshot_date_idx on public.leaderboard_snapshots (user_id, snapshot_date);
create index if not exists profiles_country_idx on public.profiles (country);
create index if not exists profiles_city_idx on public.profiles (city);
-- Lets get_leaderboard()'s rank() over (order by lifetime_steps desc) walk
-- profiles in already-sorted order instead of sorting the whole table on
-- every request — the single most-hit query in the app at real scale.
create index if not exists profiles_lifetime_steps_idx on public.profiles (lifetime_steps desc);

-- (The scaling limit that used to be documented here — get_leaderboard()
-- and get_leaderboard_rank_summary() re-summing all of daily_steps on every
-- call — is fixed above: both now read profiles.lifetime_steps, a running
-- total maintained incrementally by upsert_daily_steps_monotonic().)

-- ---------------------------------------------------------------------------
-- Rate limiting. use_peek() already had its own bespoke daily-quota table
-- (peek_usage) because "1 free / 3 premium per day" is a product feature,
-- not just abuse prevention. Everything below is purely abuse prevention —
-- capping how fast one account can hit a handful of write paths that were
-- previously uncapped: brute-forcing a league's 6-character invite code
-- (32^6 combinations — not guessable by hand, but trivial to script without
-- a cap), flooding a league's chat, mass-creating leagues, or spamming
-- reactions. One generic table + one generic function, reused by every
-- policy/function below via a distinct `p_action` key per limit, rather
-- than a bespoke table per action like peek_usage — these limits don't need
-- peek's "reset at local midnight" semantics, just a plain sliding window.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  user_id uuid not null references public.profiles (id) on delete cascade,
  action text not null,
  window_start timestamptz not null default now(),
  count integer not null default 0,
  primary key (user_id, action)
);

alter table public.rate_limits enable row level security;
-- No policies for regular users at all, on purpose — this table is only
-- ever read or written by check_rate_limit() below (SECURITY DEFINER), so
-- a client can't inspect or reset its own limits.

-- Returns true if the action is allowed (and records it), false if the
-- caller has hit p_max calls within the trailing p_window_seconds. Callers
-- decide what to do with `false` — an RPC raises an exception; an RLS
-- `with check` clause just makes the whole insert fail closed.
create or replace function public.check_rate_limit(p_action text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count integer;
begin
  insert into public.rate_limits (user_id, action, window_start, count)
  values (auth.uid(), p_action, v_now, 0)
  on conflict (user_id, action) do nothing;

  select window_start, count into v_window_start, v_count
  from public.rate_limits
  where user_id = auth.uid() and action = p_action
  for update;

  if v_now - v_window_start > make_interval(secs => p_window_seconds) then
    update public.rate_limits set window_start = v_now, count = 1
    where user_id = auth.uid() and action = p_action;
    return true;
  end if;

  if v_count >= p_max then
    return false;
  end if;

  update public.rate_limits set count = count + 1
  where user_id = auth.uid() and action = p_action;
  return true;
end;
$$;

grant execute on function public.check_rate_limit(text, integer, integer) to authenticated;

-- League chat: 20 messages per rolling minute — generous for a real
-- conversation, blocks a flood.
drop policy if exists "league-mates can post messages" on public.messages;
create policy "league-mates can post messages"
  on public.messages for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_league_member(messages.league_id, auth.uid())
    and public.check_rate_limit('send_message', 20, 60)
  );

-- League creation: 10 per rolling hour — nobody legitimately creates
-- leagues faster than that; blocks using league creation to spam other
-- tables (add_creator_as_member, invite codes, etc.).
drop policy if exists "users create leagues as themselves" on public.leagues;
create policy "users create leagues as themselves"
  on public.leagues for insert
  to authenticated
  with check (created_by = auth.uid() and public.check_rate_limit('create_league', 10, 3600));

-- Reactions: 30 per rolling hour across both first-react (insert) and
-- changing an existing reaction (update) — reacting to every teammate a few
-- times a day is normal; hundreds an hour isn't.
drop policy if exists "league-mates can react as themselves" on public.reactions;
create policy "league-mates can react as themselves"
  on public.reactions for insert
  to authenticated
  with check (
    from_user_id = auth.uid()
    and public.is_league_member(reactions.league_id, auth.uid())
    and public.is_league_member(reactions.league_id, reactions.to_user_id)
    and public.check_rate_limit('react', 30, 3600)
  );

drop policy if exists "users update their own reaction" on public.reactions;
create policy "users update their own reaction"
  on public.reactions for update
  to authenticated
  using (from_user_id = auth.uid())
  with check (from_user_id = auth.uid() and public.check_rate_limit('react', 30, 3600));

-- ---------------------------------------------------------------------------
-- get_due_profile_ids — used by the nightly-rollup Edge Function. Computes
-- "whose local time is currently 22:00-22:14" in SQL and returns just those
-- ids, instead of the function pulling every profile's (id, timezone) row
-- on every 15-minute tick only to throw almost all of them away in JS. At
-- 100k profiles that was 100k rows fetched 96 times a day for the ~1% of
-- rows actually due; this returns O(due users) rows instead.
-- ---------------------------------------------------------------------------
create or replace function public.get_due_profile_ids(p_now timestamptz default now())
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where extract(hour from (p_now at time zone coalesce(p.timezone, 'UTC')))::int = 22
    and extract(minute from (p_now at time zone coalesce(p.timezone, 'UTC')))::int < 15;
$$;

grant execute on function public.get_due_profile_ids(timestamptz) to service_role;

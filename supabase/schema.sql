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
  roast_mode boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists roast_mode boolean not null default false;

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

drop policy if exists "users manage their own steps" on public.daily_steps;
create policy "users manage their own steps"
  on public.daily_steps for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

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

-- HealthKit/Health Connect periodically *revise* a day's total, and not
-- always upward — a contributing app can overcount a burst of arm motion as
-- steps and correct it back down minutes later, or a permission hiccup can
-- make a sync see a narrower window than a previous one did. A plain upsert
-- would make the user's displayed step count visibly drop, which reads as
-- broken no matter how technically accurate. Taking the greatest of the
-- existing and incoming value — atomically, so two concurrent syncs can't
-- race each other into a lower result — means the count can only go up
-- within a day, matching what every other step-counting app does.
create or replace function public.upsert_daily_steps_monotonic(p_entries jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.daily_steps (user_id, date, steps, updated_at)
  select auth.uid(), (e->>'date')::date, (e->>'steps')::integer, now()
  from jsonb_array_elements(p_entries) as e
  on conflict (user_id, date) do update
    set steps = greatest(public.daily_steps.steps, excluded.steps),
        updated_at = excluded.updated_at;
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
language plpgsql security definer as $$
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
-- Global leaderboard tabs. Ranks every profile by lifetime total steps
-- (simplest definition that needs no timezone-aware "which day is it for
-- them" logic, unlike the friend-league leaderboard above). SECURITY DEFINER
-- so it can aggregate across every user's daily_steps without needing to open
-- up daily_steps' own RLS — callers only ever get back the aggregated total,
-- not raw rows.
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
      coalesce(sum(ds.steps), 0) as total_steps
    from public.profiles p
    left join public.daily_steps ds on ds.user_id = p.id
    where
      p_scope = 'global'
      or (p_scope = 'country' and p.country is not distinct from p_value)
      or (p_scope = 'city' and p.city is not distinct from p_value)
    group by p.id, p.display_name, p.avatar_url, p.city, p.country
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
create or replace function public.restart_league(p_league_id uuid, p_new_deadline date)
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
      round_number = v_league.round_number + 1
  where id = p_league_id;
end;
$$;

grant execute on function public.restart_league(uuid, date) to authenticated;

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
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by any signed-in user" on public.profiles;
create policy "profiles are readable by any signed-in user"
  on public.profiles for select
  to authenticated
  using (true);
  -- Fine for v1 (username/display_name/timezone aren't sensitive, and we
  -- deliberately don't build public town/country leaderboards — see the
  -- README). If you add public leaderboards later, lock this down to
  -- "shares a league with me" like league_members below.

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
-- leagues
-- ---------------------------------------------------------------------------
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  deadline date not null,
  created_at timestamptz not null default now()
);

alter table public.leagues enable row level security;

-- Members can see the leagues they belong to. Non-members can't SELECT a
-- league by guessing its id/invite_code directly — joining goes through the
-- join_league() function below (SECURITY DEFINER), which validates the
-- invite code and the deadline before adding anyone.
drop policy if exists "members can view their leagues" on public.leagues;
create policy "members can view their leagues"
  on public.leagues for select
  to authenticated
  using (
    exists (
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

-- ---------------------------------------------------------------------------
-- league_members
-- ---------------------------------------------------------------------------
create table if not exists public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

alter table public.league_members enable row level security;

drop policy if exists "members can view fellow members" on public.league_members;
create policy "members can view fellow members"
  on public.league_members for select
  to authenticated
  using (
    exists (
      select 1 from public.league_members mine
      where mine.league_id = league_members.league_id and mine.user_id = auth.uid()
    )
  );

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

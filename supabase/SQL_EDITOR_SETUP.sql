-- Poker online rooms: paste this whole file into Supabase SQL Editor and run it.
-- This applies the combined result of the poker_rooms migrations for SQL Editor setups.
-- Clients cannot read or write this table directly. The rooms Edge Function uses
-- its server-side service role to validate and update complete game state.

begin;

create table if not exists public.poker_rooms (
  id text primary key check (id ~ '^[a-f0-9]{36}$'),
  host_user_id uuid not null,
  status text not null check (status in ('waiting', 'playing')),
  revision bigint not null default 0,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.poker_rooms enable row level security;
revoke all on public.poker_rooms from anon, authenticated;

alter table public.poker_rooms
  drop constraint if exists poker_rooms_status_check;
alter table public.poker_rooms
  add constraint poker_rooms_status_check
  check (status in ('waiting', 'playing', 'finished'));

create index if not exists poker_rooms_updated_at_idx on public.poker_rooms (updated_at);

comment on table public.poker_rooms is 'Private server-authoritative poker state. Clients must use the rooms Edge Function; full state includes private hole cards and deck.';

create table if not exists public.poker_room_rate_limits (
  user_id uuid primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
alter table public.poker_room_rate_limits enable row level security;
revoke all on public.poker_room_rate_limits from anon, authenticated;

create or replace function public.consume_room_rate_limit(
  p_user_id uuid, p_now timestamptz, p_limit integer, p_window_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare current_count integer;
begin
  if p_limit < 1 or p_window_ms < 1 then return false; end if;
  insert into public.poker_room_rate_limits (user_id, window_started_at, request_count)
  values (p_user_id, p_now, 1)
  on conflict (user_id) do update
    set window_started_at = case when public.poker_room_rate_limits.window_started_at
          <= p_now - make_interval(secs => p_window_ms::double precision / 1_000)
        then p_now else public.poker_room_rate_limits.window_started_at end,
        request_count = case when public.poker_room_rate_limits.window_started_at
          <= p_now - make_interval(secs => p_window_ms::double precision / 1_000)
        then 1 else public.poker_room_rate_limits.request_count + 1 end
  returning request_count into current_count;
  return current_count <= p_limit;
end;
$function$;
revoke all on function public.consume_room_rate_limit(uuid, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_room_rate_limit(uuid, timestamptz, integer, integer) to service_role;


-- Per-action rate-limit buckets. The previous single window per user is replaced by one row per (user, bucket).
drop function if exists public.consume_room_rate_limit(uuid, timestamptz, integer, integer);

alter table public.poker_room_rate_limits add column if not exists bucket text not null default 'game';
alter table public.poker_room_rate_limits drop constraint if exists poker_room_rate_limits_pkey;
alter table public.poker_room_rate_limits add primary key (user_id, bucket);

create or replace function public.consume_room_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_now timestamptz,
  p_limit integer,
  p_window_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_count integer;
begin
  if p_limit < 1 or p_window_ms < 1 or p_bucket is null or length(p_bucket) > 32 then
    return false;
  end if;

  insert into public.poker_room_rate_limits (user_id, bucket, window_started_at, request_count)
  values (p_user_id, p_bucket, p_now, 1)
  on conflict (user_id, bucket) do update
    set window_started_at = case when public.poker_room_rate_limits.window_started_at
          <= p_now - make_interval(secs => p_window_ms::double precision / 1_000)
        then p_now else public.poker_room_rate_limits.window_started_at end,
        request_count = case when public.poker_room_rate_limits.window_started_at
          <= p_now - make_interval(secs => p_window_ms::double precision / 1_000)
        then 1 else public.poker_room_rate_limits.request_count + 1 end
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$function$;

revoke all on function public.consume_room_rate_limit(uuid, text, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_room_rate_limit(uuid, text, timestamptz, integer, integer) to service_role;

commit;

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

commit;

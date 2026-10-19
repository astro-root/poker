alter table public.poker_rooms
  drop constraint if exists poker_rooms_status_check;

alter table public.poker_rooms
  add constraint poker_rooms_status_check
  check (status in ('waiting', 'playing', 'finished'));

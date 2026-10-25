-- Short, human-typable room code (the long invite id stays the secret link).
alter table public.poker_rooms add column if not exists code text;
alter table public.poker_rooms drop constraint if exists poker_rooms_code_format;
alter table public.poker_rooms add constraint poker_rooms_code_format check (code is null or code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$');
create unique index if not exists poker_rooms_code_key on public.poker_rooms (code) where code is not null;

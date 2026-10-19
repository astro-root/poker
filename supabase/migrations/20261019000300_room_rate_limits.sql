create table if not exists public.poker_room_rate_limits (
  user_id uuid primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

alter table public.poker_room_rate_limits enable row level security;
revoke all on public.poker_room_rate_limits from anon, authenticated;

create or replace function public.consume_room_rate_limit(
  p_user_id uuid,
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
  if p_limit < 1 or p_window_ms < 1 then
    return false;
  end if;

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

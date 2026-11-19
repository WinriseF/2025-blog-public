create table public.page_views_daily (
  day date not null,
  page_key text not null,
  views bigint not null,
  primary key (day, page_key)
);

alter table public.page_views_daily enable row level security;
revoke all on public.page_views_daily from public, anon, authenticated;
grant select, insert, update on public.page_views_daily to service_role;

create function public.increment_page_view(p_page_key text)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.page_views_daily (day, page_key, views)
  values ((statement_timestamp() at time zone 'Asia/Shanghai')::date, p_page_key, 1)
  on conflict (day, page_key) do update
  set views = public.page_views_daily.views + 1;
$$;

revoke all on function public.increment_page_view(text) from public, anon, authenticated;
grant execute on function public.increment_page_view(text) to service_role;

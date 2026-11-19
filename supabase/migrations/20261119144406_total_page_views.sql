create function public.total_page_views()
returns numeric
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(sum(views), 0) from public.page_views_daily;
$$;

revoke all on function public.total_page_views() from public, anon, authenticated;
grant execute on function public.total_page_views() to service_role;

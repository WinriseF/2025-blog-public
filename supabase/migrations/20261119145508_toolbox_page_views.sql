create function public.toolbox_page_views()
returns numeric
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(sum(views), 0) from public.page_views_daily
  where page_key like '/toolbox/%'
     or page_key in ('/toolbox', '/t', '/t/[code]', '/t/lan/[roomId]');
$$;

revoke all on function public.toolbox_page_views() from public, anon, authenticated;
grant execute on function public.toolbox_page_views() to service_role;

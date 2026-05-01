create table if not exists post_likes (
  slug text primary key,
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists post_like_daily_limits (
  slug text not null,
  ip_hash text not null,
  day date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (slug, ip_hash, day)
);

alter table post_likes enable row level security;
alter table post_like_daily_limits enable row level security;

create or replace function increment_post_like(like_slug text)
returns integer
language plpgsql
as $$
declare
  new_count integer;
begin
  insert into post_likes (slug, count)
  values (like_slug, 1)
  on conflict (slug)
  do update set
    count = post_likes.count + 1,
    updated_at = now()
  returning count into new_count;

  return new_count;
end;
$$;
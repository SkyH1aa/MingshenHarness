-- Run manually as project owner. Keeps the original four-column RPC for older apps.
begin;

alter table public.mingshen_app_releases
  add column if not exists package_format text not null default 'page',
  add column if not exists package_sha256 text,
  add column if not exists package_size bigint;

alter table public.mingshen_app_releases
  drop constraint if exists mingshen_release_package_format,
  drop constraint if exists mingshen_release_package_hash,
  drop constraint if exists mingshen_release_package_size,
  drop constraint if exists mingshen_release_zip_hash_required;
alter table public.mingshen_app_releases
  add constraint mingshen_release_package_format check (package_format in ('page', 'zip')),
  add constraint mingshen_release_package_hash check (package_sha256 is null or package_sha256 ~ '^[a-fA-F0-9]{64}$'),
  add constraint mingshen_release_package_size check (package_size is null or package_size between 1 and 2147483648),
  add constraint mingshen_release_zip_hash_required check (package_format <> 'zip' or package_sha256 is not null);

alter table public.mingshen_app_releases enable row level security;
revoke all on table public.mingshen_app_releases from anon, authenticated;

create or replace function public.mingshen_get_latest_release_v2()
returns table (
  version text, download_page_url text, notes text, published_at timestamptz,
  package_format text, package_sha256 text, package_size bigint
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select r.version, r.download_page_url, r.notes, r.published_at,
    r.package_format, r.package_sha256, r.package_size
  from public.mingshen_app_releases as r
  where r.is_active = true and r.published_at <= now()
  order by string_to_array(r.version, '.')::int[] desc, r.published_at desc
  limit 1;
$$;
revoke all on function public.mingshen_get_latest_release_v2() from public;
grant execute on function public.mingshen_get_latest_release_v2() to anon, authenticated;

commit;

-- Apply once in a new Supabase project's SQL Editor.
begin;
create table public.couples (
  id uuid primary key default gen_random_uuid(),
  names text not null check (char_length(names) between 1 and 40),
  since date not null check (since <= current_date),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.couple_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index couple_members_couple_idx on public.couple_members(couple_id);
create table public.couple_invites (
  token_hash text primary key,
  couple_id uuid not null references public.couples(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  claimed_at timestamptz
);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  date date not null,
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  date date not null,
  note text not null default '' check (char_length(note) <= 300),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  date date not null,
  storage_path text not null unique,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (storage_path = couple_id::text || '/' || id::text || '.jpg')
);
create index events_couple_idx on public.events(couple_id, date);
create index trips_couple_idx on public.trips(couple_id, created_at);
create index photos_couple_idx on public.photos(couple_id, created_at);

-- Security-definer helpers avoid recursive member RLS. No caller supplies a user ID.
create function public.current_couple_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select couple_id from public.couple_members where user_id = auth.uid()
$$;
revoke all on function public.current_couple_id() from public;
grant execute on function public.current_couple_id() to authenticated;

alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.couple_invites enable row level security;
alter table public.events enable row level security;
alter table public.trips enable row level security;
alter table public.photos enable row level security;
revoke all on public.couples, public.couple_members, public.couple_invites, public.events, public.trips, public.photos from anon, authenticated;
grant select on public.couples, public.couple_members to authenticated;
grant update(names, since) on public.couples to authenticated;
grant select, insert, delete on public.events, public.trips, public.photos to authenticated;
grant update(title, date, note) on public.events to authenticated;
grant update(name, date, note, lat, lng) on public.trips to authenticated;
grant update(name, date) on public.photos to authenticated;
create policy couple_read on public.couples for select to authenticated using (id = public.current_couple_id());
create policy couple_edit on public.couples for update to authenticated using (id = public.current_couple_id()) with check (id = public.current_couple_id());
create policy member_read on public.couple_members for select to authenticated using (couple_id = public.current_couple_id());
-- Invite hashes and membership writes have no client-access policy or grant.
do $$ declare t text; begin
  foreach t in array array['events','trips','photos'] loop
    execute format('create policy record_read on public.%I for select to authenticated using (couple_id = public.current_couple_id())', t);
    execute format('create policy record_insert on public.%I for insert to authenticated with check (couple_id = public.current_couple_id() and created_by = auth.uid())', t);
    execute format('create policy record_edit on public.%I for update to authenticated using (couple_id = public.current_couple_id()) with check (couple_id = public.current_couple_id())', t);
    execute format('create policy record_delete on public.%I for delete to authenticated using (couple_id = public.current_couple_id())', t);
  end loop;
end $$;

create function public.create_couple(p_names text, p_since date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  -- Serialize create/join per account; uniqueness also protects membership.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if exists(select 1 from public.couple_members where user_id = auth.uid()) then raise exception 'ALREADY_CONNECTED'; end if;
  insert into public.couples(names, since) values(trim(p_names), p_since) returning id into cid;
  insert into public.couple_members(user_id, couple_id) values(auth.uid(), cid);
  return cid;
end $$;
create function public.create_couple_invite() returns text
language plpgsql security definer set search_path = '' as $$
declare cid uuid; token text;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  select couple_id into cid from public.couple_members where user_id = auth.uid();
  if cid is null then raise exception 'SPACE_REQUIRED'; end if;
  perform 1 from public.couples where id = cid for update;
  if (select count(*) from public.couple_members where couple_id = cid) >= 2 then raise exception 'COUPLE_FULL'; end if;
  delete from public.couple_invites where couple_id = cid;
  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.couple_invites(token_hash, couple_id) values(encode(sha256(convert_to(token, 'UTF8')), 'hex'), cid);
  return token;
end $$;
create function public.join_couple(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.couple_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if exists(select 1 from public.couple_members where user_id = auth.uid()) then raise exception 'ALREADY_CONNECTED'; end if;
  if p_token !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INVITE'; end if;
  -- Lock couple first in both invitation procedures to avoid a lock-order deadlock.
  select * into inv from public.couple_invites where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if inv.couple_id is null then raise exception 'INVALID_INVITE'; end if;
  perform 1 from public.couples where id = inv.couple_id for update;
  select * into inv from public.couple_invites where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if inv.couple_id is null or inv.claimed_at is not null or inv.expires_at <= now() then raise exception 'INVALID_INVITE'; end if;
  if (select count(*) from public.couple_members where couple_id = inv.couple_id) >= 2 then raise exception 'COUPLE_FULL'; end if;
  insert into public.couple_members(user_id, couple_id) values(auth.uid(), inv.couple_id);
  update public.couple_invites set claimed_at = now() where token_hash = inv.token_hash;
  update public.couples set revision = revision + 1, updated_at = now() where id = inv.couple_id;
  return inv.couple_id;
end $$;
revoke all on function public.create_couple(text,date), public.create_couple_invite(), public.join_couple(text) from public;
grant execute on function public.create_couple(text,date), public.create_couple_invite(), public.join_couple(text) to authenticated;

-- A private couple row update announces inserts, edits AND deletes via Realtime.
-- Do not subscribe to raw DELETE events: their old-row payload is not RLS-filtered.
create function public.touch_couple() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.couples set revision = revision + 1, updated_at = now() where id = coalesce(new.couple_id, old.couple_id);
  return null;
end $$;
revoke all on function public.touch_couple() from public;
create trigger event_changed after insert or update or delete on public.events for each row execute function public.touch_couple();
create trigger trip_changed after insert or update or delete on public.trips for each row execute function public.touch_couple();
create trigger photo_changed after insert or update or delete on public.photos for each row execute function public.touch_couple();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('couple-photos', 'couple-photos', false, 10485760, array['image/jpeg']);
create function public.can_access_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_couple_id() is not null
    and split_part(p_name, '/', 1) = public.current_couple_id()::text
    and p_name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.jpg$'
$$;
revoke all on function public.can_access_photo(text) from public;
grant execute on function public.can_access_photo(text) to authenticated;
create policy photo_object_read on storage.objects for select to authenticated using (bucket_id = 'couple-photos' and public.can_access_photo(name));
create policy photo_object_add on storage.objects for insert to authenticated with check (bucket_id = 'couple-photos' and public.can_access_photo(name));
create policy photo_object_remove on storage.objects for delete to authenticated using (bucket_id = 'couple-photos' and public.can_access_photo(name));
-- No UPDATE policy: new photos use unique paths; other photos cannot be overwritten.
do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'couples') then
      alter publication supabase_realtime add table public.couples;
    end if;
  end if;
end $$;
commit;

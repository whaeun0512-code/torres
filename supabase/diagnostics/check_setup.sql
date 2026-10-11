-- Read-only: inspect installation metadata. Never deletes or changes records.
-- 'present' means the component exists; it is not a full permission/behavior test.
with required_tables(name) as (
  values ('couples'), ('couple_members'), ('couple_invites'), ('events'), ('trips'), ('photos')
), required_functions(signature) as (
  values ('public.current_couple_id()'), ('public.create_couple(text,date)'),
         ('public.create_couple_invite()'), ('public.join_couple(text)'),
         ('public.touch_couple()'), ('public.can_access_photo(text)')
), required_policies(schema_name, table_name, policy_name) as (
  values ('public','couples','couple_read'), ('public','couples','couple_edit'),
         ('public','couple_members','member_read'),
         ('public','events','record_read'), ('public','events','record_insert'),
         ('public','events','record_edit'), ('public','events','record_delete'),
         ('public','trips','record_read'), ('public','trips','record_insert'),
         ('public','trips','record_edit'), ('public','trips','record_delete'),
         ('public','photos','record_read'), ('public','photos','record_insert'),
         ('public','photos','record_edit'), ('public','photos','record_delete'),
         ('storage','objects','photo_object_read'), ('storage','objects','photo_object_add'),
         ('storage','objects','photo_object_remove')
), required_triggers(table_name, trigger_name) as (
  values ('events','event_changed'), ('trips','trip_changed'), ('photos','photo_changed')
), checks as (
  select 'table + RLS' as component, 'public.' || r.name as object_name,
    case when c.oid is null then 'missing'
         when c.relkind not in ('r','p') then 'wrong_object_type'
         when not c.relrowsecurity then 'RLS_disabled'
         else 'present' end as status
  from required_tables r left join pg_class c on c.oid = to_regclass('public.' || r.name)
  union all
  select 'function', signature,
    case when to_regprocedure(signature) is null then 'missing' else 'present' end
  from required_functions
  union all
  select 'policy', r.schema_name || '.' || r.table_name || '.' || r.policy_name,
    case when exists(select 1 from pg_policies p where p.schemaname = r.schema_name
      and p.tablename = r.table_name and p.policyname = r.policy_name) then 'present' else 'missing' end
  from required_policies r
  union all
  select 'trigger', 'public.' || r.table_name || '.' || r.trigger_name,
    case when exists(select 1 from pg_trigger t where t.tgrelid = to_regclass('public.' || r.table_name)
      and t.tgname = r.trigger_name and t.tgenabled <> 'D' and not t.tgisinternal) then 'present' else 'missing' end
  from required_triggers r
  union all
  select 'private photo bucket', 'couple-photos',
    case when not exists(select 1 from storage.buckets where id = 'couple-photos') then 'missing'
         when exists(select 1 from storage.buckets where id = 'couple-photos' and public = false) then 'present'
         else 'public_bucket' end
)
select component, object_name, status from checks order by component, object_name;

import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

test("shared space policies, invitations and photo isolation", async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    grant usage on schema public, auth, storage to authenticated, anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select,insert,delete,update on storage.objects to authenticated;
  `);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610110001_shared_space.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ];
  for (const id of ids)
    await db.query("insert into auth.users values($1)", [id]);
  const as = async (id) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    await db.exec(`set role ${id ? "authenticated" : "anon"}`);
  };
  await as(ids[0]);
  const first = (
    await db.query(
      "select public.create_couple('하나 & 둘',current_date) as id",
    )
  ).rows[0].id;
  await assert.rejects(
    () => db.query("select public.create_couple('다른 공간',current_date)"),
    /ALREADY_CONNECTED/,
  );
  let token = (await db.query("select public.create_couple_invite() as token"))
    .rows[0].token;
  const stale = token;
  token = (await db.query("select public.create_couple_invite() as token"))
    .rows[0].token;
  assert.match(token, /^[a-f0-9]{64}$/);
  await assert.rejects(
    () => db.query("select * from public.couple_invites"),
    /permission denied/,
  );
  await db.query(
    "insert into public.events(couple_id,title,date) values($1,'둘만의 일정',current_date)",
    [first],
  );
  const revision = (await db.query("select revision from public.couples"))
    .rows[0].revision;
  assert.equal(Number(revision), 1);
  await as(ids[1]);
  assert.equal((await db.query("select * from public.events")).rows.length, 0);
  await assert.rejects(
    () => db.query("select public.join_couple($1)", [stale]),
    /INVALID_INVITE/,
  );
  await db.query("select public.join_couple($1)", [token]);
  assert.equal((await db.query("select * from public.events")).rows.length, 1);
  assert.equal(
    (await db.query("select * from public.couple_members")).rows.length,
    2,
  );
  await db.query("update public.events set title='수정한 일정'");
  assert.equal(
    (await db.query("select title from public.events")).rows[0].title,
    "수정한 일정",
  );
  await assert.rejects(
    () => db.query("select public.create_couple_invite()"),
    /COUPLE_FULL/,
  );
  await assert.rejects(
    () => db.query("update public.events set couple_id = gen_random_uuid()"),
    /permission denied/,
  );
  await assert.rejects(
    () =>
      db.query("insert into public.couple_members values($1,$2,now())", [
        ids[2],
        first,
      ]),
    /permission denied/,
  );
  await as(ids[2]);
  await assert.rejects(
    () => db.query("select public.join_couple($1)", [token]),
    /INVALID_INVITE/,
  );
  const other = (
    await db.query(
      "select public.create_couple('다른 커플',current_date) as id",
    )
  ).rows[0].id;
  assert.equal((await db.query("select * from public.events")).rows.length, 0);
  await assert.rejects(
    () =>
      db.query(
        "insert into public.events(couple_id,title,date) values($1,'침입',current_date)",
        [first],
      ),
    /row-level security/,
  );
  await assert.rejects(
    () =>
      db.query(
        "insert into public.events(couple_id,title,date,created_by) values($1,'사칭',current_date,$2)",
        [other, ids[0]],
      ),
    /row-level security/,
  );
  assert.equal(
    (
      await db.query(
        "delete from public.events where couple_id=$1 returning id",
        [first],
      )
    ).rows.length,
    0,
  );
  const photo = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await as(ids[0]);
  await db.query(
    "insert into storage.objects(bucket_id,name) values('couple-photos',$1)",
    [`${first}/${photo}.jpg`],
  );
  await db.query(
    "insert into public.photos(id,couple_id,name,date,storage_path) values($1,$2,'우리 사진',current_date,$3)",
    [photo, first, `${first}/${photo}.jpg`],
  );
  await assert.rejects(
    () =>
      db.query(
        "insert into public.photos(id,couple_id,name,date,storage_path) values(gen_random_uuid(),$1,'남의 경로',current_date,$2)",
        [first, `${other}/${photo}.jpg`],
      ),
    /check constraint/,
  );
  await as(ids[2]);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    0,
  );
  assert.equal((await db.query("select * from public.photos")).rows.length, 0);
  await assert.rejects(
    () =>
      db.query(
        "insert into storage.objects(bucket_id,name) values('couple-photos',$1)",
        [`${first}/${photo}.jpg`],
      ),
    /row-level security/,
  );
  await as(ids[1]);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    1,
  );
  const before = Number(
    (await db.query("select revision from public.couples")).rows[0].revision,
  );
  await db.query("delete from public.events");
  assert.equal(
    Number(
      (await db.query("select revision from public.couples")).rows[0].revision,
    ),
    before + 1,
  );
  assert.equal(
    (await db.query("delete from storage.objects returning id")).rows.length,
    1,
  );
  await as(null);
  await assert.rejects(
    () => db.query("select * from public.couples"),
    /permission denied/,
  );
  await assert.rejects(
    () => db.query("select public.create_couple_invite()"),
    /permission denied/,
  );
  // Expired invitations fail without creating membership.
  await as(ids[2]);
  const exp = (await db.query("select public.create_couple_invite() as token"))
    .rows[0].token;
  await db.exec("reset role");
  await db.exec(
    "update public.couple_invites set expires_at = now() - interval '1 day'",
  );
  await as(ids[3]);
  await assert.rejects(
    () => db.query("select public.join_couple($1)", [exp]),
    /INVALID_INVITE/,
  );
  assert.equal(
    (await db.query("select public.current_couple_id() as id")).rows[0].id,
    null,
  );
  await db.close();
});

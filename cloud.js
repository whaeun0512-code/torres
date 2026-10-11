import { createClient } from "@supabase/supabase-js";
export const CONFIG_KEY = "our-days-connection";
export function validateConnection(url, key) {
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    throw new Error("올바른 Supabase 프로젝트 URL을 입력해 주세요.");
  }
  if (
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (u.pathname !== "/" && u.pathname !== "")
  )
    throw new Error("올바른 Supabase 프로젝트 URL을 입력해 주세요.");
  key = key.trim();
  if (key.startsWith("sb_secret_"))
    throw new Error(
      "비밀 키는 사용할 수 없어요. Publishable key를 입력해 주세요.",
    );
  if (!key.startsWith("sb_publishable_")) {
    try {
      const payload = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (payload.role !== "anon") throw new Error();
    } catch {
      throw new Error(
        "Publishable key 또는 기존 anon 공개 키를 입력해 주세요.",
      );
    }
  }
  return { url: u.origin, key };
}
export function connection() {
  let config;
  try {
    config = JSON.parse(localStorage.getItem(CONFIG_KEY));
  } catch {}
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) config = { url, key };
  if (!config) return null;
  try {
    return validateConnection(config.url, config.key);
  } catch {
    return null;
  }
}
const checked = (result) => {
  if (result.error) throw result.error;
  return result.data;
};
export function friendlyError(error) {
  const message = error?.message || "";
  if (/Supabase|Publishable key|비밀 키|공개 키/.test(message)) return message;
  const known = {
    LOGIN_REQUIRED: "먼저 로그인해 주세요.",
    ALREADY_CONNECTED: "이미 커플 공간에 연결되어 있어요.",
    SPACE_REQUIRED: "먼저 커플 공간을 만들어 주세요.",
    COUPLE_FULL: "이미 두 사람이 연결된 공간이에요.",
    INVALID_INVITE:
      "만료되었거나 사용한 초대 코드예요. 상대방에게 새 초대를 요청해 주세요.",
    "Invalid login credentials": "이메일 또는 비밀번호를 확인해 주세요.",
    "Email not confirmed": "받은 이메일의 확인 링크를 누른 뒤 로그인해 주세요.",
    "User already registered": "이미 가입한 이메일이에요. 로그인해 주세요.",
    "New password should be different from the old password.":
      "기존 비밀번호와 다른 비밀번호를 입력해 주세요.",
  };
  for (const [key, value] of Object.entries(known))
    if (message.includes(key)) return value;
  if (/Error sending|email address not authorized|smtp/i.test(message))
    return "인증 메일을 보낼 수 없어요. 사이트 관리자가 Supabase의 이메일 전송 설정을 확인해야 해요.";
  if (/Password should|weak_password/i.test(message))
    return "비밀번호는 8자 이상으로, 추측하기 어렵게 설정해 주세요.";
  if (/rate limit|too many requests|security purposes/i.test(message))
    return "요청이 많아요. 잠시 후 다시 시도해 주세요.";
  if (/fetch|network|offline/i.test(message))
    return "서버에 연결할 수 없어요. 인터넷과 Supabase 연결 설정을 확인해 주세요.";
  if (/relation|schema cache|function .* not exist/i.test(message))
    return "공유 저장소가 아직 준비되지 않았어요. 관리자에게 데이터베이스 설정을 요청해 주세요.";
  if (/JWT|expired|not authenticated/i.test(message))
    return "로그인이 만료되었어요. 다시 로그인해 주세요.";
  if (/policy|permission|42501/i.test(message))
    return "저장 권한을 확인할 수 없어요. 로그인과 커플 연결을 확인해 주세요.";
  return "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
export class CloudStore {
  constructor(config) {
    this.client = createClient(config.url, config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    this.coupleId = null;
    this.signed = new Map();
  }
  async allRows(table, coupleId) {
    let rows = [];
    for (let offset = 0; ; offset += 1000) {
      const batch = checked(
        await this.client
          .from(table)
          .select("*")
          .eq("couple_id", coupleId)
          .order("created_at")
          .order("id")
          .range(offset, offset + 999),
      );
      rows.push(...batch);
      if (batch.length < 1000) return rows;
    }
  }
  async load(user) {
    const member = checked(
      await this.client
        .from("couple_members")
        .select("couple_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    );
    if (!member) {
      return null;
    }
    const coupleId = member.couple_id;
    const signed = this.signed;
    const results = await Promise.all([
      this.client
        .from("couples")
        .select("id,names,since")
        .eq("id", coupleId)
        .single(),
      this.client
        .from("couple_members")
        .select("user_id")
        .eq("couple_id", coupleId),
      ...["events", "trips", "photos"].map(async (table) => ({
        data: await this.allRows(table, coupleId),
        error: null,
      })),
    ]);
    const [couple, members, events, trips, photos] = results.map(checked);
    const withUrls = await Promise.all(
      photos.map(async (p) => {
        let url = signed.get(p.storage_path);
        if (!url || url.expires < Date.now()) {
          const data = checked(
            await this.client.storage
              .from("couple-photos")
              .createSignedUrl(p.storage_path, 3600),
          );
          url = { src: data.signedUrl, expires: Date.now() + 45 * 60 * 1000 };
          signed.set(p.storage_path, url);
        }
        return { ...p, src: url.src };
      }),
    );
    return {
      coupleId,
      names: couple.names,
      since: couple.since,
      events,
      trips,
      photos: withUrls,
      memberCount: members.length,
    };
  }
  async profile(names, since) {
    checked(
      await this.client
        .from("couples")
        .update({ names, since })
        .eq("id", this.coupleId)
        .select()
        .single(),
    );
  }
  async add(kind, record, importing = false) {
    const fields =
      kind === "events"
        ? ["id", "title", "date", "note"]
        : ["id", "name", "date", "note", "lat", "lng"];
    const row = Object.fromEntries(
      fields.filter((f) => record[f] !== undefined).map((f) => [f, record[f]]),
    );
    row.couple_id = this.coupleId;
    if (importing)
      checked(
        await this.client
          .from(kind)
          .upsert(row, { onConflict: "id", ignoreDuplicates: true }),
      );
    else checked(await this.client.from(kind).insert(row));
  }
  async edit(kind, record) {
    const { id, ...fields } = record;
    checked(
      await this.client
        .from(kind)
        .update(fields)
        .eq("id", id)
        .eq("couple_id", this.coupleId)
        .select()
        .single(),
    );
  }
  async remove(kind, id) {
    let path;
    if (kind === "photos") {
      const p = checked(
        await this.client
          .from("photos")
          .select("storage_path")
          .eq("id", id)
          .eq("couple_id", this.coupleId)
          .maybeSingle(),
      );
      path = p?.storage_path;
    }
    checked(
      await this.client
        .from(kind)
        .delete()
        .eq("id", id)
        .eq("couple_id", this.coupleId),
    );
    if (path) {
      const cleanup = await this.client.storage
        .from("couple-photos")
        .remove([path]);
      this.signed.delete(path);
      if (cleanup.error)
        return "기록을 삭제했지만 사진 파일 정리가 지연됐어요. 관리자에게 문의해 주세요.";
    }
  }
  async addPhoto(photo, blob, importing = false) {
    const path = `${this.coupleId}/${photo.id}.jpg`;
    if (importing) {
      const existing = checked(
        await this.client
          .from("photos")
          .select("id")
          .eq("id", photo.id)
          .maybeSingle(),
      );
      if (existing) return;
    }
    const upload = await this.client.storage
      .from("couple-photos")
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (
      upload.error &&
      !(
        importing &&
        (String(upload.error.statusCode) === "409" ||
          /already exists/i.test(upload.error.message))
      )
    )
      throw upload.error;
    const result = await this.client.from("photos").insert({
      id: photo.id,
      couple_id: this.coupleId,
      name: photo.name.slice(0, 80),
      date: photo.date,
      storage_path: path,
    });
    if (result.error) {
      // Normal uploads own this new object. Import retries retain it for a safe retry.
      if (!importing)
        await this.client.storage.from("couple-photos").remove([path]);
      throw result.error;
    }
  }
  async editPhoto(id, name, date) {
    checked(
      await this.client
        .from("photos")
        .update({ name, date })
        .eq("id", id)
        .eq("couple_id", this.coupleId)
        .select()
        .single(),
    );
  }
  watch(onChange, onStatus) {
    this.unwatch();
    if (!this.coupleId) return;
    this.channel = this.client
      .channel(`couple:${this.coupleId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "couples",
          filter: `id=eq.${this.coupleId}`,
        },
        onChange,
      )
      .subscribe(onStatus);
  }
  unwatch() {
    if (this.channel) {
      this.client.removeChannel(this.channel);
      this.channel = null;
    }
  }
}

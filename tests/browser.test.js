import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const launch = () =>
  chromium.launch({
    executablePath,
    headless: true,
    args: executablePath ? ["--no-sandbox"] : [],
  });
async function waitFor(check, timeout = 10000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error("Condition timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("local records remain usable, editable and persistent without Supabase", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator("#event-add").click();
    await page.locator("[name=title]").fill("로컬 일정");
    await page.locator("form .primary").click();
    await waitFor(() =>
      page
        .locator("#dialog")
        .count()
        .then(
          async () => !(await page.locator("#dialog").evaluate((e) => e.open)),
        ),
    );
    await page.locator("nav [data-view=calendar]").click();
    await page.locator(".edit-record").click();
    await page.locator("[name=title]").fill("수정한 로컬 일정");
    await page.locator("form .primary").click();
    await waitFor(() =>
      page
        .locator(".event-list")
        .innerText()
        .then((x) => x.includes("수정한 로컬 일정")),
    );
    await page.locator("nav [data-view=map]").click();
    await page.locator("#add").click();
    await page.locator("[name=name]").fill("로컬 여행");
    await page.locator("form .primary").click();
    await waitFor(() =>
      page
        .locator(".trip")
        .count()
        .then((x) => x === 1),
    );
    await page.locator(".edit-record").click();
    await page.locator("[name=name]").fill("수정한 여행");
    await page.locator("form .primary").click();
    await waitFor(() =>
      page
        .locator(".trip")
        .innerText()
        .then((x) => x.includes("수정한 여행")),
    );
    await page.locator("nav [data-view=photos]").click();
    await page.locator("#files").setInputFiles("public/images/sea.jpg");
    await waitFor(() =>
      page
        .locator("[data-photo]")
        .count()
        .then((x) => x === 1),
    );
    await page.reload();
    await page.locator("nav [data-view=photos]").click();
    assert.equal(await page.locator("[data-photo]").count(), 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator("nav [data-view=calendar]").click();
    await page.locator("#add").click();
    await page.locator("[name=title]").fill("저장 실패 시 보존");
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "our-days")
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        return window.originalSetItem.call(this, key, value);
      };
    });
    await page.locator("form .primary").click();
    await waitFor(() =>
      page
        .locator("#dialog .form-error")
        .innerText()
        .then((x) => x.includes("저장 공간")),
    );
    assert.equal(
      await page.locator("[name=title]").inputValue(),
      "저장 실패 시 보존",
    );
    await page.evaluate(
      () => (Storage.prototype.setItem = window.originalSetItem),
    );
    await page.locator("#close").click();
    await page.locator("#account").click();
    await page.locator("[name=url]").fill("https://test.supabase.co");
    await page.locator("[name=key]").fill("sb_secret_never-use-me");
    await page.locator("form .primary").click();
    assert.match(await page.locator(".form-error").innerText(), /비밀 키/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("two browser accounts share records through the Supabase API; failures preserve input", async () => {
  const browser = await launch();
  try {
    const contexts = [await browser.newContext(), await browser.newContext()];
    const tables = {
      couples: [],
      couple_members: [],
      events: [],
      trips: [],
      photos: [],
    };
    const code = "a".repeat(64);
    let inviteCouple = null,
      failWrite = false;
    const requests = [];
    const userForEmail = (e) => ({
      id:
        e === "one@example.com"
          ? "11111111-1111-4111-8111-111111111111"
          : "22222222-2222-4222-8222-222222222222",
      email: e,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: new Date().toISOString(),
    });
    const users = {};
    const session = (u) => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const jwt = [
        Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
          "base64url",
        ),
        Buffer.from(
          JSON.stringify({ sub: u.id, exp, role: "authenticated" }),
        ).toString("base64url"),
        "test-signature",
      ].join(".");
      users[jwt] = u;
      return {
        access_token: jwt,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: exp,
        refresh_token: "refresh-" + u.id,
        user: u,
      };
    };
    const image = await readFile("public/images/sea.jpg");
    const route = async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname,
        method = req.method(),
        body = req.postData();
      let data;
      try {
        data = JSON.parse(body || "null");
      } catch {
        data = null;
      }
      requests.push({ path, method, data });
      const reply = (json, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(json),
        });
      if (method === "OPTIONS") return reply({});
      if (path.includes("/auth/v1/")) {
        if (path.endsWith("/token")) {
          if (data?.password !== "test-password")
            return reply(
              {
                error_code: "invalid_credentials",
                msg: "Invalid login credentials",
              },
              400,
            );
          return reply(session(userForEmail(data.email)));
        }
        if (path.endsWith("/signup"))
          return reply({ user: userForEmail(data.email), session: null });
        if (path.endsWith("/recover")) return reply({});
        if (path.endsWith("/logout")) return route.fulfill({ status: 204 });
        if (path.endsWith("/user"))
          return reply(
            users[req.headers().authorization?.replace("Bearer ", "")] || {},
          );
      }
      const u = users[req.headers().authorization?.replace("Bearer ", "")];
      if (!u) return reply({ message: "LOGIN_REQUIRED" }, 401);
      const membership = () =>
        tables.couple_members.find((x) => x.user_id === u.id);
      if (path.includes("/rest/v1/rpc/")) {
        if (path.endsWith("create_couple")) {
          const id = crypto.randomUUID();
          tables.couples.push({ id, names: data.p_names, since: data.p_since });
          tables.couple_members.push({ couple_id: id, user_id: u.id });
          return reply(id);
        }
        if (path.endsWith("create_couple_invite")) {
          inviteCouple = membership().couple_id;
          return reply(code);
        }
        if (path.endsWith("join_couple")) {
          if (data.p_token !== code || !inviteCouple)
            return reply({ message: "INVALID_INVITE" }, 400);
          tables.couple_members.push({
            user_id: u.id,
            couple_id: inviteCouple,
          });
          inviteCouple = null;
          return reply(membership().couple_id);
        }
      }
      if (path.includes("/storage/v1/object/sign/")) {
        if (method === "POST")
          return reply({
            signedURL: path.replace("/storage/v1", "") + "?token=test",
          });
        return route.fulfill({
          status: 200,
          contentType: "image/jpeg",
          body: image,
        });
      }
      if (path.includes("/storage/v1/object/"))
        return reply(method === "DELETE" ? [] : { Key: "uploaded" });
      const table = path.split("/").at(-1);
      if (!tables[table])
        return reply({ message: "unexpected endpoint: " + path }, 400);
      const match = (row) =>
        [...url.searchParams]
          .filter(([k, v]) => v.startsWith("eq."))
          .every(([k, v]) => String(row[k]) === v.slice(3)) &&
        (table === "couple_members"
          ? row.couple_id === membership()?.couple_id
          : table === "couples"
            ? row.id === membership()?.couple_id
            : row.couple_id === membership()?.couple_id);
      let rows = tables[table].filter(match);
      if (method === "POST") {
        if (failWrite && table === "events")
          return reply(
            { message: "permission denied for table events", code: "42501" },
            403,
          );
        const inserts = Array.isArray(data) ? data : [data];
        for (const row of inserts) {
          if (
            tables[table].some((x) => x.id === row.id) &&
            req.headers().prefer?.includes("ignore-duplicates")
          )
            continue;
          tables[table].push({
            ...row,
            created_by: u.id,
            created_at: new Date().toISOString(),
          });
        }
        rows = inserts;
      } else if (method === "PATCH") {
        rows.forEach((r) => Object.assign(r, data));
      } else if (method === "DELETE") {
        tables[table] = tables[table].filter((r) => !rows.includes(r));
      }
      return reply(
        req.headers().accept?.includes("vnd.pgrst.object")
          ? rows[0] || null
          : rows,
      );
    };
    for (const c of contexts) {
      await c.route("https://our-days-test.supabase.co/**", route);
    }
    const errors = [];
    const a = await contexts[0].newPage();
    const b = await contexts[1].newPage();
    for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
    // Preserve a real legacy event, then connect via the public setup form.
    await a.goto(base);
    await a.locator("#event-add").click();
    await a.locator("[name=title]").fill("이전 기록");
    await a.locator("form .primary").click();
    await waitFor(() =>
      a
        .locator(".schedule-panel")
        .innerText()
        .then((x) => x.includes("이전 기록")),
    );
    await a.locator("#connect").click();
    await a.locator("[name=url]").fill("https://our-days-test.supabase.co");
    await a.locator("[name=key]").fill("sb_publishable_test");
    await a.locator("form .primary").click();
    await a.waitForSelector("#auth-form");
    await a.locator("[name=email]").fill("one@example.com");
    await a.locator("[name=password]").fill("wrong-password");
    await a.locator("#auth-submit").click();
    await waitFor(() =>
      a
        .locator(".form-error")
        .innerText()
        .then((x) => x.includes("비밀번호")),
    );
    await a.locator("[name=password]").fill("test-password");
    await a.locator("#auth-submit").click();
    await a.waitForSelector("#space-form");
    await a.locator("[name=names]").fill("우리 커플");
    await a.locator("#space-form .primary").click();
    await a.waitForSelector("#account");
    await a.locator("#share-space").click();
    await a.locator("#make-invite").click();
    await a.waitForSelector("#invite-code");
    assert.equal(await a.locator("#invite-code").inputValue(), code);
    await a.locator("#close").click();
    await contexts[1].addInitScript(() =>
      localStorage.setItem(
        "our-days-connection",
        JSON.stringify({
          url: "https://our-days-test.supabase.co",
          key: "sb_publishable_test",
        }),
      ),
    );
    await b.goto(base + "/#invite=" + code);
    await b.waitForSelector("#auth-form");
    await b.locator("#signup-tab").click();
    await b.locator("[name=email]").fill("two@example.com");
    await b.locator("[name=password]").fill("test-password");
    await b.locator("[name=confirm]").fill("does-not-match");
    await b.locator("#auth-submit").click();
    await waitFor(() =>
      b
        .locator(".form-error")
        .innerText()
        .then((x) => x.includes("같아야")),
    );
    await b.locator("[name=confirm]").fill("test-password");
    await b.locator("#auth-submit").click();
    await waitFor(() =>
      b
        .locator(".form-notice")
        .innerText()
        .then((x) => x.includes("확인 메일")),
    );
    await b.locator("#reset-password").click();
    await b.locator("#auth-submit").click();
    await waitFor(() =>
      b
        .locator(".form-notice")
        .innerText()
        .then((x) => x.includes("재설정 메일")),
    );
    await b.locator("#login-tab").click();
    await b.locator("[name=password]").fill("test-password");
    await b.locator("#auth-submit").click();
    await b.waitForSelector("#space-form");
    assert.equal(await b.locator("[name=token]").inputValue(), code);
    await b.locator("#space-form .primary").click();
    await b.waitForSelector("#account");
    assert.equal(tables.couple_members.length, 2);
    // Explicit migration is resumable and idempotent.
    for (let i = 0; i < 2; i++) {
      await a.locator("#account").click();
      await a.locator("#import-local").click();
      await a.locator("form .primary").click();
      await waitFor(() => a.locator("#dialog").evaluate((e) => !e.open));
    }
    assert.equal(tables.events.length, 1);
    await a.locator("#event-add").click();
    await a.locator("[name=title]").fill("공유 데이트");
    await a.locator("form .primary").click();
    await waitFor(() => tables.events.length === 2);
    await waitFor(() => a.locator("#dialog").evaluate((e) => !e.open));
    await b.locator("#refresh").click();
    await waitFor(() =>
      b
        .locator(".schedule-panel")
        .innerText()
        .then((x) => x.includes("공유 데이트")),
    );
    await b.locator("nav [data-view=calendar]").click();
    await b
      .locator(".event-list .event")
      .filter({ hasText: "공유 데이트" })
      .locator(".edit-record")
      .click();
    await b.locator("[name=title]").fill("함께 수정한 데이트");
    await b.locator("form .primary").click();
    await waitFor(() =>
      tables.events.some((x) => x.title === "함께 수정한 데이트"),
    );
    await a.locator("#refresh").click();
    await waitFor(() =>
      a
        .locator(".schedule-panel")
        .innerText()
        .then((x) => x.includes("함께 수정한 데이트")),
    );
    failWrite = true;
    await a.locator("#event-add").click();
    await a.locator("[name=title]").fill("실패해도 남는 입력");
    await a.locator("form .primary").click();
    await waitFor(() =>
      a
        .locator("#dialog .form-error")
        .innerText()
        .then((x) => x.includes("권한")),
    );
    assert.equal(
      await a.locator("[name=title]").inputValue(),
      "실패해도 남는 입력",
    );
    assert.equal(tables.events.length, 2);
    failWrite = false;
    await a.locator("#close").click();
    await a.locator("#trip-add").click();
    await a.locator("[name=name]").fill("함께 제주");
    await a.locator("form .primary").click();
    await waitFor(() => tables.trips.length === 1);
    await waitFor(() => a.locator("#dialog").evaluate((e) => !e.open));
    await a.locator("nav [data-view=photos]").click();
    await a.locator("#files").setInputFiles("public/images/sea.jpg");
    await waitFor(() =>
      a
        .locator("[data-photo]")
        .count()
        .then((x) => x === 1),
    );
    assert.equal(tables.photos.length, 1);
    assert.match(
      tables.photos[0].storage_path,
      new RegExp("^" + tables.couples[0].id + "/"),
    );
    await b.locator("#refresh").click();
    await b.locator("nav [data-view=photos]").click();
    await waitFor(() =>
      b
        .locator("[data-photo]")
        .count()
        .then((x) => x === 1),
    );
    await b.locator("[data-photo]").click();
    await b.locator("[name=name]").fill("우리의 바다");
    await b.locator("form .primary").click();
    await waitFor(() => tables.photos[0].name === "우리의 바다");
    await a.locator("#refresh").click();
    await waitFor(() =>
      a
        .locator(".photo-grid")
        .innerText()
        .then((x) => x.includes("우리의 바다")),
    );
    a.on("dialog", (d) => d.accept());
    await a.locator("[data-photo]").click();
    await a.locator("#delete-photo").click();
    await waitFor(() => tables.photos.length === 0);
    await waitFor(() => a.locator("#dialog").evaluate((e) => !e.open));
    await b.locator("#refresh").click();
    await waitFor(() =>
      b
        .locator("[data-photo]")
        .count()
        .then((x) => x === 0),
    );
    assert.ok(
      requests.some(
        (r) => r.path.includes("/storage/") && r.method === "DELETE",
      ),
    );
    await a.locator("nav [data-view=calendar]").click();
    await a
      .locator(".event-list .event")
      .filter({ hasText: "함께 수정한 데이트" })
      .locator(".delete")
      .click();
    await waitFor(() => tables.events.length === 1);
    await b.locator("#refresh").click();
    await b.locator("nav [data-view=calendar]").click();
    assert.doesNotMatch(
      await b.locator(".event-list").innerText(),
      /함께 수정한/,
    );
    await b.reload();
    await b.waitForSelector("#account");
    await b.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await b.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    // Follow an actual recovery-shaped URL through the real Auth SDK.
    const recoveryContext = await browser.newContext();
    await recoveryContext.route("https://our-days-test.supabase.co/**", route);
    await recoveryContext.addInitScript(() =>
      localStorage.setItem(
        "our-days-connection",
        JSON.stringify({
          url: "https://our-days-test.supabase.co",
          key: "sb_publishable_test",
        }),
      ),
    );
    const recovered = await recoveryContext.newPage();
    recovered.on("pageerror", (e) => errors.push(e.message));
    const resetSession = session(userForEmail("two@example.com"));
    await recovered.goto(
      base +
        "/#" +
        new URLSearchParams({
          access_token: resetSession.access_token,
          refresh_token: resetSession.refresh_token,
          expires_in: "3600",
          token_type: "bearer",
          type: "recovery",
        }),
    );
    await recovered.waitForSelector("#recover-form");
    await recovered.locator("[name=password]").fill("new-password");
    await recovered.locator("[name=confirm]").fill("new-password");
    await recovered.locator("#recover-form .primary").click();
    await recovered.waitForSelector("#account");
    assert.ok(
      requests.some(
        (r) => r.path.endsWith("/auth/v1/user") && r.method === "PUT",
      ),
    );
    await recoveryContext.close();
    await a.locator("#account").click();
    await a.locator("#logout").click();
    await a.waitForSelector("#auth-form");
    assert.equal(await a.locator(".calendar-panel").count(), 0);
    assert.equal(
      await a.evaluate(
        () => JSON.parse(localStorage.getItem("our-days")).events.length,
      ),
      1,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

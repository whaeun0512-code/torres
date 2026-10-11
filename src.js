import {
  CloudStore,
  connection,
  validateConnection,
  CONFIG_KEY,
  friendlyError,
} from "./cloud.js";
import "./style.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  createIcons,
  Flower2,
  Heart,
  House,
  Map as MapIcon,
  CalendarDays,
  Images,
  ChevronDown,
  CloudSun,
  Settings2,
  Plus,
  ArrowUpRight,
  CalendarHeart,
  MapPin,
  Camera,
  ArrowRight,
  Sparkles,
  Trash2,
  Upload,
  ChevronLeft,
  ChevronRight,
  X,
  Pencil,
} from "lucide";
const icons = {
  Flower2,
  Heart,
  House,
  Map: MapIcon,
  CalendarDays,
  Images,
  ChevronDown,
  CloudSun,
  Settings2,
  Plus,
  ArrowUpRight,
  CalendarHeart,
  MapPin,
  Camera,
  ArrowRight,
  Sparkles,
  Trash2,
  Upload,
  ChevronLeft,
  ChevronRight,
  X,
  Pencil,
};
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const today = () => new Date().toLocaleDateString("en-CA");
const pics = ["journey", "moments", "sea", "mountains"];
const photo = (id) => `/images/${id}.jpg`;
const blankState = () => ({
  names: "우리 두 사람",
  since: today(),
  events: [],
  trips: [],
  photos: [],
});
function localState() {
  try {
    const x = JSON.parse(localStorage.getItem("our-days"));
    if (
      x &&
      typeof x.names === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(x.since) &&
      ["events", "trips", "photos"].every((k) => Array.isArray(x[k]))
    )
      return x;
  } catch {}
  return blankState();
}
const config = connection();
let cloud = config ? new CloudStore(config) : null,
  user = null,
  booting = !!cloud,
  loadError = "",
  noSpace = false,
  recovery = false;
let state = cloud ? blankState() : localState(),
  view = "home",
  month = new Date(),
  map,
  busy = false,
  epoch = 0,
  loadVersion = 0,
  pendingRender = false,
  watchId = null,
  syncStatus = "connecting";
try {
  const token = new URLSearchParams(location.hash.slice(1)).get("invite");
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    sessionStorage.setItem("our-days-invite", token);
    history.replaceState(null, "", location.pathname + location.search);
  }
} catch {}
const pendingInvite = () => {
  try {
    return sessionStorage.getItem("our-days-invite") || "";
  } catch {
    return "";
  }
};
function localChange(change) {
  const next = structuredClone(state);
  change(next);
  try {
    localStorage.setItem("our-days", JSON.stringify(next));
  } catch {
    throw {
      userMessage: "저장 공간이 부족해요. 사진을 삭제한 후 다시 시도해 주세요.",
    };
  }
  state = next;
}
const errorText = (e) => e?.userMessage || friendlyError(e);
const ico = (name, cl = "") => `<i data-lucide="${name}" class="${cl}"></i>`;
function toast(t) {
  if (!$("#toast")) return;
  $("#toast").textContent = t;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast")?.classList.remove("show"), 4000);
}
function render() {
  if (map) {
    map.remove();
    map = null;
  }
  if (renderGate()) return;
  const initials = state.names.split("&").map((s) => s.trim().slice(0, 1));
  const first = initials[0] || "♡",
    second = initials[1] || "♡";
  const days =
    Math.floor((new Date(today()) - new Date(state.since)) / 86400000) + 1;
  $("#app").innerHTML =
    `<aside><a class="brand" href="#">${ico("flower-2")}<span>our days<span class="brand-dot">.</span></span></a><div class="space-label">OUR LITTLE SPACE</div><nav>${[
      ["home", "house", "우리의 공간"],
      ["map", "map", "여행 지도"],
      ["calendar", "calendar-days", "우리의 일정"],
      ["photos", "images", "사진 앨범"],
    ]
      .map(
        ([v, i, t]) =>
          `<button data-view="${v}" class="${view === v ? "active" : ""}">${ico(i)}${t}${view === v ? '<span class="nav-dot"></span>' : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="side-note">${ico("heart")}<p>평범한 날도,<br>함께라서 특별해.</p><span>Little moments, lasting memories.</span></div><button class="couple" id="profile"><span class="avatar">${esc(first)}<span>${esc(second)}</span></span><span><b>${esc(state.names)}</b><small>우리 둘만의 기록 ${ico("chevron-down")}</small></span></button></aside><main><header><div class="breadcrumb">우리의 공간 <span>/</span> ${{ home: "대시보드", map: "여행 지도", calendar: "우리의 일정", photos: "사진 앨범" }[view]}</div><div class="header-right"><span>${ico("cloud-sun")} 오늘도 함께, 좋은 하루</span><button class="account-btn" id="account">${ico("heart")} ${user ? "공유 계정" : "로그인 / 연결"}</button><button class="icon-btn" id="settings" aria-label="커플 설정">${ico("settings-2")}</button><span class="mini-avatar">${esc(user?.email?.slice(0, 1).toUpperCase() || first)}</span></div></header><div class="content">${sharingBanner()}<div class="page-title"><div><div class="eyebrow">A LITTLE RECORD OF US</div><h1>${{ home: "우리의 모든 날", map: "함께 그리는 여행 지도", calendar: "기다려지는 우리의 일정", photos: "오래 간직할 순간들" }[view]}<span class="title-mark">${view === "home" ? "✳" : ""}</span></h1><p>${{ home: "함께한 순간을 모아, 우리만의 이야기를 만들어가요.", map: "함께 걸었던 곳, 다음에 가고 싶은 곳을 기록해요.", calendar: "소소한 약속부터 특별한 기념일까지 함께 기억해요.", photos: "시간이 지나도 선명하게 남아 있을 우리의 이야기." }[view]}</p></div><button class="primary" id="add">${ico("plus")} ${view === "calendar" ? "일정 추가" : view === "photos" ? "사진 추가" : view === "map" ? "여행 기록" : "새로운 기록"}</button></div>${
      view === "home"
        ? `<section class="hero"><div class="hero-shade"></div><div class="hero-copy"><span class="pill">${ico("heart")} OUR LOVE STORY</span><h2>너와 나,<br>그리고 우리의 날들.</h2><p>별것 아닌 순간도 너와 함께라면 여행이 돼.</p><div class="hero-bottom"><span>${ico("calendar-heart")} ${state.since.replaceAll("-", ".")}부터 함께</span><button id="edit-date">시작일 수정 ${ico("arrow-up-right")}</button></div></div><div class="counter"><span>우리가 함께한 시간</span><div><b>${days.toLocaleString()}</b><em>days</em></div><p>오늘도, 내일도 차곡차곡 ${ico("heart")}</p></div><span class="hero-caption">COLLECT MOMENTS, NOT THINGS.</span></section><section class="stats">${[
            [
              "heart",
              "함께한 날",
              `${days.toLocaleString()}<small>일</small>`,
              "하루하루 더 가까워지는 우리",
            ],
            [
              "map-pin",
              "여행의 발자국",
              `${state.trips.length}<small>곳</small>`,
              "함께 발견한 새로운 풍경",
            ],
            [
              "calendar-days",
              "다가오는 약속",
              `${state.events.filter((e) => e.date >= today()).length}<small>개</small>`,
              "기다림도 설레는 순간",
            ],
            [
              "camera",
              "담아둔 순간",
              `${state.photos.length}<small>장</small>`,
              "오래 간직하고 싶은 기억",
            ],
          ]
            .map(
              ([i, t, n, s], idx) =>
                `<button class="stat" data-view="${["home", "map", "calendar", "photos"][idx]}"><span class="stat-icon c${idx}">${ico(i)}</span><div><span>${t}</span><strong>${n}</strong><small>${s}</small></div>${ico("arrow-up-right", "stat-arrow")}</button>`,
            )
            .join(
              "",
            )}</section><div class="two-cols"><section class="panel map-panel"><div class="section-head"><div><h3>우리의 여행 지도 <span class="tiny">${state.trips.length}</span></h3><p>함께한 곳마다 이야기가 남아요.</p></div><button data-view="map">전체 보기 ${ico("arrow-right")}</button></div><div id="map"></div><div class="map-foot"><span><b class="dot"></b> 우리의 발자국</span><button id="trip-add">${ico("plus")} 여행 기록하기</button></div></section><section class="panel schedule-panel"><div class="section-head"><div><h3>다가오는 일정</h3><p>우리의 다음 순간을 기다리며.</p></div><button data-view="calendar">${ico("arrow-up-right")}</button></div>${eventsMarkup()}<div class="schedule-bottom"><span>${ico("sparkles")} 작은 약속도 특별한 추억이 돼요.</span><button id="event-add">${ico("plus")}</button></div></section></div><section class="album-section"><div class="section-head"><div><h3>최근의 순간들 <span class="handwritten">pieces of us</span></h3><p>우리의 시선으로 담은 소중한 조각들.</p></div><button data-view="photos">앨범 보기 ${ico("arrow-right")}</button></div><div class="photo-grid">${photosMarkup(true)}</div></section>`
        : view === "map"
          ? `<section class="panel"><div id="map" class="big-map"></div></section><div class="trip-list">${state.trips.length ? state.trips.map((t) => `<article class="panel trip"><span class="stat-icon c1">${ico("map-pin")}</span><div><h3>${esc(t.name)}</h3><p>${esc(t.date)} · ${esc(t.note)}</p></div><button class="icon-btn edit-record" data-kind="trips" data-id="${t.id}" aria-label="여행 수정">${ico("pencil")}</button><button class="icon-btn delete" data-kind="trips" data-id="${t.id}" aria-label="여행 삭제">${ico("trash-2")}</button></article>`).join("") : '<div class="empty">지도에서 장소를 클릭해 첫 여행을 기록해 보세요.</div>'}</div>`
          : view === "calendar"
            ? calendarMarkup()
            : `<div class="album-toolbar"><span>${state.photos.length}장의 소중한 순간</span><button class="secondary" id="upload">${ico("upload")} 사진 업로드</button></div><div class="photo-grid album-grid">${photosMarkup(false)}</div>`
    }<footer><span>MADE OF LITTLE MOMENTS</span><span>우리의 이야기는 계속됩니다 ${ico("heart")}</span></footer></div></main><dialog id="dialog"></dialog><div id="toast" role="status"></div><input type="file" accept="image/*" multiple id="files" hidden>`;
  createIcons({ icons });
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.view;
        render();
      }),
  );
  $(".brand").onclick = (e) => {
    e.preventDefault();
    view = "home";
    render();
  };
  $("#add").onclick = () =>
    view === "home"
      ? recordModal()
      : view === "map"
        ? tripModal()
        : view === "calendar"
          ? eventModal()
          : $("#files").click();
  $("#profile").onclick = profileModal;
  $("#settings").onclick = profileModal;
  $("#account").onclick = accountModal;
  bindSharing();
  if ($("#map")) initMap();
  if ($("#edit-date")) $("#edit-date").onclick = profileModal;
  if ($("#trip-add")) $("#trip-add").onclick = () => tripModal();
  if ($("#event-add")) $("#event-add").onclick = () => eventModal();
  if ($("#upload")) $("#upload").onclick = () => $("#files").click();
  $("#files").onchange = uploadPhotos;
  document.querySelectorAll(".delete").forEach(
    (b) =>
      (b.onclick = async () => {
        if (confirm("이 기록을 삭제할까요?"))
          try {
            await runAction(async () => {
              if (cloud) return cloud.remove(b.dataset.kind, b.dataset.id);
              localChange(
                (s) =>
                  (s[b.dataset.kind] = s[b.dataset.kind].filter(
                    (x) => String(x.id) !== b.dataset.id,
                  )),
              );
            }, "기록을 삭제했어요");
          } catch (e) {
            toast(errorText(e));
          }
      }),
  );
  document
    .querySelectorAll(".edit-record")
    .forEach(
      (b) =>
        (b.onclick = () =>
          b.dataset.kind === "events"
            ? eventModal(undefined, b.dataset.id)
            : tripModal(undefined, b.dataset.id)),
    );
  document
    .querySelectorAll("[data-photo]")
    .forEach((b) => (b.onclick = () => photoModal(b.dataset.photo)));
  document
    .querySelectorAll("[data-day]")
    .forEach((b) => (b.onclick = () => eventModal(b.dataset.day)));
  if ($("#prev"))
    $("#prev").onclick = () => {
      month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
      render();
    };
  if ($("#next"))
    $("#next").onclick = () => {
      month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      render();
    };
  if ($("#now"))
    $("#now").onclick = () => {
      month = new Date();
      render();
    };
}
function eventsMarkup() {
  const upcoming = state.events
    .filter((e) => e.date >= today())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  return upcoming.length
    ? `<div class="events">${upcoming.map((e) => `<div class="event"><div class="event-date"><span>${new Date(e.date + "T12:00:00").getMonth() + 1}월</span><b>${Number(e.date.slice(-2))}</b></div><div><h4>${esc(e.title)}</h4><p>${esc(e.note || "우리의 소중한 약속")}</p></div><span class="tag">D-${Math.ceil((new Date(e.date) - new Date(today())) / 86400000)}</span></div>`).join("")}</div>`
    : `<div class="empty schedule-empty">${ico("calendar-heart")}<h4>다음 설렘을 채워볼까요?</h4><p>데이트, 여행, 기념일을 기록해 보세요.</p><button class="secondary" id="empty-add" onclick="document.querySelector('#event-add').click()">첫 일정 추가</button></div>`;
}
function photosMarkup(preview) {
  let items = preview
    ? state.photos.slice(-4).reverse()
    : state.photos.slice().reverse();
  if (!items.length)
    return pics
      .map(
        (p, i) =>
          `<button class="photo-card sample" onclick="document.querySelector('#files').click()"><img src="${photo(p)}" alt="${["잔잔한 호수", "햇살 아래의 들판", "푸른 바다", "산의 풍경"][i]}"><div><span>${["함께 떠나는 여행", "햇살이 좋았던 날", "우리의 여름", "어디든, 함께"][i]}</span><small>사진을 추가해 우리 이야기로 채워요 ${ico("plus")}</small></div><span class="sample-label">INSPIRATION</span></button>`,
      )
      .join("");
  return items
    .map(
      (p) =>
        `<button class="photo-card" data-photo="${p.id}"><img src="${esc(p.src)}" alt="${esc(p.name)}"><div><span>${esc(p.name)}</span><small>${esc(p.date)}</small></div></button>`,
    )
    .join("");
}
function calendarMarkup() {
  const y = month.getFullYear(),
    m = month.getMonth(),
    start = new Date(y, m, 1).getDay(),
    count = new Date(y, m + 1, 0).getDate();
  return `<section class="panel calendar-panel"><div class="calendar-head"><h2>${y}년 ${m + 1}월</h2><div><button class="secondary" id="now">오늘</button><button class="icon-btn" id="prev" aria-label="이전 달">${ico("chevron-left")}</button><button class="icon-btn" id="next" aria-label="다음 달">${ico("chevron-right")}</button></div></div><div class="calendar-grid">${["일", "월", "화", "수", "목", "금", "토"].map((d) => `<div class="weekday">${d}</div>`).join("")}${Array.from({ length: start }, () => '<div class="day blank"></div>').join("")}${Array.from(
    { length: count },
    (_, i) => {
      let date = `${y}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      return `<button class="day ${date === today() ? "today" : ""}" data-day="${date}"><span>${i + 1}</span>${state.events
        .filter((e) => e.date === date)
        .map((e) => `<small>${esc(e.title)}</small>`)
        .join("")}</button>`;
    },
  ).join(
    "",
  )}</div></section><section class="panel event-list"><h3>이번 달의 일정</h3>${
    state.events
      .filter((e) =>
        e.date.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`),
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(
        (e) =>
          `<div class="event"><div><h4>${esc(e.title)}</h4><p>${e.date} · ${esc(e.note)}</p></div><button class="icon-btn edit-record" data-kind="events" data-id="${e.id}" aria-label="일정 수정">${ico("pencil")}</button><button class="icon-btn delete" data-kind="events" data-id="${e.id}" aria-label="일정 삭제">${ico("trash-2")}</button></div>`,
      )
      .join("") || '<p class="muted">날짜를 선택해서 일정을 추가하세요.</p>'
  }</section>`;
}
function initMap() {
  map = L.map("map", { scrollWheelZoom: false, zoomControl: false }).setView(
    state.trips.length
      ? [state.trips[0].lat, state.trips[0].lng]
      : [36.5, 127.8],
    state.trips.length ? 6 : 6,
  );
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { attribution: "&copy; OpenStreetMap &copy; CARTO", maxZoom: 19 },
  ).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const localMap = map;
  map.createPane("fallback-map");
  map.getPane("fallback-map").style.zIndex = 150;
  map.getPane("fallback-map").style.pointerEvents = "none";
  fetch("/world.geo.json")
    .then((r) => r.json())
    .then((data) => {
      if (map !== localMap) return;
      L.geoJSON(data, {
        pane: "fallback-map",
        interactive: false,
        style: {
          color: "#cdd6c1",
          weight: 1,
          fillColor: "#e9eddf",
          fillOpacity: 1,
        },
      })
        .addTo(localMap)
        .bringToBack();
      [
        [37.5665, 126.978, "서울"],
        [35.1796, 129.0756, "부산"],
        [33.4996, 126.5312, "제주"],
        [35.6762, 139.6503, "도쿄"],
        [34.6937, 135.5023, "오사카"],
      ].forEach(([lat, lng, name]) =>
        L.circleMarker([lat, lng], { radius: 2, color: "#a0ac91", weight: 1 })
          .addTo(localMap)
          .bindTooltip(name, {
            permanent: true,
            direction: "right",
            className: "city-label",
          }),
      );
    })
    .catch(() => {});
  state.trips.forEach((t) =>
    L.marker([t.lat, t.lng], {
      icon: L.divIcon({
        html: '<span class="map-marker">♥</span>',
        className: "custom-marker",
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      }),
    })
      .addTo(map)
      .bindPopup(`<b>${esc(t.name)}</b><br>${esc(t.date)}<br>${esc(t.note)}`),
  );
  map.on("click", (e) => tripModal(e.latlng));
  const currentMap = map;
  setTimeout(() => {
    if (map === currentMap) currentMap.invalidateSize();
  }, 100);
}
function modal(title, content, onSubmit) {
  const d = $("#dialog");
  d.innerHTML = `<div class="modal-head"><h2>${title}</h2><button type="button" class="icon-btn" id="close" aria-label="닫기">${ico("x")}</button></div>${content}<p class="form-error" role="alert" hidden></p>`;
  createIcons({ icons });
  $("#close").onclick = () => {
    if (!busy) d.close();
  };
  d.onclick = (e) => {
    if (e.target === d && !busy) d.close();
  };
  d.oncancel = (e) => {
    if (busy) e.preventDefault();
  };
  d.onclose = () => {
    if (pendingRender && !busy) {
      pendingRender = false;
      render();
    }
  };
  if (!d.open) d.showModal();
  if (onSubmit)
    d.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      const form = e.target;
      const buttons = [...form.querySelectorAll("button")];
      buttons.forEach((b) => (b.disabled = true));
      d.querySelector(".form-error").hidden = true;
      try {
        await onSubmit(new FormData(form));
      } catch (error) {
        if (d.isConnected) {
          const el = d.querySelector(".form-error");
          el.textContent = errorText(error);
          el.hidden = false;
        }
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    };
}
function profileModal() {
  modal(
    "우리의 이야기",
    `<form><label>우리 이름<input name="names" required maxlength="40" value="${esc(state.names)}"></label><label>처음 함께한 날<input type="date" name="since" required max="${today()}" value="${state.since}"></label><p class="muted">시작한 날을 1일로 계산해요. ${cloud ? "상대방의 화면에도 함께 반영돼요." : ""}</p><button class="primary">저장하기</button></form>`,
    (f) =>
      runAction(async () => {
        const names = f.get("names").trim();
        if (!names) throw { userMessage: "우리 이름을 입력해 주세요." };
        if (cloud) await cloud.profile(names, f.get("since"));
        else
          localChange((s) => {
            s.names = names;
            s.since = f.get("since");
          });
      }, "우리의 이야기를 저장했어요"),
  );
}
function recordModal() {
  modal(
    "어떤 순간을 남길까요?",
    `<div class="record-options"><button class="secondary" id="rec-trip">${ico("map-pin")} 여행 기록</button><button class="secondary" id="rec-event">${ico("calendar-days")} 일정 추가</button><button class="secondary" id="rec-photo">${ico("camera")} 사진 저장</button></div>`,
  );
  $("#rec-trip").onclick = () => tripModal();
  $("#rec-event").onclick = () => eventModal();
  $("#rec-photo").onclick = () => {
    $("#dialog").close();
    $("#files").click();
  };
}
function eventModal(date = today(), id) {
  const old = state.events.find((x) => x.id === id);
  modal(
    old ? "우리의 일정 수정" : "우리의 일정 추가",
    `<form><label>어떤 약속인가요?<input name="title" value="${esc(old?.title || "")}" placeholder="예: 함께하는 주말 데이트" required maxlength="80"></label><label>날짜<input type="date" name="date" value="${old?.date || date}" required></label><label>메모<textarea name="note" placeholder="시간, 장소, 기억할 것들" maxlength="300">${esc(old?.note || "")}</textarea></label><button class="primary">${ico("plus")} 일정 저장</button></form>`,
    (f) => {
      const row = {
        id: old?.id || crypto.randomUUID(),
        title: f.get("title").trim(),
        date: f.get("date"),
        note: f.get("note"),
      };
      if (!row.title) throw { userMessage: "일정 이름을 입력해 주세요." };
      return runAction(
        () => (old ? editRecord("events", row) : addRecord("events", row)),
        "설레는 약속을 저장했어요",
      );
    },
  );
}
function tripModal(pos, id) {
  const old = state.trips.find((x) => x.id === id);
  modal(
    old ? "여행 기록 수정" : "여행의 발자국 남기기",
    `<form><label>여행지 이름<input name="name" value="${esc(old?.name || "")}" required placeholder="예: 제주도, 우리만의 바다" maxlength="80"></label><label>여행 날짜<input name="date" type="date" required value="${old?.date || today()}"></label><div class="form-row"><label>위도<input type="number" step="any" min="-90" max="90" required name="lat" value="${old?.lat ?? pos?.lat?.toFixed(5) ?? "33.4996"}"></label><label>경도<input type="number" step="any" min="-180" max="180" required name="lng" value="${old?.lng ?? pos?.lng?.toFixed(5) ?? "126.5312"}"></label></div><p class="muted">지도에서 장소를 클릭하면 위치가 자동으로 입력돼요.</p><label>기억하고 싶은 이야기<textarea name="note" maxlength="300" placeholder="그날의 풍경과 기분을 남겨요">${esc(old?.note || "")}</textarea></label><button class="primary">여행 기록 저장</button></form>`,
    (f) => {
      const row = {
        id: old?.id || crypto.randomUUID(),
        name: f.get("name").trim(),
        date: f.get("date"),
        note: f.get("note"),
        lat: Number(f.get("lat")),
        lng: Number(f.get("lng")),
      };
      if (!row.name) throw { userMessage: "여행지 이름을 입력해 주세요." };
      return runAction(
        () => (old ? editRecord("trips", row) : addRecord("trips", row)),
        "지도에 우리의 발자국을 남겼어요",
      );
    },
  );
}
async function photoBlob(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject({ userMessage: "사진을 변환할 수 없어요." }),
      "image/jpeg",
      0.78,
    ),
  );
}
function blobData(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
async function uploadPhotos(e) {
  const files = [...e.target.files];
  e.target.value = "";
  if (busy) return;
  let uploaded = 0;
  try {
    await runAction(
      async () => {
        for (const file of files) {
          if (!file.type.startsWith("image/"))
            throw { userMessage: "사진 파일만 업로드할 수 있어요." };
          if (file.size > 30 * 1024 * 1024)
            throw { userMessage: "사진 한 장은 30MB 이하로 선택해 주세요." };
          let blob;
          try {
            blob = await photoBlob(file);
          } catch {
            throw {
              userMessage:
                "이 사진을 읽을 수 없어요. JPG 또는 PNG를 선택해 주세요.",
            };
          }
          const p = {
            id: crypto.randomUUID(),
            name:
              file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "우리의 순간",
            date: today(),
          };
          if (cloud) await cloud.addPhoto(p, blob);
          else {
            p.src = await blobData(blob);
            localChange((s) => s.photos.push(p));
          }
          uploaded++;
        }
      },
      () => `${uploaded}장의 사진을 저장했어요`,
    );
  } catch (error) {
    if (cloud && user) await refreshRemote(true);
    else render();
    toast(
      `${uploaded ? uploaded + "장은 저장됐어요. " : ""}${errorText(error)}`,
    );
  }
}
function photoModal(id) {
  const p = state.photos.find((x) => x.id === id);
  if (!p) return;
  modal(
    "소중한 순간",
    `<img class="lightbox" src="${esc(p.src)}" alt="${esc(p.name)}"><form><label>사진 제목<input name="name" value="${esc(p.name)}" required maxlength="80"></label><label>촬영 날짜<input type="date" name="date" value="${p.date}" required></label><div class="modal-actions"><button type="button" class="secondary" id="delete-photo">사진 삭제</button><button class="primary">저장하기</button></div></form>`,
    (f) =>
      runAction(async () => {
        const name = f.get("name").trim();
        if (!name) throw { userMessage: "사진 제목을 입력해 주세요." };
        if (cloud) await cloud.editPhoto(id, name, f.get("date"));
        else
          localChange((s) =>
            Object.assign(
              s.photos.find((x) => x.id === id),
              { name, date: f.get("date") },
            ),
          );
      }, "사진 정보를 저장했어요"),
  );
  $("#delete-photo").onclick = async () => {
    if (busy || !confirm("이 사진을 삭제할까요?")) return;
    try {
      await runAction(
        () =>
          cloud
            ? cloud.remove("photos", id)
            : localChange(
                (s) => (s.photos = s.photos.filter((x) => x.id !== id)),
              ),
        "사진을 삭제했어요",
      );
    } catch (e) {
      const el = $("#dialog .form-error");
      el.textContent = errorText(e);
      el.hidden = false;
    }
  };
}
async function editRecord(kind, row) {
  if (cloud) await cloud.edit(kind, row);
  else
    localChange((s) =>
      Object.assign(
        s[kind].find((x) => x.id === row.id),
        row,
      ),
    );
}
async function addRecord(kind, row) {
  if (cloud) await cloud.add(kind, row);
  else localChange((s) => s[kind].push(row));
}
async function runAction(action, message) {
  if (busy) return;
  busy = true;
  const currentEpoch = epoch;
  try {
    const warning = await action();
    if (currentEpoch !== epoch) return;
    if (cloud) {
      await refreshRemote(true);
      if ($("#dialog")?.open) $("#dialog").close();
      render();
    } else render();
    toast(warning || (typeof message === "function" ? message() : message));
  } finally {
    busy = false;
  }
}
function sharingBanner() {
  return cloud
    ? `<section class="sharing-banner"><div>${ico("heart")}<span><b>우리 둘의 공유 공간</b><small>${state.memberCount === 2 ? "두 사람이 같은 기록을 함께 보고 있어요." : "상대방을 초대해 우리 이야기를 함께 채워요."}</small></span></div><div><span class="sync-state" id="sync-status">${syncStatus === "SUBSCRIBED" ? "실시간 연결됨" : "공유 저장 · 자동 새로고침"}</span><button class="secondary" id="share-space">${state.memberCount === 2 ? "계정 관리" : "상대방 초대"}</button><button class="icon-btn" id="refresh" aria-label="공유 기록 새로고침">${ico("cloud-sun")}</button></div></section>`
    : `<section class="sharing-banner local-banner"><div>${ico("heart")}<span><b>이 기기에 저장하는 개인 공간</b><small>로그인하고 커플을 연결하면 상대방과 기록을 공유할 수 있어요.</small></span></div><button class="secondary" id="connect">공유 공간 연결</button></section>`;
}
function bindSharing() {
  if ($("#connect")) $("#connect").onclick = connectionModal;
  if ($("#share-space")) $("#share-space").onclick = accountModal;
  if ($("#refresh"))
    $("#refresh").onclick = async () => {
      await refreshRemote(true);
      if (!loadError) toast("최신 공유 기록을 불러왔어요");
    };
}
function gateShell(content) {
  $("#app").innerHTML =
    `<div class="auth-page"><div class="auth-story"><a class="brand" href="#">${ico("flower-2")}<span>our days.</span></a><div><span class="eyebrow">A LITTLE RECORD OF US</span><h1>너와 나,<br>그리고 우리의 날들.</h1><p>같은 달력을 채우고, 같은 추억을 간직하는<br>우리 둘만의 작은 공간.</p></div><span class="auth-foot">COLLECT MOMENTS, NOT THINGS.</span></div><div class="auth-card">${content}</div></div><dialog id="dialog"></dialog><div id="toast" role="status"></div>`;
  createIcons({ icons });
}
function renderGate() {
  if (!cloud) return false;
  if (booting) {
    gateShell(
      '<div class="loading-heart">♡</div><h2>우리의 공간을 불러오는 중</h2><p class="muted">잠시만 기다려 주세요.</p>',
    );
    return true;
  }
  if (recovery) {
    gateShell(
      `<span class="eyebrow">A FRESH START</span><h2>새 비밀번호 설정</h2><form id="recover-form"><label>새 비밀번호<input type="password" name="password" minlength="8" required autocomplete="new-password"></label><label>비밀번호 확인<input type="password" name="confirm" minlength="8" required autocomplete="new-password"></label><button class="primary">비밀번호 변경</button><p class="form-error" role="alert" hidden></p></form>`,
    );
    bindForm($("#recover-form"), async (f) => {
      if (f.get("password") !== f.get("confirm"))
        throw { userMessage: "두 비밀번호가 같아야 해요." };
      const { error } = await cloud.client.auth.updateUser({
        password: f.get("password"),
      });
      if (error) throw error;
      recovery = false;
      await refreshRemote(true);
      render();
      toast("비밀번호를 변경했어요");
    });
    return true;
  }
  if (!user) {
    gateShell(
      `<span class="eyebrow">WELCOME TO OUR DAYS</span><h2>우리의 이야기를 시작해요</h2><p class="auth-description">로그인하고 상대방과 같은 기록을 채워요.</p>${authMarkup()}<button class="text-button" id="connection-settings">사이트 연결 설정</button>`,
    );
    bindAuth();
    $("#connection-settings").onclick = connectionModal;
    return true;
  }
  if (loadError) {
    gateShell(
      `<h2>공유 공간에 연결하지 못했어요</h2><p class="muted">${esc(loadError)}</p><div class="record-options"><button class="primary" id="retry-load">다시 연결</button><button class="secondary" id="gate-logout">로그아웃</button></div>`,
    );
    $("#retry-load").onclick = () => refreshRemote(true);
    $("#gate-logout").onclick = logout;
    return true;
  }
  if (noSpace) {
    gateShell(
      `<span class="eyebrow">JUST THE TWO OF US</span><h2>우리의 공간에 연결해요</h2><p class="auth-description">${pendingInvite() ? "받은 초대 코드가 준비되어 있어요. 아래에서 연결을 완료하세요." : "한 사람만 공간을 만들고, 상대방은 초대 코드로 참여하면 돼요."}</p><div class="auth-tabs"><button id="create-tab" class="${pendingInvite() ? "" : "selected"}">새 공간 만들기</button><button id="join-tab" class="${pendingInvite() ? "selected" : ""}">초대로 참여</button></div><div id="space-form"></div><button class="text-button" id="gate-logout">로그아웃</button>`,
    );
    $("#create-tab").onclick = () => spaceForm("create");
    $("#join-tab").onclick = () => spaceForm("join");
    $("#gate-logout").onclick = logout;
    spaceForm(pendingInvite() ? "join" : "create");
    return true;
  }
  return false;
}
function authMarkup() {
  return `<div class="auth-tabs"><button id="login-tab" class="selected">로그인</button><button id="signup-tab">회원가입</button></div><form id="auth-form"><label>이메일<input type="email" name="email" placeholder="you@example.com" autocomplete="email" required maxlength="254"></label><label id="password-label">비밀번호<input type="password" name="password" minlength="8" autocomplete="current-password" required></label><label id="confirm-label" hidden>비밀번호 확인<input type="password" name="confirm" minlength="8" autocomplete="new-password" disabled></label><button class="primary" id="auth-submit">로그인</button><p class="form-error" role="alert" hidden></p><p class="form-notice" role="status" hidden></p></form><button class="text-button" id="reset-password">비밀번호를 잊으셨나요?</button>`;
}
function bindForm(form, action) {
  let submitting = false;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    const button =
      form.querySelector("button[type=submit]") || form.querySelector("button");
    if (button) button.disabled = true;
    const errorEl = form.querySelector(".form-error");
    if (errorEl) errorEl.hidden = true;
    try {
      await action(new FormData(form));
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
      } else toast(errorText(err));
    } finally {
      submitting = false;
      if (button) button.disabled = false;
    }
  };
}
function bindAuth() {
  let mode = "login";
  const form = $("#auth-form");
  const switchMode = (m) => {
    mode = m;
    $("#login-tab").classList.toggle("selected", m === "login");
    $("#signup-tab").classList.toggle("selected", m === "signup");
    $("#password-label").hidden = m === "reset";
    $("#password-label input").required = m !== "reset";
    $("#password-label input").autocomplete =
      m === "signup" ? "new-password" : "current-password";
    $("#confirm-label").hidden = m !== "signup";
    $("#confirm-label input").required = m === "signup";
    $("#confirm-label input").disabled = m !== "signup";
    $("#password-label input").disabled = m === "reset";
    $("#auth-submit").textContent = {
      login: "로그인",
      signup: "회원가입",
      reset: "비밀번호 재설정 메일 받기",
    }[m];
    form.querySelector(".form-error").hidden = true;
    form.querySelector(".form-notice").hidden = true;
  };
  $("#login-tab").onclick = () => switchMode("login");
  $("#signup-tab").onclick = () => switchMode("signup");
  $("#reset-password").onclick = () => switchMode("reset");
  bindForm(form, async (f) => {
    const email = f.get("email").trim();
    let result;
    if (mode === "login")
      result = await cloud.client.auth.signInWithPassword({
        email,
        password: f.get("password"),
      });
    else if (mode === "signup") {
      if (f.get("password") !== f.get("confirm"))
        throw { userMessage: "두 비밀번호가 같아야 해요." };
      result = await cloud.client.auth.signUp({
        email,
        password: f.get("password"),
        options: { emailRedirectTo: location.origin + location.pathname },
      });
    } else
      result = await cloud.client.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname,
      });
    if (result.error) throw result.error;
    if (mode !== "login") {
      const notice = form.querySelector(".form-notice");
      notice.textContent =
        mode === "signup"
          ? "확인 메일을 보냈어요. 메일의 링크를 누른 후 로그인해 주세요. 이미 가입했다면 로그인을 이용하세요."
          : "가입된 이메일이라면 재설정 메일이 도착해요. 메일의 링크를 열어 주세요.";
      notice.hidden = false;
    }
  });
}
function spaceForm(mode) {
  $("#create-tab").classList.toggle("selected", mode === "create");
  $("#join-tab").classList.toggle("selected", mode === "join");
  $("#space-form").innerHTML =
    mode === "create"
      ? `<form><label>우리 이름<input name="names" required maxlength="40" placeholder="예: 지우 & 민준"></label><label>처음 함께한 날<input type="date" name="since" required max="${today()}" value="${today()}"></label><button class="primary">우리 공간 만들기</button><p class="form-error" role="alert" hidden></p></form>`
      : `<form><label>초대 코드 또는 초대 링크<input name="token" value="${esc(pendingInvite())}" required autocomplete="off" placeholder="상대방에게 받은 코드를 붙여 넣으세요"></label><p class="muted">초대는 한 번만 사용할 수 있으며 7일 후 만료돼요.</p><button class="primary">상대방과 연결하기</button><p class="form-error" role="alert" hidden></p></form>`;
  bindForm($("#space-form form"), async (f) => {
    if (mode === "create") {
      const names = f.get("names").trim();
      if (!names) throw { userMessage: "우리 이름을 입력해 주세요." };
      const { error } = await cloud.client.rpc("create_couple", {
        p_names: names,
        p_since: f.get("since"),
      });
      if (error) throw error;
    } else {
      let token = f.get("token").trim();
      if (token.includes("#")) {
        try {
          token =
            new URLSearchParams(new URL(token).hash.slice(1)).get("invite") ||
            "";
        } catch {
          throw { userMessage: "올바른 초대 코드나 링크를 입력해 주세요." };
        }
      }
      if (!/^[a-f0-9]{64}$/.test(token))
        throw { userMessage: "올바른 초대 코드나 링크를 입력해 주세요." };
      const { error } = await cloud.client.rpc("join_couple", {
        p_token: token,
      });
      if (error) throw error;
    }
    try {
      sessionStorage.removeItem("our-days-invite");
    } catch {}
    await refreshRemote(true);
    if (!loadError) toast("우리의 공유 공간에 연결됐어요");
  });
}
function connectionModal() {
  modal(
    "공유 공간 연결 설정",
    `<p class="muted">사이트 관리자가 Supabase 프로젝트를 만든 뒤 공개 연결 정보를 입력해 주세요. 한 번 배포하면 두 사람 모두 같은 프로젝트를 사용해요.</p><form><label>프로젝트 URL<input name="url" type="url" placeholder="https://xxxx.supabase.co" required value="${esc(config?.url || "")}"></label><label>Publishable key<input name="key" type="password" placeholder="sb_publishable_…" required autocomplete="off" value="${esc(config?.key || "")}"></label><p class="muted">API Keys의 Publishable key만 사용하세요. Secret 또는 service_role 키는 입력하지 마세요.</p><button class="primary">연결하고 로그인하기</button></form>`,
    (f) => {
      const c = validateConnection(f.get("url"), f.get("key"));
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
      } catch {
        throw { userMessage: "브라우저 저장 기능을 사용할 수 없어요." };
      }
      location.reload();
    },
  );
}
function accountModal() {
  if (!cloud) {
    connectionModal();
    return;
  }
  modal(
    "우리의 공유 계정",
    `<div class="account-summary"><span class="stat-icon c0">${ico("heart")}</span><div><b>${esc(state.names)}</b><small>${esc(user.email || "로그인됨")}</small><p>${state.memberCount === 2 ? "상대방과 연결됨 · 두 사람만 접근 가능" : "상대방의 참여를 기다리고 있어요."}</p></div></div><div class="record-options">${state.memberCount < 2 ? '<button class="primary" id="make-invite">상대방 초대하기</button>' : ""}<button class="secondary" id="import-local">이 기기의 기존 기록 가져오기</button><button class="secondary" id="account-refresh">공유 기록 새로고침</button><button class="secondary" id="logout">로그아웃</button></div><div id="invite-result"></div>`,
  );
  if ($("#make-invite"))
    $("#make-invite").onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const { data: token, error } = await cloud.client.rpc(
          "create_couple_invite",
        );
        if (error) throw error;
        const url = `${location.origin}${location.pathname}#invite=${token}`;
        $("#invite-result").innerHTML =
          `<div class="invite-box"><h3>우리 공간으로 초대해요</h3><p class="muted">한 번만 사용 가능 · 7일 후 만료<br>새 초대를 만들면 이전 초대는 만료돼요.</p><label>초대 코드<input readonly id="invite-code" value="${token}"></label><button class="secondary" id="copy-code">코드 복사</button><label>초대 링크<input readonly id="invite-link" value="${esc(url)}"></label><button class="secondary" id="copy-link">링크 복사</button>${["localhost", "127.0.0.1"].includes(location.hostname) ? '<p class="form-notice">지금은 내 컴퓨터에서 실행 중이에요. 상대방도 동일한 Supabase에 연결한 사이트에서 초대 코드를 입력하거나, 배포 후 초대 링크를 이용하세요.</p>' : ""}</div>`;
        $("#copy-code").onclick = () => copyValue($("#invite-code"));
        $("#copy-link").onclick = () => copyValue($("#invite-link"));
      } catch (err) {
        const el = $("#dialog .form-error");
        el.textContent = errorText(err);
        el.hidden = false;
      } finally {
        b.disabled = false;
      }
    };
  $("#import-local").onclick = importModal;
  $("#account-refresh").onclick = () => refreshRemote(true);
  $("#logout").onclick = logout;
}
async function copyValue(input) {
  try {
    await navigator.clipboard.writeText(input.value);
    toast("복사했어요. 상대방에게 보내 주세요.");
  } catch {
    input.focus();
    input.select();
    toast("선택한 내용을 Ctrl+C로 복사해 주세요.");
  }
}
function importModal() {
  const legacy = localState();
  modal(
    "기존 기록을 함께 간직해요",
    `<p class="muted">이 브라우저에 저장된 기록을 현재 커플 공간으로 복사합니다. 상대방도 볼 수 있어요. 기존 브라우저 기록은 그대로 보관해요.</p><div class="import-counts"><span>일정 <b>${legacy.events.length}</b></span><span>여행 <b>${legacy.trips.length}</b></span><span>사진 <b>${legacy.photos.length}</b></span></div><form><label class="check-label"><input type="checkbox" name="profile">우리 이름과 시작일도 기존 기록으로 변경</label><p class="muted">같은 기록을 다시 가져오면 중복으로 추가하지 않아요. 일부 실패했다면 다시 시도할 수 있어요.</p><button class="primary">공유 공간으로 가져오기</button></form>`,
    (f) =>
      runAction(async () => {
        for (const kind of ["events", "trips"])
          for (const row of legacy[kind]) await cloud.add(kind, row, true);
        for (const p of legacy.photos) {
          if (!p.src?.startsWith("data:image/"))
            throw {
              userMessage:
                "이 기기의 사진 파일을 읽을 수 없어요. 앨범에서 직접 업로드해 주세요.",
            };
          const blob = await photoBlob(await (await fetch(p.src)).blob());
          await cloud.addPhoto(p, blob, true);
        }
        if (f.get("profile")) await cloud.profile(legacy.names, legacy.since);
      }, "기존 기록을 공유 공간으로 가져왔어요"),
  );
}
async function logout() {
  if (busy) return;
  const { error } = await cloud.client.auth.signOut({ scope: "local" });
  if (error) toast(errorText(error));
}
async function refreshRemote(force = false) {
  if (!cloud || !user) return;
  if (busy && !force) return;
  const capturedEpoch = epoch,
    version = ++loadVersion,
    currentUser = user;
  try {
    const data = await cloud.load(currentUser);
    if (capturedEpoch !== epoch || version !== loadVersion) return;
    loadError = "";
    noSpace = !data;
    cloud.coupleId = data?.coupleId || null;
    if (!data) {
      cloud.unwatch();
      watchId = null;
    }
    if (data) state = data;
    else state = blankState();
    if (data && watchId !== cloud.coupleId) {
      watchId = cloud.coupleId;
      cloud.watch(
        () => scheduleRefresh(),
        (status) => {
          syncStatus = status;
          if ($("#sync-status"))
            $("#sync-status").textContent =
              status === "SUBSCRIBED"
                ? "실시간 연결됨"
                : "공유 저장 · 자동 새로고침";
        },
      );
    }
    if (force || !$("#dialog")?.open) render();
    else pendingRender = true;
  } catch (err) {
    if (capturedEpoch !== epoch || version !== loadVersion) return;
    loadError = errorText(err);
    if (force) render();
    else
      toast("공유 기록을 갱신하지 못했어요. 새로고침으로 다시 시도해 주세요.");
  }
}
let refreshTimer;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshRemote(), 250);
}
async function sessionChanged(session, event) {
  if (event === "PASSWORD_RECOVERY") recovery = true;
  if (event === "TOKEN_REFRESHED" && session?.user.id === user?.id) return;
  const id = session?.user?.id || null;
  if (id !== user?.id) {
    epoch++;
    cloud.unwatch();
    cloud.signed = new Map();
    cloud.coupleId = null;
    watchId = null;
    pendingRender = false;
    loadError = "";
    state = blankState();
    noSpace = false;
    user = session?.user || null;
  }
  booting = false;
  if (user) await refreshRemote(true);
  else {
    recovery = false;
    render();
  }
}
render();
if (cloud) {
  cloud.client.auth.onAuthStateChange((event, session) => {
    if (event !== "INITIAL_SESSION")
      setTimeout(() => sessionChanged(session, event), 0);
  });
  cloud.client.auth.getSession().then(({ data, error }) => {
    if (error) {
      booting = false;
      loadError = errorText(error);
      render();
      toast(loadError);
    } else sessionChanged(data.session, "INITIAL_SESSION");
  });
  setInterval(() => {
    if (document.visibilityState === "visible") refreshRemote();
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleRefresh();
  });
  window.addEventListener("focus", scheduleRefresh);
}

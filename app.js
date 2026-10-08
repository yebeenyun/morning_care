const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  user: null,
  dogs: [],
  dog: null,
  tab: "home",
  temperature: [],
  feeding: [],
  hydration: [],
  medication: [],
  elimination: [],
  vitality: [],
  weight: [],
  selectedDate: null,
  adminData: null,
  reminders: localStorage.getItem("morning-reminders") === "on",
  notified: new Set(),
};

let deferredInstallPrompt = null;

const tabInfo = {
  home: ["오늘의 케어", "주모닝의 하루", "오늘도 함께, 천천히 건강을 챙겨봐요."],
  temperature: ["체온 기록", "체온을 살펴봐요", "기록을 이어가면 작은 변화도 놓치지 않아요."],
  feeding: ["식사 기록", "오늘의 식사", "먹은 시간과 양을 한눈에 확인해요."],
  hydration: ["음수량 기록", "오늘의 음수량", "물을 마신 시간과 양을 기록해요."],
  medication: ["약 복용", "약 먹을 시간이에요", "8시간 간격으로 하루 세 번, 꼼꼼하게 챙겨요."],
  elimination: ["소변 · 대변", "배변 기록을 남겨요", "소변과 대변을 기록해 배설 패턴을 확인해요."],
  vitality: ["활력 징후", "오늘의 활력 징후", "그날의 전반적인 컨디션을 세 단계로 기록해요."],
  weight: ["몸무게 기록", "몸무게 변화", "하루 한 번 측정해 한 달 동안의 변화를 살펴봐요."],
  diary: ["돌봄 일지", "하루의 돌봄 기록", "선택한 날짜에 남긴 모든 기록을 시간순으로 확인해요."],
  report: ["데일리 레포트", "하루 건강 리포트", "선택한 날짜의 건강 그래프를 한 장의 이미지로 저장해요."],
};
const vitalityStates = {
  1: { label: "좋음", description: "혼자 밥 먹음 · 체온 정상", tone: "good" },
  2: { label: "보통", description: "보통의 상태 · 체온 정상", tone: "normal" },
  3: { label: "나쁨", description: "축 늘어져 있음 · 체온 높음", tone: "poor" },
};

const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function dateParts(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    datetime: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = dateParts().date;
  const sameDay = dateParts(date).date === today;
  return `${sameDay ? "오늘" : `${date.getMonth() + 1}월 ${date.getDate()}일`} ${formatTime(value)}`;
}

function setToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(setToast.timer);
  setToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
  return payload;
}

function showAuth(mode = "login") {
  $("#appView").hidden = true;
  const root = $("#authView");
  root.hidden = false;
  const signup = mode === "register";
  root.innerHTML = `
    <section class="auth-art">
      <a class="brand" href="#"><span class="brand-mark">m</span><span>모닝<span class="brand-light">케어</span></span></a>
      <div class="art-copy"><div class="eyebrow">A LITTLE CARE, EVERY DAY</div>
        <h1>함께 돌보는 마음,<br>기록으로 더 오래.</h1>
        <p>가족과 함께 우리 아이의 건강한 하루를 기록하고, 작은 변화를 놓치지 마세요.</p>
      </div>
      <div class="art-dog" aria-hidden="true">🐕</div>
      <div class="art-foot">우리 아이의 건강한 오늘을 응원해요.</div>
    </section>
    <section class="auth-panel"><form id="authForm" class="auth-form">
      <div class="eyebrow">${signup ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</div>
      <h2>${signup ? "함께 돌봐볼까요?" : "다시 만나 반가워요"}</h2>
      <p>${signup ? "보호자 계정을 만들면 주모닝의 케어 기록이 시작돼요." : "로그인하고 주모닝의 오늘을 확인해 보세요."}</p>
      ${signup ? `<div class="field"><label for="authName">보호자 이름</label><input id="authName" name="name" autocomplete="name" placeholder="이름을 입력해 주세요" required maxlength="50"></div>` : ""}
      <div class="field"><label for="authEmail">이메일</label><input id="authEmail" name="email" type="email" autocomplete="email" placeholder="hello@example.com" required></div>
      ${signup ? `<div class="field"><label for="authInviteCode">초대 코드 (선택)</label><input id="authInviteCode" name="invite_code" autocomplete="off" placeholder="초대 코드가 있다면 입력해 주세요" maxlength="20"></div>` : ""}
      <div class="field"><label for="authPassword">비밀번호</label><input id="authPassword" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="${signup ? "8자 이상 입력해 주세요" : "비밀번호를 입력해 주세요"}" minlength="${signup ? "8" : "1"}" required></div>
      <button class="primary-button auth-submit" type="submit">${signup ? "계정 만들기" : "로그인"} <span>→</span></button>
      <div class="auth-switch">${signup ? "이미 계정이 있나요?" : "처음이신가요?"} <button type="button" id="authSwitch">${signup ? "로그인" : "보호자 계정 만들기"}</button></div>
      ${signup ? `<div class="auth-hint">초대 코드 없이 가입하면 테스트 프로필 <strong>주모닝 · 2017년생 · 바베시아</strong>이 준비돼요. 코드를 입력하면 기존 강아지 케어에 바로 참여해요.</div>` : ""}
    </form><button class="install-button auth-install-button" data-pwa-install>앱 설치 · 홈 화면에 추가</button></section>`;
  if (isInstalled()) $(".auth-install-button", root).hidden = true;
  $("#authSwitch").addEventListener("click", () => showAuth(signup ? "login" : "register"));
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = $(".auth-submit", event.currentTarget);
    button.disabled = true;
    try {
      await api(signup ? "/api/register" : "/api/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      await boot();
    } catch (error) {
      setToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function boot() {
  try {
    const result = await api("/api/me");
    if (!result.user) {
      showAuth();
      return;
    }
    state.user = result.user;
    state.dogs = result.dogs;
    state.selectedDate ||= dateParts().date;
    const isAdmin = state.user.role === "admin";
    $$(".admin-nav-item").forEach((button) => { button.hidden = !isAdmin; });
    $$(".nav-item:not(.admin-nav-item)").forEach((button) => { button.hidden = isAdmin; });
    $("#sideInvite").hidden = isAdmin;
    $("#joinCareButton").hidden = isAdmin;
    $("#dogProfileButton").hidden = isAdmin;
    $("#sideUserName").textContent = state.user.name;
    $("#authView").hidden = true;
    $("#appView").hidden = false;
    $("#todayLabel").textContent = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
    if (isAdmin) {
      state.tab = "admin";
      await loadAdminData();
      render();
      return;
    }
    state.tab = "home";
    if (!state.dogs.length) {
      state.dog = null;
      renderEmptyDogs();
      return;
    }
    const selectedId = Number(localStorage.getItem("morning-dog-id"));
    state.dog = state.dogs.find((dog) => dog.id === selectedId) || state.dogs[0];
    localStorage.setItem("morning-dog-id", state.dog.id);
    $("#topDogName").textContent = state.dog.name;
    setHeading();
    await loadRecords();
    render();
    scheduleAlarmCheck();
  } catch (error) {
    showAuth();
    setToast(error.message);
  }
}

async function loadAdminData() {
  state.adminData = await api("/api/admin/overview");
}

function renderEmptyDogs() {
  $("#sideUserName").textContent = state.user.name;
  $("#topDogName").textContent = "프로필 추가";
  $("#pageTitle").textContent = "함께 돌볼 아이를 등록해요";
  $("#pageSubtitle").textContent = "강아지 프로필을 만들거나 초대 코드로 케어에 참여해요.";
  $("#tabContent").innerHTML = `<div class="card detail-card"><div class="section-head"><h2>강아지 프로필</h2></div><p class="modal-note">아직 함께 돌보는 강아지가 없어요. 보호자에게 받은 초대 코드로 참여하거나 새 프로필을 만들어 주세요.</p><div class="form-actions"><button class="primary-button" id="emptyDogCreate">＋ 프로필 만들기</button><button class="secondary-button" id="emptyDogJoin">초대 코드 입력</button></div></div>`;
  $("#emptyDogCreate").addEventListener("click", () => openDogForm());
  $("#emptyDogJoin").addEventListener("click", openJoinModal);
}

async function loadRecords() {
  const id = state.dog.id;
  [state.temperature, state.feeding, state.hydration, state.medication, state.elimination, state.vitality, state.weight] = await Promise.all(
    ["temperature", "feeding", "hydration", "medication", "elimination", "vitality", "weight"].map(async (kind) => (await api(`/api/dogs/${id}/${kind}`)).records),
  );
}

function setHeading() {
  const [breadcrumb, title, subtitle] = tabInfo[state.tab];
  $("#breadcrumbName").textContent = breadcrumb;
  $("#pageTitle").innerHTML = state.tab === "home" ? `${escapeHTML(state.dog.name)}의 하루 <span class="title-paw">✳</span>` : title;
  $("#pageSubtitle").textContent = subtitle;
  const selected = new Date(`${state.selectedDate}T12:00:00`);
  $("#headingEyebrow").textContent = selected.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
}

function render() {
  if (state.tab === "admin" && state.user?.role === "admin") {
    renderAdmin();
    return;
  }
  if (!state.dog) return;
  setHeading();
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.tab === state.tab));
  const title = tabInfo[state.tab][0];
  $("#breadcrumbName").textContent = title;
  $("#mainAddButton").hidden = ["home", "diary", "report"].includes(state.tab);
  $("#mainAddButton").onclick = () => openRecordModal();
  const templates = {
    home: homeTemplate,
    temperature: temperatureTemplate,
    feeding: feedingTemplate,
    hydration: hydrationTemplate,
    medication: medicationTemplate,
    elimination: eliminationTemplate,
    vitality: vitalityTemplate,
    weight: weightTemplate,
    diary: diaryTemplate,
    report: reportTemplate,
  };
  $("#tabContent").innerHTML = `${selectedDateControl()}${templates[state.tab]()}`;
  const content = $("#tabContent");
  content.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.go)));
  content.querySelectorAll("[data-dose]").forEach((button) => button.addEventListener("click", () => markDose(Number(button.dataset.dose))));
  content.querySelector("#reminderToggle")?.addEventListener("click", toggleReminders);
  content.querySelector("#medStart")?.addEventListener("change", saveMedicationStart);
  content.querySelector("#selectedDate")?.addEventListener("change", (event) => {
    state.selectedDate = event.target.value || dateParts().date;
    render();
  });
  content.querySelectorAll("[data-date-shift]").forEach((button) => button.addEventListener("click", () => shiftSelectedDate(Number(button.dataset.dateShift))));
  content.querySelector("#selectedDateToday")?.addEventListener("click", () => {
    state.selectedDate = dateParts().date;
    render();
  });
  content.querySelector("#downloadDailyReport")?.addEventListener("click", downloadDailyReport);
  $("#fabButton")?.remove();
  if (!["home", "diary", "report"].includes(state.tab)) {
    const fab = document.createElement("button");
    fab.id = "fabButton";
    fab.className = "fab";
    fab.setAttribute("aria-label", "기록 추가");
    fab.textContent = "+";
    fab.addEventListener("click", () => openRecordModal());
    $("#appView").append(fab);
  }
}

function renderAdmin() {
  if (!state.adminData) return;
  const data = state.adminData;
  const membershipsByDog = new Map();
  data.memberships.forEach((membership) => {
    if (!membershipsByDog.has(membership.dog_id)) membershipsByDog.set(membership.dog_id, []);
    membershipsByDog.get(membership.dog_id).push(membership);
  });
  const kindNames = {
    temperature: "체온",
    feeding: "식사",
    hydration: "음수량",
    medication: "복약",
    elimination: "소변·대변",
    vitality: "활력 징후",
    weight: "몸무게",
  };
  const recordValue = (record) => {
    if (record.kind === "temperature") return `${record.value}°C`;
    if (record.kind === "feeding") return `${record.value}ml · ${record.feeding_method === "self" ? "스스로 먹음" : "밥 강급"}`;
    if (record.kind === "hydration") return `${record.value}ml`;
    if (record.kind === "weight") return `${Number(record.value).toFixed(2)}kg`;
    if (record.kind === "medication") return `${record.dose_index}회차 복용`;
    if (record.kind === "vitality") return `${escapeHTML(record.detail)} (${record.value}/3)${record.memo ? ` · ${escapeHTML(record.memo)}` : ""}`;
    return escapeHTML(record.detail);
  };
  $("#breadcrumbName").textContent = "전체 데이터";
  $("#pageTitle").textContent = "관리자 전체 데이터";
  $("#pageSubtitle").textContent = "모든 보호자·강아지 프로필과 건강 기록을 조회합니다. 이 화면은 읽기 전용입니다.";
  $("#headingEyebrow").textContent = "ADMIN · READ ONLY";
  $("#mainAddButton").hidden = true;
  $("#fabButton")?.remove();
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.tab === "admin"));
  $("#tabContent").innerHTML = `<div class="admin-overview">
    <div class="admin-stats">
      <div class="card admin-stat"><small>보호자 계정</small><strong>${data.users.length}</strong></div>
      <div class="card admin-stat"><small>강아지 프로필</small><strong>${data.dogs.length}</strong></div>
      <div class="card admin-stat"><small>건강 기록</small><strong>${data.records.length}</strong></div>
    </div>
    <section class="card admin-section"><div class="section-head"><div><h2>강아지 프로필</h2><span class="metric-caption">모든 등록 프로필과 연결된 보호자</span></div></div>
      ${data.dogs.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>강아지</th><th>출생 연도</th><th>병명</th><th>복약 시작</th><th>보호자</th></tr></thead><tbody>${data.dogs.map((dog) => {
        const members = membershipsByDog.get(dog.id) || [];
        return `<tr><td><strong>${escapeHTML(dog.name)}</strong></td><td>${dog.birth_year}</td><td>${escapeHTML(dog.diagnosis || "—")}</td><td>${escapeHTML(dog.med_start)}</td><td>${members.map((member) => `<span class="admin-member">${escapeHTML(member.name)} · ${escapeHTML(member.email)} <small>${member.role === "owner" ? "보호자" : "케어 멤버"}</small></span>`).join("") || "—"}</td></tr>`;
      }).join("")}</tbody></table></div>` : `<div class="empty-state">강아지 프로필이 없습니다.</div>`}
    </section>
    <section class="card admin-section"><div class="section-head"><div><h2>보호자 계정</h2><span class="metric-caption">관리자 및 일반 계정</span></div></div>
      ${data.users.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>이름</th><th>이메일</th><th>권한</th><th>참여 프로필</th></tr></thead><tbody>${data.users.map((account) => `<tr><td>${escapeHTML(account.name)}</td><td>${escapeHTML(account.email)}</td><td><span class="soft-tag">${account.role === "admin" ? "관리자" : "보호자"}</span></td><td>${account.dog_count}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">사용자 계정이 없습니다.</div>`}
    </section>
    <section class="card admin-section"><div class="section-head"><div><h2>전체 건강 기록</h2><span class="metric-caption">최신순 · 기록자와 강아지 포함</span></div></div>
      ${data.records.length ? `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>측정 시각</th><th>강아지</th><th>종류</th><th>기록</th><th>기록자</th></tr></thead><tbody>${data.records.map((record) => `<tr><td>${escapeHTML(new Date(record.recorded_at).toLocaleString("ko-KR"))}</td><td>${escapeHTML(record.dog_name)}</td><td>${kindNames[record.kind] || escapeHTML(record.kind)}</td><td>${recordValue(record)}</td><td>${escapeHTML(record.caregiver)}<small class="admin-email">${escapeHTML(record.caregiver_email)}</small></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">건강 기록이 없습니다.</div>`}
    </section>
  </div>`;
}

function ageText() {
  const age = new Date().getFullYear() - state.dog.birth_year;
  return `${age}살 · ${state.dog.birth_year}년생`;
}

function todayRecords(records) {
  return recordsForDate(records, dateParts().date);
}

function recordsForSelectedDate(records) {
  return recordsForDate(records, state.selectedDate);
}

function recordsForDate(records, date) {
  return records.filter((record) => dateParts(new Date(record.recorded_at)).date === date);
}

function selectedDateControl() {
  const displayDate = new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  return `<div class="date-filter card"><button type="button" data-date-shift="-1" aria-label="하루 전">‹</button><label for="selectedDate">조회 날짜</label><input id="selectedDate" type="date" max="${dateParts().date}" value="${escapeHTML(state.selectedDate)}" aria-label="조회할 날짜 선택"><strong>${displayDate}</strong><button type="button" data-date-shift="1" aria-label="하루 후" ${state.selectedDate >= dateParts().date ? "disabled" : ""}>›</button><button type="button" id="selectedDateToday">오늘</button></div>`;
}

function shiftSelectedDate(days) {
  const date = new Date(`${state.selectedDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  state.selectedDate = dateParts(date).date;
  render();
}

function homeTemplate() {
  const temps = recordsForSelectedDate(state.temperature).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const meals = recordsForSelectedDate(state.feeding).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const drinks = recordsForSelectedDate(state.hydration);
  const todayMeds = recordsForSelectedDate(state.medication);
  const mealTotal = meals.reduce((total, record) => total + Number(record.value || 0), 0);
  const latestTemp = temps[0];
  const medDates = medicationScheduleDates();
  const dosesTaken = new Set(todayMeds.map((record) => Number(record.dose_index)));
  const currentTime = new Date();
  const overdueDose = medDates.findIndex((date, index) => date < currentTime && !dosesTaken.has(index + 1));
  const upcomingDose = medDates.findIndex((date, index) => date >= currentTime && !dosesTaken.has(index + 1));
  const nextMedLabel = [1, 2, 3].every((dose) => dosesTaken.has(dose))
    ? "오늘 일정 완료"
    : overdueDose >= 0
      ? "복용 확인 필요"
      : upcomingDose >= 0
      ? medDates[upcomingDose].toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })
      : "복용 확인 필요";
  const timeline = [
    ...meals.map((record) => ({
      id: record.id, kind: "feeding",
      time: record.recorded_at,
      title: record.feeding_method === "self" ? "스스로 먹음" : "밥 강급",
      detail: record.detail || "식사 기록",
      value: `${record.value}ml`,
    })),
    ...drinks.map((record) => ({ id: record.id, kind: "hydration", time: record.recorded_at, title: "물 마심", detail: "음수량 기록", value: `${record.value}ml` })),
    ...todayMeds.map((record) => ({ id: record.id, kind: "medication", time: record.recorded_at, title: `${record.dose_index}회차 약 복용`, detail: record.detail || "복약 완료", value: "완료" })),
    ...temps.slice(0, 1).map((record) => ({ id: record.id, kind: "temperature", time: record.recorded_at, title: "체온 측정", detail: "건강 체크", value: `${record.value}°C` })),
    ...recordsForSelectedDate(state.elimination).map((record) => ({ id: record.id, kind: "elimination", time: record.recorded_at, title: record.detail, detail: "배변 기록", value: record.detail === "소변" ? "💧" : "✓" })),
    ...recordsForSelectedDate(state.vitality).map((record) => ({ id: record.id, kind: "vitality", time: record.recorded_at, title: `활력 징후 · ${vitalityStates[record.value]?.label || "기록"}`, detail: [vitalityStates[record.value]?.description, record.memo].filter(Boolean).join(" · ") || "컨디션 기록", value: `${record.value}/3` })),
    ...recordsForSelectedDate(state.weight).map((record) => ({ id: record.id, kind: "weight", time: record.recorded_at, title: "몸무게 측정", detail: "하루 1회 측정", value: `${record.value}kg` })),
  ].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 4);
  return `<div class="dashboard-grid">
    <div class="column-stack">
      <section class="hero-card card"><div class="hero-copy"><span class="hero-tag">MY LITTLE COMPANION</span><h2>${escapeHTML(state.dog.name)}, 오늘도 반가워!</h2><p>${escapeHTML(ageText())} <span>·</span> ${escapeHTML(state.dog.diagnosis || "건강 관리 중")}</p></div><div class="dog-portrait" aria-hidden="true">🐕</div><span class="dog-status">● 함께 돌보는 중</span></section>
      <section class="card vitals-card"><div class="section-head"><h2>오늘의 건강 기록</h2><button data-go="temperature">전체 기록 보기 →</button></div><div class="vitals-row">
        <div class="vital" data-go="temperature"><div class="vital-top"><span class="vital-icon">♧</span><span class="vital-label">최근 체온</span></div><div class="vital-value">${latestTemp ? escapeHTML(latestTemp.value) : "--"}<small>°C</small></div><div class="vital-note">${latestTemp ? `${formatDateTime(latestTemp.recorded_at)} 측정` : "아직 기록이 없어요"}</div></div>
        <div class="vital" data-go="feeding"><div class="vital-top"><span class="vital-icon green">◉</span><span class="vital-label">오늘 먹은 양</span></div><div class="vital-value">${mealTotal}<small>ml</small></div><div class="vital-note">오늘 ${meals.length}회 급여했어요</div></div>
      </div></section>
      <section class="card timeline-card"><div class="section-head"><h2>오늘의 돌봄 일지</h2><span><button data-go="diary">전체 보기 →</button><button data-go="feeding">기록 추가 +</button></span></div>${timeline.length ? `<div class="timeline">${timeline.slice(0,4).map((item) => `<div class="timeline-row" data-record-row="${item.id}"><span class="timeline-time">${formatTime(item.time)}</span><span class="timeline-mark"></span><span class="timeline-copy"><span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small></span><span class="timeline-value">${escapeHTML(item.value)}</span>${recordEditButton(item)}</span></div>`).join("")}</div>` : `<div class="empty-state">선택한 날짜의 돌봄 기록이 없어요.</div>`}</section>
    </div>
    <div class="column-stack">
      <section class="card med-summary"><div class="section-head"><h2>오늘의 약속</h2><button data-go="medication">관리하기 →</button></div><div class="med-progress"><div class="progress-ring" data-count="${todayMeds.length}/3" style="--progress:${Math.min(todayMeds.length,3) * 120}deg"></div><div class="progress-copy"><strong>약 복용 ${todayMeds.length}/3회</strong><small>8시간 간격으로 챙겨주세요</small></div></div><div class="next-med"><span>다음 복약 예정</span><strong>${nextMedLabel}</strong></div></section>
      <section class="card detail-card"><div class="section-head"><h2>주모닝 프로필</h2><button id="editDogQuick">수정 →</button></div><div class="record-list">
        <div class="record-row"><span><strong>이름</strong><small>우리 아이 이름</small></span><span class="record-number">${escapeHTML(state.dog.name)}</span></div>
        <div class="record-row"><span><strong>나이</strong><small>출생 연도 기준</small></span><span class="record-number">${escapeHTML(ageText())}</span></div>
        <div class="record-row"><span><strong>병명</strong><small>건강 관리 메모</small></span><span class="record-number">${escapeHTML(state.dog.diagnosis || "—")}</span></div>
      </div><button class="profile-strip" id="profileInvite"><strong>함께 돌보는 보호자 초대하기</strong><span>초대 코드 보기 →</span></button></section>
      <section class="card detail-card"><div class="section-head"><h2>최근 활력 징후</h2><button data-go="vitality">기록하기 →</button></div>${vitalitySummary()}</section>
      <section class="card detail-card"><div class="section-head"><h2>함께 돌보는 사람</h2><span class="soft-tag">${state.dog.role === "owner" ? "보호자" : "케어 멤버"}</span></div><div class="record-row"><span><strong>${escapeHTML(state.user.name)}</strong><small>${escapeHTML(state.user.email)}</small></span><span class="record-number">나</span></div></section>
    </div>
  </div>`;
}

function chartTemplate(records, unit, minValue, maxValue, metricName = unit === "°C" ? "체온" : "급여량", windowDays = 1) {
  const selected = new Date(`${state.selectedDate}T00:00:00`);
  const timeEnd = new Date(selected);
  timeEnd.setDate(timeEnd.getDate() + 1);
  timeEnd.setMilliseconds(timeEnd.getMilliseconds() - 1);
  const maxRangeStart = new Date(selected);
  maxRangeStart.setDate(maxRangeStart.getDate() - windowDays + 1);
  let timeStart = maxRangeStart;
  if (unit === "kg") {
    const firstRecord = [...records]
      .filter((record) => Number.isFinite(Date.parse(record.recorded_at)) && Date.parse(record.recorded_at) <= timeEnd.getTime())
      .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))[0];
    if (firstRecord) {
      const firstRecordDate = new Date(firstRecord.recorded_at);
      firstRecordDate.setHours(0, 0, 0, 0);
      if (firstRecordDate > timeStart) timeStart = firstRecordDate;
    }
  }
  const rangeStart = timeStart.getTime();
  const rangeEnd = timeEnd.getTime();
  const allSorted = [...records]
    .filter((record) => {
      const timestamp = Date.parse(record.recorded_at);
      return Number.isFinite(timestamp) && timestamp >= rangeStart && timestamp <= rangeEnd;
    })
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const width = 620;
  const height = 198;
  const left = 42;
  const right = 12;
  const top = 15;
  const bottom = 25;
  const plotWidth = width - left - right;
  const allMedicationSorted = state.medication
    .filter((record) => {
      if (unit === "kg") return false;
      const timestamp = Date.parse(record.recorded_at);
      return Number.isFinite(timestamp) && timestamp >= rangeStart && timestamp <= rangeEnd;
    })
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const timeSpan = rangeEnd - rangeStart;
  const sorted = windowDays > 1 ? allSorted : allSorted.slice(-8);
  const medicationRecords = allMedicationSorted.filter((record) => {
    const timestamp = Date.parse(record.recorded_at);
    return timestamp >= rangeStart && timestamp <= rangeEnd;
  });
  const values = sorted.map((record) => Number(record.value));
  const min = unit === "kg" ? (values.length ? Math.min(...values) : minValue) : Math.min(minValue, ...values);
  const max = unit === "kg" ? (values.length ? Math.max(...values) : maxValue) : Math.max(maxValue, ...values);
  const yMin = unit === "°C" ? Math.min(37, Math.floor((min - 0.3) * 2) / 2) : unit === "kg" ? Math.max(0, Math.floor((min - 0.5) * 2) / 2) : 0;
  const yMax = unit === "°C" ? Math.max(40, Math.ceil((max + 0.3) * 2) / 2) : unit === "kg" ? Math.ceil((max + 0.5) * 2) / 2 : Math.max(30, Math.ceil(max / 10) * 10);
  const x = (record) => left + (Date.parse(record.recorded_at) - rangeStart) / timeSpan * plotWidth;
  const y = (value) => top + (yMax - value) / (yMax - yMin) * (height - top - bottom);
  const points = sorted.map((record) => `${x(record)},${y(Number(record.value))}`).join(" ");
  const area = sorted.length ? `${left},${height - bottom} ${points} ${x(sorted.at(-1))},${height - bottom}` : "";
  const weightTickCount = Math.floor((rangeEnd - rangeStart) / (24 * 60 * 60 * 1000)) + 1;
  const xTicks = unit === "kg"
    ? Array.from({ length: weightTickCount }, (_, index) => {
      const timestamp = rangeStart + index * 24 * 60 * 60 * 1000;
      const date = new Date(timestamp);
      const label = index === 0 || index === weightTickCount - 1 || index % 5 === 0
        ? `${date.getMonth() + 1}/${date.getDate()}`
        : "";
      return { x: left + (timestamp - rangeStart) / timeSpan * plotWidth, label };
    })
    : Array.from({ length: 5 }, (_, index) => {
      const timestamp = rangeStart + timeSpan * index / 4;
      const date = new Date(timestamp);
      const label = windowDays > 1
        ? `${date.getMonth() + 1}/${date.getDate()}`
        : date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
      return { x: left + (timestamp - rangeStart) / timeSpan * plotWidth, label };
    });
  const gridVals = unit === "°C" || unit === "kg"
    ? Array.from({ length: Math.floor((yMax - yMin) * 2) + 1 }, (_, index) => yMin + index * 0.5)
    : [0, Math.round(yMax / 3), Math.round(yMax * 2 / 3), yMax];
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${unit === "kg" ? "날짜별" : "시간에 따른"} ${metricName} 그래프">
    <defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#91a287" stop-opacity=".24"/><stop offset="100%" stop-color="#91a287" stop-opacity="0"/></linearGradient></defs>
    ${gridVals.map((value) => `<line class="chart-grid" x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}"/><text class="chart-text" x="0" y="${y(value)+3}">${value}${unit}</text>`).join("")}
    ${xTicks.map((tick) => `<line class="chart-x-grid" x1="${tick.x}" y1="${top}" x2="${tick.x}" y2="${height-bottom}"/><text class="chart-text" text-anchor="middle" x="${tick.x}" y="${height-5}">${tick.label}</text>`).join("")}
    ${unit === "°C" ? `<line class="chart-limit chart-limit-low" x1="${left}" y1="${y(37.5)}" x2="${width-right}" y2="${y(37.5)}"/><text class="chart-limit-label chart-limit-label-low" x="${width-right-2}" y="${y(37.5)-4}" text-anchor="end">LIMIT L 37.5°C</text><line class="chart-limit chart-limit-high" x1="${left}" y1="${y(39.2)}" x2="${width-right}" y2="${y(39.2)}"/><text class="chart-limit-label chart-limit-label-high" x="${width-right-2}" y="${y(39.2)-4}" text-anchor="end">LIMIT H 39.2°C</text>` : ""}
    ${sorted.length ? `<polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${points}"/>${sorted.map((record) => `<circle class="chart-dot" cx="${x(record)}" cy="${y(Number(record.value))}" r="4"><title>${formatDateTime(record.recorded_at)} ${record.value}${unit}</title></circle>`).join("")}` : `<text class="chart-text" x="${width/2}" y="${height/2}" text-anchor="middle">기록을 추가하면 그래프가 표시돼요</text>`}
    ${medicationRecords.map((record) => {
      const medicationX = left + (Date.parse(record.recorded_at) - timeStart) / timeSpan * plotWidth;
      return `<line class="chart-medication-line" x1="${medicationX}" y1="${top}" x2="${medicationX}" y2="${height-bottom}"><title>${formatDateTime(record.recorded_at)} 약 ${record.dose_index}회 복용</title></line><text class="chart-medication-label" text-anchor="middle" x="${medicationX}" y="${top+10}">약 ${record.dose_index}회</text>`;
    }).join("")}
  </svg>`;
}

function recordEditButton(record) {
  return `<button class="record-edit-button" type="button" data-edit-record="${record.id}" aria-label="기록 수정">✎</button>`;
}

function recordListTemplate(records, unit, emptyMessage, timeOnly = false) {
  const sorted = [...records].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  if (!sorted.length) return `<div class="empty-state">${emptyMessage}</div>`;
  return `<div class="record-list">${sorted.map((record) => {
    const number = record.kind === "medication"
      ? `${record.dose_index}회차 복용 완료`
      : record.kind === "weight"
        ? `${Number(record.value).toFixed(2)}kg`
      : unit === " " ? "" : `${record.value}${unit}`;
    return `<div class="record-row" data-record-row="${record.id}"><span><strong>${timeOnly ? formatTime(record.recorded_at) : formatDateTime(record.recorded_at)}${record.kind === "feeding" ? ` · ${record.feeding_method === "self" ? "스스로 먹음" : "밥 강급"}` : ""}${record.detail ? ` · ${escapeHTML(record.detail)}` : ""}${record.memo ? ` · ${escapeHTML(record.memo)}` : ""}</strong><small>${escapeHTML(record.caregiver)} 보호자가 기록</small></span><span class="record-number">${number}</span>${recordEditButton(record)}</div>`;
  }).join("")}</div>`;
}

function recordEditorTemplate(record) {
  const recordedDate = dateParts(new Date(record.recorded_at));
  const recordedAt = record.kind === "weight" ? recordedDate.date : recordedDate.datetime;
  const quantity = record.kind === "temperature" ? "체온 (°C)" : record.kind === "feeding" ? "급여량 (ml)" : record.kind === "weight" ? "몸무게 (kg)" : "음수량 (ml)";
  const valueInput = ["temperature", "feeding", "hydration", "weight"].includes(record.kind)
    ? `<label class="inline-field"><span>${quantity}</span><input name="value" type="number" min="${record.kind === "temperature" ? 30 : 0.1}" max="${record.kind === "temperature" ? 45 : record.kind === "weight" ? 200 : 2000}" step="${record.kind === "weight" ? "0.01" : "0.1"}" value="${record.value}" required></label>`
    : "";
  const kindInput = record.kind === "feeding"
    ? `<label class="inline-field"><span>식사 방법</span><select name="feeding_method"><option value="assisted" ${record.feeding_method !== "self" ? "selected" : ""}>밥 강급</option><option value="self" ${record.feeding_method === "self" ? "selected" : ""}>스스로 먹음</option></select></label>`
    : record.kind === "medication"
      ? `<label class="inline-field"><span>복약 회차</span><select name="dose_index">${[1, 2, 3].map((dose) => `<option value="${dose}" ${Number(record.dose_index) === dose ? "selected" : ""}>${dose}회차</option>`).join("")}</select></label>`
      : record.kind === "elimination"
        ? `<label class="inline-field"><span>종류</span><select name="detail"><option value="소변" ${record.detail === "소변" ? "selected" : ""}>소변</option><option value="대변" ${record.detail === "대변" ? "selected" : ""}>대변</option></select></label>`
        : record.kind === "vitality"
          ? `<label class="inline-field"><span>활력</span><select name="value">${Object.entries(vitalityStates).map(([score, status]) => `<option value="${score}" ${Number(record.value) === Number(score) ? "selected" : ""}>${status.label} · ${score}/3</option>`).join("")}</select></label>`
          : "";
  const extraInput = record.kind === "feeding"
    ? `<label class="inline-field"><span>메모</span><input name="detail" maxlength="200" value="${escapeHTML(record.detail || "")}"></label>`
    : record.kind === "medication"
      ? `<label class="inline-field"><span>메모</span><input name="detail" maxlength="200" value="${escapeHTML(record.detail || "")}"></label>`
    : record.kind === "vitality"
      ? `<label class="inline-field"><span>메모</span><input name="memo" maxlength="200" value="${escapeHTML(record.memo || "")}"></label>`
      : "";
  return `<form class="record-inline-form" data-inline-record-form data-record-id="${record.id}" data-record-kind="${record.kind}">
    <label class="inline-field"><span>${record.kind === "weight" ? "측정 날짜" : "날짜와 시간"}</span><input name="recorded_at" type="${record.kind === "weight" ? "date" : "datetime-local"}" value="${recordedAt}" required></label>${valueInput}${kindInput}${extraInput}
    <div class="record-inline-actions"><button type="submit" class="record-save-button" aria-label="저장">저장</button><button type="button" class="record-cancel-button" data-cancel-record aria-label="취소">취소</button></div>
  </form>`;
}

function startRecordEdit(recordId, row) {
  if (state.user?.role === "admin") return;
  const record = ["temperature", "feeding", "hydration", "medication", "elimination", "vitality", "weight"]
    .flatMap((kind) => state[kind])
    .find((item) => Number(item.id) === Number(recordId));
  if (!record || !row) return;
  row.classList.add("record-row-editing");
  row.innerHTML = recordEditorTemplate(record);
}

async function saveRecordEdit(form) {
  const recordId = form.dataset.recordId;
  const kind = form.dataset.recordKind;
  const values = Object.fromEntries(new FormData(form).entries());
  if (kind === "weight") values.recorded_at = `${values.recorded_at}T12:00:00`;
  values.recorded_at = new Date(values.recorded_at).toISOString();
  if (values.value !== undefined) values.value = Number(values.value);
  if (values.dose_index !== undefined) values.dose_index = Number(values.dose_index);
  try {
    await api(`/api/dogs/${state.dog.id}/records/${recordId}`, {
      method: "PUT",
      body: JSON.stringify(values),
    });
    await loadRecords();
    render();
    setToast("기록을 수정했어요.");
  } catch (error) {
    setToast(error.message);
  }
}

function temperatureTemplate() {
  const selectedRecords = recordsForSelectedDate(state.temperature);
  const sorted = [...selectedRecords].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const recent = sorted[0];
  const values = selectedRecords.map((item) => Number(item.value));
  const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : "--";
  return `<div class="detail-grid"><div class="card chart-card"><div class="section-head"><div><h2>체온 변화</h2><div class="metric-caption">선택한 날짜의 시간대별 체온</div></div><span class="soft-tag">${selectedRecords.length}회</span></div><div class="metric-big">${recent ? recent.value : "--"}<small> °C</small></div><div class="metric-caption">${recent ? `${formatDateTime(recent.recorded_at)} 측정` : "선택한 날짜의 체온 기록이 없어요"}</div><div class="chart-wrap">${chartTemplate(selectedRecords, "°C", 37, 40)}</div><div class="chart-legend temperature-legend"><span><i class="legend-dot"></i>체온</span><span><i class="limit-swatch"></i>하한 37.5°C</span><span><i class="limit-swatch high"></i>상한 39.2°C</span><span><i class="medication-swatch"></i>약 복용</span></div></div>
    <section class="card detail-card"><div class="section-head"><h2>측정 기록</h2><span class="soft-tag">평균 ${avg}°C</span></div>${recordListTemplate(selectedRecords, "°C", "선택한 날짜의 체온 기록이 없어요.")}</section></div>`;
}

function feedingTemplate() {
  const meals = recordsForSelectedDate(state.feeding).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const total = meals.reduce((sum, record) => sum + Number(record.value || 0), 0);
  const average = meals.length ? `${(total / meals.length).toFixed(1)}ml` : "—";
  const assistedCount = meals.filter((record) => record.feeding_method !== "self").length;
  const selfCount = meals.length - assistedCount;
  return `<div class="detail-grid"><div class="card chart-card"><div class="section-head"><div><h2>식사 기록</h2><div class="metric-caption">강급과 스스로 먹은 양을 함께 확인해요</div></div><span class="soft-tag">최근 8회</span></div><div class="food-total"><span class="food-bowl">🥣</span><div><strong>${total}ml</strong><small>오늘 총 식사량 · 강급 ${assistedCount}회 · 스스로 ${selfCount}회</small></div></div><div class="chart-wrap">${chartTemplate(state.feeding, "ml", 0, Math.max(30, ...state.feeding.map((record) => Number(record.value))))}</div><div class="chart-legend"><span class="legend-dot"></span>식사량 · 1회 평균 ${average}<span><i class="medication-swatch"></i>약 복용</span></div></div>
    <section class="card detail-card"><div class="section-head"><h2>선택 날짜 식사 시간</h2><span class="soft-tag">${meals.length}회</span></div>${recordListTemplate([...meals].reverse(), "ml", "선택한 날짜의 식사 기록이 없어요.", true)}</section></div>`;
}

function hydrationTemplate() {
  const drinks = recordsForSelectedDate(state.hydration).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const total = drinks.reduce((sum, record) => sum + Number(record.value || 0), 0);
  const average = drinks.length ? `${(total / drinks.length).toFixed(1)}ml` : "—";
  return `<div class="detail-grid"><div class="card chart-card"><div class="section-head"><div><h2>음수량 기록</h2><div class="metric-caption">시간별로 마신 물의 양을 확인해요</div></div><span class="soft-tag">최근 8회</span></div><div class="food-total"><span class="food-bowl">💧</span><div><strong>${total}ml</strong><small>오늘 총 음수량 · ${drinks.length}회</small></div></div><div class="chart-wrap">${chartTemplate(state.hydration, "ml", 0, Math.max(30, ...state.hydration.map((record) => Number(record.value))), "음수량")}</div><div class="chart-legend"><span class="legend-dot"></span>음수량 · 1회 평균 ${average}<span><i class="medication-swatch"></i>약 복용</span></div></div>
    <section class="card detail-card"><div class="section-head"><h2>선택 날짜 음수 시간</h2><span class="soft-tag">${drinks.length}회</span></div>${recordListTemplate([...drinks].reverse(), "ml", "선택한 날짜의 음수량 기록이 없어요.", true)}</section></div>`;
}

function vitalitySummary() {
  const latest = recordsForSelectedDate(state.vitality).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  if (!latest) return `<div class="empty-state">아직 활력 징후 기록이 없어요.</div>`;
  const status = vitalityStates[latest.value];
  return `<div class="vitality-current ${status.tone}"><span class="vitality-score">${latest.value}/3</span><span><strong>${status.label}</strong><small>${status.description}</small>${latest.memo ? `<small>메모 · ${escapeHTML(latest.memo)}</small>` : ""}<small>${formatDateTime(latest.recorded_at)}</small></span></div>`;
}

function eliminationTemplate() {
  const records = recordsForSelectedDate(state.elimination).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const urinationCount = records.filter((record) => record.detail === "소변").length;
  const stoolCount = records.filter((record) => record.detail === "대변").length;
  return `<div class="detail-grid"><section class="card detail-card"><div class="section-head"><h2>오늘의 배변</h2><span class="soft-tag">기록 ${urinationCount + stoolCount}회</span></div><div class="elimination-summary"><div class="elimination-stat"><span>💧</span><strong>${urinationCount}회</strong><small>소변</small></div><div class="elimination-stat"><span>◒</span><strong>${stoolCount}회</strong><small>대변</small></div></div><p class="metric-caption">시간별로 소변과 대변을 남겨두면 배설 패턴을 살펴보기 좋아요.</p></section>
    <section class="card detail-card"><div class="section-head"><h2>배변 기록</h2><span class="soft-tag">${records.length}회</span></div>${recordListTemplate(records, " ", "아직 소변·대변 기록이 없어요.")}</section></div>`;
}

function vitalityTemplate() {
  const records = recordsForSelectedDate(state.vitality).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  return `<div class="detail-grid"><section class="card detail-card"><div class="section-head"><div><h2>3단계 활력 징후</h2><div class="metric-caption">기록할 때 아이의 상태와 체온을 함께 확인해요.</div></div></div><div class="vitality-options">
    ${Object.entries(vitalityStates).map(([score, status]) => `<div class="vitality-option ${status.tone}"><span class="vitality-score">${score}</span><span><strong>${status.label}</strong><small>${status.description}</small></span></div>`).join("")}
  </div></section><section class="card detail-card"><div class="section-head"><h2>활력 기록</h2><span class="soft-tag">${records.length}회</span></div>${recordListTemplate(records, "/3", "활력 징후를 기록해 주세요.")}</section></div>`;
}

function weightTemplate() {
  const records = recordsForSelectedDate(state.weight).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const latest = records[0];
  const previous = [...state.weight]
    .filter((record) => dateParts(new Date(record.recorded_at)).date < state.selectedDate)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
  const change = latest && previous ? Number(latest.value) - Number(previous.value) : null;
  const changeLabel = change === null ? "이전 측정값이 없어요" : `${change > 0 ? "+" : ""}${change.toFixed(2)}kg · 이전 측정 대비`;
  return `<div class="detail-grid"><section class="card chart-card"><div class="section-head"><div><h2>몸무게 변화</h2><div class="metric-caption">하루 한 번 측정 · 첫 기록일부터, 최대 30일</div></div><span class="soft-tag">최대 30일</span></div><div class="metric-big">${latest ? Number(latest.value).toFixed(2) : "--"}<small> kg</small></div><div class="metric-caption">${latest ? `${changeLabel} · ${formatDateTime(latest.recorded_at)}` : "선택한 날짜의 몸무게 기록이 없어요"}</div><div class="chart-wrap">${chartTemplate(state.weight, "kg", 5, 7, "몸무게", 30)}</div></section>
    <section class="card detail-card"><div class="section-head"><h2>선택 날짜 측정</h2><span class="soft-tag">하루 1회</span></div>${recordListTemplate(records, "kg", "이 날짜의 몸무게 기록이 없어요.")}</section></div>`;
}

function recordKindLabel(record) {
  const labels = {
    temperature: "체온",
    feeding: record.feeding_method === "self" ? "스스로 먹음" : "밥 강급",
    hydration: "음수량",
    medication: `${record.dose_index}회차 약 복용`,
    elimination: record.detail,
    vitality: `활력 · ${vitalityStates[record.value]?.label || "기록"}`,
    weight: "몸무게",
  };
  return labels[record.kind] || "기록";
}

function recordSummaryValue(record) {
  if (record.kind === "temperature") return `${record.value}°C`;
  if (["feeding", "hydration"].includes(record.kind)) return `${record.value}ml`;
  if (record.kind === "weight") return `${Number(record.value).toFixed(2)}kg`;
  if (record.kind === "vitality") return `${record.value}/3`;
  return record.kind === "medication" ? "복용 완료" : "";
}

function diaryTemplate() {
  const records = [
    ...state.temperature,
    ...state.feeding,
    ...state.hydration,
    ...state.medication,
    ...state.elimination,
    ...state.vitality,
    ...state.weight,
  ].filter((record) => dateParts(new Date(record.recorded_at)).date === state.selectedDate)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  return `<section class="card detail-card diary-card"><div class="section-head"><div><h2>${new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} 돌봄 일지</h2><div class="metric-caption">식사, 물, 체온, 몸무게, 복약, 배설 및 활력 기록 전체</div></div><span class="soft-tag">${records.length}건</span></div>
    ${records.length ? `<div class="record-list">${records.map((record) => `<div class="record-row" data-record-row="${record.id}"><span><strong>${formatTime(record.recorded_at)} · ${escapeHTML(recordKindLabel(record))}${record.detail && !["elimination", "vitality"].includes(record.kind) ? ` · ${escapeHTML(record.detail)}` : ""}${record.memo ? ` · ${escapeHTML(record.memo)}` : ""}</strong><small>${escapeHTML(record.caregiver)} 보호자가 기록</small></span><span class="record-number">${escapeHTML(recordSummaryValue(record))}</span>${recordEditButton(record)}</div>`).join("")}</div>` : `<div class="empty-state">선택한 날짜에는 아직 기록이 없어요.</div>`}</section>`;
}

function dailyReportSvg() {
  const dateLabel = new Date(`${state.selectedDate}T12:00:00`).toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
  const feeding = recordsForSelectedDate(state.feeding);
  const hydration = recordsForSelectedDate(state.hydration);
  const temperatures = recordsForSelectedDate(state.temperature);
  const medication = recordsForSelectedDate(state.medication);
  const elimination = recordsForSelectedDate(state.elimination);
  const vitality = recordsForSelectedDate(state.vitality).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).at(-1);
  const weight = recordsForSelectedDate(state.weight)[0];
  const total = (records) => records.reduce((sum, record) => sum + Number(record.value || 0), 0);
  const chartCards = [
    { title: "체온", records: temperatures, unit: "°C", min: 37, max: 40, days: 1, summary: temperatures.length ? `평균 ${(total(temperatures) / temperatures.length).toFixed(1)}°C · ${temperatures.length}회` : "기록 없음" },
    { title: "식사량", records: feeding, unit: "ml", min: 0, max: 30, days: 1, summary: `${total(feeding)}ml · ${feeding.length}회` },
    { title: "음수량", records: hydration, unit: "ml", min: 0, max: 30, days: 1, summary: `${total(hydration)}ml · ${hydration.length}회` },
  ];
  const chartInner = (card) => chartTemplate(card.records, card.unit, card.min, card.max, card.title, card.days)
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const chartSvg = chartCards.map((card, index) => {
    const x = 40 + (index % 2) * 580;
    const y = index === 2 ? 530 : 180;
    const width = index === 2 ? 1120 : 540;
    const graphWidth = index === 2 ? 1080 : 510;
    return `<g><rect x="${x}" y="${y}" width="${width}" height="320" rx="22" fill="#ffffff" stroke="#edf0e9"/><text x="${x + 26}" y="${y + 42}" class="card-title">${escapeHTML(card.title)}</text><text x="${x + 26}" y="${y + 68}" class="card-summary">${escapeHTML(card.summary)}</text><svg x="${x + 15}" y="${y + 88}" width="${graphWidth}" height="205" viewBox="0 0 620 198" preserveAspectRatio="none">${chartInner(card)}</svg></g>`;
  }).join("");
  const summaryCards = [
    { label: "약 복용", value: `${medication.length}회`, detail: medication.length ? medication.map((record) => `${record.dose_index}회차`).join(" · ") : "기록 없음" },
    { label: "소변 · 대변", value: `${elimination.length}회`, detail: `소변 ${elimination.filter((record) => record.detail === "소변").length}회 · 대변 ${elimination.filter((record) => record.detail === "대변").length}회` },
    { label: "몸무게", value: weight ? `${Number(weight.value).toFixed(2)}kg` : "측정 없음", detail: weight ? "선택 날짜 측정" : "선택 날짜 기록 없음" },
    { label: "마지막 활력", value: vitality ? vitalityStates[vitality.value]?.label || "기록" : "기록 없음", detail: vitality ? `${formatTime(vitality.recorded_at)}${vitality.memo ? ` · ${vitality.memo}` : ""}` : "선택 날짜 기록 없음" },
  ];
  const summarySvg = summaryCards.map((card, index) => {
    const x = 40 + index * 285;
    const y = 880;
    return `<g><rect x="${x}" y="${y}" width="265" height="150" rx="20" fill="#ffffff" stroke="#edf0e9"/><text x="${x + 20}" y="${y + 35}" class="card-summary">${escapeHTML(card.label)}</text><text x="${x + 20}" y="${y + 82}" class="summary-value">${escapeHTML(card.value)}</text><text x="${x + 20}" y="${y + 118}" class="summary-detail">${escapeHTML(card.detail)}</text></g>`;
  }).join("");
  const dayRecords = [
    ...temperatures, ...feeding, ...hydration, ...recordsForSelectedDate(state.medication),
    ...recordsForSelectedDate(state.elimination), ...recordsForSelectedDate(state.vitality),
    ...recordsForSelectedDate(state.weight),
  ].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const diaryStart = 1115;
  const diaryRowHeight = 58;
  const lines = dayRecords.map((record, index) => {
    const y = diaryStart + index * diaryRowHeight;
    const detail = [record.kind === "elimination" || record.kind === "vitality" ? "" : record.detail, record.memo].filter(Boolean).join(" · ");
    return `<g><line x1="58" y1="${y + 18}" x2="1142" y2="${y + 18}" class="diary-separator"/><text x="72" y="${y}" class="diary-time">${formatTime(record.recorded_at)}</text><text x="160" y="${y}" class="diary-line">${escapeHTML(recordKindLabel(record))}</text><text x="1090" y="${y}" text-anchor="end" class="diary-value">${escapeHTML(recordSummaryValue(record))}</text>${detail ? `<text x="160" y="${y + 26}" class="diary-detail">${escapeHTML(detail)}</text>` : ""}</g>`;
  }).join("");
  const height = Math.max(1270, diaryStart + dayRecords.length * diaryRowHeight + 95);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}">
    <style>
      text { font-family: -apple-system, BlinkMacSystemFont, "Arial", sans-serif; }
      .title { fill: #344a39; font-size: 38px; font-weight: 700; }
      .subtitle { fill: #858b80; font-size: 20px; }
      .card-title { fill: #344a39; font-size: 21px; font-weight: 700; }
      .card-summary { fill: #858b80; font-size: 15px; }
      .diary-head { fill: #344a39; font-size: 23px; font-weight: 700; }
      .diary-line { fill: #596256; font-size: 16px; font-weight: 600; }
      .diary-time,.diary-value { fill: #68775f; font-size: 15px; font-weight: 600; }
      .diary-detail { fill: #858b80; font-size: 13px; }
      .diary-separator { stroke: #edf0e9; }
      .summary-value { fill: #344a39; font-size: 25px; font-weight: 700; }
      .summary-detail { fill: #858b80; font-size: 12px; }
      .chart-grid { stroke: #edf0e9; stroke-dasharray: 3 5; }
      .chart-x-grid { stroke: #f0f1ec; stroke-dasharray: 2 5; }
      .chart-text { fill: #8c9387; font: 10px Arial, sans-serif; }
      .chart-area { fill: url(#areaFill); }
      .chart-line { fill: none; stroke: #73876a; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
      .chart-dot { fill: white; stroke: #73876a; stroke-width: 2; }
      .chart-limit { stroke-width: 1.5; stroke-dasharray: 6 4; }
      .chart-limit-low { stroke: #d79c69; }
      .chart-limit-high { stroke: #d27467; }
      .chart-limit-label { font: 600 9px Arial, sans-serif; }
      .chart-limit-label-low { fill: #bd885b; }
      .chart-limit-label-high { fill: #bb6c60; }
      .chart-medication-line { stroke: #d27467; stroke-width: 1.5; stroke-dasharray: 4 3; }
      .chart-medication-label { fill: #bb6c60; font: 600 9px Arial, sans-serif; }
    </style>
    <rect width="1200" height="${height}" fill="#f8f9f5"/>
    <text x="50" y="78" class="title">${escapeHTML(state.dog.name)} · 데일리 레포트</text>
    <text x="52" y="116" class="subtitle">${escapeHTML(dateLabel)}</text>
    ${chartSvg}
    ${summarySvg}
    <text x="54" y="1080" class="diary-head">오늘의 돌봄 기록 · 전체 ${dayRecords.length}건</text>
    ${lines || `<text x="72" y="${diaryStart}" class="diary-line">선택한 날짜에 기록된 항목이 없습니다.</text>`}
    <text x="54" y="${height - 35}" class="subtitle">${escapeHTML(state.dog.name)} 건강 기록 · 모닝케어</text>
  </svg>`;
}

function reportTemplate() {
  const svgData = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(dailyReportSvg())}`;
  return `<section class="card detail-card report-card"><div class="section-head"><div><h2>한 장으로 보는 건강 레포트</h2><div class="metric-caption">체온·식사량·음수량 그래프, 약 복용·배설 횟수·몸무게·마지막 활력 카드와 전체 돌봄 기록을 담았어요.</div></div><button class="primary-button report-download" id="downloadDailyReport">PNG 이미지 저장</button></div><img class="daily-report-preview" src="${svgData}" alt="${escapeHTML(state.dog.name)} ${escapeHTML(state.selectedDate)} 데일리 건강 레포트"></section>`;
}

async function downloadDailyReport() {
  const image = new Image();
  const svgBlob = new Blob([dailyReportSvg()], { type: "image/svg+xml;charset=utf-8" });
  const imageUrl = URL.createObjectURL(svgBlob);
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = Math.ceil(image.naturalHeight * 2);
    const context = canvas.getContext("2d");
    if (!context) {
      URL.revokeObjectURL(imageUrl);
      setToast("이미지를 생성하지 못했어요.");
      return;
    }
    context.fillStyle = "#f8f9f5";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(imageUrl);
      if (!blob) {
        setToast("이미지 파일을 만들지 못했어요.");
        return;
      }
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${state.dog.name.replace(/[\\/:*?"<>|]/g, "-")}-${state.selectedDate}-daily-report.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setToast("데일리 레포트를 PNG 이미지로 저장했어요.");
    }, "image/png");
  };
  image.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    setToast("레포트 이미지 생성에 실패했어요.");
  };
  image.src = imageUrl;
}

function medicationTimes() {
  return medicationScheduleDates().map((date) =>
    date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }),
  );
}

function medicationScheduleDates() {
  const [hour, minute] = (state.dog.med_start || "08:00").split(":").map(Number);
  return [0, 1, 2].map((index) => {
    const date = new Date(`${state.selectedDate}T00:00:00`);
    date.setHours(hour, minute + index * 480, 0, 0);
    return date;
  });
}

function medicationTemplate() {
  const meds = recordsForSelectedDate(state.medication);
  const times = medicationTimes();
  const done = new Set(meds.map((record) => Number(record.dose_index)));
  return `<div class="detail-grid"><section class="card detail-card"><div class="section-head"><div><h2>오늘의 복약 체크</h2><div class="metric-caption">첫 복약 시간부터 8시간 간격으로 알림을 설정해요</div></div><span class="soft-tag">${done.size}/3 완료</span></div><div class="dose-list" style="margin-top:18px">${times.map((time, index) => `<div class="dose-item"><span class="dose-bullet">${done.has(index+1) ? "✓" : "✳"}</span><span class="dose-info"><strong>${index+1}회차 약 ${done.has(index+1) ? "복용 완료" : "복용 예정"}</strong><small>${time}${done.has(index+1) ? ` · ${formatTime(meds.find((record) => Number(record.dose_index) === index+1).recorded_at)} 복용` : ""}</small></span><button class="dose-button ${done.has(index+1) ? "done" : ""}" data-dose="${index+1}">${done.has(index+1) ? "완료 ✓" : "복용 체크"}</button></div>`).join("")}</div>
    <div class="toggle-row"><span class="toggle-copy"><strong>복약 알림</strong><small>${state.reminders ? "이 기기에서 알림을 받을게요" : "알림을 켜서 복약 시간을 놓치지 마세요"}</small></span><button id="reminderToggle" class="switch ${state.reminders ? "on" : ""}" role="switch" aria-checked="${state.reminders}"></button></div></section>
    <div class="column-stack"><section class="card detail-card"><div class="section-head"><h2>복약 시간 설정</h2><span class="soft-tag">8시간 간격</span></div><div class="field" style="margin-top:18px"><label for="medStart">첫 복약 시간</label><input id="medStart" type="time" value="${escapeHTML(state.dog.med_start || "08:00")}"></div><p class="modal-note" style="margin-top:12px">예정 시간은 ${times.join(" · ")}예요. 보호자 모두가 같은 일정을 확인해요.</p></section>
    <section class="card detail-card"><div class="section-head"><h2>선택 날짜 복용 기록</h2></div>${recordListTemplate(meds, " · 복용 완료", "선택한 날짜의 복용 기록이 없어요.")}</section></div></div>`;
}

function switchTab(tab) {
  state.tab = tab;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(title, subtitle, content) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><div class="modal-head"><div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(subtitle)}</p></div><button class="modal-close" aria-label="닫기">×</button></div>${content}</section></div>`;
  const backdrop = $(".modal-backdrop", root);
  $(".modal-close", root).addEventListener("click", closeModal);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(); });
  document.addEventListener("keydown", escapeModal, { once: true });
  $(".modal-close", root).focus();
}

function escapeModal(event) {
  if (event.key === "Escape") closeModal();
}

function closeModal() {
  $("#modalRoot").innerHTML = "";
}

function openRecordModal(kind = state.tab) {
  const selected = ["temperature", "feeding", "hydration", "medication", "elimination", "vitality", "weight"].includes(kind) ? kind : "temperature";
  const settings = {
    temperature: { title: "체온 기록 추가", label: "체온 (°C)", value: "38.5", type: "number", step: "0.1", min: "30", max: "45", placeholder: "예: 38.5" },
    feeding: { title: "밥 강급 기록 추가", label: "급여량 (ml)", value: "", type: "number", step: "0.1", min: "0.1", max: "2000", placeholder: "예: 20" },
    hydration: { title: "음수량 기록 추가", label: "마신 물의 양 (ml)", value: "", type: "number", step: "0.1", min: "0.1", max: "2000", placeholder: "예: 30" },
  };
  const current = state.selectedDate === dateParts().date
    ? dateParts().datetime
    : `${state.selectedDate}T12:00`;
  if (selected === "weight") {
    const alreadyMeasured = recordsForSelectedDate(state.weight).length > 0;
    openModal("몸무게 기록 추가", "하루 한 번 측정해요. 시간 대신 측정 날짜를 선택해 주세요.", `<form id="recordForm" class="form-grid">
      ${alreadyMeasured ? `<p class="modal-note">선택한 날짜에 이미 몸무게를 기록했어요. 기존 기록의 연필 버튼으로 수정할 수 있어요.</p>` : `<div class="field"><label for="weightValue">몸무게 (kg)</label><input id="weightValue" name="value" type="number" inputmode="decimal" min="0.1" max="200" step="0.01" placeholder="예: 6.2" required></div><div class="field"><label for="weightDate">측정 날짜</label><input id="weightDate" name="recorded_at" type="date" max="${dateParts().date}" value="${escapeHTML(state.selectedDate)}" required></div><div class="form-actions"><button type="button" class="secondary-button cancel-modal">취소</button><button type="submit" class="primary-button">몸무게 저장</button></div>`}
    </form>`);
    if (alreadyMeasured) $("#recordForm").insertAdjacentHTML("beforeend", `<div class="form-actions"><button type="button" class="primary-button cancel-modal">닫기</button></div>`);
  } else if (selected === "elimination") {
    openModal("소변 · 대변 기록 추가", "배설 종류와 시간을 기록해요.", `<form id="recordForm" class="form-grid">
      <div class="field"><label for="eliminationType">배설 종류</label><select id="eliminationType" name="detail"><option value="소변">소변</option><option value="대변">대변</option></select></div>
      <div class="field"><label for="recordDate">날짜와 시간</label><input id="recordDate" name="recorded_at" type="datetime-local" value="${current}" required></div>
      <div class="form-actions"><button type="button" class="secondary-button cancel-modal">취소</button><button type="submit" class="primary-button">기록 저장</button></div>
    </form>`);
  } else if (selected === "vitality") {
    openModal("활력 징후 기록 추가", "혼자 먹는지, 평소 상태인지, 체온이 높은지 확인해 주세요.", `<form id="recordForm" class="form-grid">
      <div class="field"><label for="vitalityScore">오늘의 상태</label><select id="vitalityScore" name="value">${Object.entries(vitalityStates).map(([score, status]) => `<option value="${score}">${score}. ${status.label} — ${status.description}</option>`).join("")}</select></div>
      <div class="field"><label for="vitalityMemo">메모 (선택)</label><textarea id="vitalityMemo" name="memo" rows="3" maxlength="200" placeholder="예: 토함, 기침, 식욕 저하"></textarea></div>
      <div class="field"><label for="recordDate">날짜와 시간</label><input id="recordDate" name="recorded_at" type="datetime-local" value="${current}" required></div>
      <div class="form-actions"><button type="button" class="secondary-button cancel-modal">취소</button><button type="submit" class="primary-button">활력 기록 저장</button></div>
    </form>`);
  } else if (selected === "medication") {
    const taken = new Set(recordsForSelectedDate(state.medication).map((record) => Number(record.dose_index)));
    const nextDose = [1, 2, 3].find((dose) => !taken.has(dose)) || 1;
    openModal("복용 기록 추가", "언제 약을 먹었는지 함께 기록해요.", `<form id="recordForm" class="form-grid">
      <div class="field"><label for="recordDose">복약 회차</label><select id="recordDose" name="dose_index" class="record-select">${[1,2,3].map((dose) => `<option value="${dose}" ${dose === nextDose ? "selected" : ""} ${taken.has(dose) ? "disabled" : ""}>${dose}회차${taken.has(dose) ? " (기록 완료)" : ""}</option>`).join("")}</select></div>
      <div class="field"><label for="recordDate">복용 날짜와 시간</label><input id="recordDate" name="recorded_at" type="datetime-local" value="${current}" required></div>
      <div class="field"><label for="recordDetail">메모 (선택)</label><input id="recordDetail" name="detail" maxlength="200" placeholder="예: 식후 복용"></div>
      <div class="form-actions"><button type="button" class="secondary-button cancel-modal">취소</button><button type="submit" class="primary-button">복용 완료 기록</button></div>
    </form>`);
  } else {
    const config = settings[selected];
    openModal(config.title, "기록 시간은 날짜·시·분까지 직접 수정할 수 있어요.", `<form id="recordForm" class="form-grid">
      <div class="field"><label for="recordValue">${config.label}</label><input id="recordValue" name="value" type="${config.type}" inputmode="decimal" min="${config.min}" max="${config.max}" step="${config.step}" value="${config.value}" placeholder="${config.placeholder}" required></div>
      <div class="field"><label for="recordDate">측정 날짜와 시간</label><input id="recordDate" name="recorded_at" type="datetime-local" value="${current}" required></div>
      ${selected === "feeding" ? `<div class="field"><label for="feedingMethod">먹은 방법</label><select id="feedingMethod" name="feeding_method"><option value="assisted">밥 강급</option><option value="self">스스로 먹음</option></select></div>` : ""}
      ${selected === "feeding" ? `<div class="field"><label for="recordDetail">메모 (선택)</label><input id="recordDetail" name="detail" maxlength="200" placeholder="예: 처방식, 닭가슴살"></div>` : ""}
      <div class="form-actions"><button type="button" class="secondary-button cancel-modal">취소</button><button type="submit" class="primary-button">기록 저장</button></div>
    </form>`);
  }
  $(".cancel-modal").addEventListener("click", closeModal);
  $("#recordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (selected === "weight") form.recorded_at = `${form.recorded_at}T12:00:00`;
    form.recorded_at = new Date(form.recorded_at).toISOString();
    try {
      await api(`/api/dogs/${state.dog.id}/${selected}`, { method: "POST", body: JSON.stringify(form) });
      await loadRecords();
      closeModal();
      render();
      setToast("돌봄 기록을 저장했어요.");
    } catch (error) { setToast(error.message); }
  });
}

async function markDose(dose) {
  if (recordsForSelectedDate(state.medication).some((record) => Number(record.dose_index) === dose)) {
    setToast("이미 기록한 복약 회차예요.");
    return;
  }
  const scheduledTime = medicationScheduleDates()[dose - 1];
  const recordedAt = state.selectedDate === dateParts().date
    ? new Date(dateParts().datetime).toISOString()
    : scheduledTime.toISOString();
  try {
    await api(`/api/dogs/${state.dog.id}/medication`, {
      method: "POST",
      body: JSON.stringify({ dose_index: dose, recorded_at: recordedAt, detail: "" }),
    });
    await loadRecords();
    render();
    setToast(`${dose}회차 복용을 기록했어요.`);
  } catch (error) { setToast(error.message); }
}

function openInviteModal() {
  const code = state.dog.invite_code;
  openModal("가족을 초대해요", `${state.dog.name}의 케어 기록을 함께 관리할 수 있어요.`, `<div class="code-box" id="inviteCode">${escapeHTML(code)}</div><p class="modal-note">초대할 분이 계정을 만든 뒤 이 코드를 입력하면 연결돼요. 온 가족이 같은 체온·식사·복약 기록을 확인할 수 있어요.</p><div class="form-actions"><button class="secondary-button" id="copyInvite">코드 복사</button><button class="primary-button" id="refreshInvite">새 코드 만들기</button></div>`);
  $("#copyInvite").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      setToast("초대 코드를 복사했어요.");
    } catch {
      setToast(`초대 코드: ${code}`);
    }
  });
  $("#refreshInvite").addEventListener("click", async () => {
    try {
      const result = await api(`/api/dogs/${state.dog.id}/invite`, { method: "POST", body: "{}" });
      state.dog.invite_code = result.code;
      const index = state.dogs.findIndex((dog) => dog.id === state.dog.id);
      state.dogs[index].invite_code = result.code;
      closeModal();
      openInviteModal();
      setToast("새 초대 코드를 만들었어요.");
    } catch (error) { setToast(error.message); }
  });
}

function openJoinModal() {
  openModal("초대 코드로 참여하기", "강아지의 보호자가 공유한 코드를 입력해 주세요.", `<form id="joinForm" class="form-grid"><div class="field"><label for="joinCode">초대 코드</label><input id="joinCode" name="code" autocomplete="off" placeholder="예: A1B2C3D4" maxlength="20" required></div><div class="form-actions"><button type="button" class="secondary-button cancel-modal">취소</button><button class="primary-button" type="submit">케어에 참여하기</button></div></form>`);
  $(".cancel-modal").addEventListener("click", closeModal);
  $("#joinForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code");
    try {
      await api("/api/join", { method: "POST", body: JSON.stringify({ code }) });
      closeModal();
      await boot();
      setToast("강아지 케어에 함께 참여했어요.");
    } catch (error) { setToast(error.message); }
  });
}

function openDogSelector() {
  openModal("강아지 프로필", "돌볼 강아지를 선택하거나 새 가족을 연결해요.", `<div class="dog-choice-list">${state.dogs.map((dog) => `<button class="dog-choice ${dog.id === state.dog?.id ? "selected" : ""}" data-dog-select="${dog.id}"><span class="dog-choice-face">🐕</span><span><strong>${escapeHTML(dog.name)}</strong><small>${escapeHTML(`${new Date().getFullYear() - dog.birth_year}살 · ${dog.role === "owner" ? "보호자" : "케어 멤버"}`)}</small></span><span class="dog-choice-check">${dog.id === state.dog?.id ? "✓" : "›"}</span></button>`).join("") || `<div class="empty-state">아직 연결된 프로필이 없어요.</div>`}</div><div class="form-actions"><button class="secondary-button" id="selectorJoin">초대 코드 입력</button><button class="primary-button" id="selectorCreate">강아지 추가</button></div>`);
  $$(".dog-choice", $("#modalRoot")).forEach((button) => button.addEventListener("click", async () => {
    const selected = state.dogs.find((dog) => dog.id === Number(button.dataset.dogSelect));
    if (!selected) return;
    state.dog = selected;
    localStorage.setItem("morning-dog-id", selected.id);
    closeModal();
    await loadRecords();
    render();
  }));
  $("#selectorJoin").addEventListener("click", () => { closeModal(); openJoinModal(); });
  $("#selectorCreate").addEventListener("click", () => { closeModal(); openDogForm(); });
}

function openDogForm() {
  const dog = state.dog;
  openModal(dog ? "강아지 프로필 수정" : "강아지 프로필 만들기", "보호자 프로필과 별도로 강아지 정보를 관리해요.", `<form id="dogForm" class="form-grid">
    <div class="field"><label for="dogName">이름</label><input id="dogName" name="name" value="${escapeHTML(dog?.name || "")}" placeholder="예: 주모닝" required maxlength="50"></div>
    <div class="field"><label for="dogYear">출생 연도</label><input id="dogYear" name="birth_year" type="number" min="2000" max="${new Date().getFullYear()}" value="${escapeHTML(dog?.birth_year || 2017)}" required></div>
    <div class="field"><label for="dogDiagnosis">병명 / 건강 메모</label><input id="dogDiagnosis" name="diagnosis" value="${escapeHTML(dog?.diagnosis || "")}" placeholder="예: 바베시아" maxlength="120"></div>
    <div class="form-actions"><button type="button" class="secondary-button cancel-modal">취소</button><button type="submit" class="primary-button">${dog ? "수정 저장" : "프로필 만들기"}</button></div>
  </form>`);
  $(".cancel-modal").addEventListener("click", closeModal);
  $("#dogForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    form.birth_year = Number(form.birth_year);
    try {
      if (dog) await api(`/api/dogs/${dog.id}`, { method: "PUT", body: JSON.stringify(form) });
      else await api("/api/dogs", { method: "POST", body: JSON.stringify(form) });
      closeModal();
      await boot();
      setToast("강아지 프로필을 저장했어요.");
    } catch (error) { setToast(error.message); }
  });
}

function openUserMenu() {
  openModal("보호자 프로필", "강아지 프로필과 별도로 보호자 계정을 관리해요.", `<div class="record-row"><span><strong>${escapeHTML(state.user.name)}</strong><small>${escapeHTML(state.user.email)}</small></span><span class="record-number">보호자</span></div><div class="form-actions"><button class="secondary-button" id="logoutButton">로그아웃</button><button class="primary-button" id="userDone">닫기</button></div>`);
  $("#userDone").addEventListener("click", closeModal);
  $("#logoutButton").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    closeModal();
    showAuth();
  });
}

async function toggleReminders() {
  if (!state.reminders) {
    if (!("Notification" in window)) {
      setToast("이 브라우저에서는 알림을 지원하지 않아요.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setToast("브라우저 설정에서 알림을 허용해 주세요.");
      return;
    }
    state.reminders = true;
  } else state.reminders = false;
  localStorage.setItem("morning-reminders", state.reminders ? "on" : "off");
  render();
  setToast(state.reminders ? "복약 알림을 켰어요." : "복약 알림을 껐어요.");
}

async function saveMedicationStart(event) {
  try {
    await api(`/api/dogs/${state.dog.id}/schedule`, { method: "PUT", body: JSON.stringify({ med_start: event.target.value }) });
    state.dog.med_start = event.target.value;
    setToast("복약 시간을 저장했어요.");
    render();
  } catch (error) { setToast(error.message); }
}

function scheduleAlarmCheck() {
  setInterval(() => {
    if (!state.reminders || !state.dog || !("Notification" in window) || Notification.permission !== "granted") return;
    const now = new Date();
    const todayKey = dateParts(now).date;
    const [hour, minute] = state.dog.med_start.split(":").map(Number);
    const taken = new Set(todayRecords(state.medication).map((record) => Number(record.dose_index)));
    [0, 1, 2].forEach((index) => {
      const schedule = new Date(now);
      schedule.setHours(hour, minute + index * 480, 0, 0);
      const key = `${state.dog.id}-${todayKey}-${index+1}`;
      if (!taken.has(index + 1) && now >= schedule && now.getTime() - schedule.getTime() < 60_000 && !state.notified.has(key)) {
        new Notification(`${state.dog.name} 약 먹을 시간이에요`, { body: `${index + 1}회차 복약을 확인해 주세요.`, tag: key });
        state.notified.add(key);
      }
    });
  }, 15_000);
}

function setupEvents() {
  $$(".nav-item").forEach((item) => item.addEventListener("click", () => switchTab(item.dataset.tab)));
  $("#sideInvite").addEventListener("click", openInviteModal);
  $("#dogProfileButton").addEventListener("click", openDogSelector);
  $("#joinCareButton").addEventListener("click", openJoinModal);
  $("#userMenu").addEventListener("click", () => state.user && openUserMenu());
  $("#mainAddButton").addEventListener("click", () => openRecordModal());
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-pwa-install]")) installOrExplain();
  });
  $("#tabContent").addEventListener("click", (event) => {
    if (event.target.closest("#editDogQuick")) openDogForm();
    if (event.target.closest("#profileInvite")) openInviteModal();
    const editButton = event.target.closest("[data-edit-record]");
    if (editButton) startRecordEdit(editButton.dataset.editRecord, editButton.closest("[data-record-row]"));
    if (event.target.closest("[data-cancel-record]")) render();
  });
  $("#tabContent").addEventListener("submit", (event) => {
    const form = event.target.closest("[data-inline-record-form]");
    if (!form) return;
    event.preventDefault();
    saveRecordEdit(form);
  });
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

async function installOrExplain() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (result.outcome === "accepted") setToast("홈 화면에 모닝케어를 추가했어요.");
    return;
  }
  const instructions = isIOS()
    ? `<ol class="install-steps"><li>Safari에서 이 페이지를 열고 아래 <strong>공유</strong> 버튼을 눌러요.</li><li>메뉴를 올려 <strong>홈 화면에 추가</strong>를 선택해요.</li><li><strong>추가</strong>를 누르면 앱 아이콘이 생겨요.</li></ol><p class="modal-note">Chrome 등 iPhone의 다른 브라우저에서는 Safari로 주소를 열어 진행해 주세요.</p>`
    : `<ol class="install-steps"><li>Chrome 또는 삼성 인터넷의 <strong>⋮ 메뉴</strong>를 열어요.</li><li><strong>앱 설치</strong> 또는 <strong>현재 페이지 추가 → 홈 화면</strong>을 선택해요.</li><li>확인하면 홈 화면에서 모닝케어를 바로 열 수 있어요.</li></ol><p class="modal-note">Chrome에서는 주소창 옆 설치 아이콘이 표시되면 바로 설치할 수도 있어요.</p>`;
  openModal("홈 화면에 추가하기", "설치한 뒤에도 보호자들과 같은 케어 기록을 확인해요.", `${instructions}<div class="form-actions"><button class="primary-button" id="installHelpDone">확인</button></div>`);
  $("#installHelpDone").addEventListener("click", closeModal);
}

function setupPWA() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("앱 오프라인 준비에 실패했습니다.", error);
    });
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    $$("[data-pwa-install]").forEach((button) => { button.hidden = true; });
    setToast("모닝케어를 홈 화면에 추가했어요.");
  });
  if (isInstalled()) $$("[data-pwa-install]").forEach((button) => { button.hidden = true; });
}

setupEvents();
setupPWA();
boot();

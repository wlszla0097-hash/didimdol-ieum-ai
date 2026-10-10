// 이음24 — 화면 이동, 입력 검증, API 호출(fetch), 결과 표시
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const badge = (label) => `<span class="badge ${esc(String(label).replace(/\s/g, ""))}">${esc(label)}</span>`;
const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "");
const won = (n) => (n || n === 0 ? `${Number(n).toLocaleString("ko-KR")}원` : "-");
const EUM = '<span class="eum">✓ 지원제도 활용 가능</span>';

// 화면 사이에서 이어지는 시연 상태 (새로고침하면 초기화 — 개인정보를 브라우저에 남기지 않음)
const state = { seekExamples: [], profile: null, headline: "", application: null, postExamples: [], post: null, postInput: null, filledFor: null, hireTarget: null, sessionCases: [], token: null, batchOut: null };

/* ---------- 1. 화면 이동 (해시 라우팅) ---------- */
const ROUTES = ["home", "seeker", "employer", "officer", "internal", "programs", "about"];
function route() {
  const h = location.hash.slice(1) === "diagnose" ? "internal" : location.hash.slice(1); // 예전 주소 호환
  const name = ROUTES.includes(h) ? h : "home";
  $$(".page").forEach((p) => (p.hidden = p.dataset.page !== name));
  $$(".nav a").forEach((a) => { a.classList.toggle("active", a.dataset.route === name); a.toggleAttribute("aria-current", a.dataset.route === name); });
  $("#nav").classList.remove("open");
  setTimeout(() => ($("#toast").hidden = true), 1500); // 화면 이동 후 안내 닫기
  $("#menuBtn").setAttribute("aria-expanded", "false");
  window.scrollTo({ top: 0 });
  if (name === "seeker") loadSeekExamples();
  if (name === "employer") loadPostings();
  if (name === "officer") loadCases();
  if (name === "internal") syncInternal();
  if (name === "programs" && !route.programsLoaded) loadPrograms("");
  if (name === "about") loadStatus();
}
window.addEventListener("hashchange", route);
$("#menuBtn").addEventListener("click", () => {
  const open = $("#nav").classList.toggle("open");
  $("#menuBtn").setAttribute("aria-expanded", String(open));
});

/* ---------- 다크 모드 ---------- */
const syncThemeIcon = () => ($("#themeBtn").textContent = document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙");
syncThemeIcon();
$("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  syncThemeIcon();
  try { localStorage.setItem("theme", next); } catch (e) { /* 저장 불가 환경은 무시 */ }
});

/* ---------- 2. 공통 API 호출: 시간 초과·지연 안내·오류 메시지 ---------- */
async function api(path, { method = "GET", body, timeoutMs = 45000, onSlow, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const slow = onSlow ? setTimeout(onSlow, 8000) : null; // 8초 넘으면 '지연 중' 안내
  try {
    const res = await fetch(path, {
      method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* JSON 아닌 응답 */ }
    if (!res.ok || !data || data.ok === false) {
      const fallback = res.status >= 500 ? "서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도하세요." : "요청을 처리하지 못했습니다. 입력값을 확인하세요.";
      throw new Error(`${(data && data.message) || fallback} (오류 코드 ${res.status})`);
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("응답 시간이 초과되었습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도하세요.");
    if (err instanceof TypeError) throw new Error("서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.");
    throw err;
  } finally {
    clearTimeout(timer);
    if (slow) clearTimeout(slow);
  }
}
function showMsg(el, text, type = "error") { el.textContent = text; el.className = `msg ${type}`; el.hidden = !text; }
const revealOnMobile = (el) => { if (window.matchMedia("(max-width: 900px)").matches) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
const loadingHtml = (text) => `<div class="loading"><div><div class="spinner"></div><p>${esc(text)}</p></div></div>`;
const errorHtml = (err) => `<div class="empty"><span>⚠️</span><p>${esc(err.message)}</p></div>`;
function toast(html) {
  const t = $("#toast"); t.innerHTML = html; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), 6000);
}
$$("textarea[maxlength]").forEach((ta) => ta.addEventListener("input", () => {
  const c = $(`.counter[data-for="${ta.id}"]`); if (c) c.textContent = `${ta.value.length}/${ta.maxLength}`;
}));

const fmt = (n) => (n || n === 0 ? Number(n).toLocaleString("ko-KR") : "");
/* ---------- 3. 구직자: 직접 쓴 경험 → AI 정리·역량 문장·공고 추천 ---------- */
const SEEK_FIELDS = ["kuchwi", "kuchwi_qualified", "kuchwi_iap", "kuchwi_job_after", "dojeon", "dojeon_completed", "youth", "experience", "job", "region", "consent"];
const seekEl = (k) => $(`#seekForm [name="${k}"]`);
function readSeekForm() {
  const f = {};
  SEEK_FIELDS.forEach((k) => { const el = seekEl(k); f[k] = el.type === "checkbox" ? el.checked : el.value.trim(); });
  return f;
}
function fillForm(root, values, names) {
  names.forEach((k) => {
    const el = $(`[name="${k}"]`, root); if (!el || !(k in values)) return;
    if (el.type === "checkbox") el.checked = !!values[k]; else el.value = values[k] ?? "";
    el.dispatchEvent(new Event("input"));
  });
}
function syncProgramBoxes() {
  $$(".sub[data-for]").forEach((s) => (s.hidden = !$("#" + s.dataset.for).checked));
}
["kuchwi", "dojeon"].forEach((id) => $("#" + id).addEventListener("change", syncProgramBoxes));

async function loadSeekExamples() {
  if (state.seekExamples.length) return;
  try {
    state.seekExamples = (await api("/api/seeker", { timeoutMs: 15000 })).examples;
    $("#seekExample").insertAdjacentHTML("beforeend", state.seekExamples.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join(""));
  } catch (e) { /* 예시는 없어도 직접 입력 가능 */ }
}
$("#seekExample").addEventListener("change", (e) => {
  const x = state.seekExamples.find((v) => v.id === e.target.value);
  if (!x) return;
  ["kuchwi", "kuchwi_iap", "kuchwi_job_after", "dojeon"].forEach((k) => (seekEl(k).checked = false));
  ["kuchwi_qualified", "dojeon_completed"].forEach((k) => (seekEl(k).value = ""));
  fillForm($("#seekForm"), x.form, SEEK_FIELDS.filter((k) => k !== "consent"));
  syncProgramBoxes();
});

$("#seekForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#seekMsg"), body = readSeekForm();
  $$(".invalid", $("#seekForm")).forEach((el) => el.classList.remove("invalid"));
  const need = [["experience", "내 경험"], ["job", "희망 직무"]];
  if (body.kuchwi) need.push(["kuchwi_qualified", "국민취업지원제도 수급자격 인정일"]);
  if (body.dojeon) need.push(["dojeon_completed", "청년도전지원사업 수료일"]);
  const missing = need.filter(([k]) => !body[k]);
  missing.forEach(([k]) => seekEl(k).classList.add("invalid"));
  if (missing.length) return showMsg(msg, `필수값을 입력하세요: ${missing.map(([, l]) => l).join(", ")}`);
  if (body.experience.length < 10) { seekEl("experience").classList.add("invalid"); return showMsg(msg, "내 경험을 조금 더 자세히(10자 이상) 적어 주세요."); }
  showMsg(msg, "");
  const btn = $("#seekBtn"), out = $("#seekResult");
  btn.disabled = true; btn.textContent = "정리 중…";
  out.innerHTML = loadingHtml("AI가 내 경험을 정리하고 맞는 공고를 고르고 있어요");
  revealOnMobile(out);
  try {
    const data = await api("/api/seeker", { method: "POST", body,
      onSlow: () => (out.innerHTML = loadingHtml("AI 응답이 평소보다 늦어지고 있어요. 조금만 기다려 주세요 (최대 45초)")) });
    state.profile = body;
    state.headline = data.competencies[0]?.text || "";
    renderSeeker(data);
  } catch (err) {
    out.innerHTML = errorHtml(err);
  } finally {
    btn.disabled = false; btn.textContent = "AI로 이력 정리 · 공고 추천";
  }
});

function renderSeeker({ activities, competencies, resume_intro, jobs, programs, meta }) {
  const aiNote = meta.ai_used
    ? `<p class="meta">🤖 AI ${esc(meta.model)} 정리 · 원문에 없는 숫자·내용 등으로 서버가 차단한 문장 ${meta.guard_blocked}건</p>`
    : `<div class="msg info">${esc(meta.ai_error || "AI 결과 없이 규칙 기반 기본 정리로 표시합니다.")}</div>`;
  const acts = activities.length ? `<table class="acts"><thead><tr><th>구분</th><th>활동</th><th>기간</th></tr></thead><tbody>${
    activities.map((a) => `<tr><td><span class="kind">${esc(a.kind)}</span></td><td>${esc(a.name)}</td><td>${esc(a.period || "-")}</td></tr>`).join("")}</tbody></table>` : "";
  const comps = competencies.map((c) => `<li>${esc(c.text)}${c.evidence ? `<small>근거: ${esc(c.evidence)}</small>` : ""}</li>`).join("");
  const cards = jobs.map((j) => `
    <article class="job">
      <div class="job-head"><h3>${esc(j.title)}</h3>${j.badge.show ? EUM : ""}</div>
      <div class="agency">${esc(j.company)} · ${esc(j.region)} · ${esc(j.emp_type || "고용형태 미상")} · 월 ${won(j.wage)} · 마감 ${esc(j.close || "-")}</div>
      ${j.matched.length ? `<div class="tags">${j.matched.map((m) => `<span>${esc(m)}</span>`).join("")}</div>` : ""}
      <p>${esc(j.reason)}</p>
      ${j.prep ? `<p class="next">👉 ${esc(j.prep)}</p>` : ""}
      <div class="mine ${j.badge.eligible ? "yes" : ""}"><b>나에게만 보이는 안내</b> ${esc(j.badge.text)}<br><small>기준: ${esc(j.badge.basis)} · 본인 입력 기준 예상 안내이며 최종 확인은 고용센터</small></div>
      <div class="job-actions">
        ${safeUrl(j.url) ? `<a class="btn ghost" href="${esc(j.url)}" target="_blank" rel="noopener">공고 원문 ↗</a>` : ""}
        <button class="btn primary apply" type="button" data-id="${esc(j.id)}">이 공고에 지원 (시연)</button>
      </div>
    </article>`).join("");
  const ex = meta.excluded;
  $("#seekResult").innerHTML = `
    <h3>🗂 AI가 정리한 내 이력</h3>
    ${programs.length ? `<p class="muted">참여 고용서비스: ${programs.map(esc).join(" · ")}</p>` : ""}
    ${acts}
    <h3>📌 직무 역량 문장</h3>
    <ul class="comps">${comps}</ul>
    ${resume_intro ? `<details open><summary>자기소개서 첫 문단 초안</summary><p>${esc(resume_intro)}</p></details>` : ""}
    ${aiNote}
    <h3>🎯 추천 공고 ${jobs.length}건</h3>
    ${meta.no_match ? `<div class="msg info">작성한 경험·희망 직무와 맞는 공고가 아직 없어요. 희망 직무를 바꾸거나 경험에 사용한 도구·기술을 더 적어 보세요.</div>` : ""}
    ${jobs.length && !meta.consent ? `<div class="msg info">‘지원제도 활용 가능’ 표시에 동의하지 않아 기업에는 아무 표시도 보이지 않아요.</div>` : ""}
    ${cards}
    <p class="meta">공고 출처: ${meta.postings_source === "live" ? "고용24 채용정보 실시간" : "합성 공고(고용24 OpenAPI 승인 전 시연)"} · 제외: 임금체불 명단공개 ${ex.arrears}건, 최저임금 미달 ${ex.min_wage || 0}건, 마감 ${ex.closed}건</p>`;
  $$(".apply", $("#seekResult")).forEach((b) => b.addEventListener("click", () => {
    state.application = { posting_id: b.dataset.id };
    b.textContent = "지원 완료 ✓"; b.disabled = true;
    const x = state.postExamples.find((p) => p.id === b.dataset.id);
    toast(`지원했어요. <a href="#employer">기업 화면</a>에서 ${x ? "이 공고를 불러와 " : "공고를 점검하면 "}내 지원서가 어떻게 보이는지 확인할 수 있어요.`);
  }));
}

/* ---------- 4. 기업: 직접 쓴 공고 → 점검·AI 정리 → 지원자 확인 → 채용 확정 ---------- */
const POST_FIELDS = ["company", "sido", "sigungu", "title", "job", "emp_type", "wage", "weekly_hours", "insured", "priority", "description"];
const postEl = (k) => $(`#postForm [name="${k}"]`);
["p_wage", "p_insured"].forEach((id) => $("#" + id).addEventListener("input", (e) => {
  const n = e.target.value.replace(/[^\d]/g, ""); e.target.value = n ? Number(n).toLocaleString("ko-KR") : "";
}));
async function loadPostings() {
  if (!state.postExamples.length) {
    try {
      state.postExamples = (await api("/api/employer", { timeoutMs: 15000 })).examples;
      $("#postExample").insertAdjacentHTML("beforeend", state.postExamples.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join(""));
    } catch (e) { /* 예시는 없어도 직접 입력 가능 */ }
  }
  // 구직자 화면에서 예시 공고에 지원했다면 그 공고를 채워 둔다
  if (state.application && state.application.posting_id !== state.filledFor) {
    const x = state.postExamples.find((p) => p.id === state.application.posting_id);
    if (x) { fillPost(x.form); $("#postExample").value = x.id; state.filledFor = x.id; runPostCheck(); }
  }
}
function fillPost(form) { fillForm($("#postForm"), { ...form, wage: fmt(form.wage), insured: fmt(form.insured) }, POST_FIELDS); }
$("#postExample").addEventListener("change", (e) => {
  const x = state.postExamples.find((v) => v.id === e.target.value);
  if (x) fillPost(x.form);
});
$("#postForm").addEventListener("submit", (e) => { e.preventDefault(); runPostCheck(); });

function readPostForm() {
  const f = {};
  POST_FIELDS.forEach((k) => (f[k] = postEl(k).value.trim()));
  ["wage", "insured", "weekly_hours"].forEach((k) => (f[k] = f[k] === "" ? null : Number(f[k].replace(/[^\d.]/g, ""))));
  return f;
}

async function runPostCheck() {
  const msg = $("#postMsg"), body = readPostForm();
  $$(".invalid", $("#postForm")).forEach((el) => el.classList.remove("invalid"));
  const missing = [["sido", "근무지(시·도)"], ["title", "공고 제목"], ["job", "직무"], ["wage", "월 임금"]].filter(([k]) => !body[k]);
  missing.forEach(([k]) => postEl(k).classList.add("invalid"));
  if (missing.length) return showMsg(msg, `필수값을 입력하세요: ${missing.map(([, l]) => l).join(", ")}`);
  showMsg(msg, "");
  const btn = $("#postBtn");
  btn.disabled = true; btn.textContent = "점검 중…";
  $("#empArea").hidden = false; $("#hirePanel").hidden = true;
  $("#postCheck").innerHTML = loadingHtml("규칙엔진이 공고를 점검하고 AI가 공고를 정리하고 있어요");
  $("#applicants").innerHTML = "";
  $("#empArea").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const data = await api("/api/employer", { method: "POST",
      body: { posting: body, my_application: state.profile && { profile: state.profile, headline: state.headline } } });
    state.post = data.posting; state.postInput = data.posting_input;
    renderPostCheck(data);
  } catch (err) {
    $("#postCheck").innerHTML = errorHtml(err);
  } finally {
    btn.disabled = false; btn.textContent = "공고 점검 · AI 정리";
  }
}

function checkList(items) {
  return items.map((r) => `<div class="check-item">${badge(r.level)}<div><b>${esc(r.item)}</b><br>${esc(r.detail)}<div class="basis">근거: ${esc(r.basis)}</div></div></div>`).join("");
}

function renderPostCheck({ posting, check, analysis, ai_error, applicants, note }) {
  const tone = { "연계 가능성 높음": "적정", "확인 필요": "확인필요", "연계 어려움": "위반의심" }[check.verdict];
  const ai = analysis ? `
    <h3>🤖 AI 공고 정리</h3>
    ${analysis.summary ? `<div class="summary">${esc(analysis.summary)}</div>` : ""}
    ${analysis.requirements.length ? `<p><b>요구 역량</b> <span class="tags">${analysis.requirements.map((r) => `<span>${esc(r)}</span>`).join("")}</span></p><p class="meta">요구 역량은 공고 본문에 실제로 적힌 단어만 남기고, 지원자 추천에 사용합니다.</p>` : ""}
    ${analysis.suggestions.length ? `<b>공고 보완 제안</b><ul>${analysis.suggestions.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}`
    : ai_error ? `<div class="msg info">AI 공고 정리: ${esc(ai_error)} — 규칙 점검 결과는 정상입니다.</div>` : "";
  $("#postCheck").innerHTML = `
    <h2 class="panel-title">④ 이 공고로 받을 수 있는 지원</h2>
    <p class="muted">${esc(posting.company)} · ${esc(posting.title)} · ${esc(posting.region)}</p>
    <div class="verdict ${tone}">청년일자리도약장려금 연계: <b>${esc(check.verdict)}</b></div>
    ${checkList(check.items)}
    ${ai}
    <p class="meta">※ 입력한 공고 정보 기준 사전 점검입니다. 최종 요건 확인은 고용센터에서 합니다.</p>`;
  $("#applicants").innerHTML = `
    <h2 class="panel-title">⑤ 지원자 (지원일 순)</h2>
    <p class="note">${esc(note)}</p>
    ${applicants.map((a) => `
      <div class="applicant ${a.is_me ? "me" : ""}">
        <div><b>${esc(a.alias)}</b> ${a.badge ? EUM : ""}<br><span class="muted">${esc(a.headline)}</span><br><small class="muted">지원일 ${esc(a.applied)}</small></div>
        <button class="btn ghost hire" type="button" data-id="${esc(a.id)}" data-alias="${esc(a.alias)}">채용 확정</button>
      </div>`).join("")}
    ${state.profile ? "" : `<p class="meta">구직자 화면에서 이력을 작성하면 그 내용이 이 목록에 시연용 지원자로 추가됩니다.</p>`}
    <p class="meta">시연용 가상 지원자 A·B·C가 함께 보입니다. 정렬·필터 기능은 일부러 두지 않았습니다.</p>`;
  $$(".hire", $("#applicants")).forEach((b) => b.addEventListener("click", () => openHire(b.dataset.id, b.dataset.alias)));
}

function openHire(id, alias) {
  state.hireTarget = { id, alias };
  const p = state.post;
  $("#hireWho").textContent = `${p.company} · ${p.title} → ${alias} 채용 확정. 근로조건은 공고 내용으로 채웠습니다.`;
  Object.entries({ start_date: new Date().toISOString().slice(0, 10), employment_type: p.emp_type === "정규직" ? "정규직" : "기간제",
    base_wage: fmt(p.wage), allowances: "", weekly_hours: p.weekly_hours || 40, daily_hours: 8, break_minutes: 60 })
    .forEach(([k, v]) => ($("#" + k).value = v));
  $$('#checkForm input[type="checkbox"]').forEach((c) => (c.checked = true));
  $("#checkResult").innerHTML = '<div class="empty"><span>📝</span><p>근로조건을 확인하고<br>[근로계약 점검 · 신청 건 만들기]를 누르세요.</p></div>';
  $("#hirePanel").hidden = false;
  $("#hirePanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

const numberOnly = (v) => v.replace(/[^\d.]/g, "");
["base_wage", "allowances"].forEach((id) => $("#" + id).addEventListener("input", (e) => {
  const n = numberOnly(e.target.value);
  e.target.value = n ? Number(n).toLocaleString("ko-KR") : "";
}));
$("#sampleBtn").addEventListener("click", () => {
  Object.entries({ employment_type: "기간제", base_wage: "2,000,000", weekly_hours: "40", daily_hours: "9", break_minutes: "30" })
    .forEach(([k, v]) => ($("#" + k).value = v));
  $('input[name="has_leave"]').checked = false;
});
function numberOrText(key, v) {
  if (["base_wage", "allowances", "weekly_hours", "daily_hours", "break_minutes"].includes(key)) {
    const n = numberOnly(String(v)); return n === "" ? null : Number(n);
  }
  return String(v).trim();
}

$("#checkForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = $("#checkForm"), msg = $("#checkMsg");
  const body = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, v === "on" ? true : numberOrText(k, v)]));
  $$('input[type="checkbox"]', form).forEach((c) => (body[c.name] = c.checked)); // 체크 해제 항목도 false로 명시
  $$(".invalid", form).forEach((el) => el.classList.remove("invalid"));
  const missing = [];
  if (!body.start_date) { missing.push("입사일"); $("#start_date").classList.add("invalid"); }
  if (!body.base_wage) { missing.push("월 기본급"); $("#base_wage").classList.add("invalid"); }
  if (!body.weekly_hours) { missing.push("주 소정근로시간"); $("#weekly_hours").classList.add("invalid"); }
  if (missing.length) return showMsg(msg, `필수값을 입력하세요: ${missing.join(", ")}`);
  showMsg(msg, "");
  const btn = $("#checkBtn"), out = $("#checkResult");
  btn.disabled = true; btn.textContent = "점검 중…";
  out.innerHTML = loadingHtml("규칙엔진이 점검하고 AI가 설명을 쓰고 있어요");
  revealOnMobile(out);
  try {
    const [chk, cs] = await Promise.all([
      api("/api/check", { method: "POST", body, onSlow: () => (out.innerHTML = loadingHtml("AI 설명 작성이 늦어지고 있어요. 조금만 기다려 주세요")) }),
      api("/api/cases", { method: "POST", timeoutMs: 20000, body: { posting: state.postInput, applicant_id: state.hireTarget.id, hire_date: body.start_date,
        contract: body, my_application: state.profile && { profile: state.profile } } }),
    ]);
    renderCheck(chk, cs.case);
  } catch (err) {
    out.innerHTML = errorHtml(err);
  } finally {
    btn.disabled = false; btn.textContent = "근로계약 점검 · 신청 건 만들기";
  }
});

function renderCheck({ results, explain, ai_error }, cs) {
  const order = { "위반 의심": 0, "확인 필요": 1, "적정": 2 };
  const v = results.filter((r) => r.level === "위반 의심").length, c = results.filter((r) => r.level === "확인 필요").length;
  let ai = "";
  if (explain) {
    ai = `<h3>🤖 AI 쉬운 설명</h3><div class="summary">${esc(explain.summary)}</div>` +
      (explain.blocked ? `<p class="meta">점검 결과에 없는 숫자·항목이 나온 AI 문장 ${explain.blocked}건은 서버가 차단했습니다.</p>` : "") +
      explain.actions.map((a) => `<div class="rec"><b>${esc(a.item)}</b><p>${esc(a.explain)}</p><p class="next">✏️ ${esc(a.fix)}</p></div>`).join("");
  } else if (ai_error) {
    ai = `<div class="msg info">AI 설명을 불러오지 못했습니다: ${esc(ai_error)} — 규칙 점검 결과는 정상입니다.</div>`;
  }
  const s = cs.schedule;
  $("#checkResult").innerHTML = `
    <h3>근로계약 점검 — 위반 의심 ${v}건 · 확인 필요 ${c}건</h3>
    ${[...results].sort((a, b) => order[a.level] - order[b.level]).map((r) => `<div class="check-item">${badge(r.level)}<div><b>${esc(r.item)}</b><br>${esc(r.detail)}<div class="basis">근거: ${esc(r.basis)}</div></div></div>`).join("")}
    ${ai}
    <h3>🔔 신청 알림</h3>
    <div class="sched"><div><small>입사일</small><b>${esc(s.hire_date)}</b></div><div><small>6개월 고용유지</small><b>${esc(s.six_month_date)}</b></div><div><small>알림 예정</small><b>${esc(s.notify_date)}</b></div></div>
    <p class="meta">${esc(s.note)}</p>
    <h3>📂 신청 근거 (채용 확정 후 공개)</h3>
    <div class="evidence ${cs.evidence.open ? "" : "closed"}"><b>${esc(cs.evidence.title)}</b><ul>${cs.evidence.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>
    <button class="btn primary block" id="sendCase" type="button">주무관 확인 화면으로 보내기 (시연)</button>
    <p class="meta">※ 입력값 기준 규칙 점검이며 법적 판단이 아닙니다. 결과에 대한 최종 판단은 이용자와 노무 전문가·관할 기관의 몫입니다.</p>`;
  $("#sendCase").addEventListener("click", () => {
    state.sessionCases = [cs, ...state.sessionCases.filter((x) => x.case_id !== cs.case_id)];
    $("#sendCase").disabled = true; $("#sendCase").textContent = "전송 완료 ✓";
    toast(`신청 건을 보냈어요. <a href="#officer">주무관 화면</a>에서 확인하세요.`);
  });
}

/* ---------- 5. 주무관: 근거가 정리된 신청 건 ---------- */
async function loadCases() {
  const box = $("#cases");
  try {
    const demo = (await api("/api/cases", { timeoutMs: 15000 })).cases;
    const all = [...state.sessionCases.map((c) => ({ ...c, fresh: true })), ...demo];
    $("#caseSrc").textContent = `신청 건 ${all.length}건 (이번 시연에서 보낸 건 ${state.sessionCases.length}건 포함) · 합성 데이터`;
    box.innerHTML = all.map(caseCard).join("");
    $$(".decide", box).forEach((b) => b.addEventListener("click", () => {
      const card = b.closest(".case");
      $(".decision", card).textContent = `주무관 처리: ${b.dataset.v} (시연 — 저장되지 않음)`;
    }));
  } catch (err) {
    box.innerHTML = errorHtml(err);
  }
}
function caseCard(c) {
  const tone = { "검토 대기": "적정", "확인 필요": "확인필요", "보완 필요": "위반의심" }[c.status];
  const s = c.schedule;
  return `
  <article class="case panel ${c.fresh ? "fresh" : ""}">
    <header><div><small class="muted">${esc(c.case_id)} · ${esc(c.program)}${c.fresh ? " · 방금 접수" : ""}</small>
      <h3>${esc(c.company)} — ${esc(c.worker)}</h3><span class="muted">${esc(c.title)} · ${esc(c.region)} · 입사 ${esc(c.hire_date)}</span></div>
      <span class="badge ${tone}">${esc(c.status)}</span></header>
    <div class="grid2">
      <div>
        <h4>참여 이력 근거</h4>
        <div class="evidence ${c.evidence.open ? "" : "closed"}"><b>${esc(c.evidence.title)}</b><ul>${c.evidence.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>
        <h4>신청 시기</h4>
        <p>고용유지 ${esc(s.months_kept)}개월 · 6개월 시점 ${esc(s.six_month_date)} · <b>${esc(s.state)}</b></p>
      </div>
      <div><h4>확인 항목</h4>${checkList(c.checklist)}</div>
    </div>
    <footer><span class="decision muted">자동 판정 없음 — 확인 후 처리하세요.</span>
      <span><button class="btn ghost decide" data-v="보완 요청" type="button">보완 요청</button> <button class="btn primary decide" data-v="검토 완료" type="button">검토 완료</button></span></footer>
  </article>`;
}

/* ---------- 6. 내부 모드: 고객사 지원사업 진단 (디딤돌파트너스 전용) ---------- */
// 로그인 토큰은 이 탭의 sessionStorage에만 둔다 (탭을 닫으면 사라짐). 고객사 정보는 어디에도 저장하지 않는다.
const tokenStore = {
  get() { try { return sessionStorage.getItem("itoken") || state.token; } catch (e) { return state.token; } },
  set(v) { state.token = v; try { v ? sessionStorage.setItem("itoken", v) : sessionStorage.removeItem("itoken"); } catch (e) { /* 저장 불가 환경 */ } },
};
async function iapi(path, opts = {}) {
  try {
    return await api(path, { ...opts, headers: { "X-Internal-Token": tokenStore.get() || "" } });
  } catch (err) {
    if (/로그인/.test(err.message) && /401/.test(err.message)) { tokenStore.set(null); syncInternal(); }
    throw err;
  }
}
function syncInternal() {
  const on = !!tokenStore.get();
  $("#loginForm").hidden = on; $("#internalApp").hidden = !on;
}
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#loginMsg"), pw = $("#ipw").value;
  if (!pw) return showMsg(msg, "필수값을 입력하세요: 내부 비밀번호");
  const btn = $("#loginBtn"); btn.disabled = true;
  try {
    const r = await api("/api/login", { method: "POST", body: { password: pw }, timeoutMs: 15000 });
    tokenStore.set(r.token); $("#ipw").value = ""; showMsg(msg, ""); syncInternal();
  } catch (err) { showMsg(msg, err.message); } finally { btn.disabled = false; }
});
$("#logoutBtn").addEventListener("click", () => { tokenStore.set(null); syncInternal(); });
$$(".tab[data-tab]").forEach((t) => t.addEventListener("click", () => {
  $$(".tab[data-tab]").forEach((x) => x.classList.toggle("active", x === t));
  $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab));
}));

const diagForm = $("#diagForm");
const DIAG_FLAGS = ["hire_youth", "convert_regular", "flexible_work", "hire_senior", "parental", "hire_disabled", "training", "keep_employment"];
const DIAG_COUNTS = ["insured_count", "youth_count", "fixed_term_count", "senior_count", "parental_count"];
diagForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#diagMsg");
  const body = Object.fromEntries([...new FormData(diagForm).entries()].map(([k, v]) => [k, v === "on" ? true : String(v).trim()]));
  DIAG_COUNTS.forEach((k) => (body[k] = body[k] === "" ? null : Number(String(body[k]).replace(/[^\d]/g, ""))));
  $$(".invalid", diagForm).forEach((el) => el.classList.remove("invalid"));
  const missing = [];
  if (!body.industry) { missing.push("업종"); $("#industry").classList.add("invalid"); }
  if (!body.size) { missing.push("상시근로자 수"); $("#size").classList.add("invalid"); }
  if (!DIAG_FLAGS.some((k) => body[k]) && !body.plan) missing.push("올해 계획(1개 이상) 또는 상담 메모");
  if (missing.length) return showMsg(msg, `필수값을 입력하세요: ${missing.join(", ")}`);
  showMsg(msg, "");
  const btn = $("#diagBtn"), out = $("#diagResult");
  btn.disabled = true; btn.textContent = "진단 중…";
  out.innerHTML = loadingHtml("공공데이터에서 후보를 고르고 AI가 정리하고 있어요");
  revealOnMobile(out);
  try {
    const data = await iapi("/api/diagnose", { method: "POST", body,
      onSlow: () => (out.innerHTML = loadingHtml("AI 응답이 평소보다 늦어지고 있어요. 조금만 기다려 주세요 (최대 45초)")) });
    renderDiagnosis(data, body.company_name);
  } catch (err) {
    out.innerHTML = errorHtml(err);
  } finally {
    btn.disabled = false; btn.textContent = "AI 진단 받기";
  }
});
const unmask = (s, name) => (name ? String(s ?? "").replaceAll("A사", name) : s); // 화면에서만 업체명 복원
function renderDiagnosis({ result, meta }, name = "") {
  const t = (s) => esc(unmask(s, name));
  const recs = result.recommendations.map((r) => `
    <article class="rec">
      <h3>${esc(r.name)} ${badge(r.fit)}</h3>
      <div class="agency">${esc(r.agency)}${safeUrl(r.url) ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener">상세 보기 ↗</a>` : ""}</div>
      <p>${t(r.reason)}</p>
      ${r.check_items.length ? `<strong>확인할 요건</strong><ul>${r.check_items.map((c) => `<li>${t(c)}</li>`).join("")}</ul>` : ""}
      <p class="next">👉 ${t(r.next_step)}</p>
      <details><summary>공공데이터 원문 보기</summary><p><b>지원대상</b> ${esc(r.source.target)}</p><p><b>지원내용</b> ${esc(r.source.support)}</p></details>
    </article>`).join("");
  const road = result.roadmap.length
    ? `<h3>📍 지원사업 연계 로드맵</h3><ol class="roadmap">${result.roadmap.map((s) => `<li><b>${esc(s.name)}</b> — ${t(s.when)}<br><span class="agency">${t(s.note)}</span></li>`).join("")}</ol>` : "";
  const missing = result.missing_info.length ? `<div class="msg info">더 정확한 진단을 위해 필요한 정보: ${result.missing_info.map(t).join(" · ")}</div>` : "";
  const src = meta.data_source === "live" ? "공공데이터 실시간 연동" : "예시 데이터(공공데이터 미연결)";
  $("#diagResult").innerHTML = `${name ? `<h3>${esc(name)}</h3>` : ""}<div class="summary">${t(result.summary)}</div>${recs}${road}${missing}
    <p class="meta">데이터: ${src} · 후보 ${meta.candidates}건 중 선별 · 검증 제외 ${meta.dropped_unverified}건 · AI ${esc(meta.model)}${meta.masked ? " · 업체명은 'A사'로 바꿔 전송" : ""}<br>※ 참고용 1차 안내입니다. 최종 자격과 금액은 소관기관 심사로 확정됩니다.</p>`;
}

/* 일괄 진단 (CSV) — 파일은 브라우저 안에서만 읽는다 */
const CSV_COLS = ["업체명", "업종", "상시근로자", "지역", "계획", "현재참여사업", "피보험자수", "34세이하", "기간제", "60세이상", "육아휴직", "메모"];
const PLAN_WORDS = { hire_youth: ["청년"], convert_regular: ["정규직"], flexible_work: ["유연", "선택근무", "재택", "일생활"], hire_senior: ["고령", "시니어", "계속고용"],
  parental: ["육아", "출산", "대체"], hire_disabled: ["장애"], training: ["교육", "훈련"], keep_employment: ["고용유지"] };
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
function sizeBand(v) {
  const s = String(v).trim();
  if (["5인 미만", "5~29인", "30~99인", "100~299인", "300인 이상"].includes(s)) return s;
  const n = Number(s.replace(/[^\d]/g, ""));
  if (!s || Number.isNaN(n)) return "";
  return n < 5 ? "5인 미만" : n < 30 ? "5~29인" : n < 100 ? "30~99인" : n < 300 ? "100~299인" : "300인 이상";
}
function rowToBody(r) {
  const plan = r["계획"] || "";
  const body = { company_name: r["업체명"], industry: r["업종"], size: sizeBand(r["상시근로자"]), region: r["지역"], current: r["현재참여사업"],
    plan: [plan, r["메모"]].filter(Boolean).join(" / "), insured_count: r["피보험자수"], youth_count: r["34세이하"], fixed_term_count: r["기간제"],
    senior_count: r["60세이상"], parental_count: r["육아휴직"] };
  Object.entries(PLAN_WORDS).forEach(([k, words]) => (body[k] = words.some((w) => plan.includes(w))));
  DIAG_COUNTS.forEach((k) => (body[k] = body[k] ? Number(String(body[k]).replace(/[^\d]/g, "")) : null));
  return body;
}
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
function download(name, rows) {
  const blob = new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#tplBtn").addEventListener("click", () => download("고객사_진단양식.csv", [CSV_COLS,
  ["예시정밀", "제조업", "12", "경북 상주", "청년채용;정규직전환", "청년일자리도약장려금", "12", "3", "1", "0", "0", "생산직 청년 2명 채용 예정"]]));
let batchRows = [];
$("#csvFile").addEventListener("change", async (e) => {
  const f = e.target.files[0], msg = $("#batchMsg");
  batchRows = []; $("#batchBtn").disabled = true; $("#batchDl").hidden = true; $("#batchTable").innerHTML = "";
  if (!f) return;
  const rows = parseCSV(await f.text());
  const head = (rows.shift() || []).map((h) => h.replace(/^﻿/, "").trim());
  if (!head.includes("업체명") || !head.includes("업종")) return showMsg(msg, "제목 행에 '업체명', '업종'이 있어야 합니다. [양식 내려받기]의 형식을 사용하세요.");
  batchRows = rows.slice(0, 50).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  showMsg(msg, `${batchRows.length}개 업체를 읽었습니다${rows.length > 50 ? " (한 번에 최대 50개)" : ""}. [일괄 진단 시작]을 누르세요.`, "info");
  $("#batchBtn").disabled = !batchRows.length;
  $("#batchTable").innerHTML = batchTable(batchRows.map((r) => ({ name: r["업체명"], status: "대기" })));
});
function batchTable(items) {
  return `<table class="acts batch"><thead><tr><th>업체</th><th>상태</th><th>추천 지원사업 (적합도)</th><th>다음 할 일</th></tr></thead><tbody>${
    items.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.status)}</td><td>${esc(x.recs || "")}</td><td>${esc(x.next || "")}</td></tr>`).join("")}</tbody></table>`;
}
$("#batchBtn").addEventListener("click", async () => {
  const btn = $("#batchBtn"); btn.disabled = true;
  const items = batchRows.map((r) => ({ name: r["업체명"], status: "대기" })), out = [];
  for (let i = 0; i < batchRows.length; i++) {
    items[i].status = "진단 중…"; $("#batchTable").innerHTML = batchTable(items);
    const body = rowToBody(batchRows[i]), name = batchRows[i]["업체명"];
    try {
      if (!body.industry || !body.size) throw new Error("업종·상시근로자 누락");
      const { result } = await iapi("/api/diagnose", { method: "POST", body });
      const recs = result.recommendations.map((r) => `${r.name}(${r.fit})`).join(", ");
      const road = result.roadmap.map((s) => `${s.order}. ${s.name} — ${unmask(s.when, name)}`).join(" / ");
      Object.assign(items[i], { status: "완료", recs, next: unmask(result.recommendations[0]?.next_step || "", name) });
      out.push([name, "완료", unmask(result.summary, name), recs, road, unmask(result.missing_info.join(" / "), name)]);
    } catch (err) {
      Object.assign(items[i], { status: "실패: " + err.message.slice(0, 60) });
      out.push([name, "실패", err.message, "", "", ""]);
      if (/로그인/.test(err.message)) break;
    }
    $("#batchTable").innerHTML = batchTable(items);
  }
  state.batchOut = out; $("#batchDl").hidden = !out.length; btn.disabled = false;
});
$("#batchDl").addEventListener("click", () => download(`지원사업_진단결과_${new Date().toISOString().slice(0, 10)}.csv`,
  [["업체명", "상태", "요약", "추천 지원사업(적합도)", "연계 로드맵", "추가로 필요한 정보"], ...(state.batchOut || [])]));

$("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); loadPrograms($("#q").value.trim()); });
async function loadPrograms(q) {
  const list = $("#progList");
  if (!tokenStore.get()) { list.innerHTML = '<div class="empty"><span>🔒</span><p>내부 모드 전용입니다. <a href="#internal">로그인하기 →</a></p></div>'; return; }
  route.programsLoaded = true;
  list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const data = await iapi(`/api/programs?q=${encodeURIComponent(q)}`, { timeoutMs: 20000 });
    $("#progSrc").textContent = `${data.meta.data_source === "live" ? "공공데이터 실시간 연동" : "예시 데이터 (공공데이터 미연결 — 상세 링크에서 확인하세요)"} · ${data.total}건${q ? ` · '${q}' 검색 결과` : ""}`;
    list.innerHTML = data.items.length ? data.items.map((p) => `
      <article class="card prog">
        <div class="agency">${esc(p.agency)}</div><h3>${esc(p.name)}</h3><p>${esc(p.summary)}</p>
        <dl><dt>지원대상</dt><dd>${esc(p.target)}</dd><dt>지원내용</dt><dd>${esc(p.support)}</dd><dt>신청</dt><dd>${esc(p.apply)} ${p.deadline ? "· " + esc(p.deadline) : ""}</dd></dl>
        ${safeUrl(p.url) ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">상세 보기 ↗</a></p>` : ""}
      </article>`).join("") : '<div class="empty"><span>🔍</span><p>검색 결과가 없습니다. 다른 검색어를 입력해 보세요.</p></div>';
  } catch (err) {
    route.programsLoaded = false;
    list.innerHTML = errorHtml(err);
  }
}

/* ---------- 7. 연동 상태 ---------- */
async function loadStatus() {
  try {
    const s = await api("/api/health", { timeoutMs: 10000 });
    $("#status").textContent = `연동 상태 — AI: ${s.ai === "not_configured" ? "미설정(규칙 기반 기본 문장으로 동작)" : `${s.ai} (${s.model})`} · 고용24 채용정보: ${s.work24 === "configured" ? "연동" : "합성 공고 사용"} · 공공서비스(혜택) 정보: ${s.public_data === "configured" ? "연동" : "예시 데이터"}`;
  } catch (err) {
    $("#status").textContent = `연동 상태 확인 실패: ${err.message}`;
  }
}

route();

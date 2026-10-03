// 지원사업 이음 AI — 화면 이동, 입력 검증, API 호출(fetch), 결과 표시
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const badge = (label) => `<span class="badge ${esc(String(label).replace(/\s/g, ""))}">${esc(label)}</span>`;
const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "#");

/* ---------- 1. 화면 이동 (해시 라우팅) ---------- */
const ROUTES = ["home", "diagnose", "programs", "check", "about"];
function route() {
  const name = ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
  $$(".page").forEach((p) => (p.hidden = p.dataset.page !== name));
  $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
  $$(".nav a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.route === name));
  $("#nav").classList.remove("open");
  $("#menuBtn").setAttribute("aria-expanded", "false");
  window.scrollTo({ top: 0 });
  if (name === "programs" && !route.programsLoaded) loadPrograms("");
  if (name === "about") loadStatus();
}
window.addEventListener("hashchange", route);

$("#menuBtn").addEventListener("click", () => {
  const open = $("#nav").classList.toggle("open");
  $("#menuBtn").setAttribute("aria-expanded", String(open));
});

/* ---------- 다크 모드 (보너스) ---------- */
const syncThemeIcon = () => ($("#themeBtn").textContent = document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙");
syncThemeIcon();
$("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  syncThemeIcon();
  try { localStorage.setItem("theme", next); } catch (e) { /* 저장 불가 환경은 무시 */ }
});

/* ---------- 2. 공통 API 호출: 시간 초과·지연 안내·오류 메시지 ---------- */
async function api(path, { method = "GET", body, timeoutMs = 45000, onSlow } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const slow = onSlow ? setTimeout(onSlow, 8000) : null; // 8초 넘으면 '지연 중' 안내
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
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

function showMsg(el, text, type = "error") {
  el.textContent = text;
  el.className = `msg ${type}`;
  el.hidden = !text;
}
// 모바일에서는 결과 영역이 폼 아래에 있으므로 자동으로 스크롤
const revealOnMobile = (el) => { if (window.matchMedia("(max-width: 900px)").matches) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
const loadingHtml = (text) => `<div class="loading"><div><div class="spinner"></div><p>${esc(text)}</p></div></div>`;

/* ---------- 3. AI 기업 진단 ---------- */
const diagForm = $("#diagForm");
$("#plan").addEventListener("input", (e) => ($('.counter[data-for="plan"]').textContent = `${e.target.value.length}/500`));

diagForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#diagMsg");
  const fd = new FormData(diagForm);
  const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, v === "on" ? true : String(v).trim()]));
  // 빈 입력(필수값) 검사 — 서버도 한 번 더 검사한다
  $$(".invalid", diagForm).forEach((el) => el.classList.remove("invalid"));
  const missing = [];
  if (!body.industry) { missing.push("업종"); $("#industry").classList.add("invalid"); }
  if (!body.size) { missing.push("상시근로자 수"); $("#size").classList.add("invalid"); }
  const anyPlan = $$('fieldset input[type="checkbox"]', diagForm).some((c) => c.checked);
  if (!anyPlan && !body.plan) missing.push("올해 계획(1개 이상)");
  if (missing.length) return showMsg(msg, `필수값을 입력하세요: ${missing.join(", ")}`);
  showMsg(msg, "");

  const btn = $("#diagBtn"), out = $("#diagResult");
  btn.disabled = true; btn.textContent = "진단 중…";
  out.innerHTML = loadingHtml("공공데이터에서 후보를 고르고 AI가 정리하고 있어요");
  revealOnMobile(out);
  try {
    const data = await api("/api/diagnose", { method: "POST", body,
      onSlow: () => (out.innerHTML = loadingHtml("AI 응답이 평소보다 늦어지고 있어요. 조금만 기다려 주세요 (최대 45초)")) });
    renderDiagnosis(data);
  } catch (err) {
    out.innerHTML = `<div class="empty"><span>⚠️</span><p>${esc(err.message)}</p></div>`;
  } finally {
    btn.disabled = false; btn.textContent = "AI 진단 받기";
  }
});

function renderDiagnosis({ result, meta }) {
  const recs = result.recommendations.map((r) => `
    <article class="rec">
      <h3>${esc(r.name)} ${badge(r.fit)}</h3>
      <div class="agency">${esc(r.agency)} · <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">상세 보기 ↗</a></div>
      <p>${esc(r.reason)}</p>
      ${r.check_items.length ? `<strong>확인할 요건</strong><ul>${r.check_items.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      <p class="next">👉 ${esc(r.next_step)}</p>
      <details><summary>공공데이터 원문 보기</summary><p><b>지원대상</b> ${esc(r.source.target)}</p><p><b>지원내용</b> ${esc(r.source.support)}</p></details>
    </article>`).join("");
  const road = result.roadmap.length
    ? `<h3>📍 지원사업 연계 로드맵</h3><ol class="roadmap">${result.roadmap.map((s) => `<li><b>${esc(s.name)}</b> — ${esc(s.when)}<br><span class="agency">${esc(s.note)}</span></li>`).join("")}</ol>` : "";
  const missing = result.missing_info.length
    ? `<div class="msg info">더 정확한 진단을 위해 필요한 정보: ${result.missing_info.map(esc).join(" · ")}</div>` : "";
  const src = meta.data_source === "live" ? "공공데이터 실시간 연동" : "예시 데이터(공공데이터 미연결)";
  $("#diagResult").innerHTML = `
    <div class="summary">${esc(result.summary)}</div>
    ${recs}${road}${missing}
    <p class="meta">데이터: ${src} · 후보 ${meta.candidates}건 중 선별 · 검증 제외 ${meta.dropped_unverified}건 · AI ${esc(meta.model)}<br>
    ※ 참고용 1차 안내입니다. 최종 자격과 금액은 소관기관 심사로 확정됩니다.</p>`;
}

/* ---------- 4. 지원사업 찾기 (공공데이터) ---------- */
$("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); loadPrograms($("#q").value.trim()); });

async function loadPrograms(q) {
  route.programsLoaded = true;
  const list = $("#progList");
  list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const data = await api(`/api/programs?q=${encodeURIComponent(q)}`, { timeoutMs: 20000 });
    $("#progSrc").textContent = `${data.meta.data_source === "live" ? "공공데이터 실시간 연동" : "예시 데이터 (공공데이터 미연결 — 상세 링크에서 확인하세요)"} · ${data.total}건${q ? ` · '${q}' 검색 결과` : ""}`;
    list.innerHTML = data.items.length ? data.items.map((p) => `
      <article class="card prog">
        <div class="agency">${esc(p.agency)}</div>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.summary)}</p>
        <dl><dt>지원대상</dt><dd>${esc(p.target)}</dd><dt>지원내용</dt><dd>${esc(p.support)}</dd><dt>신청</dt><dd>${esc(p.apply)} ${p.deadline ? "· " + esc(p.deadline) : ""}</dd></dl>
        <p><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">상세 보기 ↗</a></p>
      </article>`).join("") : '<div class="empty"><span>🔍</span><p>검색 결과가 없습니다. 다른 검색어를 입력해 보세요.</p></div>';
  } catch (err) {
    list.innerHTML = `<div class="empty"><span>⚠️</span><p>${esc(err.message)}</p></div>`;
  }
}

/* ---------- 5. 근로계약 점검 ---------- */
const checkForm = $("#checkForm");
const numberOnly = (v) => v.replace(/[^\d.]/g, "");
["base_wage", "allowances"].forEach((id) => $("#" + id).addEventListener("input", (e) => {
  const n = numberOnly(e.target.value);
  e.target.value = n ? Number(n).toLocaleString("ko-KR") : "";
}));
$("#sampleBtn").addEventListener("click", () => {
  Object.entries({ employment_type: "기간제", wage_type: "월급", start_date: "2026-10-01", end_date: "", base_wage: "2,000,000",
    allowances: "100,000", weekly_hours: "40", daily_hours: "8", break_minutes: "30" }).forEach(([k, v]) => ($("#" + k).value = v));
  $('input[name="has_leave"]').checked = false;
});

checkForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#checkMsg");
  const fd = new FormData(checkForm);
  const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, v === "on" ? true : numberOrText(k, v)]));
  $$(".invalid", checkForm).forEach((el) => el.classList.remove("invalid"));
  const missing = [];
  if (!body.base_wage) { missing.push("기본급"); $("#base_wage").classList.add("invalid"); }
  if (!body.weekly_hours) { missing.push("주 소정근로시간"); $("#weekly_hours").classList.add("invalid"); }
  if (missing.length) return showMsg(msg, `필수값을 입력하세요: ${missing.join(", ")}`);
  showMsg(msg, "");

  const btn = $("#checkBtn"), out = $("#checkResult");
  btn.disabled = true; btn.textContent = "점검 중…";
  out.innerHTML = loadingHtml("규칙 엔진이 점검하고 AI가 설명을 쓰고 있어요");
  revealOnMobile(out);
  try {
    const data = await api("/api/check", { method: "POST", body,
      onSlow: () => (out.innerHTML = loadingHtml("AI 설명 작성이 늦어지고 있어요. 조금만 기다려 주세요")) });
    renderCheck(data);
  } catch (err) {
    out.innerHTML = `<div class="empty"><span>⚠️</span><p>${esc(err.message)}</p></div>`;
  } finally {
    btn.disabled = false; btn.textContent = "점검하기";
  }
});

function numberOrText(key, v) {
  if (["base_wage", "allowances", "weekly_hours", "daily_hours", "break_minutes"].includes(key)) {
    const n = numberOnly(String(v));
    return n === "" ? null : Number(n);
  }
  return String(v).trim();
}

function renderCheck({ results, explain, ai_error }) {
  const order = { "위반 의심": 0, "확인 필요": 1, "적정": 2 };
  const v = results.filter((r) => r.level === "위반 의심").length, c = results.filter((r) => r.level === "확인 필요").length;
  const items = [...results].sort((a, b) => order[a.level] - order[b.level]).map((r) => `
    <div class="check-item">${badge(r.level)}<div><b>${esc(r.item)}</b><br>${esc(r.detail)}<div class="basis">근거: ${esc(r.basis)}</div></div></div>`).join("");
  let ai = "";
  if (explain) {
    ai = `<h3>🤖 AI 쉬운 설명</h3><div class="summary">${esc(explain.summary)}</div>` +
      explain.actions.map((a) => `<div class="rec"><b>${esc(a.item)}</b><p>${esc(a.explain)}</p><p class="next">✏️ ${esc(a.fix)}</p></div>`).join("");
  } else if (ai_error) {
    ai = `<div class="msg info">AI 설명을 불러오지 못했습니다: ${esc(ai_error)} — 위의 규칙 점검 결과는 정상입니다.</div>`;
  }
  $("#checkResult").innerHTML = `
    <h3>점검 결과 — 위반 의심 ${v}건 · 확인 필요 ${c}건</h3>${items}${ai}
    <p class="meta">※ 입력값 기준 규칙 점검이며 법적 판단이 아닙니다. 최종 판단은 노무 전문가·관할 기관에 확인하세요.</p>`;
}

/* ---------- 6. 연동 상태 ---------- */
async function loadStatus() {
  try {
    const s = await api("/api/health", { timeoutMs: 10000 });
    $("#status").textContent = `연동 상태 — AI: ${s.ai === "not_configured" ? "미설정" : `${s.ai} (${s.model})`} · 공공데이터: ${s.public_data === "configured" ? "연동" : "예시 데이터만 사용"}`;
  } catch (err) {
    $("#status").textContent = `연동 상태 확인 실패: ${err.message}`;
  }
}

// AI 키가 아직 없으면 AI 기능 화면 위에 안내 (최종 테스트 전 배포 확인용)
(async () => {
  try {
    const s = await api("/api/health", { timeoutMs: 10000 });
    if (s.ai === "not_configured") {
      ["#diagForm", "#checkForm"].forEach((sel) => {
        const note = document.createElement("p");
        note.className = "msg info";
        note.textContent = "현재 AI 키가 설정되지 않아 AI 결과 대신 안내 메시지가 표시됩니다. (관리자: Vercel 환경 변수에 키 등록 후 재배포)";
        $(sel).prepend(note);
      });
    }
  } catch (e) { /* 상태 확인 실패는 무시 */ }
})();

route();

"""채용 확정 → 신청 건(주무관 확인 보조 화면용).

POST /api/cases {"posting": {...공고 입력}, "applicant_id", "hire_date", "contract": {...근로조건}, "my_application": {"profile": {...}}}
GET  /api/cases 시연용 신청 건 목록

- 근로계약 조건은 규칙엔진(labor.py)으로 점검하고, 공고 점검 항목·고용유지 기간·신청 가능일을 함께 정리한다.
- 참여 이력 근거(사유)는 채용 확정 후, 근로자가 동의한 경우에만 신청 건에 붙는다.
- 이 화면은 판단을 대신하지 않는다. 확인 항목을 모아 보여 주고 최종 결정은 담당 주무관이 한다.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core"))  # 공용 모듈 위치

from common import ApiError, JsonHandler, num, text  # noqa: E402
from labor import check as contract_check  # noqa: E402
from rules import BAD, CHECK, GUIDE_YOUTH, d, history_flags, judge, posting_check, schedule  # noqa: E402
from userinput import parse_posting, parse_seeker  # noqa: E402
from synthetic import applicants_for, posting  # noqa: E402

CONTRACT_KEYS = ("employment_type", "wage_type", "start_date", "end_date", "base_wage", "allowances", "weekly_hours", "daily_hours", "break_minutes")
HAS_KEYS = ("has_holiday", "has_leave", "has_place", "has_job", "has_payday")


def resolve_applicant(post: dict, aid: str, mine: dict | None) -> dict | None:
    if aid.endswith("-ME"):
        if not isinstance(mine, dict) or not isinstance(mine.get("profile"), dict):
            return None
        me = parse_seeker(mine["profile"])
        return {**me, "id": aid, "alias": "구직자 화면 작성자(시연)"}
    return next((a for a in applicants_for(post) if a["id"] == aid), None)


def contract_from(post: dict, hire: date, given: dict | None) -> dict:
    f = {"employment_type": post.get("emp_type") or "정규직", "wage_type": "월급", "start_date": hire.isoformat(), "end_date": "",
         "base_wage": post.get("wage"), "allowances": 0, "weekly_hours": post.get("weekly_hours") or 40, "daily_hours": 8, "break_minutes": 60,
         **{k: True for k in HAS_KEYS}}
    for k, v in (given or {}).items():
        if k in CONTRACT_KEYS:
            f[k] = num(v) if k in ("base_wage", "allowances", "weekly_hours", "daily_hours", "break_minutes") else text(v, 10)
        elif k in HAS_KEYS:
            f[k] = bool(v)
    return f


def build_case(post: dict, app: dict, hire: date, contract: dict | None = None, today: date | None = None) -> dict:
    j = judge(app, post, app.get("consent", False))
    pc = posting_check(post)
    cc = contract_check(contract_from(post, hire, contract))
    sch = schedule(hire, today)
    if j["type"] == "non_capital":
        evidence = {"open": True, "title": "비수도권 유형 — 청년 연령 확인", "lines": ["취업애로 요건 없이 청년(만 15~34세) 채용 시 대상. 연령은 고용24 회원 정보로 확인"]}
    elif j["eligible"] and app.get("consent"):
        evidence = {"open": True, "title": f"취업애로청년 근거: {j['reason']}", "lines": history_flags(app, before=hire)["evidence"]}
    elif j["eligible"]:
        evidence = {"open": False, "title": "근로자 동의 전 — 참여 이력 근거 비공개", "lines": ["신청 시 근로자 본인의 정보 제공 동의가 필요합니다."]}
    else:
        evidence = {"open": True, "title": "취업애로청년 근거 미확인", "lines": ["참여 이력에서 해당 근거가 확인되지 않음 — 다른 요건 해당 여부는 고용센터 확인"]}
    checklist = [i for i in pc["items"] if i["item"] != "지원 유형"]
    checklist.append({"level": "충족" if sch["months_kept"] >= 6 else CHECK, "item": "고용유지 6개월",
                      "detail": f"채용 {sch['hire_date']} → {sch['months_kept']}개월 경과 (6개월 시점 {sch['six_month_date']})", "basis": GUIDE_YOUTH})
    issues = [r for r in cc if r["level"] != "적정"]
    checklist.append({"level": BAD if any(r["level"] == "위반 의심" for r in cc) else CHECK if issues else "충족", "item": "근로계약 점검",
                      "detail": " / ".join(f"{r['item']}: {r['detail']}" for r in issues) or "최저임금·근로시간·휴게·필수 기재사항 이상 없음",
                      "basis": "근로기준법·최저임금법 (규칙 점검)"})
    status = "보완 필요" if any(c["level"] == BAD for c in checklist) else "확인 필요" if any(c["level"] == CHECK for c in checklist) else "검토 대기"
    return {"case_id": f"C-{post['id']}-{app['id'].split('-')[-1]}-{hire:%m%d}", "company": post["company"], "region": post["region"],
            "title": post["title"], "worker": app["alias"], "hire_date": hire.isoformat(), "program": "청년일자리도약장려금",
            "evidence": evidence, "checklist": checklist, "contract": cc, "schedule": sch, "status": status, "source": "합성 데이터(시연)"}


# 시연용 과거 채용 건 (합성). 참여 이력 날짜가 채용일보다 앞서도록 따로 둔다.
DEMO = [
    ("JOB-04", "2026-03-03", {"id": "D-1", "alias": "정○○", "age": 26, "consent": True,
                              "programs": [{"type": "청년도전지원사업", "completed": "2026-01-30", "status": "수료"}], "insurance": []}),
    ("JOB-03", "2026-05-11", {"id": "D-2", "alias": "한○○", "age": 29, "consent": False,
                              "programs": [{"type": "국민취업지원제도", "qualified": "2025-11-03", "iap": "2025-11-17"}], "insurance": []}),
    ("JOB-09", "2026-04-01", {"id": "D-3", "alias": "오○○", "age": 25, "consent": True,
                              "programs": [{"type": "국민취업지원제도", "qualified": "2025-10-13", "iap": "2025-10-27"}], "insurance": []}),
]


def demo_cases(today: date | None = None) -> list[dict]:
    return [build_case(posting(jid), app, d(hd), today=today) for jid, hd, app in DEMO]


class handler(JsonHandler):
    def handle_get(self):
        return {"ok": True, "cases": demo_cases()}

    def handle_post(self):
        b = self.read_json()
        if not isinstance(b.get("posting"), dict):
            raise ApiError(400, "missing_input", "공고를 먼저 점검하세요.")
        post = parse_posting(b["posting"])
        app = resolve_applicant(post, text(b.get("applicant_id"), 20), b.get("my_application"))
        if not app:
            raise ApiError(400, "missing_input", "채용할 지원자를 선택하세요.")
        hire = d(b.get("hire_date"))
        if not hire:
            raise ApiError(400, "missing_input", "채용일(입사일)을 입력하세요.")
        contract = b.get("contract") if isinstance(b.get("contract"), dict) else None
        return {"ok": True, "case": build_case(post, app, hire, contract)}

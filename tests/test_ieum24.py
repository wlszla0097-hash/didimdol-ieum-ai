"""이음24 규칙엔진·차별 방지·AI 가드 테스트: python -m pytest tests"""
import json
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))
sys.path.insert(0, str(ROOT / "api"))
for k in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "WORK24_KEY"):
    os.environ.pop(k, None)

import pytest  # noqa: E402

import cases as case  # noqa: E402
import employer  # noqa: E402
import rules  # noqa: E402
import seeker  # noqa: E402
from common import ApiError  # noqa: E402
from match import guard  # noqa: E402
from synthetic import persona, posting  # noqa: E402

SEOUL = {"region": "서울 마포구", "emp_type": "정규직", "priority": True}
GUMI = {"region": "경북 구미시", "emp_type": "정규직", "priority": True}


def who(programs, insurance=(), age=27):
    return {"age": age, "programs": list(programs), "insurance": list(insurance)}


KUCHWI = {"type": "국민취업지원제도", "qualified": "2026-04-20", "iap": "2026-05-02"}
DOJEON = {"type": "청년도전지원사업", "completed": "2026-08-29"}


@pytest.mark.parametrize("person,expected", [
    (who([KUCHWI]), True),                                                     # 국취 참여 후 최초 취업
    (who([KUCHWI], [{"acquired": "2026-07-01", "lost": "2026-08-31"}]), False),  # 참여 후 취업 이력 있음
    (who([KUCHWI], [{"acquired": "2024-03-02", "lost": "2024-12-31"}]), True),   # 참여 전 이력은 무관
    (who([{"type": "국민취업지원제도", "qualified": "2026-04-20"}]), False),     # 취업활동계획 미수립
    (who([DOJEON]), True),                                                     # 청년도전 수료
    (who([]), False),                                                          # 일반 훈련만
    (who([DOJEON], age=36), False),                                            # 청년 연령 아님
])
def test_capital_badge_rule(person, expected):
    assert rules.judge(person, SEOUL, consent=True)["eligible"] is expected


def test_badge_requires_consent():
    j = rules.judge(who([DOJEON]), SEOUL, consent=False)
    assert j["eligible"] and not j["badge"]


def test_non_capital_and_non_regular_show_no_badge():
    assert rules.judge(who([DOJEON]), GUMI, True)["type"] == "non_capital"
    assert not rules.judge(who([DOJEON]), {**SEOUL, "emp_type": "계약직"}, True)["badge"]
    assert not rules.judge(who([DOJEON]), {**SEOUL, "priority": False}, True)["badge"]


def test_employer_view_hides_reason_and_age():
    out = employer.build({"posting_id": "JOB-01", "my_application": {"persona_id": "P-01", "consent": True}})
    raw = json.dumps(out["applicants"], ensure_ascii=False)
    for word in ("국민취업", "청년도전", "age", "programs", "insurance", "reason"):
        assert word not in raw
    assert [a["applied"] for a in out["applicants"]] == sorted(a["applied"] for a in out["applicants"])  # 지원일 순 고정
    me = [a for a in out["applicants"] if a["is_me"]][0]
    assert me["badge"] is True


def test_posting_check_flags():
    assert rules.posting_check(posting("JOB-09"))["verdict"] == "연계 어려움"   # 최저임금 미달
    assert rules.posting_check(posting("JOB-01"))["verdict"] == "연계 가능성 높음"
    assert rules.posting_check(posting("JOB-08"))["verdict"] == "확인 필요"      # 피보험자 5인 미만


def test_schedule_six_months():
    s = rules.schedule(date(2026, 8, 31), today=date(2026, 10, 10))
    assert s["six_month_date"] == "2027-02-28" and s["state"] == "고용유지 중"
    assert rules.schedule(date(2026, 3, 3), today=date(2026, 10, 10))["state"] == "신청 가능"


@pytest.mark.parametrize("text,ok", [
    ("React로 화면을 구현할 수 있습니다.", True),
    ("채용 시 지원금을 받을 수 있습니다.", False),   # 지원금 언급
    ("만 27세 청년입니다.", False),                  # 연령 언급
    ("480시간 훈련을 수료했습니다.", True),           # 입력에 있는 숫자
    ("3년 실무 경력이 있습니다.", False),             # 입력에 없는 숫자
])
def test_ai_guard(text, ok):
    assert (guard(text, "웹 개발 과정 480시간") is not None) is ok


def test_seeker_works_without_ai_and_excludes_arrears():
    out = seeker.run(seeker.validate_input({"persona_id": "P-03", "consent": True}))
    assert out["meta"]["ai_used"] is False and out["competencies"]
    assert "JOB-10" not in [j["id"] for j in out["jobs"]] and out["meta"]["excluded"]["arrears"] == 1
    with pytest.raises(ApiError):
        seeker.validate_input({"persona_id": ""})


def test_case_discloses_reason_only_with_consent():
    post = posting("JOB-01")
    me = {**persona("P-01"), "id": "JOB-01-ME", "alias": "김○○"}
    hire = date(2026, 10, 12)
    assert case.build_case(post, {**me, "consent": True}, hire)["evidence"]["open"] is True
    closed = case.build_case(post, {**me, "consent": False}, hire)["evidence"]
    assert closed["open"] is False and not any("국민취업" in line for line in closed["lines"])


def test_demo_cases_statuses():
    st = {c["company"]: c["status"] for c in case.demo_cases(today=date(2026, 10, 10))}
    assert st["가온유통 (가상)"] == "보완 필요" and st["세진정밀 (가상)"] == "검토 대기"


def test_contract_guard_blocks_invented_numbers():
    src = "최저임금: 환산 시급 9,569원 < 2026년 최저임금 10,320원 — 월 환산 최소 2,156,880원 필요"
    assert guard("월 2,150,000원 이상으로 인상하세요.", src, forbid=False) is None
    assert guard("월 2,156,880원 이상으로 인상하세요.", src, forbid=False)
    assert guard("최저임금 10,320원 미달이라 지원금 대상 확인 필요", src, forbid=False)  # 근로계약 설명은 금지어 검사 제외

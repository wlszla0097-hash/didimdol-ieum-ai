"""핵심 로직 테스트: python -m pytest tests"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))
sys.path.insert(0, str(ROOT / "api"))
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("DATA_GO_KR_KEY", None)

import pytest  # noqa: E402

import ai  # noqa: E402
import labor  # noqa: E402
import publicdata  # noqa: E402
import diagnose  # noqa: E402
from common import ApiError  # noqa: E402


def test_min_wage_209_hours():
    assert labor.monthly_hours(40) == 209
    ok = labor.check({"base_wage": 2156880, "weekly_hours": 40, "daily_hours": 8, "break_minutes": 60, "start_date": "2026-03-01",
                       "has_holiday": 1, "has_leave": 1, "has_place": 1, "has_job": 1, "has_payday": 1})
    assert all(r["level"] == "적정" for r in ok)


def test_violations_detected():
    res = {r["item"]: r["level"] for r in labor.check({"employment_type": "기간제", "base_wage": 2000000, "weekly_hours": 45,
                                                         "daily_hours": 9, "break_minutes": 30, "start_date": "2026-10-01"})}
    assert res["최저임금"] == "위반 의심"
    assert res["주 소정근로시간"] == "위반 의심"
    assert res["휴게시간"] == "위반 의심"
    assert res["근로계약기간"] == "위반 의심"
    assert res["필수 기재사항"] == "확인 필요"


def test_unknown_year_min_wage_needs_check():
    res = {r["item"]: r for r in labor.check({"base_wage": 3000000, "weekly_hours": 40, "start_date": "2027-01-02"})}
    assert res["최저임금"]["level"] == "확인 필요"


def test_sample_fallback_without_key():
    publicdata._cache.update(items=None)
    items, source = publicdata.load_programs()
    assert source == "sample" and len(items) >= 8


def test_shortlist_prefers_matching_programs():
    items, _ = publicdata.load_programs()
    top = publicdata.shortlist(items, {"hire_youth": True})
    assert top[0]["서비스명"] == "청년일자리도약장려금"


def test_input_validation():
    with pytest.raises(ApiError):
        diagnose.validate_input({"industry": "", "size": "5~29인", "hire_youth": True})
    with pytest.raises(ApiError):
        diagnose.validate_input({"industry": "제조업", "size": "5~29인"})  # 계획 없음
    assert diagnose.validate_input({"industry": "제조업", "size": "5~29인", "hire_youth": True})["hire_youth"]


def test_sanitize_drops_hallucinated_programs():
    items, _ = publicdata.load_programs()
    ai = {"summary": "요약", "recommendations": [{"id": "SAMPLE-01", "fit": "높음", "reason": "r", "check_items": ["a"], "next_step": "n"},
                                                 {"id": "FAKE-99", "fit": "높음", "reason": "없는 사업"}],
          "roadmap": [{"id": "FAKE-1", "when": "x"}, {"id": "SAMPLE-02", "when": "6개월 후", "note": "n"}], "missing_info": []}
    out, dropped = diagnose.sanitize(ai, items)
    assert [r["id"] for r in out["recommendations"]] == ["SAMPLE-01"]
    assert out["recommendations"][0]["name"] == "청년일자리도약장려금"  # 이름은 원본 데이터에서
    assert [s["id"] for s in out["roadmap"]] == ["SAMPLE-02"] and dropped == 2


def test_ai_not_configured_message():
    with pytest.raises(ApiError) as e:
        ai.generate_json("s", "u")
    assert e.value.code == "ai_not_configured"


def test_parse_json_from_wrapped_text():
    assert ai.parse_json('결과입니다 ```json\n{"a": 1}\n```')["a"] == 1
    with pytest.raises(ApiError):
        ai.parse_json("JSON 아님")

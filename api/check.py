"""POST /api/check — 근로조건 입력 → 규칙 엔진 점검 → AI 쉬운 설명.

판단(위반 의심/확인 필요/적정)은 규칙 엔진이 하고, AI는 그 결과만 설명한다.
AI가 실패해도 규칙 점검 결과는 항상 돌려준다.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core"))  # 공용 모듈 위치

from ai import generate_json, provider  # noqa: E402
from common import ApiError, JsonHandler, num, text  # noqa: E402
from labor import check  # noqa: E402

SYSTEM = """당신은 근로계약 점검 결과를 사업주에게 쉽게 설명하는 보조자입니다.
- [점검 결과]에 있는 내용만 설명하고, 새로운 위반 판단이나 수치를 추가하지 않습니다.
- 각 항목의 근거 조문은 점검 결과에 적힌 것만 사용합니다.
- 최종 판단은 노무 전문가·관할 기관 확인이 필요하다는 점을 한 문장으로 덧붙입니다.
출력은 JSON 하나만: {"summary": "전체 요약 2문장", "actions": [{"item": "점검 항목명", "explain": "쉬운 설명 1~2문장", "fix": "계약서 수정 제안 1문장"}]}
actions는 '위반 의심'과 '확인 필요' 항목만, 최대 6개입니다."""


def validate_input(b: dict) -> dict:
    f = {"employment_type": text(b.get("employment_type"), 10) or "정규직", "start_date": text(b.get("start_date"), 10),
         "end_date": text(b.get("end_date"), 10), "wage_type": text(b.get("wage_type"), 10) or "월급",
         "base_wage": num(b.get("base_wage")), "allowances": num(b.get("allowances")),
         "weekly_hours": num(b.get("weekly_hours")), "daily_hours": num(b.get("daily_hours")), "break_minutes": num(b.get("break_minutes"))}
    for k in ("has_holiday", "has_leave", "has_place", "has_job", "has_payday"):
        f[k] = bool(b.get(k))
    if f["base_wage"] is None or f["weekly_hours"] is None:
        raise ApiError(400, "missing_input", "기본급과 주 소정근로시간은 필수 입력입니다.")
    if f["base_wage"] <= 0 or not (0 < f["weekly_hours"] <= 80):
        raise ApiError(400, "invalid_input", "기본급은 0보다 크고, 주 소정근로시간은 0~80 사이로 입력하세요.")
    return f


class handler(JsonHandler):
    def handle_post(self):
        f = validate_input(self.read_json())
        results = check(f)
        issues = [r for r in results if r["level"] != "적정"]
        explain, ai_error = None, None
        if issues:
            try:
                ai = generate_json(SYSTEM, "[점검 결과]\n" + json.dumps(issues, ensure_ascii=False), max_tokens=1200)
                names = {r["item"] for r in issues}
                explain = {"summary": text(ai.get("summary"), 400),
                           "actions": [{"item": text(a.get("item"), 40), "explain": text(a.get("explain"), 300), "fix": text(a.get("fix"), 200)}
                                       for a in (ai.get("actions") or [])[:6] if a.get("item") in names]}  # 점검에 없는 항목은 버림
            except ApiError as e:
                ai_error = e.message
        return {"ok": True, "results": results, "explain": explain, "ai_error": ai_error, "meta": {"ai": provider()}}

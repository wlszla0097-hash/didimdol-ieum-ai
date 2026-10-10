"""기업 화면 — 공고 점검 + 지원자 목록(배지 표시).

GET  /api/employer            시연용 공고 목록
POST /api/employer            {"posting_id", "my_application": {"persona_id", "consent"}} → 공고 점검 + 지원자 목록

차별 방지 설계
- 기업에게는 지원자별 '지원제도 활용 가능' 표시 여부(true/false)만 보낸다. 사유(참여 사업)·연령은 응답에 넣지 않는다.
- 지원자 목록은 지원일 순서 고정. 배지 기준 정렬·필터 파라미터를 받지 않는다.
- 비수도권 공고는 지원자 표시 대신 공고 단위 안내만 한다.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core"))  # 공용 모듈 위치

from common import ApiError, JsonHandler, text  # noqa: E402
from rules import judge, posting_check  # noqa: E402
from synthetic import POSTINGS, applicants_for, persona, posting  # noqa: E402

PUBLIC_FIELDS = ("id", "company", "region", "title", "job", "emp_type", "wage", "weekly_hours", "insured", "priority", "close")


def employer_view(applicant: dict, post: dict) -> dict:
    j = judge(applicant, post, applicant.get("consent", False))
    return {"id": applicant["id"], "alias": applicant["alias"], "headline": applicant["headline"], "applied": applicant["applied"],
            "badge": bool(j["badge"]), "is_me": applicant.get("is_me", False)}  # ← 사유·연령·참여 이력은 넣지 않음


def build(body: dict) -> dict:
    post = posting(text(body.get("posting_id"), 10))
    if not post:
        raise ApiError(400, "missing_input", "점검할 공고를 선택하세요.")
    apps = applicants_for(post)
    mine = body.get("my_application") or {}
    me = persona(text(mine.get("persona_id"), 10)) if isinstance(mine, dict) else None
    if me:
        apps.append({**me, "id": f"{post['id']}-ME", "alias": f"지원자 {me['alias'][0]}○○ (시연: 나)", "consent": bool(mine.get("consent")),
                     "headline": text(mine.get("headline"), 160) or f"{me['desire']['job']} 직무 희망",
                     "applied": "2026-10-10", "is_me": True})
    check = posting_check(post)
    view = [employer_view(a, post) for a in sorted(apps, key=lambda a: a["applied"])]
    note = ("비수도권 공고: 청년 채용 시 취업애로 요건 없이 활용 가능할 수 있어 지원자별 표시는 하지 않습니다."
            if check["region_type"] == "non_capital" else
            "'지원제도 활용 가능' 표시는 본인이 동의한 지원자에게만 보이는 예상 신호입니다. 사유는 채용 확정 후 신청 단계에서만 공개되며, 최종 확인은 고용센터가 합니다.")
    return {"ok": True, "posting": {k: post.get(k) for k in PUBLIC_FIELDS}, "check": check, "applicants": view, "note": note}


class handler(JsonHandler):
    def handle_get(self):
        return {"ok": True, "postings": [{k: p.get(k) for k in PUBLIC_FIELDS} for p in POSTINGS]}

    def handle_post(self):
        return build(self.read_json())

"""POST /api/diagnose — 기업 정보 → 공공데이터 후보 → AI 맞춤 진단·로드맵.

할루시네이션 방지: AI는 서버가 넘긴 후보 목록 안에서만 고를 수 있고,
목록에 없는 사업 ID를 답하면 서버가 버린다. 링크·사업명은 공공데이터 원본을 사용한다.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core"))  # 공용 모듈 위치

from ai import generate_json, model_name, provider  # noqa: E402
from common import ApiError, JsonHandler, text  # noqa: E402
from publicdata import load_programs, shortlist  # noqa: E402

SIZES = ["5인 미만", "5~29인", "30~99인", "100~299인", "300인 이상"]
FLAGS = ["hire_youth", "hire_senior", "hire_disabled", "convert_regular", "flexible_work", "parental", "training", "keep_employment"]

SYSTEM = """당신은 한국 고용지원사업 안내 보조자입니다. 아래 규칙을 반드시 지킵니다.
1. 추천은 반드시 [후보 목록]에 있는 사업의 id만 사용합니다. 목록에 없는 사업은 언급하지 않습니다.
2. 후보 정보에 없는 금액·기간·연령 등 구체 수치를 만들어내지 않습니다.
3. 요건 충족 여부가 기업 정보만으로 불확실하면 fit을 "확인 필요"로 하고 check_items에 확인할 요건을 적습니다.
4. 최종 자격은 소관기관 심사로 확정된다는 전제에서 안내합니다.
5. 출력은 아래 JSON 하나만, 한국어로 작성합니다.
{"summary": "기업 상황 요약과 전체 안내 2~3문장",
 "recommendations": [{"id": "후보 id", "fit": "높음|보통|확인 필요", "reason": "추천 이유 1~2문장", "check_items": ["확인할 요건"], "next_step": "지금 할 일 1문장"}],
 "roadmap": [{"order": 1, "id": "후보 id", "when": "언제(예: 채용 직후, 6개월 고용유지 후)", "note": "연계 포인트·중복지원 주의 1문장"}],
 "missing_info": ["진단 정확도를 높이려면 추가로 필요한 기업 정보"]}
recommendations는 최대 5개, roadmap은 최대 4단계입니다."""


def validate_input(body: dict) -> dict:
    p = {"industry": text(body.get("industry"), 40), "size": text(body.get("size"), 20), "region": text(body.get("region"), 20),
         "current": text(body.get("current"), 200), "plan": text(body.get("plan"), 500)}
    for f in FLAGS:
        p[f] = bool(body.get(f))
    if not p["industry"] or p["size"] not in SIZES:
        raise ApiError(400, "missing_input", "업종과 상시근로자 규모는 필수 입력입니다.")
    if not any(p[f] for f in FLAGS) and not p["plan"]:
        raise ApiError(400, "missing_input", "관심 있는 계획을 하나 이상 선택하거나 계획을 적어 주세요.")
    return p


def build_prompt(profile: dict, cands: list[dict]) -> str:
    labels = {"hire_youth": "청년 채용", "hire_senior": "고령자·신중년 채용", "hire_disabled": "장애인 채용", "convert_regular": "비정규직의 정규직 전환",
              "flexible_work": "유연근무(선택근무 등) 도입", "parental": "육아휴직·대체인력", "training": "직원 교육훈련", "keep_employment": "고용 유지·계속고용"}
    plans = [labels[f] for f in FLAGS if profile[f]]
    comp = {"업종": profile["industry"], "상시근로자": profile["size"], "지역": profile["region"] or "미입력",
            "현재 참여 중인 지원사업": profile["current"] or "없음", "계획": plans, "추가 설명": profile["plan"] or "없음"}
    cand = [{"id": c["서비스ID"], "사업명": c["서비스명"], "기관": c["소관기관명"], "요약": c["서비스목적요약"][:200],
             "지원대상": c["지원대상"][:300], "선정기준": c["선정기준"][:400], "지원내용": c["지원내용"][:300]} for c in cands]
    return f"[기업 정보]\n{json.dumps(comp, ensure_ascii=False)}\n\n[후보 목록]\n{json.dumps(cand, ensure_ascii=False)}"


def sanitize(ai: dict, cands: list[dict]) -> tuple[dict, int]:
    """AI 결과에서 후보에 없는 id 제거, 표시용 원본 정보(사업명·링크)를 서버가 붙인다."""
    by_id = {c["서비스ID"]: c for c in cands}
    dropped = 0
    recs = []
    for r in (ai.get("recommendations") or [])[:5]:
        c = by_id.get(str(r.get("id")))
        if not c:
            dropped += 1
            continue
        fit = r.get("fit") if r.get("fit") in ("높음", "보통", "확인 필요") else "확인 필요"
        recs.append({"id": c["서비스ID"], "name": c["서비스명"], "agency": c["소관기관명"], "url": c["상세조회URL"],
                     "fit": fit, "reason": text(r.get("reason"), 300), "next_step": text(r.get("next_step"), 200),
                     "check_items": [text(x, 150) for x in (r.get("check_items") or [])[:5]],
                     "source": {"target": c["지원대상"][:300], "support": c["지원내용"][:300]}})
    road = []
    for i, s in enumerate((ai.get("roadmap") or [])[:4], 1):
        c = by_id.get(str(s.get("id")))
        if not c:
            dropped += 1
            continue
        road.append({"order": i, "id": c["서비스ID"], "name": c["서비스명"], "when": text(s.get("when"), 80), "note": text(s.get("note"), 200)})
    return {"summary": text(ai.get("summary"), 500), "recommendations": recs, "roadmap": road,
            "missing_info": [text(x, 150) for x in (ai.get("missing_info") or [])[:5]]}, dropped


class handler(JsonHandler):
    def handle_post(self):
        profile = validate_input(self.read_json())
        programs, source = load_programs()
        cands = shortlist(programs, profile)
        ai = generate_json(SYSTEM, build_prompt(profile, cands), max_tokens=1800)
        result, dropped = sanitize(ai, cands)
        if not result["recommendations"]:
            raise ApiError(502, "ai_empty", "추천 결과를 만들지 못했습니다. 입력을 조금 더 구체적으로 적어 다시 시도하세요.")
        return {"ok": True, "result": result, "meta": {"data_source": source, "candidates": len(cands),
                "dropped_unverified": dropped, "ai": provider(), "model": model_name()}}

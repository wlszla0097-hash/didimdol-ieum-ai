"""공공데이터 연동: 행정안전부_대한민국 공공서비스(혜택) 정보 (공공데이터포털, api.odcloud.kr).

DATA_GO_KR_KEY 환경 변수(공공데이터포털 일반 인증키)가 없거나 호출이 실패하면
내장된 예시 데이터(_sample.py)로 대체하고, 화면에 그 사실을 표시한다.
"""
import http.client
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from _sample import SAMPLE_PROGRAMS

BASE = os.environ.get("ODCLOUD_BASE_URL", "https://api.odcloud.kr/api/gov24/v3")
AGENCIES = ["고용노동부", "보건복지부"]
EMPLOYER_WORDS = ["사업주", "기업", "사업장", "법인", "고용주", "중소"]
FIELDS = ["서비스ID", "서비스명", "서비스목적요약", "지원대상", "선정기준", "지원내용", "신청방법", "신청기한", "소관기관명", "상세조회URL", "사용자구분", "서비스분야"]
CACHE_SECONDS = 6 * 3600
_cache: dict = {"at": 0.0, "items": None, "source": None}


def _fetch(agency: str, key: str) -> list[dict]:
    q = urllib.parse.urlencode({"page": 1, "perPage": 500, "returnType": "JSON", "serviceKey": key,
                                "cond[소관기관명::LIKE]": agency})
    with urllib.request.urlopen(f"{BASE}/serviceList?{q}", timeout=8) as r:
        data = json.loads(r.read())
    return data.get("data") or []


def _is_employer_program(item: dict) -> bool:
    target = f"{item.get('지원대상', '')} {item.get('사용자구분', '')} {item.get('선정기준', '')}"
    return any(w in target for w in EMPLOYER_WORDS)


def _clean(item: dict, source: str) -> dict:
    out = {k: str(item.get(k) or "").strip() for k in FIELDS}
    out["source"] = source
    return out


def load_programs() -> tuple[list[dict], str]:
    """(사업주 대상 지원사업 목록, 출처 'live'|'sample')."""
    if _cache["items"] is not None and time.time() - _cache["at"] < CACHE_SECONDS:
        return _cache["items"], _cache["source"]
    key = os.environ.get("DATA_GO_KR_KEY")
    items, source = [], "sample"
    if key:
        try:
            for agency in AGENCIES:
                items += [_clean(i, "live") for i in _fetch(agency, key) if _is_employer_program(i)]
            source = "live" if items else "sample"
        except (OSError, http.client.HTTPException, json.JSONDecodeError, ValueError) as e:
            print("[publicdata] 실패 → 예시 데이터 사용:", repr(e))
            items = []
    if not items:
        items, source = [_clean(i, "sample") for i in SAMPLE_PROGRAMS], "sample"
    seen, uniq = set(), []
    for i in items:
        if i["서비스ID"] not in seen:
            seen.add(i["서비스ID"])
            uniq.append(i)
    _cache.update(at=time.time(), items=uniq, source=source)
    return uniq, source


def search(programs: list[dict], keyword: str) -> list[dict]:
    kw = keyword.strip()
    if not kw:
        return programs
    words = kw.split()
    return [p for p in programs if all(w in f"{p['서비스명']} {p['서비스목적요약']} {p['지원대상']} {p['지원내용']}" for w in words)]


# 기업 진단 입력 → 관련 키워드 (AI에 넘길 후보를 먼저 규칙으로 좁힌다)
SIGNALS = {
    "hire_youth": ["청년"],
    "hire_senior": ["고령", "신중년", "시니어", "중장년", "노인"],
    "hire_disabled": ["장애인"],
    "convert_regular": ["정규직"],
    "flexible_work": ["유연근무", "일·생활", "일생활", "선택근무", "재택", "워라밸", "근로시간 단축"],
    "parental": ["육아", "출산", "대체인력"],
    "training": ["훈련", "능력개발"],
    "keep_employment": ["고용유지", "계속고용", "고용안정"],
}


def shortlist(programs: list[dict], profile: dict, limit: int = 12) -> list[dict]:
    wanted = [w for k, words in SIGNALS.items() if profile.get(k) for w in words]
    def score(p):
        blob = f"{p['서비스명']} {p['서비스목적요약']} {p['지원대상']} {p['지원내용']}"
        s = sum(3 for w in wanted if w in p["서비스명"]) + sum(1 for w in wanted if w in blob)
        if "장려금" in p["서비스명"] or "지원금" in p["서비스명"]:
            s += 1
        return s
    ranked = sorted(programs, key=score, reverse=True)
    return [p for p in ranked if score(p) > 0][:limit] or ranked[:limit]

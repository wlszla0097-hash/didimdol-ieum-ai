"""GET /api/programs?q=키워드 — 사업주 대상 고용지원사업 목록 (공공데이터, AI 미사용). 내부 모드 전용."""
import os
import sys
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core"))  # 공용 모듈 위치

from auth import require  # noqa: E402
from common import JsonHandler, text  # noqa: E402
from publicdata import load_programs, search  # noqa: E402


class handler(JsonHandler):
    def handle_get(self):
        require(self.headers.get("x-internal-token"))
        q = text(parse_qs(urlparse(self.path).query).get("q", [""])[0], 40)
        programs, source = load_programs()
        found = search(programs, q)
        items = [{"id": p["서비스ID"], "name": p["서비스명"], "agency": p["소관기관명"], "summary": p["서비스목적요약"][:200],
                  "target": p["지원대상"][:300], "support": p["지원내용"][:300], "apply": p["신청방법"][:150],
                  "deadline": p["신청기한"][:100], "url": p["상세조회URL"]} for p in found[:60]]
        return {"ok": True, "items": items, "total": len(found), "meta": {"data_source": source}}

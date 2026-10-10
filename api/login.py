"""POST /api/login {"password"} — 내부 모드 로그인 (지원사업 진단). 1분 5회 제한."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core"))  # 공용 모듈 위치

from auth import enabled, login  # noqa: E402
from common import ApiError, JsonHandler, rate_limited  # noqa: E402


class handler(JsonHandler):
    def handle_get(self):
        return {"ok": True, "enabled": enabled()}

    def handle_post(self):
        if rate_limited("login:" + self._client_ip(), limit=5):
            raise ApiError(429, "rate_limited", "로그인 시도가 너무 많습니다. 1분 후 다시 시도하세요.")
        return {"ok": True, **login(self.read_json().get("password"))}

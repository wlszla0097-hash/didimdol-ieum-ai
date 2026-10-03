"""GET /api/health — 연동 상태 확인 (키 값은 절대 내보내지 않고 설정 여부만)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from _ai import model_name, provider  # noqa: E402
from _common import JsonHandler  # noqa: E402


class handler(JsonHandler):
    def handle_get(self):
        return {"ok": True, "ai": provider() or "not_configured", "model": model_name() if provider() else None,
                "public_data": "configured" if os.environ.get("DATA_GO_KR_KEY") else "sample_only"}

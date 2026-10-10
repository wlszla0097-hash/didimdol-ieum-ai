"""GET /api/health — 연동 상태 확인 (키 값은 절대 내보내지 않고 설정 여부만)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "core"))  # 공용 모듈 위치

from ai import model_name, provider  # noqa: E402
from common import JsonHandler  # noqa: E402


class handler(JsonHandler):
    def handle_get(self):
        return {"ok": True, "ai": provider() or "not_configured", "model": model_name() if provider() else None,
                "public_data": "configured" if os.environ.get("DATA_GO_KR_KEY") else "sample_only",
                "work24": "configured" if os.environ.get("WORK24_KEY") else "synthetic",
                # 키 값은 내보내지 않고 '등록됨/비어 있음/없음'만 표시 (설정 오류 진단용)
                "keys": {k: ({"status": "set", "prefix_ok": os.environ[k].strip().strip('"').strip("'").startswith("sk-ant-" if "ANTHROPIC" in k else "AI"),
                              "had_spaces": os.environ[k] != os.environ[k].strip(),
                              "length": len(os.environ[k].strip()), "contains_sk_ant": "sk-ant-" in os.environ[k],
                              "starts_with_name": os.environ[k].strip().upper().startswith(k)}
                             if os.environ.get(k, "").strip() else "empty" if k in os.environ else "missing")
                         for k in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY")}}

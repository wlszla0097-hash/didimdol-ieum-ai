"""api/ 함수들이 함께 쓰는 도구. (core/ 폴더는 URL로 노출되지 않는 공용 모듈)"""
import json
import time
from http.server import BaseHTTPRequestHandler

MAX_BODY = 20_000  # 요청 본문 최대 20KB (긴 입력·남용 방지)

_hits: dict[str, list[float]] = {}


def rate_limited(ip: str, limit: int = 10, window: int = 60) -> bool:
    """같은 서버 인스턴스 안에서 IP당 1분 10회로 제한 (AI 과금 보호용, 최선 노력 방식)."""
    now = time.time()
    hits = [t for t in _hits.get(ip, []) if now - t < window]
    hits.append(now)
    _hits[ip] = hits
    return len(hits) > limit


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class JsonHandler(BaseHTTPRequestHandler):
    """JSON 요청/응답 공통 처리. 하위 클래스는 handle_get / handle_post 를 구현."""

    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _client_ip(self) -> str:
        fwd = self.headers.get("x-forwarded-for", "")
        return fwd.split(",")[0].strip() or (self.client_address[0] if self.client_address else "unknown")

    def _run(self, fn):
        try:
            self._send(200, fn())
        except ApiError as e:
            self._send(e.status, {"ok": False, "error": e.code, "message": e.message})
        except Exception as e:  # 예상 못한 오류도 JSON으로 안내
            print("[server error]", repr(e))
            self._send(500, {"ok": False, "error": "server_error", "message": "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요."})

    def read_json(self, max_body: int = MAX_BODY) -> dict:
        length = int(self.headers.get("content-length") or 0)
        if length > max_body:
            raise ApiError(413, "too_large", "입력 내용이 너무 깁니다. 줄여서 다시 시도하세요.")
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            raise ApiError(400, "bad_json", "요청 형식이 올바르지 않습니다.")
        if not isinstance(data, dict):
            raise ApiError(400, "bad_json", "요청 형식이 올바르지 않습니다.")
        return data

    def do_GET(self):
        self._run(self.handle_get)

    def do_POST(self):
        if rate_limited(self._client_ip()):
            return self._send(429, {"ok": False, "error": "rate_limited", "message": "요청이 너무 많습니다. 1분 후 다시 시도하세요."})
        self._run(self.handle_post)

    def handle_get(self):
        raise ApiError(405, "method_not_allowed", "지원하지 않는 요청 방식입니다.")

    def handle_post(self):
        raise ApiError(405, "method_not_allowed", "지원하지 않는 요청 방식입니다.")

    def log_message(self, *args):  # 기본 접근 로그 끄기
        pass


def text(v, limit: int = 200) -> str:
    """입력값을 문자열로 정리하고 길이를 제한."""
    return str(v if v is not None else "").strip()[:limit]


def num(v):
    try:
        if v in (None, ""):
            return None
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None

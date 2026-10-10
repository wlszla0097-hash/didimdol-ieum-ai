"""내부 모드(디딤돌파트너스 전용) 인증 — 비밀번호는 환경 변수 INTERNAL_PASSWORD 에만 둔다.

로그인하면 8시간짜리 서명 토큰을 준다. 서버에 세션·고객 데이터를 저장하지 않는다.
비밀번호를 바꾸면 이전 토큰은 모두 무효가 된다.
"""
import base64
import hashlib
import hmac
import os
import time

from common import ApiError

TTL = 8 * 3600


def _secret() -> bytes | None:
    pw = (os.environ.get("INTERNAL_PASSWORD") or "").strip()
    return hashlib.sha256(f"ieum24-internal:{pw}".encode()).digest() if pw else None


def enabled() -> bool:
    return _secret() is not None


def login(password: str) -> dict:
    key = _secret()
    if not key:
        raise ApiError(503, "internal_off", "내부 모드가 설정되지 않았습니다. (관리자: Vercel 환경 변수 INTERNAL_PASSWORD 등록 후 재배포)")
    expected = (os.environ.get("INTERNAL_PASSWORD") or "").strip()
    if not hmac.compare_digest(str(password or "").strip().encode(), expected.encode()):
        raise ApiError(401, "bad_password", "비밀번호가 올바르지 않습니다.")
    exp = int(time.time()) + TTL
    sig = hmac.new(key, str(exp).encode(), hashlib.sha256).digest()
    token = f"{exp}.{base64.urlsafe_b64encode(sig).decode().rstrip('=')}"
    return {"token": token, "expires": exp}


def require(token: str | None) -> None:
    """내부 API 호출 전 토큰 확인. 실패 시 401."""
    key = _secret()
    if not key:
        raise ApiError(503, "internal_off", "내부 모드가 설정되지 않았습니다.")
    try:
        exp_s, sig_s = str(token or "").split(".", 1)
        exp = int(exp_s)
        sig = base64.urlsafe_b64decode(sig_s + "=" * (-len(sig_s) % 4))
    except (ValueError, TypeError):
        raise ApiError(401, "need_login", "내부 모드 로그인이 필요합니다.")
    good = hmac.new(key, exp_s.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(sig, good) or exp < time.time():
        raise ApiError(401, "need_login", "로그인이 만료되었거나 올바르지 않습니다. 다시 로그인하세요.")

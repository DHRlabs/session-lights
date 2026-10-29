"""session-lights: a status emoji at the front of a Hermes session's stored title.

Same emoji set and meaning as the Claude plugin in ../claude/hooks/register.ts:
  working, waiting on a tool approval, waiting on a clarify question, then at turn end the last
  green, yellow or red light in the reply (white when there is none), or a warning on error.

Native Hermes hooks only. The title is written through SessionDB.set_session_title for the session
the hook fired for, and nothing is written for a session that has no title yet, so Hermes can still
name it. A hook never raises: any failure is swallowed so a turn is never broken by a light.
"""

from __future__ import annotations

import logging
import re
import threading

log = logging.getLogger(__name__)

WORKING = "⚙️"
PERMISSION = "\U0001f510"
QUESTION = "❓"
NO_LIGHT = "⚪"
FAILED = "⚠️"

_TICKER = re.compile("[\U0001f7e2\U0001f7e1\U0001f534]")
_PREFIX = re.compile(
    "^(?:(?:⚙️?|\U0001f510|❓|⚪|⚠️?|\U0001f7e2|\U0001f7e1|\U0001f534)\\s*)+"
)

_lock = threading.Lock()
_current = ""  # session of the most recent main-session pre_llm_call in this process
_children: set[str] = set()  # subagent sessions, never lit
_waiting: dict[str, dict[str, str]] = {}  # session_id -> {request_id: light}


def _write(session_id: str, light: str) -> None:
    if not session_id:
        return
    try:
        from hermes_state_registry import acquire, release_or_close

        db = acquire()
        try:
            title = db.get_session_title(session_id)
            if not title:
                return  # no title yet: leave it to Hermes auto-titling
            base = _PREFIX.sub("", title)
            if not base or title == f"{light} {base}":
                return
            db.set_session_title(session_id, f"{light} {base}")
        finally:
            release_or_close(db)
    except Exception:
        log.debug("session-lights: title write skipped", exc_info=True)


def _on_turn_start(session_id="", parent_session_id="", **_):
    global _current
    try:
        if not session_id:
            return None
        if parent_session_id:
            with _lock:
                _children.add(session_id)
            return None
        with _lock:
            _current = session_id
            _children.discard(session_id)
            _waiting.pop(session_id, None)
        _write(session_id, WORKING)
    except Exception:
        log.debug("session-lights: pre_llm_call failed", exc_info=True)
    return None


def _on_turn_end(session_id="", assistant_response="", **_):
    try:
        with _lock:
            if not session_id or session_id in _children:
                return None
            _waiting.pop(session_id, None)
        lights = _TICKER.findall(assistant_response if isinstance(assistant_response, str) else "")
        _write(session_id, lights[-1] if lights else NO_LIGHT)
    except Exception:
        log.debug("session-lights: post_llm_call failed", exc_info=True)
    return None


def _on_session_end(session_id="", failed=False, interrupted=False, **_):
    try:
        with _lock:
            if not session_id or session_id in _children:
                return None
            _waiting.pop(session_id, None)
        if failed:
            _write(session_id, FAILED)
        elif interrupted:
            _write(session_id, NO_LIGHT)
    except Exception:
        log.debug("session-lights: on_session_end failed", exc_info=True)
    return None


def _on_api_error(session_id="", retryable=None, retry_count=None, max_retries=None, **_):
    # A request error that will not be retried can end the turn before on_session_end fires.
    try:
        with _lock:
            if not session_id or session_id in _children:
                return None
        out_of_retries = retry_count is not None and max_retries is not None and retry_count + 1 >= max_retries
        if retryable is False or out_of_retries:
            _write(session_id, FAILED)
    except Exception:
        log.debug("session-lights: api_request_error failed", exc_info=True)
    return None


def _on_wait(kind="", session_id="", request_id="", **_):
    try:
        light = PERMISSION if kind == "approval" else QUESTION if kind == "clarify" else ""
        with _lock:
            sid = session_id or _current
            if not light or not sid or sid in _children:
                return None
            _waiting.setdefault(sid, {})[request_id or ""] = light
        _write(sid, light)
    except Exception:
        log.debug("session-lights: on_human_input_request failed", exc_info=True)
    return None


def _on_resolved(kind="", session_id="", request_id="", **_):
    try:
        with _lock:
            sid = session_id or _current
            if not sid or sid in _children:
                return None
            pending = _waiting.get(sid)
            if pending is None or (request_id or "") not in pending:
                return None  # not a wait we lit
            del pending[request_id or ""]
            light = next(reversed(pending.values()), WORKING)
            if not pending:
                del _waiting[sid]
        _write(sid, light)
    except Exception:
        log.debug("session-lights: on_human_input_resolved failed", exc_info=True)
    return None


def register(ctx):
    ctx.register_hook("pre_llm_call", _on_turn_start)
    ctx.register_hook("on_human_input_request", _on_wait)
    ctx.register_hook("on_human_input_resolved", _on_resolved)
    ctx.register_hook("post_llm_call", _on_turn_end)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("api_request_error", _on_api_error)

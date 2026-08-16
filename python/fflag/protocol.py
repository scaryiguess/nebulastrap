from __future__ import annotations

import io
import json
import sys
import threading
from typing import Any, Dict, Iterator, Optional

class Protocol:

    def __init__(self, stream=None, source=None):
        self._out = stream if stream is not None else sys.stdout
        self._in = source if source is not None else sys.stdin
        self._write_lock = threading.Lock()

    def _emit(self, payload: Dict[str, Any]) -> None:
        try:
            line = json.dumps(payload, ensure_ascii=False, default=str)
        except Exception:
            return
        with self._write_lock:
            try:
                self._out.write(line + "\n")
                self._out.flush()
            except Exception:
                pass

    def event(self, name: str, **fields: Any) -> None:
        self._emit({"ev": name, **fields})

    def log(self, message: str, level: str = "info") -> None:
        self.event("log", msg=message, level=level)

    def reply(self, request_id: Optional[int], ok: bool = True, **fields: Any) -> None:
        if request_id is None:
            return
        self._emit({"id": request_id, "ok": ok, **fields})

    def requests(self) -> Iterator[Dict[str, Any]]:
        while True:
            try:
                line = self._in.readline()
            except (EOFError, KeyboardInterrupt):
                return
            except Exception as exc:
                self.log("[!] stdin read failed: %s" % str(exc)[:120], "warning")
                continue
            if not line:
                return
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if isinstance(message, dict):
                yield message

def utf8_stdout() -> None:
    try:
        sys.stdout = io.TextIOWrapper(
            sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True
        )
    except Exception:
        pass

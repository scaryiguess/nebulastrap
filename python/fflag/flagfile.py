from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

MAX_FILE_BYTES = 64 * 1024 * 1024

_COMMENT_RE = re.compile(r"(?m)(?<![:/])//[^\r\n]*|^[ \t]*#[^\r\n]*")

_NAME = r"(?:S?D?F(?:Flag|Int|String|Log|Float|Double|Variable))[A-Za-z0-9_]*"

_ASSIGNMENT_RE = re.compile(
    r"\b(" + _NAME + r")\b"
    r"[\"']?"
    r"\s*(?P<sep>[:=])?\s*"
    r"(?:\"(?P<dq>[^\"\r\n]*)\""
    r"|'(?P<sq>[^'\r\n]*)'"
    r"|\b(?P<word>[Tt]rue|[Ff]alse)\b"
    r"|(?P<num>-?\d+(?:\.\d+)?)\b"
    r"|(?P<bare>[A-Za-z0-9_./-]+))?"
)

_FLAG_NAME_RE = re.compile(r"^" + _NAME + r"$")

_PAIR_RE = re.compile(
    r"^[\"']?(?P<name>[A-Za-z_][A-Za-z0-9_]*)[\"']?"
    r"\s*(?P<sep>[:=])?\s*"
    r"(?P<value>.*?)"
    r"\s*[,;]?$"
)

def _is_flag_name(name: str) -> bool:
    return bool(_FLAG_NAME_RE.match(name))

def _unquote(text: str) -> str:
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    return text

class LoadResult:

    __slots__ = ("flags", "source", "note")

    def __init__(self, flags: Dict[str, Any], source: str, note: str = ""):
        self.flags = flags
        self.source = source
        self.note = note

    def __len__(self) -> int:
        return len(self.flags)

def read_text(path: str) -> Optional[str]:
    try:
        if Path(path).stat().st_size > MAX_FILE_BYTES:
            return None
        with open(path, "rb") as handle:
            raw = handle.read()
    except OSError:
        return None

    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return raw.decode(encoding)
        except (UnicodeError, LookupError):
            continue
    return raw.decode("utf-8", errors="ignore")

def _coerce(text: str) -> Any:
    low = text.lower()
    if low == "true":
        return True
    if low == "false":
        return False
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        return text

def from_json(text: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(text)
    except ValueError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(name): value for name, value in parsed.items()}

def from_pairs(text: str) -> Dict[str, Any]:
    found: Dict[str, Any] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        if line in ("{", "}", "[", "]", "},", "],"):
            continue

        match = _PAIR_RE.match(line)
        if not match:
            continue
        name = match.group("name")
        separator = match.group("sep")
        written = match.group("value").strip()
        quoted = len(written) >= 2 and written[0] == written[-1] and written[0] in "\"'"
        value = _unquote(written)

        if not separator and not _is_flag_name(name):
            continue
        if not value:
            if not _is_flag_name(name):
                continue
            found[name] = True
            continue

        settled = _coerce(value)
        if not _is_flag_name(name):
            if quoted or isinstance(settled, str):
                continue
        found[name] = settled
    return found

def from_scan(text: str) -> Dict[str, Any]:
    found: Dict[str, Any] = {}
    for match in _ASSIGNMENT_RE.finditer(text):
        name = match.group(1)
        if name in found:
            continue
        if match.group("dq") is not None:
            value: Any = match.group("dq")
        elif match.group("sq") is not None:
            value = match.group("sq")
        elif match.group("word") is not None:
            value = match.group("word").lower() == "true"
        elif match.group("num") is not None:
            number = match.group("num")
            value = float(number) if "." in number else int(number)
        elif match.group("sep") and match.group("bare"):
            bare = match.group("bare").rstrip(".,;)")
            if not bare:
                continue
            value = bare
        else:
            continue
        found[name] = value
    return found

def collect(text: str) -> Tuple[Dict[str, Any], List[str]]:
    exported = from_json(text)
    if exported:
        return exported, ["json"]

    body = _COMMENT_RE.sub(" ", text)
    layers = (("scan", from_scan), ("pairs", from_pairs))
    flags: Dict[str, Any] = {}
    used: List[str] = []
    for source, reader in layers:
        try:
            found = reader(body)
        except MemoryError:
            raise
        except Exception:
            continue
        if found:
            used.append(source)
            flags.update(found)
    used.reverse()
    return flags, used

def load(path: str) -> LoadResult:
    text = read_text(path)
    if text is None:
        return LoadResult({}, "none", "unreadable or larger than 64 MB")

    try:
        flags, used = collect(text)
    except MemoryError:
        return LoadResult({}, "none", "ran out of memory reading the file")

    if not flags:
        return LoadResult({}, "none", "no FFlags found")
    return LoadResult(flags, "+".join(used))

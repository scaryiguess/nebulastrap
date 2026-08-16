from __future__ import annotations

import struct
from typing import Any, Callable, Dict, Optional, Tuple

TRUTHY = frozenset({"true", "1", "yes", "on", "enabled"})
FALSEY = frozenset({"false", "0", "no", "off", "disabled"})

INT32_MIN = -(2 ** 31)
INT32_MAX = 2 ** 31 - 1
MAX_STRING_BYTES = 255

class Codec:

    __slots__ = ("kind", "size", "_encode", "_decode", "default")

    def __init__(self, kind, size, encode, decode, default):
        self.kind = kind
        self.size = size
        self._encode = encode
        self._decode = decode
        self.default = default

    def encode(self, value: Any) -> Optional[bytes]:
        try:
            return self._encode(_as_text(value))
        except (ValueError, TypeError, OverflowError, struct.error):
            return None

    def decode(self, raw: bytes) -> Any:
        try:
            return self._decode(raw)
        except (ValueError, TypeError, struct.error, UnicodeError):
            return None

    def matches(self, raw: bytes, value: Any) -> bool:
        wanted = self.encode(value)
        if wanted is None or raw is None:
            return True
        if self.kind == "string":
            return _read_c_string(raw) == _read_c_string(wanted)
        if self.kind in ("float", "double"):
            current, expected = self.decode(raw), self.decode(wanted)
            if current is None or expected is None:
                return True
            return abs(current - expected) <= 1e-4
        return raw[: len(wanted)] == wanted

    def __repr__(self) -> str:
        return "<Codec %s/%d>" % (self.kind, self.size)

def _as_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).strip()

def _read_c_string(raw: bytes) -> str:
    terminator = raw.find(b"\x00")
    body = raw if terminator == -1 else raw[:terminator]
    return body.decode("utf-8", errors="ignore")

def _to_bool_bytes(text: str) -> bytes:
    return b"\x01" if text.lower() in TRUTHY else b"\x00"

def _to_int_bytes(text: str) -> bytes:
    low = text.lower()
    if low in TRUTHY:
        number = 1
    elif low in FALSEY:
        number = 0
    else:
        number = int(float(text))
    number = max(INT32_MIN, min(INT32_MAX, number))
    return number.to_bytes(4, "little", signed=True)

def _to_float_bytes(text: str) -> bytes:
    return struct.pack("<f", float(text))

def _to_double_bytes(text: str) -> bytes:
    return struct.pack("<d", float(text))

def _to_string_bytes(text: str) -> bytes:
    return text.encode("utf-8")[:MAX_STRING_BYTES] + b"\x00"

BOOL = Codec("bool", 1, _to_bool_bytes, lambda raw: bool(raw[0]), b"\x00")
INT = Codec("int", 4, _to_int_bytes, lambda raw: struct.unpack("<i", raw[:4])[0],
            (0).to_bytes(4, "little", signed=True))
FLOAT = Codec("float", 4, _to_float_bytes, lambda raw: struct.unpack("<f", raw[:4])[0],
              struct.pack("<f", 0.0))
DOUBLE = Codec("double", 8, _to_double_bytes, lambda raw: struct.unpack("<d", raw[:8])[0],
               struct.pack("<d", 0.0))
STRING = Codec("string", 128, _to_string_bytes, _read_c_string, b"\x00")

def _to_auto_bytes(text: str) -> bytes:
    low = text.lower()
    if low in TRUTHY or low in FALSEY:
        return _to_bool_bytes(text)
    try:
        return _to_int_bytes(text)
    except (ValueError, TypeError):
        return _to_string_bytes(text)

AUTO = Codec("auto", 128, _to_auto_bytes, _read_c_string, b"\x00")

_SCOPES = ("SD", "D", "S", "")
_FAMILIES = (
    ("String", STRING),
    ("Double", DOUBLE),
    ("Float", FLOAT),
    ("Variable", AUTO),
    ("Flag", BOOL),
    ("Log", INT),
    ("Int", INT),
)

PREFIXES: Dict[str, Codec] = {}
for _family, _codec in _FAMILIES:
    for _scope in _SCOPES:
        PREFIXES[_scope + "F" + _family] = _codec
    PREFIXES.setdefault(_family, _codec)

_ORDERED = tuple(sorted(PREFIXES.items(), key=lambda item: -len(item[0])))

def classify(codec: Codec, value: Any) -> Tuple[str, Optional[bytes]]:
    payload = codec.encode(value)
    if payload is None:
        return codec.kind, None
    if codec.kind != "auto":
        return codec.kind, payload
    text = _as_text(value)
    low = text.lower()
    if low in TRUTHY or low in FALSEY:
        return "bool", payload
    try:
        int(float(text))
    except (ValueError, TypeError, OverflowError):
        return "string", payload
    return "int", payload

def resolve(name: str) -> Tuple[Codec, str]:
    for prefix, codec in _ORDERED:
        if name.startswith(prefix):
            return codec, name[len(prefix):] or name
    return AUTO, name

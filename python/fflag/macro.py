from __future__ import annotations

import ctypes
import threading
import time
from ctypes import wintypes
from typing import Any, Callable, Dict, List, Optional

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

WH_KEYBOARD_LL = 13
WH_MOUSE_LL = 14

WM_QUIT = 0x0012
WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_SYSKEYDOWN = 0x0104
WM_SYSKEYUP = 0x0105

WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202
WM_RBUTTONDOWN = 0x0204
WM_RBUTTONUP = 0x0205
WM_MBUTTONDOWN = 0x0207
WM_MBUTTONUP = 0x0208
WM_MOUSEWHEEL = 0x020A
WM_XBUTTONDOWN = 0x020B
WM_XBUTTONUP = 0x020C

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1

KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008
KEYEVENTF_EXTENDEDKEY = 0x0001

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_VIRTUALDESK = 0x4000
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_XDOWN = 0x0080
MOUSEEVENTF_XUP = 0x0100
MOUSEEVENTF_WHEEL = 0x0800

SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79

LLKHF_EXTENDED = 0x01

SIGNATURE = 0x4E425331

MAX_STEPS = 200000
MOVE_MIN_INTERVAL_MS = 15
PLAY_SLICE = 0.004

BUTTON_FLAGS = {
    "left": (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
    "right": (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
    "middle": (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
    "x1": (MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP),
    "x2": (MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP),
}

DOWN_MESSAGES = {
    WM_LBUTTONDOWN: "left",
    WM_RBUTTONDOWN: "right",
    WM_MBUTTONDOWN: "middle",
}
UP_MESSAGES = {
    WM_LBUTTONUP: "left",
    WM_RBUTTONUP: "right",
    WM_MBUTTONUP: "middle",
}

ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong

class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]

class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("pt", wintypes.POINT),
        ("mouseData", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]

class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]

class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]

class INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]

class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", INPUTUNION)]

HOOKPROC = ctypes.WINFUNCTYPE(
    ctypes.c_longlong, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM
)

user32.SetWindowsHookExW.argtypes = (ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD)
user32.SetWindowsHookExW.restype = wintypes.HHOOK

user32.UnhookWindowsHookEx.argtypes = (wintypes.HHOOK,)
user32.UnhookWindowsHookEx.restype = wintypes.BOOL

user32.CallNextHookEx.argtypes = (wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
user32.CallNextHookEx.restype = ctypes.c_longlong

user32.GetMessageW.argtypes = (ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT)
user32.GetMessageW.restype = wintypes.BOOL

user32.PostThreadMessageW.argtypes = (wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
user32.PostThreadMessageW.restype = wintypes.BOOL

user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
user32.SendInput.restype = wintypes.UINT

user32.GetSystemMetrics.argtypes = (ctypes.c_int,)
user32.GetSystemMetrics.restype = ctypes.c_int

user32.MapVirtualKeyW.argtypes = (wintypes.UINT, wintypes.UINT)
user32.MapVirtualKeyW.restype = wintypes.UINT

user32.GetCursorPos.argtypes = (ctypes.POINTER(wintypes.POINT),)
user32.GetCursorPos.restype = wintypes.BOOL

kernel32.GetCurrentThreadId.restype = wintypes.DWORD

EXTENDED_KEYS = {
    0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28,
    0x2D, 0x2E, 0x5B, 0x5C, 0x5D, 0x90, 0xA3, 0xA5,
}

def cursor_position() -> Dict[str, int]:
    point = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(point))
    return {"x": int(point.x), "y": int(point.y)}

def _virtual_screen():
    left = user32.GetSystemMetrics(SM_XVIRTUALSCREEN)
    top = user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
    width = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN) or 1
    height = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN) or 1
    return left, top, width, height

def _send(items: List[INPUT]) -> int:
    if not items:
        return 0
    array = (INPUT * len(items))(*items)
    return int(user32.SendInput(len(items), array, ctypes.sizeof(INPUT)))

def _key_input(code: int, down: bool) -> INPUT:
    scan = user32.MapVirtualKeyW(code, 0)
    flags = 0 if down else KEYEVENTF_KEYUP
    if code in EXTENDED_KEYS:
        flags |= KEYEVENTF_EXTENDEDKEY
    item = INPUT()
    item.type = INPUT_KEYBOARD
    item.ki = KEYBDINPUT(wVk=code, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=SIGNATURE)
    return item

def _mouse_input(flags: int, dx: int = 0, dy: int = 0, data: int = 0) -> INPUT:
    item = INPUT()
    item.type = INPUT_MOUSE
    item.mi = MOUSEINPUT(dx=dx, dy=dy, mouseData=data, dwFlags=flags, time=0, dwExtraInfo=SIGNATURE)
    return item

def _move_input(x: int, y: int) -> INPUT:
    left, top, width, height = _virtual_screen()
    nx = int(round((x - left) * 65535 / max(1, width - 1)))
    ny = int(round((y - top) * 65535 / max(1, height - 1)))
    nx = max(0, min(65535, nx))
    ny = max(0, min(65535, ny))
    return _mouse_input(
        MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, nx, ny
    )

def steps_for(step: Dict[str, Any]) -> List[INPUT]:
    kind = step.get("kind")
    if kind == "key":
        code = int(step.get("code") or 0)
        if not code:
            return []
        return [_key_input(code, bool(step.get("down")))]
    if kind == "mouse":
        button = str(step.get("button") or "left")
        pair = BUTTON_FLAGS.get(button)
        if not pair:
            return []
        flag = pair[0] if step.get("down") else pair[1]
        data = 0
        if button == "x1":
            data = 1
        elif button == "x2":
            data = 2
        return [_mouse_input(flag, data=data)]
    if kind == "move":
        return [_move_input(int(step.get("x") or 0), int(step.get("y") or 0))]
    if kind == "wheel":
        return [_mouse_input(MOUSEEVENTF_WHEEL, data=int(step.get("delta") or 0) & 0xFFFFFFFF)]
    return []

class Recorder:
    def __init__(self, log: Optional[Callable] = None):
        self.log = log or (lambda *a, **k: None)
        self.steps: List[Dict[str, Any]] = []
        self.recording = False
        self.capture_moves = True

        self._thread: Optional[threading.Thread] = None
        self._thread_id = 0
        self._started_at = 0.0
        self._last_move = -MOVE_MIN_INTERVAL_MS
        self._keyboard_hook = None
        self._mouse_hook = None
        self._keyboard_proc = None
        self._mouse_proc = None
        self._lock = threading.Lock()
        self._ready = threading.Event()

    def start(self, capture_moves: bool = True) -> bool:
        if self.recording:
            return False
        with self._lock:
            self.steps = []
        self.capture_moves = bool(capture_moves)
        self._last_move = -MOVE_MIN_INTERVAL_MS
        self._ready.clear()
        self.recording = True
        self._thread = threading.Thread(target=self._pump, daemon=True)
        self._thread.start()
        self._ready.wait(3)
        return self.recording

    def stop(self) -> List[Dict[str, Any]]:
        if not self.recording:
            return self.snapshot()
        self.recording = False
        if self._thread_id:
            user32.PostThreadMessageW(self._thread_id, WM_QUIT, 0, 0)
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=3)
        self._thread = None
        self._thread_id = 0
        return self.snapshot()

    def snapshot(self) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self.steps)

    def _elapsed_ms(self) -> int:
        return int((time.perf_counter() - self._started_at) * 1000)

    def _add(self, step: Dict[str, Any]) -> None:
        with self._lock:
            if len(self.steps) >= MAX_STEPS:
                return
            self.steps.append(step)

    def _pump(self) -> None:
        self._thread_id = kernel32.GetCurrentThreadId()
        self._started_at = time.perf_counter()

        self._keyboard_proc = HOOKPROC(self._on_keyboard)
        self._mouse_proc = HOOKPROC(self._on_mouse)
        self._keyboard_hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, self._keyboard_proc, None, 0)
        self._mouse_hook = user32.SetWindowsHookExW(WH_MOUSE_LL, self._mouse_proc, None, 0)

        if not self._keyboard_hook or not self._mouse_hook:
            self.recording = False
            self.log("[-] Could not install the input hooks", "error")
            self._ready.set()
            self._teardown()
            return

        self._ready.set()
        message = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            if not self.recording:
                break
        self._teardown()

    def _teardown(self) -> None:
        if self._keyboard_hook:
            user32.UnhookWindowsHookEx(self._keyboard_hook)
            self._keyboard_hook = None
        if self._mouse_hook:
            user32.UnhookWindowsHookEx(self._mouse_hook)
            self._mouse_hook = None
        self._keyboard_proc = None
        self._mouse_proc = None

    def _on_keyboard(self, code, wparam, lparam):
        if code >= 0 and self.recording:
            data = ctypes.cast(lparam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            if data.dwExtraInfo != SIGNATURE:
                message = int(wparam)
                if message in (WM_KEYDOWN, WM_SYSKEYDOWN, WM_KEYUP, WM_SYSKEYUP):
                    self._add({
                        "t": self._elapsed_ms(),
                        "kind": "key",
                        "code": int(data.vkCode),
                        "down": message in (WM_KEYDOWN, WM_SYSKEYDOWN),
                    })
        return user32.CallNextHookEx(None, code, wparam, lparam)

    def _on_mouse(self, code, wparam, lparam):
        if code >= 0 and self.recording:
            data = ctypes.cast(lparam, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
            if data.dwExtraInfo != SIGNATURE:
                self._record_mouse(int(wparam), data)
        return user32.CallNextHookEx(None, code, wparam, lparam)

    def _record_mouse(self, message: int, data) -> None:
        now = self._elapsed_ms()

        if message == WM_MOUSEMOVE:
            if not self.capture_moves:
                return
            if now - self._last_move < MOVE_MIN_INTERVAL_MS:
                return
            self._last_move = now
            self._add({"t": now, "kind": "move", "x": int(data.pt.x), "y": int(data.pt.y)})
            return

        if message == WM_MOUSEWHEEL:
            delta = ctypes.c_short((data.mouseData >> 16) & 0xFFFF).value
            self._add({"t": now, "kind": "wheel", "delta": int(delta)})
            return

        button = DOWN_MESSAGES.get(message) or UP_MESSAGES.get(message)
        if button is None and message in (WM_XBUTTONDOWN, WM_XBUTTONUP):
            button = "x2" if ((data.mouseData >> 16) & 0xFFFF) == 2 else "x1"
        if button is None:
            return

        down = message in DOWN_MESSAGES or message == WM_XBUTTONDOWN
        self._add({"t": now, "kind": "mouse", "button": button, "down": down})

class Player:
    def __init__(self, log: Optional[Callable] = None, on_finish: Optional[Callable] = None):
        self.log = log or (lambda *a, **k: None)
        self.on_finish = on_finish
        self.playing = False
        self.loop = 0
        self.loops_done = 0

        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._held_keys: List[int] = []
        self._held_buttons: List[str] = []

    def start(self, steps: List[Dict[str, Any]], repeat: int = 1, speed: float = 1.0) -> bool:
        if self.playing or not steps:
            return False
        self._stop.clear()
        self.playing = True
        self.loop = max(0, int(repeat))
        self.loops_done = 0
        self._thread = threading.Thread(
            target=self._run, args=(list(steps), self.loop, max(0.05, float(speed))), daemon=True
        )
        self._thread.start()
        return True

    def stop(self) -> bool:
        if not self.playing:
            return False
        self._stop.set()
        thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=3)
        return True

    def _run(self, steps: List[Dict[str, Any]], repeat: int, speed: float) -> None:
        try:
            count = 0
            while not self._stop.is_set():
                self._play_once(steps, speed)
                count += 1
                self.loops_done = count
                if repeat and count >= repeat:
                    break
        finally:
            self._release_everything()
            self.playing = False
            if self.on_finish:
                try:
                    self.on_finish(self.loops_done, self._stop.is_set())
                except Exception:
                    pass

    def _play_once(self, steps: List[Dict[str, Any]], speed: float) -> None:
        origin = time.perf_counter()
        for step in steps:
            if self._stop.is_set():
                return
            target = origin + (int(step.get("t") or 0) / 1000.0) / speed
            while True:
                remaining = target - time.perf_counter()
                if remaining <= 0 or self._stop.is_set():
                    break
                time.sleep(min(PLAY_SLICE, remaining))
            if self._stop.is_set():
                return
            self._emit(step)

    def _emit(self, step: Dict[str, Any]) -> None:
        items = steps_for(step)
        if not items:
            return
        _send(items)
        self._track(step)

    def _track(self, step: Dict[str, Any]) -> None:
        kind = step.get("kind")
        if kind == "key":
            code = int(step.get("code") or 0)
            if step.get("down"):
                if code and code not in self._held_keys:
                    self._held_keys.append(code)
            elif code in self._held_keys:
                self._held_keys.remove(code)
        elif kind == "mouse":
            button = str(step.get("button") or "")
            if step.get("down"):
                if button and button not in self._held_buttons:
                    self._held_buttons.append(button)
            elif button in self._held_buttons:
                self._held_buttons.remove(button)

    def _release_everything(self) -> None:
        items: List[INPUT] = []
        for code in list(self._held_keys):
            items.append(_key_input(code, False))
        for button in list(self._held_buttons):
            pair = BUTTON_FLAGS.get(button)
            if pair:
                items.append(_mouse_input(pair[1]))
        if items:
            _send(items)
        self._held_keys = []
        self._held_buttons = []

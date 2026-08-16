from __future__ import annotations

import ctypes
from ctypes import wintypes
from typing import List, Optional, Tuple

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
psapi = ctypes.WinDLL("psapi", use_last_error=True)
ntdll = ctypes.WinDLL("ntdll", use_last_error=True)

PROCESS_ALL_ACCESS = 0x1F0FFF
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
TH32CS_SNAPPROCESS = 0x0002

PAGE_READWRITE = 0x04
PAGE_WRITECOPY = 0x08
PAGE_EXECUTE_READWRITE = 0x40
PAGE_EXECUTE_WRITECOPY = 0x80
WRITABLE_PROTECTIONS = (
    PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY
)

MEM_COMMIT = 0x1000

IMAGE_SCN_CNT_CODE = 0x00000020
IMAGE_SCN_MEM_EXECUTE = 0x20000000
IMAGE_SCN_NOT_DATA = IMAGE_SCN_CNT_CODE | IMAGE_SCN_MEM_EXECUTE

ADDRESS_MIN = 0x10000
ADDRESS_MAX = 0x7FFFFFFFFFFF

_INVALID_HANDLE = ctypes.c_void_p(-1).value

class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", ctypes.c_char * 260),
    ]

class MODULEINFO(ctypes.Structure):
    _fields_ = [
        ("lpBaseOfDll", ctypes.c_void_p),
        ("SizeOfImage", wintypes.DWORD),
        ("EntryPoint", ctypes.c_void_p),
    ]

class MEMORY_BASIC_INFORMATION(ctypes.Structure):

    _fields_ = [
        ("BaseAddress", ctypes.c_void_p),
        ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wintypes.DWORD),
        ("__alignment1", wintypes.DWORD),
        ("RegionSize", ctypes.c_size_t),
        ("State", wintypes.DWORD),
        ("Protect", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("__alignment2", wintypes.DWORD),
    ]

kernel32.CreateToolhelp32Snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE

kernel32.Process32First.argtypes = (wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32))
kernel32.Process32First.restype = wintypes.BOOL

kernel32.Process32Next.argtypes = (wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32))
kernel32.Process32Next.restype = wintypes.BOOL

kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
kernel32.CloseHandle.restype = wintypes.BOOL

kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
kernel32.OpenProcess.restype = wintypes.HANDLE

kernel32.ReadProcessMemory.argtypes = (
    wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
    ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t),
)
kernel32.ReadProcessMemory.restype = wintypes.BOOL

kernel32.VirtualQueryEx.argtypes = (
    wintypes.HANDLE, ctypes.c_void_p,
    ctypes.POINTER(MEMORY_BASIC_INFORMATION), ctypes.c_size_t,
)
kernel32.VirtualQueryEx.restype = ctypes.c_size_t

kernel32.VirtualProtectEx.argtypes = (
    wintypes.HANDLE, ctypes.c_void_p, ctypes.c_size_t,
    wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
)
kernel32.VirtualProtectEx.restype = wintypes.BOOL

kernel32.QueryFullProcessImageNameW.argtypes = (
    wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD),
)
kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL

kernel32.GetProcessTimes.argtypes = (
    wintypes.HANDLE,
    ctypes.POINTER(wintypes.FILETIME),
    ctypes.POINTER(wintypes.FILETIME),
    ctypes.POINTER(wintypes.FILETIME),
    ctypes.POINTER(wintypes.FILETIME),
)
kernel32.GetProcessTimes.restype = wintypes.BOOL

kernel32.GetSystemTimeAsFileTime.argtypes = (ctypes.POINTER(wintypes.FILETIME),)
kernel32.GetSystemTimeAsFileTime.restype = None

psapi.EnumProcessModules.argtypes = (
    wintypes.HANDLE, ctypes.POINTER(ctypes.c_void_p),
    wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
)
psapi.EnumProcessModules.restype = wintypes.BOOL

psapi.GetModuleInformation.argtypes = (
    wintypes.HANDLE, ctypes.c_void_p, ctypes.POINTER(MODULEINFO), wintypes.DWORD,
)
psapi.GetModuleInformation.restype = wintypes.BOOL

ntdll.NtWriteVirtualMemory.argtypes = (
    wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
    ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t),
)
ntdll.NtWriteVirtualMemory.restype = ctypes.c_long

def find_process(image_name: bytes) -> Optional[int]:
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snapshot or snapshot == _INVALID_HANDLE:
        return None
    try:
        entry = PROCESSENTRY32()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
        if not kernel32.Process32First(snapshot, ctypes.byref(entry)):
            return None
        wanted = image_name.lower()
        while True:
            if entry.szExeFile.lower() == wanted:
                return int(entry.th32ProcessID)
            if not kernel32.Process32Next(snapshot, ctypes.byref(entry)):
                return None
    finally:
        kernel32.CloseHandle(snapshot)

def module_bounds(pid: int) -> Tuple[Optional[int], int]:
    handle = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not handle:
        return None, 0
    try:
        modules = (ctypes.c_void_p * 1)()
        needed = wintypes.DWORD()
        if not psapi.EnumProcessModules(
            handle, modules, ctypes.sizeof(modules), ctypes.byref(needed)
        ):
            return None, 0
        base = modules[0]
        if not base:
            return None, 0
        info = MODULEINFO()
        if psapi.GetModuleInformation(handle, ctypes.c_void_p(base), ctypes.byref(info), ctypes.sizeof(info)):
            return int(base), int(info.SizeOfImage)
        return int(base), 0
    finally:
        kernel32.CloseHandle(handle)

def image_path(pid: int) -> Optional[str]:
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        size = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(size.value)
        if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return buffer.value
        return None
    finally:
        kernel32.CloseHandle(handle)

def _filetime_to_int(value: wintypes.FILETIME) -> int:
    return (int(value.dwHighDateTime) << 32) | int(value.dwLowDateTime)

def process_age(pid: int) -> Optional[float]:
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        created = wintypes.FILETIME()
        exited = wintypes.FILETIME()
        kernel_time = wintypes.FILETIME()
        user_time = wintypes.FILETIME()
        ok = kernel32.GetProcessTimes(
            handle,
            ctypes.byref(created),
            ctypes.byref(exited),
            ctypes.byref(kernel_time),
            ctypes.byref(user_time),
        )
        if not ok:
            return None
        now = wintypes.FILETIME()
        kernel32.GetSystemTimeAsFileTime(ctypes.byref(now))
        delta = _filetime_to_int(now) - _filetime_to_int(created)
        return max(0.0, delta / 10000000.0)
    finally:
        kernel32.CloseHandle(handle)

def in_user_space(address: int, size: int = 1) -> bool:
    return (
        isinstance(address, int)
        and ADDRESS_MIN <= address
        and address + size <= ADDRESS_MAX
    )

class ProcessHandle:

    MAX_WRITE = 4096
    MAX_READ = 1 << 20

    def __init__(self, handle: int, pid: int):
        self._handle = handle
        self.pid = pid

    @classmethod
    def open(cls, pid: int, attempts: int = 5, delay: float = 0.3) -> Optional["ProcessHandle"]:
        import time

        for attempt in range(attempts):
            handle = kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, pid)
            if handle:
                return cls(handle, pid)
            if attempt < attempts - 1:
                time.sleep(delay)
        return None

    @property
    def alive(self) -> bool:
        return self._handle is not None

    def close(self) -> None:
        if self._handle:
            try:
                kernel32.CloseHandle(self._handle)
            except Exception:
                pass
            self._handle = None

    def read(self, address: int, size: int) -> Optional[bytes]:
        if not self._handle or size <= 0 or size > self.MAX_READ:
            return None
        if not in_user_space(address, size):
            return None
        buffer = (ctypes.c_ubyte * size)()
        transferred = ctypes.c_size_t(0)
        ok = kernel32.ReadProcessMemory(
            self._handle, ctypes.c_void_p(address), ctypes.byref(buffer),
            size, ctypes.byref(transferred),
        )
        if ok and transferred.value:
            return bytes(buffer[: transferred.value])
        return None

    def _region(self, address: int) -> Optional[Tuple[int, int]]:
        info = MEMORY_BASIC_INFORMATION()
        queried = kernel32.VirtualQueryEx(
            self._handle, ctypes.c_void_p(address), ctypes.byref(info), ctypes.sizeof(info)
        )
        if not queried:
            return None
        if info.State != MEM_COMMIT:
            return None
        base = int(info.BaseAddress or 0)
        return int(info.Protect), base + int(info.RegionSize)

    def write(self, address: int, data: bytes, attempts: int = 3) -> bool:
        import random
        import time

        if not self._handle or not data:
            return False
        size = len(data)
        if size > self.MAX_WRITE or not in_user_space(address, size):
            return False

        payload = ctypes.create_string_buffer(data, size)
        for attempt in range(attempts):
            if self._write_once(address, payload, size, data):
                return True
            if attempt < attempts - 1:
                time.sleep(random.uniform(0.0003, 0.0006))
        return False

    def _write_once(self, address: int, payload, size: int, expected: bytes) -> bool:
        restore_to = 0
        try:
            region = self._region(address)
            if region is None:
                return False
            protection, region_end = region
            if address + size > region_end:
                return False
            if not protection & WRITABLE_PROTECTIONS:
                previous = wintypes.DWORD()
                if kernel32.VirtualProtectEx(
                    self._handle, ctypes.c_void_p(address), size,
                    PAGE_READWRITE, ctypes.byref(previous),
                ):
                    restore_to = previous.value

            written = ctypes.c_size_t(0)
            status = ntdll.NtWriteVirtualMemory(
                self._handle, ctypes.c_void_p(address), payload,
                size, ctypes.byref(written),
            )
            if status != 0 or written.value != size:
                return False
        except (OSError, ValueError, OverflowError):
            return False
        finally:
            if restore_to:
                discarded = wintypes.DWORD()
                try:
                    kernel32.VirtualProtectEx(
                        self._handle, ctypes.c_void_p(address), size,
                        restore_to, ctypes.byref(discarded),
                    )
                except Exception:
                    pass

        if size > 128:
            return True
        return self.read(address, size) == expected

class Section:

    __slots__ = ("name", "start", "end", "characteristics")

    def __init__(self, name: str, start: int, end: int, characteristics: int):
        self.name = name
        self.start = start
        self.end = end
        self.characteristics = characteristics

    @property
    def writable_data(self) -> bool:
        return not self.characteristics & IMAGE_SCN_NOT_DATA

    def __repr__(self) -> str:
        return "<Section %s %#x-%#x>" % (self.name, self.start, self.end)

def image_sections(handle: "ProcessHandle", base: int) -> List[Section]:
    header = handle.read(base, 0x2000)
    if not header or len(header) < 0x40 or header[:2] != b"MZ":
        return []
    nt = int.from_bytes(header[0x3C:0x40], "little")
    if nt <= 0 or nt + 0x18 > len(header) or header[nt:nt + 4] != b"PE\x00\x00":
        return []

    file_header = nt + 4
    count = int.from_bytes(header[file_header + 2: file_header + 4], "little")
    optional_size = int.from_bytes(header[file_header + 16: file_header + 18], "little")
    if not 0 < count <= 96:
        return []

    table = file_header + 20 + optional_size
    sections: List[Section] = []
    for index in range(count):
        entry = table + index * 40
        if entry + 40 > len(header):
            break
        name = header[entry: entry + 8].rstrip(b"\x00").decode("latin-1", "ignore")
        virtual_size = int.from_bytes(header[entry + 8: entry + 12], "little")
        virtual_address = int.from_bytes(header[entry + 12: entry + 16], "little")
        raw_size = int.from_bytes(header[entry + 16: entry + 20], "little")
        characteristics = int.from_bytes(header[entry + 36: entry + 40], "little")
        span = virtual_size or raw_size
        if not virtual_address or not span:
            continue
        sections.append(Section(name, virtual_address, virtual_address + span, characteristics))
    sections.sort(key=lambda section: section.start)
    return sections

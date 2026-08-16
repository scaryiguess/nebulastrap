from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

RAM = "eats RAM until the machine stalls"
JOIN = "stalls leaving or joining a game"
LOAD = "makes the client load without a ceiling"

CEILINGS: Dict[str, Tuple[int, str]] = {
    "DFIntThirdPartyInMemoryCacheCapacity": (134217728, RAM),
    "FIntMeshContentProviderForceCacheSize": (134217728, RAM),
    "DFIntHttpCurlConnectionCacheSize": (128, RAM),
    "DFIntUserIdPlayerNameCacheSize": (4096, RAM),
    "DFIntUserIdPlayerNameLifetimeSeconds": (86400, RAM),

    "DFIntNumAssetsMaxToPreload": (512, LOAD),
    "DFIntAssetPreloading": (10000, LOAD),
    "DFIntPreloadAvatarAssets": (10000, LOAD),
    "DFIntTeleportClientAssetPreloadingHundredthsPercentage": (10000, JOIN),
    "DFIntTeleportClientAssetPreloadingHundredthsPercentage2": (10000, JOIN),

    "DFIntMaxClientSimulationRadius": (10000, RAM),
    "DFIntMinClientSimulationRadius": (10000, RAM),
    "DFIntMinimalSimRadiusBuffer": (10000, RAM),

    "DFIntSignalRCoreRpcQueueSize": (1024, RAM),
    "DFIntTotalRepPayloadLimit": (4194304, RAM),
    "DFIntMaxDataPacketPerSend": (4096, RAM),
    "DFIntMaxProcessPacketsStepsAccumulated": (64, JOIN),
    "DFIntMaxProcessPacketsStepsPerCyclic": (64, JOIN),
    "DFIntDataSenderMaxBandwidthBps": (20000000, RAM),
    "DFIntDataSenderMaxJoinBandwidthBps": (20000000, JOIN),

    "FIntFastClusterHumanoidWorstCaseBytes": (262144, RAM),
    "FIntFastClusterHumanoidWorstCaseGeometryDataBytes": (262144, RAM),

    "DFIntTaskSchedulerTargetFps": (1000, RAM),
    "DFIntSecondsBetweenDynamicVariableReloading": (86400, JOIN),
}

PATTERNS: Tuple[Tuple[Any, int, str], ...] = (
    (re.compile(r"RuntimeMaxNumOf"), 8192, RAM),
    (re.compile(r"(Cache|Buffer|Pool|Arena)(Size|Capacity|Bytes)$"), 134217728, RAM),
    (re.compile(r"(Queue|Pool|Cache|Buffer)Max(Size|Count|Entries|Length)$"), 65536, RAM),
    (re.compile(r"Hundredths?Percent(age)?\d*$"), 10000, JOIN),
)

def ceiling_for(name: str) -> Optional[Tuple[int, str]]:
    direct = CEILINGS.get(name)
    if direct is not None:
        return direct
    for expression, ceiling, why in PATTERNS:
        if expression.search(name):
            return (ceiling, why)
    return None

def _as_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    text = str(value).strip()
    if not text or len(text) > 24:
        return None
    try:
        return int(float(text))
    except (ValueError, TypeError, OverflowError):
        return None

def screen(flags: Dict[str, Any], enabled: bool = True) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    if not enabled:
        return flags, []

    out = dict(flags)
    notes: List[Dict[str, Any]] = []
    for name, value in flags.items():
        found = ceiling_for(name)
        if found is None:
            continue
        ceiling, why = found
        number = _as_int(value)
        if number is None or number <= ceiling:
            continue
        out[name] = str(ceiling) if isinstance(value, str) else ceiling
        notes.append({"name": name, "was": str(value)[:24], "now": ceiling, "why": why})
    return out, notes

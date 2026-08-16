$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class MemTools {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("psapi.dll")] static extern bool EmptyWorkingSet(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX buffer);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeValue(string host, string name, out LUID luid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES state, uint length, IntPtr previous, IntPtr returned);
    [DllImport("ntdll.dll")] static extern int NtSetSystemInformation(int infoClass, IntPtr info, int length);

    const uint PROCESS_QUERY_INFORMATION = 0x0400;
    const uint PROCESS_SET_QUOTA = 0x0100;
    const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
    const uint TOKEN_QUERY = 0x0008;
    const uint SE_PRIVILEGE_ENABLED = 0x0002;
    const int SystemMemoryListInformation = 80;
    const int MemoryEmptyWorkingSets = 2;
    const int MemoryPurgeStandbyList = 4;

    [StructLayout(LayoutKind.Sequential)]
    struct LUID { public uint LowPart; public int HighPart; }

    [StructLayout(LayoutKind.Sequential)]
    struct LUID_AND_ATTRIBUTES { public LUID Luid; public uint Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_PRIVILEGES { public uint PrivilegeCount; public LUID_AND_ATTRIBUTES Privilege; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORYSTATUSEX {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
    }

    public static MEMORYSTATUSEX Status() {
        MEMORYSTATUSEX status = new MEMORYSTATUSEX();
        status.Length = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        GlobalMemoryStatusEx(ref status);
        return status;
    }

    // Per-process working set trim. Processes we have no rights over are
    // skipped rather than reported: on a normal desktop that is a handful of
    // protected system processes every single time, and counting them as
    // failures would make every run look broken.
    public static int TrimProcesses() {
        int trimmed = 0;
        foreach (System.Diagnostics.Process process in System.Diagnostics.Process.GetProcesses()) {
            try {
                IntPtr handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, false, process.Id);
                if (handle != IntPtr.Zero) {
                    if (EmptyWorkingSet(handle)) { trimmed++; }
                    CloseHandle(handle);
                }
            } catch { }
            try { process.Dispose(); } catch { }
        }
        return trimmed;
    }

    static bool EnablePrivilege(string name) {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out token)) { return false; }
        try {
            LUID luid;
            if (!LookupPrivilegeValue(null, name, out luid)) { return false; }
            TOKEN_PRIVILEGES privileges = new TOKEN_PRIVILEGES();
            privileges.PrivilegeCount = 1;
            privileges.Privilege.Luid = luid;
            privileges.Privilege.Attributes = SE_PRIVILEGE_ENABLED;
            return AdjustTokenPrivileges(token, false, ref privileges, 0, IntPtr.Zero, IntPtr.Zero);
        } finally {
            CloseHandle(token);
        }
    }

    // The kernel-level pass: empty every working set and drop the standby
    // list in one call. This is where most of the reclaimed memory comes
    // from - far more than EmptyWorkingSet can reach on its own - and it
    // needs SeProfileSingleProcess, so it only works elevated.
    public static bool PurgeSystem() {
        if (!EnablePrivilege("SeProfileSingleProcessPrivilege")) { return false; }
        IntPtr buffer = Marshal.AllocHGlobal(4);
        try {
            Marshal.WriteInt32(buffer, MemoryEmptyWorkingSets);
            NtSetSystemInformation(SystemMemoryListInformation, buffer, 4);
            Marshal.WriteInt32(buffer, MemoryPurgeStandbyList);
            NtSetSystemInformation(SystemMemoryListInformation, buffer, 4);
            return true;
        } catch {
            return false;
        } finally {
            Marshal.FreeHGlobal(buffer);
        }
    }
}
'@

function Get-MemorySnapshot {
    $status = [MemTools]::Status()
    return [pscustomobject]@{
        totalMB = [math]::Round($status.TotalPhys / 1MB)
        availMB = [math]::Round($status.AvailPhys / 1MB)
        usedMB  = [math]::Round(($status.TotalPhys - $status.AvailPhys) / 1MB)
        percent = [int]$status.MemoryLoad
    }
}

function Send-Reply([object]$payload) {
    [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
}

$running = $true
while ($running) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line.Length -eq 0) { continue }

    try { $request = $line | ConvertFrom-Json } catch { continue }
    $id = $request.id
    $op = [string]$request.op

    try {
        switch ($op) {
            'status' {
                $snapshot = Get-MemorySnapshot
                Send-Reply @{ id = $id; ok = $true; memory = $snapshot }
            }
            'flush' {
                $before = Get-MemorySnapshot
                $trimmed = [MemTools]::TrimProcesses()
                $purged = $false
                if ($request.deep -ne $false) { $purged = [MemTools]::PurgeSystem() }
                $after = Get-MemorySnapshot
                Send-Reply @{
                    id      = $id
                    ok      = $true
                    trimmed = $trimmed
                    purged  = $purged
                    freedMB = [int]($after.availMB - $before.availMB)
                    memory  = $after
                }
            }
            'ping' {
                Send-Reply @{ id = $id; ok = $true; pong = $true }
            }
            'quit' {
                Send-Reply @{ id = $id; ok = $true }
                $running = $false
            }
            default {
                Send-Reply @{ id = $id; ok = $false; error = "unknown op: $op" }
            }
        }
    } catch {
        Send-Reply @{ id = $id; ok = $false; error = $_.Exception.Message }
    }
}

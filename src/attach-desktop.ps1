param([Parameter(Mandatory=$true)][string]$Hwnd)

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class DesktopAttach {
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint ms, out IntPtr result);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hWnd, int index, int value);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }

    public static string Attach(long hwndLong) {
        SetProcessDPIAware();
        IntPtr hwnd = new IntPtr(hwndLong);
        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return "no-progman";
        IntPtr res;
        SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out res);
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out res);

        IntPtr defParent = IntPtr.Zero;
        EnumWindows((h, l) => {
            if (FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) { defParent = h; return false; }
            return true;
        }, IntPtr.Zero);

        IntPtr target = IntPtr.Zero;
        IntPtr defView = IntPtr.Zero;
        string mode = "progman";
        if (defParent != IntPtr.Zero) {
            defView = FindWindowEx(defParent, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (Cls(defParent) == "WorkerW") {
                target = FindWindowEx(IntPtr.Zero, defParent, "WorkerW", null);
                if (target != IntPtr.Zero) mode = "workerw";
            } else {
                IntPtr w = IntPtr.Zero;
                EnumChildWindows(defParent, (h, l) => {
                    if (Cls(h) == "WorkerW" && IsWindowVisible(h)) { w = h; return false; }
                    return true;
                }, IntPtr.Zero);
                if (w != IntPtr.Zero) { target = w; mode = "workerw-child"; }
            }
        }
        if (target == IntPtr.Zero) { target = progman; mode = "progman"; }

        int style = GetWindowLong(hwnd, -16);
        SetWindowLong(hwnd, -16, style | 0x40000000);
        SetParent(hwnd, target);
        int x = GetSystemMetrics(76), y = GetSystemMetrics(77);
        int cx = GetSystemMetrics(78), cy = GetSystemMetrics(79);
        MoveWindow(hwnd, x, y, cx, cy, true);
        IntPtr after = (mode == "progman" && defView != IntPtr.Zero) ? defView : new IntPtr(1);
        SetWindowPos(hwnd, after, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
        return mode;
    }
}
"@

Write-Output ([DesktopAttach]::Attach([long]::Parse($Hwnd)))
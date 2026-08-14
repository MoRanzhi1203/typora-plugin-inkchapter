using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;

namespace R58Win32Helper
{
    public static class Native
    {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct GUITHREADINFO
    {
        public uint cbSize;
        public uint flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public RECT rcCaret;
    }

    public static class Program
    {
        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions { WriteIndented = false };

        public static int Main(string[] args)
        {
            if (args == null || args.Length == 0)
            {
                Console.WriteLine("{\"error\":\"no command\"}");
                return 2;
            }

            try
            {
                string cmd = (args[0] ?? "").ToLowerInvariant();
                switch (cmd)
                {
                    case "enumerate":
                        Console.WriteLine(JsonSerializer.Serialize(Enumerate(), JsonOpts));
                        return 0;
                    case "close":
                        Console.WriteLine(JsonSerializer.Serialize(Close(), JsonOpts));
                        return 0;
                    case "foreground":
                        Console.WriteLine(JsonSerializer.Serialize(Foreground(), JsonOpts));
                        return 0;
                    case "set-foreground":
                        if (args.Length < 2) { Console.WriteLine("{\"error\":\"missing hwnd\"}"); return 2; }
                        Console.WriteLine(JsonSerializer.Serialize(SetForeground(ParseIntPtr(args[1])), JsonOpts));
                        return 0;
                    case "send-key":
                        if (args.Length < 2) { Console.WriteLine("{\"error\":\"missing vk\"}"); return 2; }
                        Console.WriteLine(JsonSerializer.Serialize(SendKey(ParseVk(args[1])), JsonOpts));
                        return 0;
                    case "focus-probe":
                        long target = args.Length >= 2 ? ParseIntPtr(args[1]) : 0;
                        Console.WriteLine(JsonSerializer.Serialize(FocusProbe(target), JsonOpts));
                        return 0;
                    default:
                        Console.WriteLine("{\"error\":\"unknown command:" + cmd + "\"}");
                        return 2;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { error = ex.Message }, JsonOpts));
                return 1;
            }
        }

        private static long ParseIntPtr(string s)
        {
            if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) return Convert.ToInt64(s.Substring(2), 16);
            return long.Parse(s);
        }

        private static ushort ParseVk(string s)
        {
            if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) return (ushort)Convert.ToUInt32(s.Substring(2), 16);
            return (ushort)uint.Parse(s);
        }

        private static object Enumerate()
        {
            var list = new List<object>();
            foreach (var p in Process.GetProcessesByName("Typora"))
            {
                long startTimeUnixMs = 0;
                string startTimeIso = null;
                long hwnd = 0;
                string title = "";
                try
                {
                    var dto = new DateTimeOffset(p.StartTime);
                    startTimeUnixMs = dto.ToUnixTimeMilliseconds();
                    startTimeIso = dto.ToUniversalTime().ToString("o");
                }
                catch { }

                try { hwnd = p.MainWindowHandle.ToInt64(); } catch { hwnd = 0; }
                try { title = p.MainWindowTitle ?? ""; } catch { title = ""; }

                list.Add(new
                {
                    pid = p.Id,
                    startTimeUnixMs,
                    startTimeIso,
                    mainWindowHandle = hwnd,
                    mainWindowTitle = title
                });
            }
            return new { processes = list, count = list.Count };
        }

        private static object Close()
        {
            var before = Process.GetProcessesByName("Typora");
            var beforePids = before.Select(p => p.Id).ToArray();
            if (before.Length == 0)
            {
                return new { beforeCount = 0, afterCount = 0, closed = true, oldPids = Array.Empty<int>() };
            }

            foreach (var p in before)
            {
                try { p.CloseMainWindow(); } catch { }
            }
            Thread.Sleep(800);

            var still = Process.GetProcessesByName("Typora");
            foreach (var p in still)
            {
                try { p.Kill(); } catch { }
            }

            var deadline = DateTime.UtcNow.AddSeconds(15);
            int remainingCount;
            do
            {
                Thread.Sleep(300);
                remainingCount = Process.GetProcessesByName("Typora").Length;
            } while (remainingCount > 0 && DateTime.UtcNow < deadline);

            var after = Process.GetProcessesByName("Typora");
            bool anyOldStillExists = false;
            foreach (var oldId in beforePids)
            {
                try { Process.GetProcessById(oldId); anyOldStillExists = true; break; } catch { }
            }

            return new
            {
                beforeCount = before.Length,
                afterCount = after.Length,
                closed = after.Length == 0 && !anyOldStillExists,
                oldPids = beforePids
            };
        }

        private static object Foreground()
        {
            return new { foregroundHwnd = Native.GetForegroundWindow().ToInt64() };
        }

        private static object SetForeground(long hwnd)
        {
            if (hwnd == 0) return new { hwnd = (long)0, setForegroundOk = false };
            var ptr = new IntPtr(hwnd);
            Native.BringWindowToTop(ptr);
            bool ok = Native.SetForegroundWindow(ptr);
            return new { hwnd, setForegroundOk = ok };
        }

        private static object SendKey(ushort vk)
        {
            int size = Marshal.SizeOf(typeof(INPUT));

            var down = new INPUT();
            down.type = INPUT_KEYBOARD;
            down.U.ki.wVk = vk;
            down.U.ki.wScan = 0;
            down.U.ki.dwFlags = 0;
            down.U.ki.time = 0;
            down.U.ki.dwExtraInfo = IntPtr.Zero;

            var up = new INPUT();
            up.type = INPUT_KEYBOARD;
            up.U.ki.wVk = vk;
            up.U.ki.wScan = 0;
            up.U.ki.dwFlags = KEYEVENTF_KEYUP;
            up.U.ki.time = 0;
            up.U.ki.dwExtraInfo = IntPtr.Zero;

            uint sent = Native.SendInput(2, new[] { down, up }, size);
            return new { vk = (int)vk, sent = (int)sent };
        }

        private static object FocusProbe(long targetHwnd)
        {
            IntPtr foreground = Native.GetForegroundWindow();

            uint foregroundPid = 0;
            uint foregroundThreadId = Native.GetWindowThreadProcessId(foreground, out foregroundPid);

            var gui = new GUITHREADINFO();
            gui.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
            bool guiOk = Native.GetGUIThreadInfo(foregroundThreadId, ref gui);

            long targetPid = 0;
            if (targetHwnd != 0)
            {
                uint pid;
                Native.GetWindowThreadProcessId(new IntPtr(targetHwnd), out pid);
                targetPid = pid;
            }

            return new
            {
                targetHwnd,
                targetPid,
                foregroundHwnd = foreground.ToInt64(),
                foregroundPid = (long)foregroundPid,
                foregroundThreadId = (long)foregroundThreadId,
                guiThreadInfoOk = guiOk,
                activeHwnd = gui.hwndActive.ToInt64(),
                focusedChildHwnd = gui.hwndFocus.ToInt64(),
                captureHwnd = gui.hwndCapture.ToInt64(),
                caretHwnd = gui.hwndCaret.ToInt64()
            };
        }
    }
}

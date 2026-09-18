using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;

namespace RuzgarDeskSecureInput
{
    internal static class Native
    {
        internal const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
        internal const uint TOKEN_DUPLICATE = 0x0002;
        internal const uint TOKEN_QUERY = 0x0008;
        internal const uint TOKEN_ADJUST_DEFAULT = 0x0080;
        internal const uint TOKEN_ADJUST_SESSIONID = 0x0100;
        internal const uint MAXIMUM_ALLOWED = 0x02000000;
        internal const int SecurityImpersonation = 2;
        internal const int TokenPrimary = 1;
        internal const int TokenSessionId = 12;
        internal const uint CREATE_NO_WINDOW = 0x08000000;
        internal const uint STILL_ACTIVE = 259;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct STARTUPINFO
        {
            internal int cb;
            internal string lpReserved;
            internal string lpDesktop;
            internal string lpTitle;
            internal int dwX;
            internal int dwY;
            internal int dwXSize;
            internal int dwYSize;
            internal int dwXCountChars;
            internal int dwYCountChars;
            internal int dwFillAttribute;
            internal int dwFlags;
            internal short wShowWindow;
            internal short cbReserved2;
            internal IntPtr lpReserved2;
            internal IntPtr hStdInput;
            internal IntPtr hStdOutput;
            internal IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct PROCESS_INFORMATION
        {
            internal IntPtr hProcess;
            internal IntPtr hThread;
            internal int dwProcessId;
            internal int dwThreadId;
        }

        [DllImport("kernel32.dll")]
        internal static extern IntPtr GetCurrentProcess();

        [DllImport("advapi32.dll", SetLastError = true)]
        internal static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true)]
        internal static extern bool DuplicateTokenEx(IntPtr existingToken, uint desiredAccess, IntPtr attributes,
            int impersonationLevel, int tokenType, out IntPtr newToken);

        [DllImport("advapi32.dll", SetLastError = true)]
        internal static extern bool SetTokenInformation(IntPtr token, int tokenInformationClass,
            ref uint tokenInformation, uint tokenInformationLength);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool CreateProcessAsUser(IntPtr token, string applicationName, StringBuilder commandLine,
            IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
            IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll")]
        internal static extern uint WTSGetActiveConsoleSessionId();

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool TerminateProcess(IntPtr process, uint exitCode);

        [DllImport("kernel32.dll")]
        internal static extern bool CloseHandle(IntPtr handle);
    }

    internal sealed class InputService : ServiceBase
    {
        private Thread monitor;
        private volatile bool stopping;
        private IntPtr agentProcess = IntPtr.Zero;
        private uint agentSession = UInt32.MaxValue;

        internal InputService()
        {
            ServiceName = "RuzgarDeskSecureInput";
            CanStop = true;
            CanShutdown = true;
            CanHandleSessionChangeEvent = true;
            AutoLog = true;
        }

        protected override void OnStart(string[] args)
        {
            stopping = false;
            monitor = new Thread(MonitorLoop);
            monitor.IsBackground = true;
            monitor.Start();
        }

        protected override void OnStop()
        {
            stopping = true;
            StopAgent();
            if (monitor != null) monitor.Join(3000);
        }

        protected override void OnShutdown()
        {
            OnStop();
            base.OnShutdown();
        }

        protected override void OnSessionChange(SessionChangeDescription changeDescription)
        {
            StopAgent();
            base.OnSessionChange(changeDescription);
        }

        private void MonitorLoop()
        {
            while (!stopping)
            {
                try { EnsureAgent(); }
                catch { }
                Thread.Sleep(2000);
            }
        }

        private bool AgentIsRunning()
        {
            if (agentProcess == IntPtr.Zero) return false;
            uint exitCode;
            return Native.GetExitCodeProcess(agentProcess, out exitCode) && exitCode == Native.STILL_ACTIVE;
        }

        private void EnsureAgent()
        {
            uint sessionId = Native.WTSGetActiveConsoleSessionId();
            if (sessionId == UInt32.MaxValue) return;
            if (AgentIsRunning() && agentSession == sessionId) return;
            StopAgent();
            StartAgent(sessionId);
        }

        private void StartAgent(uint sessionId)
        {
            IntPtr processToken = IntPtr.Zero;
            IntPtr primaryToken = IntPtr.Zero;
            Native.PROCESS_INFORMATION pi = new Native.PROCESS_INFORMATION();
            try
            {
                uint access = Native.TOKEN_ASSIGN_PRIMARY | Native.TOKEN_DUPLICATE | Native.TOKEN_QUERY |
                    Native.TOKEN_ADJUST_DEFAULT | Native.TOKEN_ADJUST_SESSIONID;
                if (!Native.OpenProcessToken(Native.GetCurrentProcess(), access, out processToken))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                if (!Native.DuplicateTokenEx(processToken, Native.MAXIMUM_ALLOWED, IntPtr.Zero,
                    Native.SecurityImpersonation, Native.TokenPrimary, out primaryToken))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                if (!Native.SetTokenInformation(primaryToken, Native.TokenSessionId, ref sessionId, sizeof(uint)))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

                string exe = Process.GetCurrentProcess().MainModule.FileName;
                Native.STARTUPINFO si = new Native.STARTUPINFO();
                si.cb = Marshal.SizeOf(typeof(Native.STARTUPINFO));
                si.lpDesktop = @"winsta0\default";
                StringBuilder command = new StringBuilder("\"" + exe + "\" --agent");
                if (!Native.CreateProcessAsUser(primaryToken, exe, command, IntPtr.Zero, IntPtr.Zero, false,
                    Native.CREATE_NO_WINDOW, IntPtr.Zero, Path.GetDirectoryName(exe), ref si, out pi))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

                agentProcess = pi.hProcess;
                agentSession = sessionId;
                Native.CloseHandle(pi.hThread);
                pi.hThread = IntPtr.Zero;
            }
            finally
            {
                if (pi.hThread != IntPtr.Zero) Native.CloseHandle(pi.hThread);
                if (primaryToken != IntPtr.Zero) Native.CloseHandle(primaryToken);
                if (processToken != IntPtr.Zero) Native.CloseHandle(processToken);
            }
        }

        private void StopAgent()
        {
            if (agentProcess != IntPtr.Zero)
            {
                try { Native.TerminateProcess(agentProcess, 0); }
                catch { }
                Native.CloseHandle(agentProcess);
                agentProcess = IntPtr.Zero;
            }
            agentSession = UInt32.MaxValue;
        }
    }

    internal static class InputAgent
    {
        [StructLayout(LayoutKind.Sequential)]
        internal struct MOUSEINPUT
        {
            internal int dx;
            internal int dy;
            internal uint mouseData;
            internal uint dwFlags;
            internal uint time;
            internal IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct KEYBDINPUT
        {
            internal ushort wVk;
            internal ushort wScan;
            internal uint dwFlags;
            internal uint time;
            internal IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Explicit)]
        internal struct INPUTUNION
        {
            [FieldOffset(0)] internal MOUSEINPUT mi;
            [FieldOffset(0)] internal KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct INPUT
        {
            internal uint type;
            internal INPUTUNION u;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint count, INPUT[] inputs, int size);

        [DllImport("user32.dll")]
        private static extern int GetSystemMetrics(int index);

        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;
        private const uint MOUSEEVENTF_MOVE = 0x0001;
        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
        private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
        private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_UNICODE = 0x0004;
        private const int SM_XVIRTUALSCREEN = 76;
        private const int SM_YVIRTUALSCREEN = 77;
        private const int SM_CXVIRTUALSCREEN = 78;
        private const int SM_CYVIRTUALSCREEN = 79;
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private static readonly int InputSize = Marshal.SizeOf(typeof(INPUT));
        private static double activeLeft;
        private static double activeTop;
        private static double activeWidth = GetSystemMetrics(0);
        private static double activeHeight = GetSystemMetrics(1);

        internal static void Run()
        {
            while (true)
            {
                try
                {
                    PipeSecurity security = new PipeSecurity();
                    security.SetAccessRuleProtection(true, false);
                    security.AddAccessRule(new PipeAccessRule(
                        new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
                        PipeAccessRights.FullControl, AccessControlType.Allow));
                    security.AddAccessRule(new PipeAccessRule(
                        new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
                        PipeAccessRights.ReadWrite, AccessControlType.Allow));
                    using (NamedPipeServerStream pipe = new NamedPipeServerStream(
                        "RuzgarDeskSecureInput", PipeDirection.In, 1, PipeTransmissionMode.Byte,
                        PipeOptions.None, 4096, 4096, security))
                    {
                        pipe.WaitForConnection();
                        using (StreamReader reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, true))
                        {
                            string line;
                            while ((line = reader.ReadLine()) != null) Dispatch(line);
                        }
                    }
                }
                catch { Thread.Sleep(500); }
            }
        }

        private static void MapAbsolute(double fx, double fy, out int nx, out int ny)
        {
            if (Double.IsNaN(fx) || Double.IsInfinity(fx)) fx = 0.5;
            if (Double.IsNaN(fy) || Double.IsInfinity(fy)) fy = 0.5;
            fx = Math.Max(0.0, Math.Min(1.0, fx));
            fy = Math.Max(0.0, Math.Min(1.0, fy));
            double vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
            double vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
            double vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            double vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            if (vw <= 0) vw = activeWidth;
            if (vh <= 0) vh = activeHeight;
            nx = Math.Max(0, Math.Min(65535, (int)Math.Round((activeLeft + fx * activeWidth - vx) / vw * 65535.0)));
            ny = Math.Max(0, Math.Min(65535, (int)Math.Round((activeTop + fy * activeHeight - vy) / vh * 65535.0)));
        }

        private static void Move(double fx, double fy, ref INPUT input)
        {
            int nx, ny;
            MapAbsolute(fx, fy, out nx, out ny);
            input.type = INPUT_MOUSE;
            input.u.mi.dx = nx;
            input.u.mi.dy = ny;
            input.u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
        }

        private static void MoveOnly(double fx, double fy)
        {
            INPUT[] input = new INPUT[1];
            Move(fx, fy, ref input[0]);
            SendInput(1, input, InputSize);
        }

        private static void Button(uint flag, double fx, double fy)
        {
            INPUT[] input = new INPUT[2];
            Move(fx, fy, ref input[0]);
            input[1].type = INPUT_MOUSE;
            input[1].u.mi.dwFlags = flag;
            SendInput(2, input, InputSize);
        }

        private static void Wheel(int delta, double fx, double fy)
        {
            INPUT[] input = new INPUT[2];
            Move(fx, fy, ref input[0]);
            input[1].type = INPUT_MOUSE;
            input[1].u.mi.mouseData = unchecked((uint)delta);
            input[1].u.mi.dwFlags = MOUSEEVENTF_WHEEL;
            SendInput(2, input, InputSize);
        }

        private static bool IsExtended(ushort vk)
        {
            switch (vk)
            {
                case 0x21: case 0x22: case 0x23: case 0x24:
                case 0x25: case 0x26: case 0x27: case 0x28:
                case 0x2D: case 0x2E: case 0x5B: case 0x5C:
                case 0x6F: case 0xA3: case 0xA5: return true;
                default: return false;
            }
        }

        private static void Key(ushort vk, bool down)
        {
            INPUT[] input = new INPUT[1];
            input[0].type = INPUT_KEYBOARD;
            input[0].u.ki.wVk = vk;
            uint flags = IsExtended(vk) ? KEYEVENTF_EXTENDEDKEY : 0;
            if (!down) flags |= KEYEVENTF_KEYUP;
            input[0].u.ki.dwFlags = flags;
            SendInput(1, input, InputSize);
        }

        private static void TypeUnit(ushort unit, bool up)
        {
            INPUT[] input = new INPUT[1];
            input[0].type = INPUT_KEYBOARD;
            input[0].u.ki.wScan = unit;
            input[0].u.ki.dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0);
            SendInput(1, input, InputSize);
        }

        private static void TypeCodepoint(int codepoint)
        {
            if (codepoint <= 0xFFFF)
            {
                TypeUnit((ushort)codepoint, false);
                TypeUnit((ushort)codepoint, true);
            }
            else
            {
                codepoint -= 0x10000;
                ushort high = (ushort)(0xD800 + (codepoint >> 10));
                ushort low = (ushort)(0xDC00 + (codepoint & 0x3FF));
                TypeUnit(high, false); TypeUnit(low, false);
                TypeUnit(high, true); TypeUnit(low, true);
            }
        }

        private static uint DownFlag(string button)
        {
            if (button == "R") return MOUSEEVENTF_RIGHTDOWN;
            if (button == "M") return MOUSEEVENTF_MIDDLEDOWN;
            return MOUSEEVENTF_LEFTDOWN;
        }

        private static uint UpFlag(string button)
        {
            if (button == "R") return MOUSEEVENTF_RIGHTUP;
            if (button == "M") return MOUSEEVENTF_MIDDLEUP;
            return MOUSEEVENTF_LEFTUP;
        }

        private static void Dispatch(string line)
        {
            try
            {
                string[] parts = line.Split(' ');
                double fx, fy;
                switch (parts[0])
                {
                    case "SCREEN":
                        activeLeft = Double.Parse(parts[1], Inv);
                        activeTop = Double.Parse(parts[2], Inv);
                        activeWidth = Double.Parse(parts[3], Inv);
                        activeHeight = Double.Parse(parts[4], Inv);
                        break;
                    case "M": MoveOnly(Double.Parse(parts[1], Inv), Double.Parse(parts[2], Inv)); break;
                    case "D": Button(DownFlag(parts[1]), Double.Parse(parts[2], Inv), Double.Parse(parts[3], Inv)); break;
                    case "U": Button(UpFlag(parts[1]), Double.Parse(parts[2], Inv), Double.Parse(parts[3], Inv)); break;
                    case "C":
                        fx = Double.Parse(parts[2], Inv); fy = Double.Parse(parts[3], Inv);
                        Button(DownFlag(parts[1]), fx, fy); Button(UpFlag(parts[1]), fx, fy);
                        break;
                    case "W": Wheel(Int32.Parse(parts[1], Inv), Double.Parse(parts[2], Inv), Double.Parse(parts[3], Inv)); break;
                    case "K": Key(UInt16.Parse(parts[1], Inv), parts[2] == "1"); break;
                    case "T": TypeCodepoint(Int32.Parse(parts[1], Inv)); break;
                }
            }
            catch { }
        }
    }

    internal static class Program
    {
        private static void Main(string[] args)
        {
            if (args.Length > 0 && String.Equals(args[0], "--agent", StringComparison.OrdinalIgnoreCase))
            {
                InputAgent.Run();
                return;
            }
            ServiceBase.Run(new InputService());
        }
    }
}

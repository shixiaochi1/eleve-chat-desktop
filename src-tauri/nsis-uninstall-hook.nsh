; NSIS 卸载钩子 — 卸载前 kill 进程，卸载后清理所有数据

; ── 通用变量定义 ──
; NSIS 不内置 $LOCALAPPDATA，需手动解析
Var LOCALAPPDATA_PATH

!macro NSIS_HOOK_POSTINSTALL
  ; 解析 LOCALAPPDATA 路径（安装时初始化，确保变量可用）
  ReadEnvStr $LOCALAPPDATA_PATH "LOCALAPPDATA"

  ; 创建数据根目录及子目录结构
  ; 对齐 Hermes ensure_hermes_home(): mkdir(parents=True, exist_ok=True)
  ; 用户选 D:\Eleve Chat\ 安装 → 数据在 D:\Eleve Chat\data\
  ; Tauri 启动时 resolve_and_set_eleve_home() 会设 ELEVE_HOME=$INSTDIR\data
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\data\cron"
  CreateDirectory "$INSTDIR\data\sessions"
  CreateDirectory "$INSTDIR\data\logs"
  CreateDirectory "$INSTDIR\data\skills"
  CreateDirectory "$INSTDIR\data\memories"
  CreateDirectory "$INSTDIR\data\hooks"
  CreateDirectory "$INSTDIR\data\pairing"
  CreateDirectory "$INSTDIR\data\app-data"
  CreateDirectory "$INSTDIR\data\runtime"
  CreateDirectory "$INSTDIR\data\boards"
  CreateDirectory "$INSTDIR\data\cache"
  CreateDirectory "$INSTDIR\data\cache\images"
  CreateDirectory "$INSTDIR\data\cache\audio"
  CreateDirectory "$INSTDIR\data\cache\terminal"
  CreateDirectory "$INSTDIR\data\cache\sandbox"
  CreateDirectory "$INSTDIR\data\cache\vision"
  CreateDirectory "$INSTDIR\data\cache\voice"
  CreateDirectory "$INSTDIR\data\cache\results"
  CreateDirectory "$INSTDIR\data\credentials"
  CreateDirectory "$INSTDIR\data\mcp-tokens"
!macroend

; ── 卸载前：强制终止所有相关进程 + 清理注册表 ──
!macro NSIS_HOOK_PREUNINSTALL
  ; 解析 LOCALAPPDATA 路径（卸载时也需要）
  ReadEnvStr $LOCALAPPDATA_PATH "LOCALAPPDATA"

  ; 清理开机自启注册表（无论是否启用都尝试删除）
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EleveChat"

  ; 按优先级尝试安全终止进程：
  ; 1. 读取 PID 文件（更精确，不误杀同名进程）
  ; 2. Fallback 到按映像名杀进程
  ClearErrors
  FileOpen $0 "$INSTDIR\data\runtime\gateway.pid" r
  FileRead $0 $1
  FileClose $0
  ${If} ${Errors}
    ; PID 文件不存在或不可读，fallback 到 /IM
    nsExec::Exec "taskkill /IM eleved.exe /F"
  ${Else}
    ; 按 PID 杀进程（更安全，不误杀同名进程）
    StrCpy $1 $1 -1 0  ; trim trailing newline
    nsExec::Exec "taskkill /PID $1 /F"
  ${EndIf}

  ; Kill Tauri 主进程（无 PID 文件，只能 /IM）
  nsExec::Exec "taskkill /IM eleve-chat-desktop.exe /F"
  ; Kill agent-browser sidecar
  nsExec::Exec "taskkill /IM agent-browser-win32-x64.exe /F"
  ; 等待进程完全退出（Windows 文件锁需要时间释放）
  Sleep 3000
!macroend

; ── 卸载后：清理所有运行时数据、缓存、临时文件 ──
;
; 闭环清单（安装/运行写入 → 卸载清理）：
;   A1 卸载注册表        → Tauri 框架自动清
;   A2 安装目录(exe等)   → Tauri 框架自动清
;   A3 data/ 子目录树    → U1 处理
;   A4 开始菜单快捷方式   → Tauri 框架自动清
;   R1 开机自启注册表    → PREUNINSTALL 已清
;   R2 WebView2 缓存    → U2 处理
;   R3 Tauri 配置目录    → U3 处理
;   R4 runtime/         → U1 处理
;   R5 logs/            → U1 处理
;   R6-R10 用户数据      → U1 处理
;   R11 临时文件         → U4 处理
;   R12 .eleve/         → U1 处理（旧版 pairing.rs 遗留，已修复但兜底清理）
;
!macro NSIS_HOOK_POSTUNINSTALL
  ; ── U1: 清理安装目录下的 data/ 和 .eleve/ ──
  ; Tauri v2 NSIS 提供 $DeleteAppDataCheckboxState 变量：
  ;   值为 1 表示用户勾选了"删除应用数据"，为 0 表示未勾选
  ${If} $DeleteAppDataCheckboxState = 1
    ; 用户明确要求删除全部数据
    RmDir /r "$INSTDIR\data"
    RmDir /r "$INSTDIR\.eleve"
  ${Else}
    ; 未勾选：保留用户数据，仅清理运行时临时文件
    RmDir /r "$INSTDIR\data\runtime"
    RmDir /r "$INSTDIR\data\logs"
    RmDir /r "$INSTDIR\.eleve"
  ${EndIf}

  ; ── U2: 清理 WebView2 缓存（AppData\Local\com.eleve.chat.desktop\）──
  ; NSIS 不内置 $LOCALAPPDATA，用 ReadEnvStr 解析的变量
  ${If} $LOCALAPPDATA_PATH != ""
    RmDir /r "$LOCALAPPDATA_PATH\com.eleve.chat.desktop"
  ${EndIf}

  ; ── U3: 清理 Tauri 配置目录（AppData\Roaming\com.eleve.chat.desktop\）──
  ; $APPDATA 是 NSIS 内置变量
  RmDir /r "$APPDATA\com.eleve.chat.desktop"

  ; ── 注册表残留 ──
  DeleteRegKey HKCU "Software\Eleve Chat"
  DeleteRegKey HKCU "Software\com.eleve.chat.desktop"

  ; ── U4: 清理临时文件 ──
  Delete "$TEMP\eleve-cwd-*.txt"

  ; ── U5: 删除安装目录本身 ──
  ; RmDir 仅删空目录，非空时安全跳过（data/ 残留时 $INSTDIR 非空）
  RmDir "$INSTDIR"
!macroend

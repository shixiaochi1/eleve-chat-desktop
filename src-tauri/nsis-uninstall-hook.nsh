; NSIS uninstall hook - 对齐 Hermes Windows 桌面端架构
; 数据目录: %LOCALAPPDATA%\Eleve（对齐 Hermes %LOCALAPPDATA%\hermes）
; 环境变量: ELEVE_HOME 写入注册表 HKCU\Environment（不广播）
;
; 对齐 Hermes 设计原则：
; 1. 数据目录放 %LOCALAPPDATA%\Eleve（位于 $INSTDIR 之外，卸载 RmDir $INSTDIR 不波及数据）
; 2. 安装时只创建根目录，子目录由应用运行时按需创建
; 3. 不用 SendMessage 广播（环境变量重启后生效即可）
; 4. 不用长 Sleep（500ms 足够）
;
; 🔴 Phase 3 修复：旧版曾把数据放 $INSTDIR\data，导致卸载末尾 RmDir /r "$INSTDIR"
; 无条件删除用户数据，使"删除应用数据"复选框门控失效。现改用 LOCALAPPDATA。

Var ELEVE_HOME_PATH
; 🔴 2026-08-08 卸载数据保留询问：0=删除数据 1=保留数据（默认 1 安全优先）
; 默认保留：MB_DEFBUTTON1（默认焦点在「是」= 保留），防误删用户配置
Var KEEP_DATA

!macro NSIS_HOOK_POSTINSTALL
  ; 🔴 2026-08-11 对齐老大 08-10 决策「装哪 data 在哪」（d17d911）：
  ;   安装版数据目录 = $INSTDIR\data（与运行时 resolve_eleve_home 步骤 2 的
  ;   resources 特征判定一致）——写注册表 ELEVE_HOME=$INSTDIR\data，即使
  ;   env/注册表优先级命中也是安装目录，双保险。
  ; 🔴 08-11 07:17 教训：曾加 %LOCALAPPDATA%\Eleve 反向兼容分支（旧数据沿用），
  ;   但老大是「卸载重装、不迁移」场景——AppData 残留命中兼容分支 → 数据仍落
  ;   AppData（07:11 实证）。老大拍板：无条件 $INSTDIR\data，AppData 旧数据
  ;   不沿用（残留由用户自行清理）。
  StrCpy $ELEVE_HOME_PATH "$INSTDIR\data"

  ; 只创建根目录，子目录由应用运行时按需创建（对齐 Hermes）
  CreateDirectory "$ELEVE_HOME_PATH"

  ; 设置 ELEVE_HOME 环境变量到注册表（不广播，重启后生效）
  WriteRegStr HKCU "Environment" "ELEVE_HOME" "$ELEVE_HOME_PATH"

  ; 🔴 2026-08-12 广播环境变量变更（WM_SETTINGCHANGE）：
  ;   写注册表不广播 → Explorer 环境快照不刷新 → 安装器直接启动的应用无 env、
  ;   重启电脑后才有 env，且若存在历史残留值（旧 setx）会先命中 env 分支 →
  ;   home 漂移分裂（重启后数据"消失"事故根因之一）。广播后当前会话立即一致。
  ; 🔴 2026-08-20 安装提速（用户反馈：安装到「创建文件夹: E:\Eleve\data」处长时间卡住）：
  ;   超时 5000→500ms——SendMessageTimeout 是同步等待，Explorer 消息队列繁忙/无响应时
  ;   会阻塞安装收尾（每次安装固定开销）；广播是"尽力而为"通知，500ms 未响应即可放弃，
  ;   不影响 env 生效（注册表已写，重启后必然生效；广播仅用于当前会话即时一致性）。
  System::Call 'user32::SendMessageTimeout(i 0xFFFF, i 0x001A, i 0, t "Environment", i 0x0002, i 500, *i r0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 删除开机启动项
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EleveChat"
  
  ; 杀进程（Job Object 兜底）
  nsExec::Exec "taskkill /IM eleved.exe /F"
  nsExec::Exec "taskkill /IM eleve-chat-desktop.exe /F"
  nsExec::Exec "taskkill /IM agent-browser-win32-x64.exe /F"
  
  ; 短等待（500ms 足够，不用 2000ms）
  Sleep 500

  ; 🔴 2026-08-08 老大诉求：卸载必须明确提示是否保留数据
  ; 更新模式（$UpdateMode=1）绝不询问（升级保留 providers.yaml/state.db）；
  ; 已在确认页勾选"删除应用程序数据"（$DeleteAppDataCheckboxState=1）则不重复询问。
  StrCpy $KEEP_DATA 1
  ${If} $UpdateMode <> 1
  ${AndIf} $DeleteAppDataCheckboxState <> 1
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 \
      "是否保留应用数据（配置/会话/日志/模型凭据）？$\r$\n$\r$\n选择「是」= 保留数据（推荐）$\r$\n选择「否」= 连同应用数据一起删除。" IDYES keep_data
    StrCpy $KEEP_DATA 0
    Goto ask_done
  keep_data:
    StrCpy $KEEP_DATA 1
  ask_done:
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 读取 ELEVE_HOME（从注册表）
  ReadRegStr $ELEVE_HOME_PATH HKCU "Environment" "ELEVE_HOME"
  
  ; 删除 ELEVE_HOME 环境变量（始终执行）
  DeleteRegValue HKCU "Environment" "ELEVE_HOME"
  
  ; 🔴 用户数据清理：尊重 Tauri 内置"删除应用程序数据"复选框 + 卸载弹窗询问结果
  ; 对齐 installer.nsi:812 的条件逻辑（$DeleteAppDataCheckboxState + $UpdateMode）
  ; 覆盖安装（$UpdateMode=1）时绝不清理数据（升级保留 providers.yaml/state.db）
  ; 🔴 2026-08-08 弹窗结果并入：$KEEP_DATA=0（用户明确选择删除）也执行清理
  ${If} $UpdateMode <> 1
  ${AndIf} $DeleteAppDataCheckboxState = 1
  ${OrIf} $KEEP_DATA = 0
    ; 删除数据目录（新版为 %LOCALAPPDATA%\Eleve，旧版存量为 $INSTDIR\data）
    ${If} $ELEVE_HOME_PATH != ""
      RmDir /r "$ELEVE_HOME_PATH"
    ${EndIf}
    ; 清理 legacy 目录 ~/.eleve
    ReadEnvStr $R2 "USERPROFILE"
    ${If} $R2 != ""
      RmDir /r "$R2\.eleve"
    ${EndIf}
  ${Else}
    ; 🔴 2026-08-08 数据保护（Phase 3 盲点修复）：用户选择保留数据，但 ELEVE_HOME 若位于
    ;    $INSTDIR 内（旧版兼容分支：安装时检测到 $INSTDIR\data 已存在 → 数据目录指到安装目录内），
    ;    下方 RmDir /r "$INSTDIR" 会连带删掉数据 → 先迁出到 %LOCALAPPDATA%\Eleve 再删安装目录。
    ;    前缀判断用原生 StrLen/StrCpy/StrCmp（StrLoc 宏在卸载器段有 un 前缀问题，弃用）
    ${If} $ELEVE_HOME_PATH != ""
      StrLen $1 "$INSTDIR"
      StrCpy $2 "$ELEVE_HOME_PATH" $1
      ${If} $2 == "$INSTDIR"
        CreateDirectory "$LOCALAPPDATA\Eleve"
        nsExec::ExecToLog 'cmd /c xcopy /E /I /Y "$ELEVE_HOME_PATH\*" "$LOCALAPPDATA\Eleve\"'
        RmDir /r "$ELEVE_HOME_PATH"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  
  ; Tauri 应用数据（APPDATA/LOCALAPPDATA）由 installer.nsi:824 条件清理，此处不重复
  
  ; 清理临时文件（始终执行，真正的临时产物）
  Delete "$TEMP\eleve-cwd-*.txt"
  RmDir /r "$TEMP\eleve-results"
  RmDir /r "$TEMP\eleve_test"
  RmDir /r "$TEMP\eleve_demo_project"
  RmDir /r "$TEMP\eleve_vision_images"
  nsExec::Exec 'cmd /c rd /s /q "%TEMP%\eleve_sandbox_*" 2>nul'
  nsExec::Exec 'cmd /c rd /s /q "%TEMP%\eleve_exec_*" 2>nul'
  
  ; 清理注册表（始终执行）
  DeleteRegKey HKCU "Software\Eleve Chat"
  DeleteRegKey HKCU "Software\com.eleve.chat.desktop"
  
  ; 删除安装目录（始终执行，Tauri 预期行为）。
  ; 🔴 Phase 3：数据目录已迁至 %LOCALAPPDATA%\Eleve（不在 $INSTDIR 内），故此处仅移除
  ;    应用程序文件，不再波及用户数据——数据删除仅由上面"删除应用数据"复选框门控。
  ;    （旧版 $INSTDIR\data 安装的存量用户除外，其数据随 $INSTDIR 移除，属历史遗留。）
  RmDir /r "$INSTDIR"
!macroend

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

!macro NSIS_HOOK_POSTINSTALL
  ; 🔴 Phase 3：数据目录默认 %LOCALAPPDATA%\Eleve（不在 $INSTDIR 内，卸载不误删）
  StrCpy $ELEVE_HOME_PATH "$LOCALAPPDATA\Eleve"
  ; 兼容：若旧版已在 $INSTDIR\data 存有数据（升级场景），沿用旧目录避免数据分裂
  IfFileExists "$INSTDIR\data\*.*" 0 +2
    StrCpy $ELEVE_HOME_PATH "$INSTDIR\data"

  ; 只创建根目录，子目录由应用运行时按需创建（对齐 Hermes）
  CreateDirectory "$ELEVE_HOME_PATH"

  ; 设置 ELEVE_HOME 环境变量到注册表（不广播，重启后生效）
  WriteRegStr HKCU "Environment" "ELEVE_HOME" "$ELEVE_HOME_PATH"
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
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; 读取 ELEVE_HOME（从注册表）
  ReadRegStr $ELEVE_HOME_PATH HKCU "Environment" "ELEVE_HOME"
  
  ; 删除 ELEVE_HOME 环境变量（始终执行）
  DeleteRegValue HKCU "Environment" "ELEVE_HOME"
  
  ; 🔴 用户数据清理：尊重 Tauri 内置"删除应用程序数据"复选框
  ; 对齐 installer.nsi:812 的条件逻辑（$DeleteAppDataCheckboxState + $UpdateMode）
  ; 覆盖安装（$UpdateMode=1）时绝不清理数据（升级保留 providers.yaml/state.db）
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; 删除数据目录（新版为 %LOCALAPPDATA%\Eleve，旧版存量为 $INSTDIR\data）
    ${If} $ELEVE_HOME_PATH != ""
      RmDir /r "$ELEVE_HOME_PATH"
    ${EndIf}
    ; 清理 legacy 目录 ~/.eleve
    ReadEnvStr $R2 "USERPROFILE"
    ${If} $R2 != ""
      RmDir /r "$R2\.eleve"
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

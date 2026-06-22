; NSIS uninstall hook - 对齐 Hermes 桌面端架构
; 数据目录: %LOCALAPPDATA%\Eleve\ (用户目录，有写权限)
; 环境变量: ELEVE_HOME 写入注册表 HKCU\Environment

Var LOCALAPPDATA_PATH
Var ELEVE_HOME_PATH

!macro NSIS_HOOK_POSTINSTALL
  ; 获取 LOCALAPPDATA
  ReadEnvStr $LOCALAPPDATA_PATH "LOCALAPPDATA"
  StrCpy $ELEVE_HOME_PATH "$LOCALAPPDATA_PATH\Eleve"
  
  ; 创建数据目录结构（对齐 Hermes %LOCALAPPDATA%\hermes\）
  CreateDirectory "$ELEVE_HOME_PATH"
  CreateDirectory "$ELEVE_HOME_PATH\cron"
  CreateDirectory "$ELEVE_HOME_PATH\sessions"
  CreateDirectory "$ELEVE_HOME_PATH\logs"
  CreateDirectory "$ELEVE_HOME_PATH\skills"
  CreateDirectory "$ELEVE_HOME_PATH\memories"
  CreateDirectory "$ELEVE_HOME_PATH\hooks"
  CreateDirectory "$ELEVE_HOME_PATH\pairing"
  CreateDirectory "$ELEVE_HOME_PATH\app-data"
  CreateDirectory "$ELEVE_HOME_PATH\runtime"
  CreateDirectory "$ELEVE_HOME_PATH\boards"
  CreateDirectory "$ELEVE_HOME_PATH\cache"
  CreateDirectory "$ELEVE_HOME_PATH\cache\images"
  CreateDirectory "$ELEVE_HOME_PATH\cache\audio"
  CreateDirectory "$ELEVE_HOME_PATH\cache\terminal"
  CreateDirectory "$ELEVE_HOME_PATH\cache\sandbox"
  CreateDirectory "$ELEVE_HOME_PATH\cache\vision"
  CreateDirectory "$ELEVE_HOME_PATH\cache\voice"
  CreateDirectory "$ELEVE_HOME_PATH\cache\results"
  CreateDirectory "$ELEVE_HOME_PATH\credentials"
  CreateDirectory "$ELEVE_HOME_PATH\mcp-tokens"
  
  ; 设置 ELEVE_HOME 环境变量到注册表（对齐 Hermes install.ps1）
  WriteRegStr HKCU "Environment" "ELEVE_HOME" "$ELEVE_HOME_PATH"
  ; 通知系统环境变量已更改
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ReadEnvStr $LOCALAPPDATA_PATH "LOCALAPPDATA"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EleveChat"
  ; 杀进程（Job Object 兜底，正常 500ms 内退出）
  nsExec::Exec "taskkill /IM eleved.exe /F"
  nsExec::Exec "taskkill /IM eleve-chat-desktop.exe /F"
  nsExec::Exec "taskkill /IM agent-browser-win32-x64.exe /F"
  Sleep 2000
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ReadEnvStr $LOCALAPPDATA_PATH "LOCALAPPDATA"
  ReadEnvStr $R1 "USERPROFILE"
  StrCpy $ELEVE_HOME_PATH "$LOCALAPPDATA_PATH\Eleve"
  
  ; 删除 ELEVE_HOME 环境变量（对齐 Hermes uninstall）
  DeleteRegValue HKCU "Environment" "ELEVE_HOME"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  
  ; 清理数据目录 %LOCALAPPDATA%\Eleve\
  ; 始终清理 runtime/cache/logs（安全删除）
  RmDir /r "$ELEVE_HOME_PATH\runtime"
  RmDir /r "$ELEVE_HOME_PATH\logs"
  RmDir /r "$ELEVE_HOME_PATH\cache\sandbox"
  RmDir /r "$ELEVE_HOME_PATH\cache\terminal"
  
  ; 清理安装目录中的 binaries（非用户数据）
  RmDir /r "$INSTDIR\binaries"
  
  ; 如果用户选择删除应用数据，清理全部
  IntCmp $DeleteAppDataCheckboxState 1 "" +5 +5
  RmDir /r "$ELEVE_HOME_PATH"
  RmDir /r "$LOCALAPPDATA_PATH\com.eleve.chat.desktop"
  RmDir /r "$APPDATA\com.eleve.chat.desktop"
  RmDir /r "$R1\.eleve"
  RmDir /r "$R1\voice-memos"
  
  ; 始终清理临时文件
  Delete "$TEMP\eleve-cwd-*.txt"
  RmDir /r "$TEMP\eleve-results"
  RmDir /r "$TEMP\eleve_test"
  RmDir /r "$TEMP\eleve_demo_project"
  RmDir /r "$TEMP\eleve_vision_images"
  nsExec::Exec 'cmd /c rd /s /q "%TEMP%\eleve_sandbox_*" 2>nul'
  nsExec::Exec 'cmd /c rd /s /q "%TEMP%\eleve_exec_*" 2>nul'
  
  ; 始终清理注册表
  DeleteRegKey HKCU "Software\Eleve Chat"
  DeleteRegKey HKCU "Software\com.eleve.chat.desktop"
  
  ; 删除安装目录
  RmDir "$INSTDIR"
!macroend

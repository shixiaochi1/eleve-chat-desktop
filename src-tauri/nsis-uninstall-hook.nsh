; NSIS uninstall hook - kill processes then clean all data
Var LOCALAPPDATA_PATH

!macro NSIS_HOOK_POSTINSTALL
  ReadEnvStr $LOCALAPPDATA_PATH "LOCALAPPDATA"
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

!macro NSIS_HOOK_PREUNINSTALL
  ReadEnvStr $LOCALAPPDATA_PATH "LOCALAPPDATA"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "EleveChat"
  ; 直接按进程名杀，不读 gateway.pid（它是 JSON 格式，NSIS 无法解析）
  nsExec::Exec "taskkill /IM eleved.exe /F"
  nsExec::Exec "taskkill /IM eleve-chat-desktop.exe /F"
  nsExec::Exec "taskkill /IM agent-browser-win32-x64.exe /F"
  ; 等待进程退出（Job Object 兜底，正常 500ms 内退出）
  Sleep 2000
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ReadEnvStr $LOCALAPPDATA_PATH "LOCALAPPDATA"
  ReadEnvStr $R1 "USERPROFILE"
  ReadEnvStr $R2 "WINDIR"

  ; Always clean runtime/cache/logs (safe to delete)
  RmDir /r "$INSTDIR\data\runtime"
  RmDir /r "$INSTDIR\data\logs"
  RmDir /r "$INSTDIR\data\cache\sandbox"
  RmDir /r "$INSTDIR\data\cache\terminal"
  RmDir /r "$INSTDIR\.eleve"

  ; Always clean binaries (non-user data, blocks $INSTDIR removal)
  RmDir /r "$INSTDIR\binaries"

  ; If user chose to delete app data, clean everything
  ; IntCmp: val1 val2 jump_equal jump_less jump_greater
  ; If != 1, skip 8 instructions forward
  IntCmp $DeleteAppDataCheckboxState 1 "" +8 +8
  RmDir /r "$INSTDIR\data"
  RmDir /r "$LOCALAPPDATA_PATH\com.eleve.chat.desktop"
  RmDir /r "$APPDATA\com.eleve.chat.desktop"
  RmDir /r "$APPDATA\Eleve"
  RmDir /r "$R1\.eleve"
  RmDir /r "$LOCALAPPDATA_PATH\eleve"
  RmDir /r "$R2\.eleve"
  RmDir /r "$R1\voice-memos"

  ; Always clean temp files
  Delete "$TEMP\eleve-cwd-*.txt"
  RmDir /r "$TEMP\eleve-results"
  RmDir /r "$TEMP\eleve_test"
  RmDir /r "$TEMP\eleve_demo_project"
  RmDir /r "$TEMP\eleve_vision_images"
  nsExec::Exec 'cmd /c rd /s /q "%TEMP%\eleve_sandbox_*" 2>nul'
  nsExec::Exec 'cmd /c rd /s /q "%TEMP%\eleve_exec_*" 2>nul'

  ; Always clean registry
  DeleteRegKey HKCU "Software\Eleve Chat"
  DeleteRegKey HKCU "Software\com.eleve.chat.desktop"

  ; Remove install directory (only works if empty)
  RmDir "$INSTDIR"
!macroend

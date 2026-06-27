; NSIS uninstall hook - 对齐 Hermes Windows 桌面端架构
; 数据目录: 跟随程序安装位置 $INSTDIR\data\
; 环境变量: ELEVE_HOME 写入注册表 HKCU\Environment（不广播）
;
; 对齐 Hermes 设计原则：
; 1. 数据目录跟随程序位置（程序装哪，数据存哪）
; 2. 安装时只创建根目录，子目录由应用运行时按需创建
; 3. 不用 SendMessage 广播（环境变量重启后生效即可）
; 4. 不用长 Sleep（500ms 足够）

Var ELEVE_HOME_PATH

!macro NSIS_HOOK_POSTINSTALL
  ; 数据目录跟随程序安装位置（对齐 Hermes: 程序装哪，数据存哪）
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
  
  ; 删除 ELEVE_HOME 环境变量（不广播）
  DeleteRegValue HKCU "Environment" "ELEVE_HOME"
  
  ; 删除数据目录（跟随程序位置）
  ${If} $ELEVE_HOME_PATH != ""
    RmDir /r "$ELEVE_HOME_PATH"
  ${EndIf}
  
  ; 🔴 清理 legacy 目录 ~/.eleve（对齐 Hermes）
  ; 用户可能从旧版本升级，需要清理 legacy 数据目录
  ReadEnvStr $R2 "USERPROFILE"
  ${If} $R2 != ""
    RmDir /r "$R2\.eleve"
  ${EndIf}
  
  ; 清理 Tauri 应用数据
  ReadEnvStr $R0 "LOCALAPPDATA"
  RmDir /r "$R0\com.eleve.chat.desktop"
  ReadEnvStr $R1 "APPDATA"
  RmDir /r "$R1\com.eleve.chat.desktop"
  
  ; 清理临时文件
  Delete "$TEMP\eleve-cwd-*.txt"
  RmDir /r "$TEMP\eleve-results"
  RmDir /r "$TEMP\eleve_test"
  RmDir /r "$TEMP\eleve_demo_project"
  RmDir /r "$TEMP\eleve_vision_images"
  nsExec::Exec 'cmd /c rd /s /q "%TEMP%\eleve_sandbox_*" 2>nul'
  nsExec::Exec 'cmd /c rd /s /q "%TEMP%\eleve_exec_*" 2>nul'
  
  ; 清理注册表
  DeleteRegKey HKCU "Software\Eleve Chat"
  DeleteRegKey HKCU "Software\com.eleve.chat.desktop"
  
  ; 删除安装目录
  RmDir /r "$INSTDIR"
!macroend

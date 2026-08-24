Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define ROOT "..\..\.."

Name "ClawKit Desktop"
OutFile "${ROOT}\dist\windows\ClawKit-${VERSION}-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\ClawKit"
InstallDirRegKey HKCU "Software\ClawKit" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ICON "${ROOT}\apps\codex-plus-manager\src-tauri\icons\icon.ico"
!define MUI_UNICON "${ROOT}\apps\codex-plus-manager\src-tauri\icons\icon.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"

  nsExec::ExecToLog 'taskkill /IM codex-plus-plus.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM codex-plus-plus-manager.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM clawkit-desktop.exe /F'
  Pop $0

  File "${ROOT}\dist\windows\app\clawkit-desktop.exe"
  File "${ROOT}\dist\windows\app\codex-plus-plus.exe"
  File "${ROOT}\dist\windows\app\codex-plus-plus-manager.exe"

  Delete "$DESKTOP\Codex++ 绠＄悊宸ュ叿.lnk"
  Delete "$SMPROGRAMS\Codex++\Codex++ 绠＄悊宸ュ叿.lnk"

  CreateShortcut "$DESKTOP\ClawKit Desktop.lnk" "$INSTDIR\clawkit-desktop.exe" "" "$INSTDIR\clawkit-desktop.exe"
  CreateShortcut "$DESKTOP\ClawKit Codex.lnk" "$INSTDIR\codex-plus-plus.exe" "" "$INSTDIR\codex-plus-plus.exe"
  CreateDirectory "$SMPROGRAMS\ClawKit"
  CreateShortcut "$SMPROGRAMS\ClawKit\ClawKit Desktop.lnk" "$INSTDIR\clawkit-desktop.exe" "" "$INSTDIR\clawkit-desktop.exe"
  CreateShortcut "$SMPROGRAMS\ClawKit\ClawKit Codex.lnk" "$INSTDIR\codex-plus-plus.exe" "" "$INSTDIR\codex-plus-plus.exe"
  CreateShortcut "$SMPROGRAMS\ClawKit\ClawKit Settings.lnk" "$INSTDIR\codex-plus-plus-manager.exe" "" "$INSTDIR\codex-plus-plus-manager.exe"
  CreateShortcut "$SMPROGRAMS\ClawKit\卸载 ClawKit.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\codex-plus-plus-manager.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\ClawKit" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClawKit" "DisplayName" "ClawKit Desktop"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClawKit" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClawKit" "Publisher" "ClawKit"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClawKit" "DisplayIcon" "$INSTDIR\clawkit-desktop.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClawKit" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClawKit" "UninstallString" "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'taskkill /IM codex-plus-plus.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM codex-plus-plus-manager.exe /F'
  Pop $0
  nsExec::ExecToLog 'taskkill /IM clawkit-desktop.exe /F'
  Pop $0

  Delete "$DESKTOP\Codex++.lnk"
  Delete "$DESKTOP\Codex++ 管理工具.lnk"
  Delete "$DESKTOP\ClawKit.lnk"
  Delete "$DESKTOP\ClawKit Desktop.lnk"
  Delete "$DESKTOP\ClawKit Codex.lnk"
  Delete "$DESKTOP\Codex++ 绠＄悊宸ュ叿.lnk"
  Delete "$SMPROGRAMS\Codex++\Codex++.lnk"
  Delete "$SMPROGRAMS\Codex++\Codex++ 管理工具.lnk"
  Delete "$SMPROGRAMS\Codex++\Codex++ 绠＄悊宸ュ叿.lnk"
  Delete "$SMPROGRAMS\Codex++\卸载 Codex++.lnk"
  RMDir "$SMPROGRAMS\Codex++"
  Delete "$SMPROGRAMS\ClawKit\ClawKit Desktop.lnk"
  Delete "$SMPROGRAMS\ClawKit\ClawKit Codex.lnk"
  Delete "$SMPROGRAMS\ClawKit\ClawKit Settings.lnk"
  Delete "$SMPROGRAMS\ClawKit\卸载 ClawKit.lnk"
  RMDir "$SMPROGRAMS\ClawKit"

  Delete "$INSTDIR\clawkit-desktop.exe"
  Delete "$INSTDIR\codex-plus-plus.exe"
  Delete "$INSTDIR\codex-plus-plus-manager.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Codex++"
  DeleteRegKey HKCU "Software\Codex++"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ClawKit"
  DeleteRegKey HKCU "Software\ClawKit"
SectionEnd

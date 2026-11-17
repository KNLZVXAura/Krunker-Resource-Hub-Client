# KRH Client Uninstaller (Windows)
#
# A small stand-alone program that ships with every KRH Client release next to the installers. It removes the program however it was
# installed (the Setup.exe installer, the .msi, for one user or for all users) and asks whether your data goes too:
#
#   Keep my data (default)  settings, saved accounts, userscripts, swapper files, statistics, backups stay where they are, so a later
#                           reinstall picks up where you left off.
#   Delete my data          everything in %APPDATA%\krh-client, and the temporary update files.
#   + recordings and pictures   the clips / recordings / weekly cards KRH Client saved in Videos and Pictures, and the mods it saved
#                           in Downloads\KRH Client. Separate on purpose: those are YOUR videos, never deleted without asking.
#
# Folders you picked yourself (for example a backup copy folder) are never touched.
# A portable copy has no installer: this removes its data; the .exe itself you delete by hand.
#
# Silent use (admins, scripts):  "KRH Client-X-Uninstaller.exe" /S [/DELETEDATA] [/DELETEMEDIA] [/KEEPPROGRAM]
#   /S            no windows; keeps the data unless /DELETEDATA is given
#   /DELETEDATA   delete the data folder
#   /DELETEMEDIA  with /DELETEDATA: also the recordings, pictures and downloaded mods
#   /KEEPPROGRAM  leave the program installed (only the data is removed)
#
# Build:  makensis -DVERSION=4.1.0 -DVERSION4=4.1.0.0 "-DOUTFILE=out/KRH Client-4.1.0-Uninstaller.exe" build/uninstaller/krh-uninstaller.nsi
# (CI does this on the Linux job: NSIS compiles the Windows .exe fine there.) The script uses only what NSIS ships with.

Unicode true
SetCompressor /SOLID lzma
ManifestDPIAware true
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef VERSION4
  !define VERSION4 "0.0.0.0"
!endif
!ifndef OUTFILE
  !define OUTFILE "krh-uninstaller.exe"
!endif

!define APPNAME "KRH Client"
!define EXENAME "KRH Client.exe"
!define DATAFOLDER "krh-client"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall"

Name "${APPNAME} Uninstaller"
OutFile "${OUTFILE}"
BrandingText "${APPNAME} ${VERSION}"
ShowInstDetails show
AutoCloseWindow false

VIProductVersion "${VERSION4}"
VIAddVersionKey "ProductName" "${APPNAME} Uninstaller"
VIAddVersionKey "FileDescription" "${APPNAME} Uninstaller"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "KRH Client"

!include MUI2.nsh
!include LogicLib.nsh
!include nsDialogs.nsh
!include FileFunc.nsh
!include WordFunc.nsh
!include WinMessages.nsh

!insertmacro GetParameters
!insertmacro GetOptions
!insertmacro GetParent
!insertmacro WordFind

!define MUI_ICON "uninstaller.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_NOAUTOCLOSE
# the wizard's words are for installing: this one removes
!define MUI_PAGE_HEADER_TEXT "Removing"
!define MUI_PAGE_HEADER_SUBTEXT "Please wait while ${APPNAME} is removed."
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Finished"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "This is what was done."
!define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "Finished with problems"
!define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "Something could not be removed: see the lines in the log."
!define MUI_FINISHPAGE_TITLE "${APPNAME} Uninstaller"
!define MUI_FINISHPAGE_TEXT "The uninstaller has finished.$\r$\n$\r$\nIf the log shows a problem, close ${APPNAME} and run this uninstaller again."

# ---- debug log (only when compiled with -DDEBUG) ----
!ifdef DEBUG
  !macro Dbg TEXT
    FileOpen $9 "$TEMP\krh-uninstaller-debug.txt" a
    FileSeek $9 0 END
    FileWrite $9 "${TEXT}$\r$\n"
    FileClose $9
  !macroend
!else
  !macro Dbg TEXT
  !macroend
!endif

# ---- state ----
Var FoundNsis         # 1 when a Setup.exe (NSIS) install was found
Var NsisCommand       # its UninstallString from the registry (the exe in quotes + /currentuser or /allusers)
Var NsisExe           # the uninstaller exe, without quotes
Var NsisDir           # the folder of that exe (the install folder)
Var NsisAllUsers      # 1 when it is an all-users install (needs administrator)
Var FoundMsi          # 1 when an .msi install was found
Var MsiCode           # its product code, "{GUID}"
Var MsiAllUsers
Var InstalledName     # "KRH Client 4.1.0" for the page

Var RemoveProgram     # 1 = remove the program
Var DeleteData        # 1 = delete %APPDATA%\krh-client
Var DeleteMedia       # 1 = also Videos / Pictures / Downloads folders of KRH Client
Var HasProblem
Var Params            # the command line (not a register: the detection below uses $R0-$R5)

Var RemoveBox
Var KeepRadio
Var DeleteRadio
Var MediaBox

# ---- finding installs ----

!macro ScanUninstall ROOT VIEW ALLUSERS
  SetRegView ${VIEW}
  StrCpy $R0 0
  ${Do}
    ClearErrors
    EnumRegKey $R1 ${ROOT} "${UNINSTALL_KEY}" $R0
    ${If} ${Errors}
    ${OrIf} $R1 == ""
      ${ExitDo}
    ${EndIf}
    IntOp $R0 $R0 + 1
    ReadRegStr $R2 ${ROOT} "${UNINSTALL_KEY}\$R1" "DisplayName"
    # electron-builder names it "KRH Client 4.1.0" (NSIS) or "KRH Client" (MSI)
    StrCpy $R3 $R2 11
    ${If} $R2 == "${APPNAME}"
    ${OrIf} $R3 == "${APPNAME} "
      ReadRegDWORD $R4 ${ROOT} "${UNINSTALL_KEY}\$R1" "WindowsInstaller"
      ${If} $R4 == 1
        ${If} $FoundMsi != 1
          StrCpy $FoundMsi 1
          StrCpy $MsiCode $R1
          StrCpy $MsiAllUsers ${ALLUSERS}
          StrCpy $InstalledName $R2
        ${EndIf}
      ${Else}
        ReadRegStr $R5 ${ROOT} "${UNINSTALL_KEY}\$R1" "UninstallString"
        ${If} $R5 != ""
        ${AndIf} $FoundNsis != 1
          StrCpy $FoundNsis 1
          StrCpy $NsisCommand $R5
          StrCpy $NsisAllUsers ${ALLUSERS}
          StrCpy $InstalledName $R2
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${Loop}
!macroend

Function DetectInstalls
  StrCpy $FoundNsis 0
  StrCpy $FoundMsi 0
  StrCpy $InstalledName ""
  !insertmacro ScanUninstall HKCU 64 0
  !insertmacro ScanUninstall HKCU 32 0
  !insertmacro ScanUninstall HKLM 64 1
  !insertmacro ScanUninstall HKLM 32 1
  SetRegView 32

  # the uninstaller exe is the quoted part of the UninstallString
  ${If} $FoundNsis == 1
    StrCpy $R0 $NsisCommand 1
    ${If} $R0 == '"'
      StrCpy $R1 $NsisCommand "" 1
      ${WordFind} $R1 '"' "+1" $NsisExe
    ${Else}
      ${WordFind} $NsisCommand " /" "+1" $NsisExe
    ${EndIf}
    ${GetParent} $NsisExe $NsisDir
    ${IfNot} ${FileExists} $NsisExe
      # the files are gone already: only the registry entry is left behind
      StrCpy $FoundNsis 0
    ${EndIf}
  ${EndIf}
FunctionEnd

# ---- starting ----

Function .onInit
  ${GetParameters} $Params
  !insertmacro Dbg "onInit params=[$Params]"
  Call DetectInstalls
  !insertmacro Dbg "after detect: nsis=$FoundNsis msi=$FoundMsi exe=[$NsisExe] dir=[$NsisDir] cmd=[$NsisCommand]"

  StrCpy $RemoveProgram 0
  ${If} $FoundNsis == 1
  ${OrIf} $FoundMsi == 1
    StrCpy $RemoveProgram 1
  ${EndIf}
  StrCpy $DeleteData 0
  StrCpy $DeleteMedia 0
  StrCpy $HasProblem 0

  # command line (used for silent runs; the window shows the same choices)
  ClearErrors
  ${GetOptions} $Params "/DELETEDATA" $R1
  ${IfNot} ${Errors}
    StrCpy $DeleteData 1
  ${EndIf}
  ClearErrors
  ${GetOptions} $Params "/DELETEMEDIA" $R1
  ${IfNot} ${Errors}
    StrCpy $DeleteMedia 1
  ${EndIf}
  ClearErrors
  ${GetOptions} $Params "/KEEPPROGRAM" $R1
  ${IfNot} ${Errors}
    StrCpy $RemoveProgram 0
  ${EndIf}
  ${If} $DeleteData != 1
    StrCpy $DeleteMedia 0
  ${EndIf}
FunctionEnd

# ---- the choices page ----

Page custom OptionsCreate OptionsLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

Function OptionsCreate
  !insertmacro MUI_HEADER_TEXT "Uninstall ${APPNAME}" "Choose what to remove."
  nsDialogs::Create 1018
  Pop $0

  # what was found
  ${If} $FoundNsis == 1
  ${OrIf} $FoundMsi == 1
    ${If} $FoundNsis == 1
      ${If} $NsisAllUsers == 1
        ${NSD_CreateLabel} 0 0 100% 16u "Found: $InstalledName (installed for all users)"
      ${Else}
        ${NSD_CreateLabel} 0 0 100% 16u "Found: $InstalledName (installed for this user)"
      ${EndIf}
    ${Else}
      ${NSD_CreateLabel} 0 0 100% 16u "Found: $InstalledName (installed with the .msi)"
    ${EndIf}
  ${Else}
    ${NSD_CreateLabel} 0 0 100% 18u "No installed copy of ${APPNAME} was found. A portable copy has nothing to uninstall: delete its .exe yourself. You can still remove its data below."
  ${EndIf}
  Pop $0

  ${NSD_CreateCheckbox} 0 20u 100% 12u "Remove the ${APPNAME} program"
  Pop $RemoveBox
  ${If} $FoundNsis == 1
  ${OrIf} $FoundMsi == 1
    ${If} $RemoveProgram == 1
      ${NSD_Check} $RemoveBox
    ${EndIf}
  ${Else}
    EnableWindow $RemoveBox 0
  ${EndIf}

  ${NSD_CreateGroupBox} 0 36u 100% 80u "My data"
  Pop $0
  ${NSD_CreateRadioButton} 8u 47u 96% 20u "Keep my data (settings, saved accounts, userscripts, statistics, backups). If you install ${APPNAME} again later you pick up where you left off."
  Pop $KeepRadio
  ${NSD_AddStyle} $KeepRadio ${WS_GROUP}
  ${NSD_CreateRadioButton} 8u 68u 96% 20u "Delete my data too: everything in %APPDATA%\${DATAFOLDER} (settings, saved accounts, userscripts, swapper files, statistics, backups, logs)."
  Pop $DeleteRadio
  ${NSD_CreateCheckbox} 20u 90u 88% 22u "Also delete the recordings, clips and pictures ${APPNAME} saved in Videos and Pictures, and the mods it saved in Downloads"
  Pop $MediaBox
  ${If} $DeleteData == 1
    ${NSD_Check} $DeleteRadio
    ${If} $DeleteMedia == 1
      ${NSD_Check} $MediaBox
    ${EndIf}
  ${Else}
    ${NSD_Check} $KeepRadio
    EnableWindow $MediaBox 0
  ${EndIf}
  ${NSD_OnClick} $KeepRadio OptionsRadioClick
  ${NSD_OnClick} $DeleteRadio OptionsRadioClick

  # the Next button says what it does
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Uninstall"

  nsDialogs::Show
FunctionEnd

Function OptionsRadioClick
  ${NSD_GetState} $DeleteRadio $0
  ${If} $0 == 1
    EnableWindow $MediaBox 1
  ${Else}
    ${NSD_Uncheck} $MediaBox
    EnableWindow $MediaBox 0
  ${EndIf}
FunctionEnd

Function OptionsLeave
  ${NSD_GetState} $RemoveBox $RemoveProgram
  ${NSD_GetState} $DeleteRadio $DeleteData
  ${NSD_GetState} $MediaBox $DeleteMedia
  ${If} $DeleteData != 1
    StrCpy $DeleteMedia 0
  ${EndIf}

  ${If} $RemoveProgram != 1
  ${AndIf} $DeleteData != 1
    MessageBox MB_OK|MB_ICONINFORMATION "Nothing is selected: tick the program, or choose to delete your data."
    Abort
  ${EndIf}

  ${If} $DeleteData == 1
    ${If} $DeleteMedia == 1
      StrCpy $R0 "All your ${APPNAME} data will be deleted, including the recordings, clips and pictures it saved in Videos and Pictures."
    ${Else}
      StrCpy $R0 "All your ${APPNAME} settings, saved accounts, userscripts, statistics and backups will be deleted."
    ${EndIf}
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "$R0$\r$\n$\r$\nThis cannot be undone. Continue?" IDYES +2
    Abort
  ${EndIf}
FunctionEnd

# ---- doing it ----

Function IsAppRunning
  # $0 = 1 when "KRH Client.exe" is running
  StrCpy $0 0
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq ${EXENAME}" /NH'
  Pop $1
  Pop $2
  ${If} $1 == 0
    ${WordFind} $2 "${EXENAME}" "E+1" $3
    ${IfNot} ${Errors}
      StrCpy $0 1
    ${EndIf}
  ${EndIf}
FunctionEnd

Function CloseApp
  # Silent runs have nobody to ask: the app is simply closed (taskkill says "not found" when it is not running, which is fine)
  ${If} ${Silent}
    nsExec::ExecToLog 'taskkill /F /T /IM "${EXENAME}"'
    Pop $1
    ${If} $1 == 0
      Sleep 1500
    ${EndIf}
    Return
  ${EndIf}
  Call IsAppRunning
  ${If} $0 == 1
    MessageBox MB_YESNO|MB_ICONQUESTION "${APPNAME} is running and has to be closed first.$\r$\n$\r$\nClose it now? Anything unsaved in the game is lost." IDYES +2
    Abort
    DetailPrint "Closing ${APPNAME}..."
    nsExec::ExecToLog 'taskkill /F /T /IM "${EXENAME}"'
    Pop $1
    Sleep 1500
  ${EndIf}
FunctionEnd

Function RemoveNsisInstall
  ${If} $NsisAllUsers == 1
    UserInfo::GetAccountType
    Pop $1
    ${If} $1 != "Admin"
      DetailPrint "This copy is installed for all users: run this uninstaller as administrator (right-click it, Run as administrator)."
      StrCpy $HasProblem 1
      Return
    ${EndIf}
  ${EndIf}
  DetailPrint "Removing the program from $NsisDir ..."
  # /S = silent, _?= = run in place and wait (the uninstaller does not copy itself away), so it can be removed afterwards
  ExecWait '$NsisCommand /S _?=$NsisDir' $1
  ${If} $1 != 0
    DetailPrint "The uninstaller of ${APPNAME} reported code $1."
    StrCpy $HasProblem 1
  ${EndIf}
  Delete "$NsisExe"
  RMDir "$NsisDir"
  DetailPrint "Program removed."
FunctionEnd

Function RemoveMsiInstall
  ${If} $MsiAllUsers == 1
    UserInfo::GetAccountType
    Pop $1
    ${If} $1 != "Admin"
      DetailPrint "This copy is installed for all users: run this uninstaller as administrator (right-click it, Run as administrator)."
      StrCpy $HasProblem 1
      Return
    ${EndIf}
  ${EndIf}
  DetailPrint "Removing the .msi install ($MsiCode) ..."
  ${If} ${Silent}
    ExecWait 'msiexec /x "$MsiCode" /qn /norestart' $1
  ${Else}
    ExecWait 'msiexec /x "$MsiCode" /qb /norestart' $1
  ${EndIf}
  # 0 = done, 3010 = done but a restart is pending
  ${If} $1 != 0
  ${AndIf} $1 != 3010
    DetailPrint "The Windows Installer reported code $1."
    StrCpy $HasProblem 1
  ${Else}
    DetailPrint "Program removed."
  ${EndIf}
FunctionEnd

Section "Removal"
  SetDetailsPrint both
  !insertmacro Dbg "section: remove=$RemoveProgram data=$DeleteData media=$DeleteMedia"

  ${If} $RemoveProgram == 1
    Call CloseApp
    ${If} $FoundNsis == 1
      Call RemoveNsisInstall
    ${EndIf}
    ${If} $FoundMsi == 1
      Call RemoveMsiInstall
    ${EndIf}
  ${ElseIf} $DeleteData == 1
    Call CloseApp
  ${EndIf}

  ${If} $DeleteData == 1
    DetailPrint "Deleting your data in $APPDATA\${DATAFOLDER} ..."
    ${If} ${FileExists} "$APPDATA\${DATAFOLDER}\*.*"
      RMDir /r "$APPDATA\${DATAFOLDER}"
    ${EndIf}
    ${If} ${FileExists} "$APPDATA\${DATAFOLDER}"
      DetailPrint "Some files could not be deleted (in use or protected). Close ${APPNAME} and run this again."
      StrCpy $HasProblem 1
    ${Else}
      DetailPrint "Data deleted."
    ${EndIf}
    ${If} ${FileExists} "$TEMP\krh-update\*.*"
      RMDir /r "$TEMP\krh-update"
    ${EndIf}
    # the krh:// link registration of the app (the installer's own uninstaller removes it too), in both registry views
    SetRegView 64
    DeleteRegKey HKCU "Software\Classes\krh"
    SetRegView 32
    DeleteRegKey HKCU "Software\Classes\krh"

    ${If} $DeleteMedia == 1
      DetailPrint "Deleting recordings, pictures and mods ${APPNAME} saved ..."
      ${If} ${FileExists} "$VIDEOS\${APPNAME}\*.*"
        RMDir /r "$VIDEOS\${APPNAME}"
      ${EndIf}
      ${If} ${FileExists} "$PICTURES\${APPNAME}\*.*"
        RMDir /r "$PICTURES\${APPNAME}"
      ${EndIf}
      ${If} ${FileExists} "$PROFILE\Downloads\${APPNAME}\*.*"
        RMDir /r "$PROFILE\Downloads\${APPNAME}"
      ${EndIf}
      DetailPrint "Done."
    ${EndIf}
  ${Else}
    DetailPrint "Your data was kept."
  ${EndIf}

  ${If} $HasProblem == 1
    DetailPrint " "
    DetailPrint "Finished with problems: see the lines above."
  ${Else}
    DetailPrint " "
    DetailPrint "All done."
  ${EndIf}
SectionEnd

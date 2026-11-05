# Included before MUI2/nsDialogs are loaded, so pages and functions must stay
# inside the custom* macros (electron-builder expands them after those includes).

!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_LINK "KRH Client on GitHub"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client"

  !macro customWelcomePage
    !define MUI_WELCOMEPAGE_TITLE "KRH Client"
    !define MUI_WELCOMEPAGE_TEXT "Open-source Krunker client with uncapped FPS, resource swapper, matchmaker filters and userscripts.$\r$\n$\r$\nClick Next to install."
    !insertmacro MUI_PAGE_WELCOME
  !macroend

  # The desktop and Start menu shortcuts are created here (electron-builder's own ones are switched off with
  # createDesktopShortcut / createStartMenuShortcut: false) so the user can choose. Silent installs keep the old
  # behaviour: both created. A variable stays empty until the page was shown, which counts as "yes".
  Var desktopShortcutBox
  Var createDesktopShortcut
  Var startMenuShortcutBox
  Var createStartMenuShortcut

  !macro customPageAfterChangeDir
    Page custom desktopShortcutPageCreate desktopShortcutPageLeave

    Function desktopShortcutPageCreate
      # an update keeps the shortcuts the user already has
      ${if} ${isUpdated}
        Abort
      ${endIf}
      ${if} ${Silent}
        Abort
      ${endIf}
      !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose which shortcuts ${PRODUCT_NAME} creates"
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateLabel} 0 0 100% 24u "Choose which shortcuts ${PRODUCT_NAME} creates."
      Pop $0
      ${NSD_CreateCheckbox} 0 32u 100% 12u "Create a desktop shortcut"
      Pop $desktopShortcutBox
      ${if} $createDesktopShortcut == "0"
        ${NSD_Uncheck} $desktopShortcutBox
      ${else}
        ${NSD_Check} $desktopShortcutBox
      ${endIf}
      ${NSD_CreateCheckbox} 0 50u 100% 12u "Add ${PRODUCT_NAME} to the Start menu (right-click it there to pin it to Start)"
      Pop $startMenuShortcutBox
      ${if} $createStartMenuShortcut == "0"
        ${NSD_Uncheck} $startMenuShortcutBox
      ${else}
        ${NSD_Check} $startMenuShortcutBox
      ${endIf}
      nsDialogs::Show
    FunctionEnd

    Function desktopShortcutPageLeave
      ${NSD_GetState} $desktopShortcutBox $createDesktopShortcut
      ${NSD_GetState} $startMenuShortcutBox $createStartMenuShortcut
    FunctionEnd
  !macroend

  !macro customInstall
    ${ifNot} ${isUpdated}
    ${andIf} $createDesktopShortcut != "0"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endIf}
    ${ifNot} ${isUpdated}
    ${andIf} $createStartMenuShortcut != "0"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endIf}
  !macroend
!endif

!ifdef BUILD_UNINSTALLER
  Var unDeleteSettings
  Var unDeleteContent
  Var unDeleteSettingsBox
  Var unDeleteContentBox

  !macro customUnWelcomePage
    UninstPage custom un.removalPageCreate un.removalPageLeave

    Function un.removalPageCreate
      !insertmacro MUI_HEADER_TEXT "Uninstall ${PRODUCT_NAME}" "Choose what to remove"
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateLabel} 0 0 100% 28u "${PRODUCT_NAME} will be uninstalled. Your settings and files are kept unless selected below."
      Pop $0
      ${NSD_CreateCheckbox} 0 40u 100% 12u "Delete settings, saved accounts and logs"
      Pop $unDeleteSettingsBox
      ${NSD_CreateCheckbox} 0 56u 100% 12u "Delete swapper files, userscripts and screenshots"
      Pop $unDeleteContentBox
      nsDialogs::Show
    FunctionEnd

    Function un.removalPageLeave
      ${NSD_GetState} $unDeleteSettingsBox $unDeleteSettings
      ${NSD_GetState} $unDeleteContentBox $unDeleteContent
    FunctionEnd
  !macroend

  !macro customUnInstall
    ${ifNot} ${isUpdated}
      DeleteRegKey HKCU "Software\Classes\krh"
    ${endIf}
    # both shortcuts are made by customInstall, so electron-builder's uninstaller does not know them
    ${ifNot} ${isKeepShortcuts}
      WinShell::UninstShortcut "$oldDesktopLink"
      Delete "$oldDesktopLink"
      WinShell::UninstShortcut "$oldStartMenuLink"
      Delete "$oldStartMenuLink"
    ${endIf}
    ${if} $unDeleteSettings == 1
    ${orIf} $unDeleteContent == 1
      # electron user data is always per-user
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endIf}
      ${if} $unDeleteSettings == 1
      ${andIf} $unDeleteContent == 1
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      ${elseIf} $unDeleteContent == 1
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\KRH Client"
      ${else}
        # settings only: keep the user-content subfolder, remove the rest
        FindFirst $R1 $R2 "$APPDATA\${APP_PACKAGE_NAME}\*.*"
        ${Do}
          ${if} $R2 == ""
            ${ExitDo}
          ${endIf}
          ${if} $R2 != "."
          ${andIf} $R2 != ".."
          ${andIf} $R2 != "KRH Client"
            ${if} ${FileExists} "$APPDATA\${APP_PACKAGE_NAME}\$R2\*.*"
              RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\$R2"
            ${else}
              Delete "$APPDATA\${APP_PACKAGE_NAME}\$R2"
            ${endIf}
          ${endIf}
          FindNext $R1 $R2
        ${Loop}
        FindClose $R1
      ${endIf}
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endIf}
    ${endIf}
  !macroend
!endif

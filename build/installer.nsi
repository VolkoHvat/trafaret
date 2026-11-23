; Однопроходная сборка установщика «Трафарет» без Wine.
; Основана на штатном app-builder-lib/templates/nsis/installer.nsi (assisted, per-user).
; Отличия:
;   1. uninstaller не собирается отдельным проходом и не подписывается — сборка на Linux
;      без Wine. Вместо File "${UNINSTALLER_OUT_FILE}" uninstaller пишется в момент
;      установки через WriteUninstaller (код uninstaller'а — из штатного uninstaller.nsh).
;   2. Работает без define BUILD_UNINSTALLER: ветки штатного шаблона под него удалены.

Var newStartMenuLink
Var oldStartMenuLink
Var newDesktopLink
Var oldDesktopLink
Var oldShortcutName
Var oldMenuDirectory

!include "common.nsh"
!include "MUI2.nsh"
!include "multiUser.nsh"
!addincludedir "${PROJECT_DIR}\build"
!include "trafaretAllowOnlyOneInstallerInstance.nsh"

!ifdef INSTALL_MODE_PER_ALL_USERS
  RequestExecutionLevel admin
!else
  RequestExecutionLevel user
!endif

Var appExe
Var launchLink

!include "assistedInstaller.nsh"

!insertmacro addLangs

!ifmacrodef customHeader
  !insertmacro customHeader
!endif

Function .onInit
  Call setInstallSectionSpaceRequired

  SetOutPath $INSTDIR
  ${LogSet} on

  !ifmacrodef preInit
    !insertmacro preInit
  !endif

  !ifdef DISPLAY_LANG_SELECTOR
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro check64BitAndSetRegView

  ${IfNot} ${UAC_IsInnerInstance}
    !insertmacro ALLOW_ONLY_ONE_INSTALLER_INSTANCE
  ${EndIf}

  !insertmacro initMultiUser

  !ifmacrodef customInit
    !insertmacro customInit
  !endif

  !ifmacrodef addLicenseFiles
    InitPluginsDir
    !insertmacro addLicenseFiles
  !endif
FunctionEnd

!include "installUtil.nsh"
!include "installer.nsh"

Section "install" INSTALL_SECTION_ID
  # Если идёт тихое обновление per-machine установки — поднимаем права,
  # как в штатном шаблоне.
  !ifndef INSTALL_MODE_PER_ALL_USERS
    ${if} $hasPerMachineInstallation == "1" # set in onInit by initMultiUser
    ${andIf} ${Silent}
      ${ifNot} ${UAC_IsAdmin}
        ShowWindow $HWNDPARENT ${SW_HIDE}
        !insertmacro UAC_RunElevated
        ${Switch} $0
          ${Case} 0
            ${Break}
          ${Case} 1223 ;user aborted
            ${Break}
          ${Default}
            MessageBox mb_IconStop|mb_TopMost|mb_SetForeground "Unable to elevate, error $0"
            ${Break}
        ${EndSwitch}
        Quit
      ${else}
        !insertmacro setInstallModePerAllUsers
      ${endIf}
    ${endIf}
  !endif

  # --- тело штатного installSection.nsh с одной правкой: вместо
  #     !insertmacro installApplicationFiles (File "${UNINSTALLER_OUT_FILE}")
  #     файлы приложения извлекаются макросами ниже, а uninstaller пишется
  #     непосредственно в каталог установки. ---
  InitPluginsDir

  ${IfNot} ${Silent}
    SetDetailsPrint none
  ${endif}

  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

  # must be called before uninstallOldVersion
  !insertmacro setLinkVars

  ${ifNot} ${UAC_IsInnerInstance}
    !insertmacro CHECK_APP_RUNNING
  ${endif}

  Var /GLOBAL keepShortcuts
  StrCpy $keepShortcuts "false"
  !insertMacro setIsTryToKeepShortcuts
  ${if} $isTryToKeepShortcuts == "true"
    ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts

    ${if} $R1 == "true"
    ${andIf} ${FileExists} "$appExe"
      StrCpy $keepShortcuts "true"
    ${endIf}
  ${endif}

  !insertmacro uninstallOldVersion SHELL_CONTEXT
  !insertmacro handleUninstallResult SHELL_CONTEXT

  ${if} $installMode == "all"
    !insertmacro uninstallOldVersion HKEY_CURRENT_USER
    !insertmacro handleUninstallResult HKEY_CURRENT_USER
  ${endIf}

  SetOutPath $INSTDIR

  !ifdef UNINSTALLER_ICON
    File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
  !endif

  !insertmacro extractEmbeddedAppPackage
  # electron always uses per user app data
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}
  !insertmacro copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}

  # Однопроходный uninstaller вместо отдельно собранного и подписанного файла.
  WriteUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"

  !insertmacro registryAddInstallInfo
  !insertmacro addStartMenuLink $keepShortcuts
  !insertmacro addDesktopLink $keepShortcuts

  ${if} ${FileExists} "$newStartMenuLink"
    StrCpy $launchLink "$newStartMenuLink"
  ${else}
    StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${endIf}

  !ifmacrodef registerFileAssociations
    !insertmacro registerFileAssociations
  !endif

  !ifmacrodef customInstall
    !insertmacro customInstall
  !endif

  !macro doStartApp
    # otherwise app window will be in background
    HideWindow
    !insertmacro StartApp
  !macroend

  # for assisted installer run only if silent, because assisted installer has run after finish option
  ${if} ${isForceRun}
  ${andIf} ${Silent}
    !insertmacro doStartApp
  ${endIf}
SectionEnd

Function setInstallSectionSpaceRequired
  !insertmacro setSpaceRequired ${INSTALL_SECTION_ID}
FunctionEnd

# uninstaller: штатный код; define BUILD_UNINSTALLER действует только на этот include,
# чтобы GetProcessInfo и прочие макросы выбрали un.-варианты функций.
!define BUILD_UNINSTALLER
!include "uninstaller.nsh"
!undef BUILD_UNINSTALLER

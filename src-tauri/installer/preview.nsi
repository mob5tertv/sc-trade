; =====================================================================================================================
; THIS IS A MOCK-UP OF THE INSTALLER, NOT THE INSTALLER (the pages-only preview, "SC-Trade-installer-preview.exe").
; It installs nothing: it shows the pages of the installer of SC Trade in their real colours, so that a person can page
; through them with Next and Back. The colours, the pictures and the macros are the very ones of the real installer
; (theme.nsh, header.bmp, sidebar.bmp; the pages of the real one come from the template installer.nsi), so that the two
; cannot differ. Only the sections are another: they print a few lines and wait a moment, so that the bar of the
; progress page moves. There is no File, no registry, no shortcut, no Delete, no RMDir, no Exec and no WriteUninstaller
; in this script (a test keeps it so: tests/release/installer.test.ts), it runs as the user, and the two check boxes of
; the finish page call a function that does nothing.
; Like every NSIS program it unpacks its plug-ins (System, nsDialogs) into a folder of its own in %TEMP% while it runs
; and removes the folder when it ends.
; Two of its pages are re-typed copies of code of the template, not that code itself: the "already installed" page (with the
; wording of the same-version case) and the confirmation of the removal. The real pages come from the template and the
; language files of Tauri, and their wording and layout may differ from these copies in small ways.
;
; Two builds of this one script, with the NSIS that Tauri downloads (%LOCALAPPDATA%\tauri\NSIS), from any folder:
;   makensis -INPUTCHARSET UTF8 -OUTPUTCHARSET UTF8 -V3 -WX "/DOUTFILE=<folder>\SC-Trade-installer-preview.exe" preview.nsi
;   makensis -INPUTCHARSET UTF8 -OUTPUTCHARSET UTF8 -V3 -WX /DPREVIEW_UNINSTALL "/DOUTFILE=<folder>\SC-Trade-uninstaller-preview.exe" preview.nsi
; The first one shows: welcome, the question of a second installation, folder, progress, finish. The second one shows
; the removal: the confirmation (with the check box "Delete the application data"), the progress. An uninstaller cannot
; be made without WriteUninstaller, so the second build shows the real dialogs of the removal on the pages of an installer.
; The version in the corner is VERSION below; the test of the installer fails when it is not the one of package.json.

Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "1.4.0"
!endif
!define PRODUCTNAME "SC Trade"
!ifndef OUTFILE
  !ifdef PREVIEW_UNINSTALL
    !define OUTFILE "SC-Trade-uninstaller-preview.exe"
  !else
    !define OUTFILE "SC-Trade-installer-preview.exe"
  !endif
!endif

!include MUI2.nsh
!include LogicLib.nsh
!include "theme.nsh"

Name "${PRODUCTNAME}"
BrandingText "${PRODUCTNAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\${PRODUCTNAME}"
Caption "$(previewCaption)"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME}: pages-only preview of the installer (a mock-up, installs nothing)"
VIAddVersionKey "LegalCopyright" ""
VIAddVersionKey "FileVersion" "${VERSION}"

; The icon and the pictures of the installer (the same files as in tauri.conf.json, bundle > windows > nsis). The paths are
; relative to this file: makensis changes into the folder of the script before it reads it, however the script is named.
!define MUI_ICON "..\icons\icon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "sidebar.bmp"

; ---- the pages: in the order of the installer ------------------------------------------------------------------
!ifndef PREVIEW_UNINSTALL
  !define MUI_WELCOMEPAGE_TEXT "$(previewWelcome)"
  !insertmacro MUI_PAGE_WELCOME

  ; The question of a second installation: the real installer shows it only when the program is already there.
  Page custom PreviewQuestion

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SCT.DirectoryShow
  !insertmacro MUI_PAGE_DIRECTORY
  !insertmacro SCT_FUNCTIONS_DIRECTORY

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SCT.InstFilesShow
  !insertmacro MUI_PAGE_INSTFILES
  !insertmacro SCT_FUNCTIONS_INSTFILES ""

  !define MUI_FINISHPAGE_NOAUTOCLOSE
  !define MUI_FINISHPAGE_TEXT "$(previewFinish)"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "$(createDesktop)"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION PreviewNothing
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION PreviewNothing
  !insertmacro MUI_PAGE_FINISH
!else
  ; The removal: the confirmation is the very dialog of the uninstaller (the page "uninstConfirm"), then the progress.
  Var PreviewDeleteData
  PageEx uninstConfirm
    PageCallbacks PreviewUnConfirmPre PreviewUnConfirmShow
    Caption " "
    UninstallText "$(previewRemoveText)" "$(previewRemoveFrom)"
  PageExEnd

  !define MUI_PAGE_HEADER_TEXT "$(previewRemoveProgressTitle)"
  !define MUI_PAGE_HEADER_SUBTEXT "$(previewRemoveProgressSub)"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SCT.InstFilesShow
  !insertmacro MUI_PAGE_INSTFILES
  !insertmacro SCT_FUNCTIONS_INSTFILES ""
!endif

!insertmacro SCT_FUNCTIONS_GUIINIT ""

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Russian"

; ---- the words of the pages that the mock-up has to say itself (the real ones are in the language files of Tauri) ----
LangString previewCaption ${LANG_RUSSIAN} "SC Trade - макет установщика (ничего не устанавливается)"
LangString previewCaption ${LANG_ENGLISH} "SC Trade - installer mock-up (nothing is installed)"
LangString previewWelcome ${LANG_RUSSIAN} "Это макет: страницы установщика SC Trade в настоящих цветах. Ничего не устанавливается, ничего не пишется на диск и в реестр. Листайте кнопками Далее и Назад."
LangString previewWelcome ${LANG_ENGLISH} "This is a mock-up: the pages of the SC Trade installer in their real colours. Nothing is installed, nothing is written to the disk or to the registry. Page through with Next and Back."
LangString previewFinish ${LANG_RUSSIAN} "Макет закончился, ничего не установлено. Флажки ниже ничего не делают: они здесь, чтобы был виден их цвет."
LangString previewFinish ${LANG_ENGLISH} "The mock-up is over, nothing is installed. The two check boxes below do nothing: they are here to show their colour."
LangString previewStepFiles ${LANG_RUSSIAN} "Копирование файлов (макет, ничего не копируется)"
LangString previewStepFiles ${LANG_ENGLISH} "Copying files (a mock-up, nothing is copied)"
LangString previewStepRegistry ${LANG_RUSSIAN} "Запись в реестр (макет, ничего не пишется)"
LangString previewStepRegistry ${LANG_ENGLISH} "Writing to the registry (a mock-up, nothing is written)"
LangString previewStepShortcuts ${LANG_RUSSIAN} "Ярлыки (макет, ничего не создаётся)"
LangString previewStepShortcuts ${LANG_ENGLISH} "Shortcuts (a mock-up, nothing is made)"
LangString previewStepDone ${LANG_RUSSIAN} "Готово. Это был макет."
LangString previewStepDone ${LANG_ENGLISH} "Done. It was a mock-up."
LangString previewRemoveText ${LANG_RUSSIAN} "SC Trade будет удалён с этого компьютера. Это макет: ничего не удаляется."
LangString previewRemoveText ${LANG_ENGLISH} "SC Trade would be removed from this computer. This is a mock-up: nothing is removed."
LangString previewRemoveFrom ${LANG_RUSSIAN} "Удаление из папки:"
LangString previewRemoveFrom ${LANG_ENGLISH} "Uninstalling from:"
LangString previewRemoveTitle ${LANG_RUSSIAN} "Удаление SC Trade"
LangString previewRemoveTitle ${LANG_ENGLISH} "Uninstall SC Trade"
LangString previewRemoveSub ${LANG_RUSSIAN} "Макет страницы подтверждения: ничего не удаляется."
LangString previewRemoveSub ${LANG_ENGLISH} "A mock-up of the confirmation page: nothing is removed."
LangString previewRemoveProgressTitle ${LANG_RUSSIAN} "Удаление"
LangString previewRemoveProgressTitle ${LANG_ENGLISH} "Removing"
LangString previewRemoveProgressSub ${LANG_RUSSIAN} "Макет: ход удаления."
LangString previewRemoveProgressSub ${LANG_ENGLISH} "A mock-up: the progress of the removal."
; The question of the second installation and the check box of the removal: the words of the language files of Tauri.
LangString alreadyInstalled ${LANG_RUSSIAN} "Уже установлено"
LangString alreadyInstalled ${LANG_ENGLISH} "Already Installed"
LangString chooseMaintenanceOption ${LANG_RUSSIAN} "Выберите действие, которое вы хотите выполнить."
LangString chooseMaintenanceOption ${LANG_ENGLISH} "Choose the maintenance option to perform."
LangString alreadyInstalledLong ${LANG_RUSSIAN} "${PRODUCTNAME} ${VERSION} уже установлен. Выберите действие, которое вы хотите выполнить и нажмите Далее для продолжения."
LangString alreadyInstalledLong ${LANG_ENGLISH} "${PRODUCTNAME} ${VERSION} is already installed. Select the operation you want to perform and click Next to continue."
LangString addOrReinstall ${LANG_RUSSIAN} "Добавить/Переустановить компоненты"
LangString addOrReinstall ${LANG_ENGLISH} "Add/Reinstall components"
LangString uninstallApp ${LANG_RUSSIAN} "Удалить ${PRODUCTNAME}"
LangString uninstallApp ${LANG_ENGLISH} "Uninstall ${PRODUCTNAME}"
LangString createDesktop ${LANG_RUSSIAN} "Добавить ярлык на рабочий стол"
LangString createDesktop ${LANG_ENGLISH} "Create desktop shortcut"
LangString deleteAppData ${LANG_RUSSIAN} "Удалить данные приложения"
LangString deleteAppData ${LANG_ENGLISH} "Delete the application data"

; ---- the sections: they only say something and wait ---------------------------------------------------------------
!ifndef PREVIEW_UNINSTALL
Section "Preview"
  DetailPrint "$(previewStepFiles)"
  Sleep 400
  DetailPrint "$(previewStepFiles)"
  Sleep 400
  DetailPrint "$(previewStepRegistry)"
  Sleep 400
  DetailPrint "$(previewStepRegistry)"
  Sleep 400
  DetailPrint "$(previewStepShortcuts)"
  Sleep 400
  DetailPrint "$(previewStepDone)"
  Sleep 400
SectionEnd
!else
Section "Preview"
  DetailPrint "$(previewRemoveProgressSub)"
  Sleep 400
  DetailPrint "$(previewRemoveProgressSub)"
  Sleep 400
  DetailPrint "$(previewRemoveProgressSub)"
  Sleep 400
  DetailPrint "$(previewRemoveProgressSub)"
  Sleep 400
  DetailPrint "$(previewStepDone)"
  Sleep 400
SectionEnd
!endif

; ---- the functions of the pages ----------------------------------------------------------------------------------
!ifndef PREVIEW_UNINSTALL
; What the two check boxes of the finish page call: nothing.
Function PreviewNothing
  Nop
FunctionEnd

; The question of the second installation: the same controls as PageReinstall of the template (installer.nsi), under the
; same names, painted by the same macros as there.
Function PreviewQuestion
  !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  nsDialogs::Create 1018
  Pop $R4

  ${NSD_CreateLabel} 0 0 100% 24u "$(alreadyInstalledLong)"
  Pop $R1
  ${NSD_CreateRadioButton} 30u 50u -30u 8u "$(addOrReinstall)"
  Pop $R2
  ${NSD_CreateRadioButton} 30u 70u -30u 8u "$(uninstallApp)"
  Pop $R3
  SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
  ${NSD_SetFocus} $R2

  !insertmacro SCT_PAINT_DIALOG $R4
  !insertmacro SCT_PAINT_TEXT $R1
  !insertmacro SCT_PAINT_CLASSIC $R2
  !insertmacro SCT_PAINT_CLASSIC $R3
  nsDialogs::Show
FunctionEnd
!else
Function PreviewUnConfirmPre
  !insertmacro MUI_HEADER_TEXT "$(previewRemoveTitle)" "$(previewRemoveSub)"
FunctionEnd

; The check box "Delete the application data" that the template adds to the dialog of the removal (un.ConfirmShow of
; installer.nsi): the same code, then the colours from the very same macro.
Function PreviewUnConfirmShow
  FindWindow $1 "#32770" "" $HWNDPARENT
  System::Call 'user32::GetDpiForWindow(p r1) i .r2'
  StrCpy $3 "${__NSD_CheckBox_EXSTYLE}"
  IntOp $4 0 * $2
  IntOp $5 100 * $2
  IntOp $6 400 * $2
  IntOp $7 25 * $2
  IntOp $4 $4 / 96
  IntOp $5 $5 / 96
  IntOp $6 $6 / 96
  IntOp $7 $7 / 96
  System::Call 'user32::CreateWindowEx(i r3, w "${__NSD_CheckBox_CLASS}", w "$(deleteAppData)", i ${__NSD_CheckBox_STYLE}, i r4, i r5, i r6, i r7, p r1, i0, i0, i0) i .s'
  Pop $PreviewDeleteData
  GetDlgItem $2 $1 1006
  GetDlgItem $3 $1 1029
  GetDlgItem $4 $1 1000
  !insertmacro SCT_PAINT_UNCONFIRM $1 $2 $3 $4 $PreviewDeleteData
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $1
  SendMessage $PreviewDeleteData ${WM_SETFONT} $1 1
FunctionEnd
!endif

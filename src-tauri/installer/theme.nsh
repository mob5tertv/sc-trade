; The theme of the SC Trade installer: the glass of the application (src/ui/theme.css) on every page, the text of the
; application on it. One file for the real installer and for the pages-only preview (preview.nsi), so that they cannot
; differ: hooks.nsh includes it for Tauri, preview.nsi includes it itself. Both include Modern UI 2 first.
;
; THE RULE: an element that gets a dark background gets a light text colour in the same place (SetCtlColors always takes
; both), and a check box, a radio button, a group box and the progress bar get their visual style switched off in the
; macro that colours them (with the style on, Windows ignores the text colour of the first three and the bar colour of
; the last; this is what Modern UI 2 itself does on its finish page, see Pages\Finish.nsh, bug #443 of NSIS). Nothing
; on a dark page is left to the defaults of the system: a static control without a colour is drawn black on grey.
; tests/release/installer.test.ts checks the rule over this file and over the template.
;
; The buttons (Back, Next, Cancel, Browse, Show details) and the message boxes stay the system's own: without a plug-in
; they cannot be coloured, and that is fine. Only Windows system libraries are called, through System::Call (SetWindowTheme
; as Modern UI 2 does, DwmSetWindowAttribute for the title bar): no third-party plug-in, no DLL of ours.

; ---- the colours, from src/ui/theme.css -------------------------------------------------------------------------------
!define SCT_GLASS "07121b"  ; --sc-bg-solid: the window and every page
!define SCT_TEXT "d6eef5"   ; --sc-text: the text of the pages (15.7:1 on the glass, 14.4:1 on SCT_FIELD)
!define SCT_MUTED "82a8b6"  ; --sc-muted: the corner text and the lines of the space on the disk (7.4:1 on the glass; keep it off SCT_FIELD, 6.8:1)
!define SCT_FIELD "0b1c27"  ; --sc-surface: the field of the path and the list of the details
!define SCT_TROUGH "1d4654" ; --sc-border: the empty part of the progress bar
!define SCT_ACCENT "3fd0f0" ; --sc-accent: the bar
!define SCT_FRAME "2b8fa8"  ; --sc-frame: the border of the window
; The same colours as the numbers that a message and the title bar take (0xBBGGRR): NSIS cannot turn "rrggbb" round.
; The test of the installer checks that every pair is one colour.
!define SCT_GLASS_BGR 0x1B1207
!define SCT_TEXT_BGR 0xF5EED6
!define SCT_TROUGH_BGR 0x54461D
!define SCT_ACCENT_BGR 0xF0D03F
!define SCT_FRAME_BGR 0xA88F2B

; ---- Modern UI 2: the header, the welcome and finish pages, the list of the details ----------------------------------
!define MUI_BGCOLOR "${SCT_GLASS}"
!define MUI_TEXTCOLOR "${SCT_TEXT}"
; The list of the details on the progress page (the installer and the uninstaller): light text on the field colour.
!define MUI_INSTFILESPAGE_COLORS "${SCT_TEXT} ${SCT_FIELD}"
; The text colour does not reach the check boxes of the finish page ("Run SC Trade", the desktop shortcut) while they are
; drawn with the visual styles of Windows: they would keep black text on the dark glass. With this define Modern UI 2
; draws them as classic check boxes, which take the colour (Pages\Finish.nsh).
; This define is in the source of Modern UI 2 but not in its readme: after any update of Tauri or of the NSIS it downloads,
; look at the finish page of the installer once more (the two check boxes must have light text).
!define MUI_FORCECLASSICCONTROLS
; The window itself, the corner text, the title bar: when the window is made, before the first page (the functions are made
; by SCT_FUNCTIONS_GUIINIT, which the template and the preview insert after the pages).
!define MUI_CUSTOMFUNCTION_GUIINIT SCT.GuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.SCT.GuiInit

; ---- what colours one control ------------------------------------------------------------------------------------------
; A dialog (the window, the page behind the controls) and a label: light text on the glass.
!macro SCT_PAINT_DIALOG HWND
  SetCtlColors ${HWND} "${SCT_TEXT}" "${SCT_GLASS}"
!macroend
!macro SCT_PAINT_TEXT HWND
  SetCtlColors ${HWND} "${SCT_TEXT}" "${SCT_GLASS}"
!macroend
; A secondary label: the muted text of the application, on the glass.
!macro SCT_PAINT_MUTED HWND
  SetCtlColors ${HWND} "${SCT_MUTED}" "${SCT_GLASS}"
!macroend
; A field (the path, the list): light text on the field colour. The border is the one of the system.
!macro SCT_PAINT_FIELD HWND
  SetCtlColors ${HWND} "${SCT_TEXT}" "${SCT_FIELD}"
!macroend
; A check box, a radio button, a group box: the visual style off first, else the text colour is not applied.
!macro SCT_PAINT_CLASSIC HWND
  System::Call 'UXTHEME::SetWindowTheme(p${HWND},w" ",w" ")'
  SetCtlColors ${HWND} "${SCT_TEXT}" "${SCT_GLASS}"
!macroend
; The progress bar: the visual style off (else the colours below are ignored), the bar in the accent, the rest in the border colour.
!macro SCT_PAINT_PROGRESS HWND
  System::Call 'UXTHEME::SetWindowTheme(p${HWND},w" ",w" ")'
  SendMessage ${HWND} 0x2001 0 ${SCT_TROUGH_BGR} ; PBM_SETBKCOLOR
  SendMessage ${HWND} 0x0409 0 ${SCT_ACCENT_BGR} ; PBM_SETBARCOLOR
!macroend
; An attribute of the title bar of a window (dwmapi, Windows 10 20H1 / Windows 11; an older Windows answers with an error code, which is dropped).
!macro SCT_DWM_SET HWND ATTRIBUTE VALUE
  System::Call 'dwmapi::DwmSetWindowAttribute(p${HWND},i ${ATTRIBUTE},*i ${VALUE},i 4)'
!macroend

; The page of the removal: the text above, the line "uninstalling from:", the read-only field with the folder, and the
; check box "Delete the data of the application" that the template adds. The five handles are the ones the template has.
!macro SCT_PAINT_UNCONFIRM DIALOG TEXT LOCATION_TEXT LOCATION DELETE_DATA
  !insertmacro SCT_PAINT_DIALOG ${DIALOG}
  !insertmacro SCT_PAINT_TEXT ${TEXT}
  !insertmacro SCT_PAINT_TEXT ${LOCATION_TEXT}
  !insertmacro SCT_PAINT_FIELD ${LOCATION}
  !insertmacro SCT_PAINT_CLASSIC ${DELETE_DATA}
!macroend

; ---- the functions of the pages ---------------------------------------------------------------------------------------
; They use the variables of Modern UI 2 (mui.*), which exist once the pages are inserted: insert these macros after the
; pages. Not one of them touches $R0-$R9: the installer keeps the result of the version check there from the question of
; the second installation to the first section.

; The window (.onGUIInit / un.onGUIInit, UN is "" or "un.").
!macro SCT_FUNCTIONS_GUIINIT UN
  Function ${UN}SCT.GuiInit
    Push $0
    ; The window and the strip with the buttons under the page.
    !insertmacro SCT_PAINT_DIALOG $HWNDPARENT
    ; The corner text ("SC Trade 1.1.0"): the muted text of the application. Two controls lie on one another there. In stock
    ; NSIS the text that shows is the one of 1028, a disabled control (Windows draws the text of a disabled control grey,
    ; whatever colour it is given), and 1256 only blanks the line behind it; Modern UI 2 writes the text into both and
    ; shows and hides both page by page. Both get the same pair here, and 1028 is enabled below, so that whichever of the two
    ; shows, it shows the muted text on the glass.
    !insertmacro SCT_PAINT_MUTED $mui.Branding.Background
    !insertmacro SCT_PAINT_MUTED $mui.Branding.Text
    EnableWindow $mui.Branding.Background 1
    ; The three lines (under the header, above the buttons, full width) are etched in the colours of the system, white on
    ; grey: bright hairlines on the glass. Hidden; the two that Modern UI 2 shows and hides page by page are pointed at no
    ; window (ShowWindow on 0 does nothing), so they stay hidden.
    ShowWindow $mui.Line.Standard ${SW_HIDE}
    ShowWindow $mui.Line.FullWindow ${SW_HIDE}
    StrCpy $mui.Line.Standard 0
    StrCpy $mui.Line.FullWindow 0
    GetDlgItem $0 $HWNDPARENT 1036
    ShowWindow $0 ${SW_HIDE}
    ; The title bar: dark (Windows 10 20H1+), and on Windows 11 the glass, the text and the frame of the application.
    !insertmacro SCT_DWM_SET $HWNDPARENT 20 1
    !insertmacro SCT_DWM_SET $HWNDPARENT 35 ${SCT_GLASS_BGR}
    !insertmacro SCT_DWM_SET $HWNDPARENT 36 ${SCT_TEXT_BGR}
    !insertmacro SCT_DWM_SET $HWNDPARENT 34 ${SCT_FRAME_BGR}
    Pop $0
  FunctionEnd
!macroend

; The page of the folder (the callback "show" of MUI_PAGE_DIRECTORY).
!macro SCT_FUNCTIONS_DIRECTORY
  Function SCT.DirectoryShow
    !insertmacro SCT_PAINT_DIALOG $mui.DirectoryPage
    !insertmacro SCT_PAINT_TEXT $mui.DirectoryPage.Text
    !insertmacro SCT_PAINT_CLASSIC $mui.DirectoryPage.DirectoryBox
    !insertmacro SCT_PAINT_FIELD $mui.DirectoryPage.Directory
    !insertmacro SCT_PAINT_MUTED $mui.DirectoryPage.SpaceRequired
    !insertmacro SCT_PAINT_MUTED $mui.DirectoryPage.SpaceAvailable
  FunctionEnd
!macroend

; The page of the progress (the callback "show" of MUI_PAGE_INSTFILES / MUI_UNPAGE_INSTFILES, UN is "" or "un."). The list
; of the details gets its colours from MUI_INSTFILESPAGE_COLORS.
!macro SCT_FUNCTIONS_INSTFILES UN
  Function ${UN}SCT.InstFilesShow
    !insertmacro SCT_PAINT_DIALOG $mui.InstFilesPage
    !insertmacro SCT_PAINT_TEXT $mui.InstFilesPage.Text
    !insertmacro SCT_PAINT_PROGRESS $mui.InstFilesPage.ProgressBar
  FunctionEnd
!macroend

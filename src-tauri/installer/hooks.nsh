; The colours of the installer: the glass of the application (src/ui/theme.css) under the header and under the welcome
; and finish pages, and the text of the application on it. Tauri includes this file in installer.nsi right after the
; includes of Modern UI 2 and before the first page, so plain `!define`s are enough: Modern UI 2 reads them when it
; inserts the first page. No custom template is needed. The inner pages (folder, progress) stay the system's own.
;
; A background and a text colour only ever go together: one without the other would give dark text on dark glass.
!define MUI_BGCOLOR "07121b"
!define MUI_TEXTCOLOR "d6eef5"

; The text colour does not reach the check boxes of the finish page ("Run SC Trade", the desktop shortcut) while they are
; drawn with the visual styles of Windows: they would keep black text on the dark glass. With this define Modern UI 2
; draws them as classic check boxes, which take the colour (see Pages\Finish.nsh of Modern UI 2).
!define MUI_FORCECLASSICCONTROLS

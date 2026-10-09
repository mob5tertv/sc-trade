; Tauri includes this file in installer.nsi (src-tauri/installer/installer.nsi, our copy of its template) right after the
; includes of Modern UI 2 and before the first page. All it does is bring in the theme of the installer, which is a file
; of its own because the pages-only preview of the installer (preview.nsi) includes the very same one.
; Relative to this file: Tauri includes it by its full path, and the working folder of NSIS is another one.
!include "${__FILEDIR__}\theme.nsh"

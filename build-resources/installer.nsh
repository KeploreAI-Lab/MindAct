; installer.nsh — MindAct NSIS MUI2 customization
; Included by electron-builder before generating the installer script.
; electron-builder ships its own NSIS 3.x, so no separate NSIS install needed.

; ── Welcome page ────────────────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE "Welcome to MindAct"
!define MUI_WELCOMEPAGE_TEXT "MindAct is an AI-powered decision and action assistant for robotics and automation projects.$\r$\n$\r$\nThis wizard will guide you through the installation. Click Install to begin."

; ── Finish page ─────────────────────────────────────────────────────────────
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TEXT "MindAct has been installed successfully.$\r$\n$\r$\nClick Finish to close this wizard."

; Launch the app from the Finish page
!define MUI_FINISHPAGE_RUN "$INSTDIR\MindAct.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch MindAct"

; ── Abort / Cancel confirmation ──────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Are you sure you want to cancel the MindAct installation?"

; ── Uninstaller Welcome / Finish ─────────────────────────────────────────────
!define MUI_UNWELCOMEPAGE_TITLE "Uninstall MindAct"
!define MUI_UNWELCOMEPAGE_TEXT "This wizard will remove MindAct from your computer.$\r$\n$\r$\nClick Uninstall to proceed."

!define MUI_UNFINISHPAGE_TITLE "Uninstall Complete"
!define MUI_UNFINISHPAGE_TEXT "MindAct has been removed from your computer."

; installer.nsh — MindAct NSIS MUI2 text customization
; Included by electron-builder. Only defines text strings — no page
; redefinitions that could conflict with electron-builder's own template.

; ── Welcome page ─────────────────────────────────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE "Welcome to MindAct"
!define MUI_WELCOMEPAGE_TEXT "MindAct is an AI-powered decision and action assistant for robotics and automation projects.$\r$\n$\r$\nBy clicking Install you agree to the MindAct Terms of Service.$\r$\n$\r$\nClick Install to begin, or click Back to review settings."

; ── Finish page ──────────────────────────────────────────────────────────────
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TEXT "MindAct has been installed successfully. Click Finish to close this wizard."

; ── Uninstall pages ──────────────────────────────────────────────────────────
!define MUI_UNWELCOMEPAGE_TITLE "Uninstall MindAct"
!define MUI_UNWELCOMEPAGE_TEXT "This wizard will remove MindAct from your computer. Click Uninstall to proceed."

!define MUI_UNFINISHPAGE_TITLE "Uninstall Complete"
!define MUI_UNFINISHPAGE_TEXT "MindAct has been removed from your computer."

; ── Uninstaller: ask whether to delete user data ─────────────────────────────
; Called by electron-builder's generated un.onInit via !insertmacro customUnInit.
; Do NOT define Function un.onInit here — electron-builder owns that function
; and including a second definition causes "Function already exists" NSIS error.
!macro customUnInit
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Would you also like to delete MindAct user data (API keys, config files)?$\n$\nPath: $APPDATA\physmind" \
    IDNO mindact_keep_data
  SetShellVarContext current
  RMDir /r "$APPDATA\physmind"
  mindact_keep_data:
!macroend

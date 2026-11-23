; Mingshen Harness assisted installer welcome page.
; The animation is UI-only: it cycles embedded bitmap frames while the page is visible.
!include "nsDialogs.nsh"
!include "FileFunc.nsh"

LangString MSH_SETUP_TITLE 1033 "Welcome to MingshenHarness"
LangString MSH_SETUP_COPY 1033 "A local-first workspace for coding, office work, and conversation."
LangString MSH_SETUP_TITLE 2052 "欢迎使用 MingshenHarness"
LangString MSH_SETUP_COPY 2052 "面向代码、办公与对话的本地优先智能工作空间。"

Var mingshen.WelcomeAnimation
Var mingshen.WelcomeBitmap
Var mingshen.WelcomeFrame
Var mingshen.WelcomeTitle
Var mingshen.WelcomeCopy
Var mingshen.WelcomeTimerActive

Function mingshenWelcomeCreate
  ; The custom page API has no PRE callback slot. Skip the page from the create
  ; callback when electron-builder marks this run as an update. Avoid its
  ; isUpdated helper here because it expands to a plugin call while this include
  ; is parsed, before electron-builder's extra plugin directory is guaranteed.
  ${GetParameters} $0
  ${GetOptions} $0 "/updated" $1
  IfErrors mingshenWelcomeCreatePage
  Abort
mingshenWelcomeCreatePage:

  ; This is a real nsDialogs page. A MUI SHOW hook has no nsDialogs context.
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  StrCpy $mingshen.WelcomeTimerActive 0
  StrCpy $mingshen.WelcomeAnimation 0
  StrCpy $mingshen.WelcomeBitmap 0

  ; Keep the MUI wizard navigation and use the page body for the assisted welcome surface.
  InitPluginsDir
  ${NSD_CreateBitmap} 0u 0u 109u 193u ""
  Pop $mingshen.WelcomeAnimation
  ${NSD_CreateLabel} 124u 28u 170u 18u "$(MSH_SETUP_TITLE)"
  Pop $mingshen.WelcomeTitle
  ${NSD_CreateLabel} 124u 54u 170u 64u "$(MSH_SETUP_COPY)"
  Pop $mingshen.WelcomeCopy
  StrCpy $mingshen.WelcomeFrame 0

  ; These files are embedded in the installer and extracted only for this page.
  File "/oname=$PLUGINSDIR\mingshen-atom-00.bmp" "${BUILD_RESOURCES_DIR}\installer-atom-frame-00.bmp"
  File "/oname=$PLUGINSDIR\mingshen-atom-01.bmp" "${BUILD_RESOURCES_DIR}\installer-atom-frame-01.bmp"
  File "/oname=$PLUGINSDIR\mingshen-atom-02.bmp" "${BUILD_RESOURCES_DIR}\installer-atom-frame-02.bmp"
  File "/oname=$PLUGINSDIR\mingshen-atom-03.bmp" "${BUILD_RESOURCES_DIR}\installer-atom-frame-03.bmp"
  File "/oname=$PLUGINSDIR\mingshen-atom-04.bmp" "${BUILD_RESOURCES_DIR}\installer-atom-frame-04.bmp"
  File "/oname=$PLUGINSDIR\mingshen-atom-05.bmp" "${BUILD_RESOURCES_DIR}\installer-atom-frame-05.bmp"
  File "/oname=$PLUGINSDIR\mingshen-atom-06.bmp" "${BUILD_RESOURCES_DIR}\installer-atom-frame-06.bmp"
  File "/oname=$PLUGINSDIR\mingshen-atom-07.bmp" "${BUILD_RESOURCES_DIR}\installer-atom-frame-07.bmp"

  StrCpy $0 "$PLUGINSDIR\mingshen-atom-00.bmp"
  ${NSD_SetStretchedImage} $mingshen.WelcomeAnimation "$0" $mingshen.WelcomeBitmap
  ${NSD_CreateTimer} mingshenWelcomeTick 120
  StrCpy $mingshen.WelcomeTimerActive 1
  nsDialogs::Show
  Call mingshenWelcomeCleanup
FunctionEnd

Function mingshenWelcomeTick
  ${If} $mingshen.WelcomeBitmap P<> 0
    ${NSD_ClearImage} $mingshen.WelcomeAnimation
    ${NSD_FreeImage} $mingshen.WelcomeBitmap
    StrCpy $mingshen.WelcomeBitmap 0
  ${EndIf}
  IntOp $mingshen.WelcomeFrame $mingshen.WelcomeFrame + 1
  ; Reset at the upper bound; values 1..7 continue to the frame formatter.
  IntCmp $mingshen.WelcomeFrame 8 mingshenWelcomeFrameReset mingshenWelcomeFrameReady mingshenWelcomeFrameReset
mingshenWelcomeFrameReset:
  StrCpy $mingshen.WelcomeFrame 0
mingshenWelcomeFrameReady:
  IntFmt $0 "%02d" $mingshen.WelcomeFrame
  StrCpy $1 "$PLUGINSDIR\mingshen-atom-$0.bmp"
  ${NSD_SetStretchedImage} $mingshen.WelcomeAnimation "$1" $mingshen.WelcomeBitmap
FunctionEnd

Function mingshenWelcomeCleanup
  ${If} $mingshen.WelcomeTimerActive == 1
    ${NSD_KillTimer} mingshenWelcomeTick
    StrCpy $mingshen.WelcomeTimerActive 0
  ${EndIf}
  ${If} $mingshen.WelcomeAnimation P<> 0
    ${NSD_ClearImage} $mingshen.WelcomeAnimation
    StrCpy $mingshen.WelcomeAnimation 0
  ${EndIf}
  ${If} $mingshen.WelcomeBitmap P<> 0
    ${NSD_FreeImage} $mingshen.WelcomeBitmap
    StrCpy $mingshen.WelcomeBitmap 0
  ${EndIf}
FunctionEnd

!macro customWelcomePage
  Page custom mingshenWelcomeCreate
!macroend

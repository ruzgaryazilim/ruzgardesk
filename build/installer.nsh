!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\sc.exe" stop RuzgarDeskSecureInput'
  Sleep 1500
  nsExec::ExecToLog '"$SYSDIR\sc.exe" delete RuzgarDeskSecureInput'
  ExpandEnvStrings $0 "%ProgramData%\RuzgarDesk"
  RMDir /r "$0"
!macroend

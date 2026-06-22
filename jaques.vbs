' ─── 7Panel Studio + Jaques-OS ────────────────────────────────────────────────
' Unified launcher. Kills orphan processes before starting.
' Idempotente: rodar varias vezes nao acumula processos zombie.

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Dim base : base = fso.GetParentFolderName(WScript.ScriptFullName)
Dim jaquesOs : jaquesOs = fso.GetParentFolderName(base) & "\jaques-os"

' Kill orphan processes on all relevant ports (4000, 4100, 5000, 5173, 5174)
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -Command ""@(4000,4100,5000,5173,5174) | ForEach-Object { $p=$_; netstat -ano | Select-String \"":$p\s.*LISTENING\"" | ForEach-Object { if($_ -match '\s(\d+)\s*$'){Stop-Process -Id $Matches[1] -Force -ErrorAction SilentlyContinue} } }""", 0, True
WScript.Sleep 800

' ─── 1. Launcher Hub (:4000) — sobe primeiro pra estar pronto no final ─────
sh.Run "cmd /c cd /d """ & base & """ && python -m http.server 4000 --bind 127.0.0.1", 0, False

' ─── 2. 7Panel backend (:5000) ─────────────────────────────────────────────
sh.Run "cmd /c cd /d """ & base & "\backend"" && python dashboard_server.py", 0, False
WScript.Sleep 2000

' ─── 2b. AutoHotkey keyboard bridge (F13-F24 → Python actions) ────────────
Dim ahk : ahk = base & "\backend\keyboard_integration.ahk"
If fso.FileExists(ahk) Then
    sh.Run """" & ahk & """", 0, False
End If

' ─── 3. YT Bot ─────────────────────────────────────────────────────────────
sh.Run "cmd /c cd /d """ & base & "\backend"" && python yt_bot.py", 0, False
WScript.Sleep 1000

' ─── 4. 7Panel frontend (:5174) ────────────────────────────────────────────
sh.Run "cmd /c cd /d """ & base & "\keyboard-ui"" && npm run dev", 0, False

' ─── 5. Jaques-OS (:5173) ──────────────────────────────────────────────────
sh.Run "cmd /c cd /d """ & jaquesOs & """ && npm run dev", 0, False

' ─── 6. Mockup Store render server (:4200 TCP) + UI (:4100) ────────────────
sh.Run "cmd /c cd /d ""Z:\BOXY\mockup-store"" && bun run scripts/render-server.ts", 0, False
WScript.Sleep 3000
sh.Run "cmd /c cd /d ""Z:\BOXY\mockup-store"" && npx next dev --port 4100", 0, False

' ─── Aguarda servers subirem e abre o launcher ─────────────────────────────
WScript.Sleep 6000
sh.Run "cmd /c start """" ""http://localhost:4000/launcher.html""", 0, False

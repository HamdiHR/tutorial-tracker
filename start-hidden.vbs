' Starts Tutorial Tracker in the background (no console window) and opens the browser.
' Stop it later from Task Manager (node.exe) or by running stop.cmd.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "node --disable-warning=ExperimentalWarning server\index.js", 0, False
WScript.Sleep 1500
sh.Run "http://localhost:4173"

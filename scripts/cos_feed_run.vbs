' Runs the Chief of Staff feed hidden (scheduled task "CoS dashboard feed"). Node must be on PATH.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c node """ & dir & "\cos_feed.mjs"" --push >> """ & dir & "\out\task.log"" 2>&1", 0, True

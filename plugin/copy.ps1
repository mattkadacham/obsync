
$filepath = "C:\dev\notes\.obsidian\plugins\obsync-obsidian-plugin"

if (-not (Test-Path -Path $filepath)) {
    New-Item -ItemType Directory -Path $filepath | Out-Null
}

Copy-Item -Path "main.js", "manifest.json", "styles.css" -Destination $filepath

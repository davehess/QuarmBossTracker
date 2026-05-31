# build/ — electron-builder resources

Drop a real app icon here before shipping:

- `icon.ico` (Windows, 256×256 multi-res) — used by NSIS + the .exe
- `icon.png` (512×512) — Linux/dev fallback

Until then the tray uses an inline placeholder and electron-builder falls back
to the default Electron icon. A wolf-head mark matching the 🐺 site branding is
the obvious choice.

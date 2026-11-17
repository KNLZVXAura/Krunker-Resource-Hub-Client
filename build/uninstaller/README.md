# Uninstallers

Shipped next to the installers in every release (built by `npm run uninstaller` = `scripts/build-uninstaller.mjs`; CI does it on the Linux job).

| File | What |
| --- | --- |
| `krh-uninstaller.nsi` | Windows uninstaller (NSIS). Finds a Setup.exe or .msi install (this user or all users), closes the app, removes it, and asks whether the data goes too. Silent: `/S [/DELETEDATA] [/DELETEMEDIA] [/KEEPPROGRAM]`. |
| `uninstaller.ico` | Its icon (NSIS cannot read the PNG-compressed icons of `build/icon.ico`). |
| `krh-client-uninstall.sh` | Linux script for the .deb and the AppImage: same choices, `--dry-run`, `-y`, `--delete-data`, `--delete-media`, `--keep-program`, `--appimage FILE`. |

Data it may delete (only when asked): `%APPDATA%\krh-client` / `~/.config/krh-client`; separately `Videos\KRH Client`, `Pictures\KRH Client` and `Downloads\KRH Client`. Nothing else, and never a folder the user picked.

Build by hand: `makensis -DVERSION=4.1.0 -DVERSION4=4.1.0.0 "-DOUTFILE=out/KRH Client-4.1.0-Uninstaller.exe" build/uninstaller/krh-uninstaller.nsi` (add `-DDEBUG` to write `%TEMP%\krh-uninstaller-debug.txt`).

How it was tested: the Windows one under Wine with a stand-in install made by NSIS (same uninstaller engine as electron-builder), silent runs for every combination plus the window clicked through; the Linux one with a fake `$HOME` and stub `dpkg-query` / `apt-get`. Not tested on real Windows: an `.msi` install (the code runs `msiexec /x <product code>`) and an all-users install started without administrator rights.

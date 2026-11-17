#!/usr/bin/env bash
# KRH Client uninstaller for Linux (the .deb package and the AppImage).
#
# It removes the program and asks whether your data goes too:
#   Keep my data (default)  settings, saved accounts, userscripts, statistics, backups stay in ~/.config/krh-client, so a later
#                           reinstall picks up where you left off.
#   Delete my data          everything in ~/.config/krh-client (and its cache).
#   + recordings / pictures the clips, recordings and weekly cards KRH Client saved in your Videos and Pictures folders and the mods
#                           it saved in Downloads. Separate on purpose: those are YOUR files, never deleted without asking.
# Folders you picked yourself (for example a backup copy folder) are never touched.
#
# Usage:  bash krh-client-uninstall.sh [options]
#   --dry-run          only show what would be removed; changes nothing
#   -y, --yes          do not ask: keeps the data unless --delete-data is given
#   --delete-data      delete the data folder
#   --delete-media     with --delete-data: also the recordings, pictures and downloaded mods
#   --keep-program     leave the program installed (only the data is removed)
#   --appimage FILE    also remove this AppImage file
#   -h, --help         this text

set -u

DRY=0; YES=0; DEL_DATA=0; DEL_MEDIA=0; KEEP_PROGRAM=0
APPIMAGES=()
PKG="krh-client"
DATA_NAME="krh-client"
MEDIA_NAME="KRH Client"

say()  { printf '%s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
usage() { sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    -y|--yes) YES=1 ;;
    --delete-data) DEL_DATA=1 ;;
    --delete-media) DEL_MEDIA=1 ;;
    --keep-program) KEEP_PROGRAM=1 ;;
    --appimage) shift; [ $# -gt 0 ] || { say "--appimage needs a file"; exit 2; }; APPIMAGES+=("$1") ;;
    -h|--help) usage; exit 0 ;;
    *) say "Unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done
[ "$DEL_DATA" -eq 1 ] || DEL_MEDIA=0

# ---- helpers ----

# a real answer from the keyboard, even when this script was piped into bash
ask() {  # ask "question" default(y|n) -> returns 0 for yes
  local q="$1" def="$2" a hint
  [ "$YES" -eq 1 ] && { [ "$def" = y ]; return; }
  if [ "$def" = y ]; then hint="[Y/n]"; else hint="[y/N]"; fi
  if [ -r /dev/tty ]; then read -r -p "$q $hint " a < /dev/tty || a=""; else a=""; fi
  case "${a:-$def}" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

run() {  # run a command, or only show it with --dry-run
  if [ "$DRY" -eq 1 ]; then note "[dry run] $*"; else "$@"; fi
}

remove_path() {  # remove a file or folder when it exists (never anything empty or "/")
  local p="$1"
  case "$p" in ""|"/"|"$HOME"|"$HOME/") return 0 ;; esac
  [ -e "$p" ] || [ -L "$p" ] || return 0
  if [ "$DRY" -eq 1 ]; then note "[dry run] delete $p"; else rm -rf -- "$p" && note "deleted $p"; fi
}

xdg_dir() {  # xdg_dir VIDEOS|PICTURES|DOWNLOAD fallback
  local d=""
  if command -v xdg-user-dir >/dev/null 2>&1; then d="$(xdg-user-dir "$1" 2>/dev/null || true)"; fi
  [ -n "$d" ] && [ "$d" != "$HOME" ] || d="$2"
  printf '%s' "$d"
}

close_app() {
  # the program may be running from /opt (deb) or from an AppImage mount
  if pgrep -f '/opt/KRH Client/|/opt/krh-client/|\.mount_KRH' >/dev/null 2>&1 || pgrep -x "krh-client" >/dev/null 2>&1; then
    if ask "KRH Client is running and has to be closed first. Close it now?" y; then
      run pkill -f '/opt/KRH Client/|/opt/krh-client/|\.mount_KRH' 2>/dev/null
      run pkill -x krh-client 2>/dev/null
      [ "$DRY" -eq 1 ] || sleep 1
    else
      say "Close KRH Client and run this again."; exit 1
    fi
  fi
}

# ---- what is installed ----

DEB=0
if command -v dpkg-query >/dev/null 2>&1 && dpkg-query -W -f='${Status}' "$PKG" 2>/dev/null | grep -q "install ok installed"; then DEB=1; fi

# AppImages: the ones given, plus the usual places
for dir in "$HOME/Applications" "$HOME/Downloads" "$HOME/Desktop" "$HOME/.local/bin" "$HOME/bin" "$PWD"; do
  [ -d "$dir" ] || continue
  while IFS= read -r f; do
    [ -n "$f" ] && APPIMAGES+=("$f")
  done < <(find "$dir" -maxdepth 2 -type f \( -iname 'KRH*Client*.AppImage' -o -iname 'krh-client*.AppImage' \) 2>/dev/null)
done
# unique, and only files that exist
UNIQ=()
for f in "${APPIMAGES[@]+"${APPIMAGES[@]}"}"; do
  [ -f "$f" ] || continue
  dup=0; for u in "${UNIQ[@]+"${UNIQ[@]}"}"; do [ "$u" = "$f" ] && dup=1; done
  [ "$dup" -eq 1 ] || UNIQ+=("$f")
done
APPIMAGES=("${UNIQ[@]+"${UNIQ[@]}"}")

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DATA_DIR="$CONFIG_HOME/$DATA_NAME"

say "KRH Client uninstaller"
say ""
FOUND=0
if [ "$DEB" -eq 1 ]; then say "Found: the .deb package ($PKG)"; FOUND=1; fi
for f in "${APPIMAGES[@]+"${APPIMAGES[@]}"}"; do say "Found: AppImage $f"; FOUND=1; done
[ "$FOUND" -eq 1 ] || say "No installed copy of KRH Client was found. You can still remove its data below."
[ -d "$DATA_DIR" ] && say "Found: your data in $DATA_DIR"
say ""

# ---- the choices (only when nothing was given on the command line) ----

if [ "$YES" -eq 0 ]; then
  if [ "$FOUND" -eq 1 ] && [ "$KEEP_PROGRAM" -eq 0 ]; then
    ask "Remove the KRH Client program?" y || KEEP_PROGRAM=1
  fi
  if [ "$DEL_DATA" -eq 0 ]; then
    say "What about your data (settings, saved accounts, userscripts, statistics, backups)?"
    if ask "Delete it too? (No keeps it, so a later reinstall picks up where you left off)" n; then
      DEL_DATA=1
      ask "Also delete the recordings, clips and pictures KRH Client saved in Videos and Pictures, and the mods in Downloads?" n && DEL_MEDIA=1
    fi
  fi
  if [ "$DEL_DATA" -eq 1 ]; then
    say ""
    if [ "$DEL_MEDIA" -eq 1 ]; then say "All your KRH Client data will be deleted, including the recordings, clips and pictures it saved."
    else say "All your KRH Client settings, saved accounts, userscripts, statistics and backups will be deleted."; fi
    ask "This cannot be undone. Continue?" n || { say "Nothing was changed."; exit 0; }
  fi
fi

if { [ "$FOUND" -eq 0 ] || [ "$KEEP_PROGRAM" -eq 1 ]; } && [ "$DEL_DATA" -eq 0 ]; then
  say "Nothing to do."; exit 0
fi
say ""

PROBLEM=0

# ---- the program ----

if [ "$KEEP_PROGRAM" -eq 0 ]; then
  [ "$FOUND" -eq 1 ] && close_app
  if [ "$DEB" -eq 1 ]; then
    say "Removing the .deb package..."
    if [ "$(id -u)" -eq 0 ]; then
      run apt-get remove -y "$PKG" || PROBLEM=1
    elif command -v sudo >/dev/null 2>&1; then
      run sudo apt-get remove -y "$PKG" || PROBLEM=1
    else
      say "  Run this as root to remove the package:  apt-get remove $PKG"; PROBLEM=1
    fi
  fi
  for f in "${APPIMAGES[@]+"${APPIMAGES[@]}"}"; do
    remove_path "$f"
  done
  if [ "${#APPIMAGES[@]}" -gt 0 ]; then
    # menu entries and icons made by AppImageLauncher / appimaged
    shopt -s nullglob nocaseglob
    for e in "$DATA_HOME"/applications/appimagekit*krh*client*.desktop "$DATA_HOME"/applications/appimagekit*krh*.desktop \
             "$DATA_HOME"/icons/hicolor/*/apps/appimagekit*krh*; do
      remove_path "$e"
    done
    shopt -u nullglob nocaseglob
  fi
fi

# ---- the data ----

if [ "$DEL_DATA" -eq 1 ]; then
  say "Deleting your data..."
  [ "$KEEP_PROGRAM" -eq 1 ] && close_app
  remove_path "$DATA_DIR"
  remove_path "$CACHE_HOME/$DATA_NAME"
  remove_path "/tmp/krh-update"
  if [ "$DEL_MEDIA" -eq 1 ]; then
    say "Deleting recordings, pictures and mods KRH Client saved..."
    remove_path "$(xdg_dir VIDEOS "$HOME/Videos")/$MEDIA_NAME"
    remove_path "$(xdg_dir PICTURES "$HOME/Pictures")/$MEDIA_NAME"
    remove_path "$(xdg_dir DOWNLOAD "$HOME/Downloads")/$MEDIA_NAME"
  fi
  if [ "$DRY" -eq 0 ] && [ -e "$DATA_DIR" ]; then say "  Some files could not be deleted. Close KRH Client and run this again."; PROBLEM=1; fi
else
  say "Your data was kept."
fi

say ""
if [ "$PROBLEM" -eq 1 ]; then say "Finished with problems: see the lines above."; exit 1; fi
[ "$DRY" -eq 1 ] && say "Dry run: nothing was changed." || say "All done."
exit 0

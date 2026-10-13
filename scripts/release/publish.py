#!/usr/bin/env python3
"""Put an Elchi release on speech.patientdesk.ai.

    scripts/release/publish.py --site ~/dev/stt-website-elchi --windows-run <GitHub run id> [--notes "…"] [--windows-only]

Takes the macOS files made by scripts/release/macos.sh (dist/release/<version>/)
and the Windows installer from the "Elchi Windows build" workflow run (its
artifact, downloaded with `gh`), then, in the website checkout:

- copies them to public/downloads/elchi/<version>/ with SHA256SUMS;
- writes lib/elchi/release.json (what the /elchi page offers);
- writes public/downloads/elchi/latest.json (the updater manifest).

It does not commit or push: review the site diff, then commit and push the
site's main to deploy.
"""

import argparse
import datetime as dt
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE_URL = "https://speech.patientdesk.ai"
REPO = "0daycloud/elchi"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def one(paths: list[Path], what: str) -> Path:
    if len(paths) != 1:
        sys.exit(f"expected exactly one {what}, found {[p.name for p in paths]}")
    return paths[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True, type=Path, help="website checkout (stt-website)")
    ap.add_argument("--windows-run", required=True, help="run id of the 'Elchi Windows build' workflow")
    ap.add_argument("--notes", default="", help="release notes shown by the updater")
    ap.add_argument("--windows-only", action="store_true",
                    help="publish the Windows installer alone (macOS keeps its 'coming soon')")
    args = ap.parse_args()

    version = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["version"]
    commit = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], text=True).strip()
    mac_dir = ROOT / "dist/release" / version
    mac = None
    if not args.windows_only:
        if not mac_dir.is_dir():
            sys.exit(f"{mac_dir} missing: run scripts/release/macos.sh first (or pass --windows-only)")
        dmg = one(sorted(mac_dir.glob("*.dmg")), "macOS DMG")
        mac_tar = one(sorted(mac_dir.glob("*.app.tar.gz")), "macOS updater bundle")
        mac_sig = Path(f"{mac_tar}.sig")
        if not mac_sig.exists():
            sys.exit(f"{mac_sig.name} missing")
        mac = (dmg, mac_tar, mac_sig)

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["gh", "run", "download", args.windows_run, "-R", REPO, "-D", tmp], check=True)
        exes = [p for p in Path(tmp).rglob("*-setup.exe")]
        exe = one(exes, "Windows installer")
        if f"_{version}_" not in exe.name:
            sys.exit(f"Windows installer {exe.name} is not version {version}")
        exe_sig = Path(f"{exe}.sig")
        if not exe_sig.exists():
            sys.exit(f"{exe_sig.name} missing: the Windows build was not signed for the updater")

        dest = args.site / "public/downloads/elchi" / version
        dest.mkdir(parents=True, exist_ok=True)
        for src in (*(mac or ()), exe, exe_sig):
            shutil.copy2(src, dest / src.name)

    entries = [(exe.name, "windows", "x86_64", "installer"), (f"{exe.name}.sig", "windows", "x86_64", "signature")]
    if mac:
        dmg, mac_tar, mac_sig = mac
        mac_arch = "universal" if "universal" in dmg.name else ("aarch64" if "aarch64" in dmg.name else "x86_64")
        entries = [
            (dmg.name, "macos", mac_arch, "installer"),
            (mac_tar.name, "macos", mac_arch, "updater"),
            (mac_sig.name, "macos", mac_arch, "signature"),
        ] + entries
    files = []
    for name, platform, arch, kind in entries:
        p = dest / name
        files.append({"platform": platform, "arch": arch, "kind": kind, "name": name,
                      "bytes": p.stat().st_size, "sha256": sha256(p)})
    (dest / "SHA256SUMS").write_text("".join(f"{f['sha256']}  {f['name']}\n" for f in files))

    today = dt.date.today().isoformat()
    release = {"app": "Elchi", "version": version, "date": today, "commit": commit, "files": files}
    (args.site / "lib/elchi/release.json").write_text(json.dumps(release, indent=1) + "\n")

    base = f"{SITE_URL}/downloads/elchi/{version}"
    platforms = {}
    if mac:
        mac_entry = {"signature": mac_sig.read_text().strip(), "url": f"{base}/{mac_tar.name}"}
        for t in (["darwin-aarch64", "darwin-x86_64"] if mac_arch == "universal" else [f"darwin-{mac_arch}"]):
            platforms[t] = mac_entry
    manifest = {
        "version": version,
        "notes": args.notes,
        "pub_date": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "platforms": {
            **platforms,
            "windows-x86_64": {"signature": (dest / f"{exe.name}.sig").read_text().strip(),
                               "url": f"{base}/{exe.name}"},
        },
    }
    (args.site / "public/downloads/elchi/latest.json").write_text(json.dumps(manifest, indent=1) + "\n")

    print(f"Elchi {version} staged in {args.site}:")
    for f in files:
        print(f"  {f['name']}  {f['bytes'] / 1e6:.1f} MB")
    print("Review `git -C <site> status`, then commit and push the site's main to deploy.")


if __name__ == "__main__":
    main()

//! Moving from the Electron app: find what it saved on this computer, have it export that, and (only when asked, and only
//! after a successful import) move it to the Trash.
use super::{files, shell, ToolError};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const BUNDLE_ID: &str = "cc.kokodev.koko";

/// Where the Electron app keeps its data. KOKO_ELECTRON_DATA points tests at a throwaway copy.
pub fn data_dir() -> PathBuf {
    std::env::var_os("KOKO_ELECTRON_DATA").map(PathBuf::from).unwrap_or_else(|| files::home().join("Library/Application Support/kokochat"))
}
fn has_data(dir: &Path) -> bool {
    dir.join("IndexedDB/app_koko_0.indexeddb.leveldb").is_dir()
}

fn installed_apps() -> Vec<PathBuf> {
    // only real installs; a build inside a source folder is never removed
    [PathBuf::from("/Applications/Koko.app"), files::home().join("Applications/Koko.app")].into_iter().filter(|p| is_ours(p)).collect()
}
fn is_ours(app: &Path) -> bool {
    fs::read_to_string(app.join("Contents/Info.plist")).is_ok_and(|p| p.contains(&format!("<string>{BUNDLE_ID}</string>")))
}
/// An Electron build that knows how to export (older builds would just start normally).
fn can_export(app: &Path) -> bool {
    let needle = b"KOKO_EXPORT";
    fs::read(app.join("Contents/Resources/app.asar")).is_ok_and(|b| b.windows(needle.len()).any(|w| w == needle))
}
fn exporter() -> (Option<PathBuf>, bool) {
    let mut all: Vec<PathBuf> = std::env::var_os("KOKO_ELECTRON_APP").map(PathBuf::from).into_iter().collect();
    all.extend(installed_apps());
    all.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../release/mac-arm64/Koko.app"));
    let found: Vec<PathBuf> = all.into_iter().filter(|p| is_ours(p)).collect();
    let any = !found.is_empty();
    (found.into_iter().find(|p| can_export(p)), any)
}

/// The Electron app holds a lock file naming its process while it is open.
fn electron_open(dir: &Path) -> bool {
    let Ok(target) = fs::read_link(dir.join("SingletonLock")) else { return false };
    let pid = target.to_string_lossy().rsplit('-').next().and_then(|p| p.parse::<i32>().ok());
    pid.is_some_and(alive)
}
#[cfg(unix)]
fn alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}
#[cfg(not(unix))]
fn alive(_: i32) -> bool {
    false
}

pub fn status() -> Value {
    // moving over is only built for macOS: elsewhere the button never appears
    if !cfg!(target_os = "macos") {
        return json!({ "found": false, "dataPath": "", "exporter": null, "oldAppOnly": false, "running": false, "installed": [] });
    }
    let dir = data_dir();
    let (app, any_app) = exporter();
    json!({
        "found": has_data(&dir),
        "dataPath": dir.to_string_lossy(),
        "exporter": app.map(|p| p.to_string_lossy().into_owned()),
        "oldAppOnly": any_app,
        "running": electron_open(&dir),
        "installed": installed_apps().iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>(),
    })
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(to)?;
    let mut n = 0;
    for e in fs::read_dir(from)?.flatten() {
        let target = to.join(e.file_name());
        let kind = e.file_type()?;
        if kind.is_dir() {
            copy_dir(&e.path(), &target)?;
            n += 1;
        } else if kind.is_file() && !target.exists() {
            fs::copy(e.path(), target)?;
        }
    }
    Ok(n)
}

/// Returns the exported data (JSON text) and copies the undo checkpoints across. The temporary file is removed at once.
pub fn export(app_data: &Path) -> Result<String, ToolError> {
    let fail = |m: &str| ToolError::new("MIGRATE", m);
    let dir = data_dir();
    if !has_data(&dir) {
        return Err(fail("No data from the Electron app was found on this computer."));
    }
    if electron_open(&dir) {
        return Err(fail("Quit the Electron Koko app first (Cmd+Q), then try again."));
    }
    let Some(app) = exporter().0 else {
        return Err(fail("No Electron Koko app that can export was found. Rebuild it with `npm run electron:pack`, then try again."));
    };
    fs::create_dir_all(app_data)?;
    let out = app_data.join(format!("electron-export-{}.json", std::process::id()));
    let _ = fs::remove_file(&out);
    let mut cmd = Command::new(app.join("Contents/MacOS/Koko"));
    cmd.env("KOKO_EXPORT", &out).env("KOKO_USER_DATA", &dir).env_remove("ELECTRON_RUN_AS_NODE");
    let result = shell::capture(cmd, 120_000, 20_000);
    let data = fs::read_to_string(&out);
    let _ = fs::remove_file(&out);
    match (result, data) {
        (Some(r), Ok(text)) if r.ok => {
            let _ = copy_dir(&dir.join("checkpoints"), &app_data.join("checkpoints"));
            Ok(text)
        }
        (Some(r), _) if r.code == Some(3) => Err(fail("Quit the Electron Koko app first (Cmd+Q), then try again.")),
        (Some(r), _) => Err(fail(&format!("The Electron app could not export its data. {}", r.stderr.chars().take(300).collect::<String>()))),
        (None, _) => Err(fail("The Electron app could not be started.")),
    }
}

fn marker(app_data: &Path) -> PathBuf {
    app_data.join("migrated-from-electron")
}
pub fn done(app_data: &Path) -> Result<(), ToolError> {
    fs::create_dir_all(app_data)?;
    fs::write(marker(app_data), data_dir().to_string_lossy().as_bytes())?;
    Ok(())
}

/// What cleanup would move to the Trash.
pub fn cleanup_targets() -> Vec<PathBuf> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let dir = data_dir();
    let mut v = installed_apps();
    if has_data(&dir) {
        v.push(dir);
    }
    v
}

pub fn cleanup(app_data: &Path) -> Result<Vec<String>, ToolError> {
    if !marker(app_data).exists() {
        return Err(ToolError::new("MIGRATE", "Migrate your data first; nothing was removed."));
    }
    if electron_open(&data_dir()) {
        return Err(ToolError::new("MIGRATE", "Quit the Electron Koko app first (Cmd+Q). Nothing was removed."));
    }
    // the Trash, so it can be put back. The system call, not Finder: asking Finder needs an extra permission.
    #[allow(unused_mut)]
    let mut bin = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        bin.set_delete_method(DeleteMethod::NsFileManager);
    }
    let mut moved = Vec::new();
    for p in cleanup_targets() {
        bin.delete(&p).map_err(|e| ToolError::new("MIGRATE", format!("Could not move {} to the Trash: {e}", p.display())))?;
        moved.push(p.to_string_lossy().into_owned());
    }
    Ok(moved)
}

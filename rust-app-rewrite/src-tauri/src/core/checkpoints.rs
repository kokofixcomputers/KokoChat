//! Undo for Code mode. Before the agent changes a file through its file tools, the original is saved per "turn" (one reply).
//! Reverting puts every file of that turn back. Changes made by shell commands are not tracked.
use super::{files, flag, text, Res, ToolError};
use serde_json::{json, Map, Value};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

static ROOT: OnceLock<PathBuf> = OnceLock::new();
/// one change at a time, so parallel tool calls cannot trample a turn's list
static LOCK: Mutex<()> = Mutex::new(());

pub fn init(dir: PathBuf) {
    let _ = fs::create_dir_all(&dir);
    // forget checkpoints older than two weeks
    let cutoff = SystemTime::now() - Duration::from_secs(14 * 86_400);
    for e in fs::read_dir(&dir).into_iter().flatten().flatten() {
        if e.metadata().and_then(|m| m.modified()).is_ok_and(|t| t < cutoff) {
            let _ = fs::remove_dir_all(e.path());
        }
    }
    let _ = ROOT.set(dir);
}

fn dir_of(key: &str) -> Result<PathBuf, ToolError> {
    let root = ROOT.get().ok_or_else(|| ToolError::new("ERR", "Undo is not set up."))?;
    let safe: String = key.chars().take(120).map(|c| if c.is_ascii_alphanumeric() || "_.-".contains(c) { c } else { '_' }).collect();
    // never "." or "..": that would point outside the checkpoint folder
    Ok(root.join(if safe.chars().all(|c| c == '.') { "_".into() } else { safe }))
}

fn sha(b: &[u8]) -> String {
    Sha1::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn load(dir: &Path) -> Value {
    fs::read(dir.join("manifest.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| json!({ "files": {}, "reverted": false }))
}
fn save(dir: &Path, m: &Value) -> Result<(), ToolError> {
    fs::create_dir_all(dir)?;
    fs::write(dir.join("manifest.json"), m.to_string())?;
    Ok(())
}
fn entries(m: &Value) -> Map<String, Value> {
    m["files"].as_object().cloned().unwrap_or_default()
}

fn before(key: &str, abs: &Path) -> Result<(), ToolError> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = dir_of(key)?;
    let mut m = load(&dir);
    let name = abs.to_string_lossy().into_owned();
    if m["files"].get(&name).is_some() {
        return Ok(());
    }
    let buf = fs::read(abs).ok();
    let mut entry = json!({ "existed": buf.is_some(), "origHash": buf.as_deref().map(sha) });
    if let Some(b) = &buf {
        let backup = format!("{}.bak", sha(name.as_bytes()));
        fs::create_dir_all(&dir)?;
        fs::write(dir.join(&backup), b)?;
        entry["backup"] = json!(backup);
    }
    m["files"][&name] = entry;
    save(&dir, &m)
}

/// remembers what the agent left, so later edits by you can be noticed
fn after(key: &str, abs: &Path) -> Result<(), ToolError> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = dir_of(key)?;
    let mut m = load(&dir);
    let name = abs.to_string_lossy().into_owned();
    if m["files"].get(&name).is_none() {
        return Ok(());
    }
    m["files"][&name]["afterHash"] = json!(fs::read(abs).ok().as_deref().map(sha));
    save(&dir, &m)
}

/// Run a file-changing tool, saving the original first when it belongs to a turn.
pub fn tracked(a: &Value, f: fn(&Value) -> Res) -> Res {
    let turn = text(a, "turn");
    if turn.is_empty() {
        return f(a);
    }
    let abs = files::resolve_args(a)?.abs;
    before(turn, &abs)?;
    let out = f(a);
    after(turn, &abs)?;
    out
}

fn changed(e: &Value, current: Option<&[u8]>) -> bool {
    if e["existed"] == true {
        current.map(sha).as_deref() != e["origHash"].as_str()
    } else {
        current.is_some()
    }
}

pub fn info(a: &Value) -> Res {
    let m = load(&dir_of(text(a, "key"))?);
    let reverted = m["reverted"] == true;
    let cwd = text(a, "cwd");
    let list: Vec<String> = entries(&m)
        .iter()
        .filter(|(abs, e)| reverted || changed(e, fs::read(abs).ok().as_deref()))
        .map(|(abs, _)| match Path::new(abs).strip_prefix(cwd) {
            Ok(r) if !cwd.is_empty() => r.to_string_lossy().into_owned(),
            _ => abs.clone(),
        })
        .collect();
    let count = if reverted { entries(&m).len() } else { list.len() };
    Ok(json!({ "files": list, "reverted": reverted, "count": count }))
}

pub fn revert(a: &Value) -> Res {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = dir_of(text(a, "key"))?;
    let mut m = load(&dir);
    if m["reverted"] == true {
        return Ok(json!({ "restored": 0, "deleted": 0, "conflicts": [], "already": true }));
    }
    let list = entries(&m);
    let conflicts: Vec<&String> = list
        .iter()
        .filter(|(abs, e)| {
            let cur = fs::read(abs).ok();
            e.get("afterHash").is_some_and(|h| cur.as_deref().map(sha).as_deref() != h.as_str()) && changed(e, cur.as_deref())
        })
        .map(|(abs, _)| abs)
        .collect();
    if !conflicts.is_empty() && !flag(a, "force") {
        return Ok(json!({ "restored": 0, "deleted": 0, "conflicts": conflicts }));
    }
    let (mut restored, mut deleted) = (0, 0);
    for (abs, e) in &list {
        let path = Path::new(abs);
        if e["existed"] == true {
            let Some(buf) = e["backup"].as_str().and_then(|b| fs::read(dir.join(b)).ok()) else { continue };
            if let Some(p) = path.parent() {
                fs::create_dir_all(p)?;
            }
            fs::write(path, buf)?;
            restored += 1;
        } else if path.exists() {
            fs::remove_file(path)?;
            deleted += 1;
        }
    }
    m["reverted"] = json!(true);
    save(&dir, &m)?;
    Ok(json!({ "restored": restored, "deleted": deleted, "conflicts": [] }))
}

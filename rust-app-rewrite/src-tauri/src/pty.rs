//! Real terminals for the side panel: one pseudo-terminal per tab, streamed to the interface.
use koko_tauri::core::{files, shell};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{mpsc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

struct Term {
    serial: u64,
    input: mpsc::Sender<String>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

fn terms() -> &'static Mutex<HashMap<String, Term>> {
    static T: OnceLock<Mutex<HashMap<String, Term>>> = OnceLock::new();
    T.get_or_init(Default::default)
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { cols: if cols < 2 { 80 } else { cols }, rows: if rows < 2 { 24 } else { rows }, pixel_width: 0, pixel_height: 0 }
}

pub fn open(app: AppHandle, id: String, cwd: Option<String>, cols: u16, rows: u16) -> Result<Value, String> {
    if terms().lock().unwrap().contains_key(&id) {
        return Ok(json!({ "reused": true }));
    }
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let program = shell::user_shell("/bin/zsh");
    let mut cmd = CommandBuilder::new(&program);
    if cfg!(unix) {
        cmd.arg("-il");
    }
    cmd.cwd(cwd.filter(|d| std::path::Path::new(d).is_dir()).map(Into::into).unwrap_or_else(files::home));
    for (k, v) in shell::shell_env() {
        cmd.env(k, v);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Koko");
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    // typing goes through a queue, so keys keep their order and a busy shell never blocks the window
    let (input, queue) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for data in queue {
            if writer.write_all(data.as_bytes()).and_then(|_| writer.flush()).is_err() {
                break;
            }
        }
    });
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let serial = SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pid = child.process_id();
    let killer = child.clone_killer();
    terms().lock().unwrap().insert(id.clone(), Term { serial, input, master: pair.master, killer });

    let (out_app, out_id) = (app.clone(), id.clone());
    let pump = std::thread::spawn(move || {
        let (mut buf, mut carry) = ([0u8; 8192], Vec::new());
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            carry.extend_from_slice(&buf[..n]);
            let cut = match std::str::from_utf8(&carry) {
                Err(e) if e.error_len().is_none() => e.valid_up_to(),
                _ => carry.len(),
            };
            let data = String::from_utf8_lossy(&carry[..cut]).into_owned();
            carry.drain(..cut);
            let _ = out_app.emit_to("main", "koko:pty:data", json!({ "id": out_id, "data": data }));
        }
    });
    std::thread::spawn(move || {
        let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
        std::thread::sleep(std::time::Duration::from_millis(80)); // let the last output arrive first
        drop(pump);
        let mine = terms().lock().unwrap().get(&id).is_some_and(|t| t.serial == serial);
        if mine {
            terms().lock().unwrap().remove(&id);
            let _ = app.emit_to("main", "koko:pty:exit", json!({ "id": id, "code": code }));
        }
    });
    Ok(json!({ "pid": pid, "shell": program.rsplit(['/', '\\']).next() }))
}

pub fn write(id: &str, data: String) {
    if let Some(t) = terms().lock().unwrap().get(id) {
        let _ = t.input.send(data);
    }
}
pub fn resize(id: &str, cols: u16, rows: u16) {
    if let Some(t) = terms().lock().unwrap().get(id) {
        let _ = t.master.resize(size(cols, rows));
    }
}
pub fn kill(id: &str) {
    if let Some(mut t) = terms().lock().unwrap().remove(id) {
        let _ = t.killer.kill();
    }
}
pub fn kill_all() {
    let ids: Vec<String> = terms().lock().unwrap().keys().cloned().collect();
    ids.iter().for_each(|i| kill(i));
}

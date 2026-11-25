//! What the interface can ask for. Every command refuses anything but the app's own page: web pages shown in the
//! side-panel browser must never reach your files or shell.
use crate::{pty, Busy};
use koko_tauri::core;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State, Webview};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub fn trusted(w: &Webview) -> Result<(), String> {
    // the app's page is tauri://localhost on macOS and http://tauri.localhost on Windows
    let ours = w.url().is_ok_and(|u| u.scheme() == "tauri" || (cfg!(windows) && u.host_str() == Some("tauri.localhost")) || (cfg!(debug_assertions) && u.host_str() == Some("localhost")));
    if w.label() == "main" && ours {
        Ok(())
    } else {
        Err("Not allowed.".into())
    }
}

#[tauri::command]
pub async fn koko(app: AppHandle, webview: Webview, op: String, args: Value) -> Result<Value, String> {
    trusted(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        if op == "shell:run" {
            let id = args["id"].clone();
            core::reply(core::shell::run(&args, &mut |chunk| {
                let _ = app.emit_to("main", "koko:shell:data", json!({ "id": id, "chunk": chunk }));
            }))
        } else {
            core::reply(core::dispatch(&op, &args))
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn shell_kill(webview: Webview, id: String) -> Result<bool, String> {
    trusted(&webview)?;
    Ok(core::shell::kill(&id))
}

#[tauri::command]
pub async fn pty_open(app: AppHandle, webview: Webview, id: String, cwd: Option<String>, cols: u16, rows: u16) -> Result<Value, String> {
    trusted(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        match pty::open(app, id, cwd, cols, rows) {
            Ok(data) => json!({ "ok": true, "data": data }),
            Err(e) => json!({ "ok": false, "error": { "message": e, "code": "PTY" } }),
        }
    })
    .await
    .map_err(|e| e.to_string())
}
// not async: these run one after another in the order they were sent
#[tauri::command]
pub fn pty_write(webview: Webview, id: String, data: String) -> Result<(), String> {
    trusted(&webview)?;
    pty::write(&id, data);
    Ok(())
}
#[tauri::command]
pub fn pty_resize(webview: Webview, id: String, cols: u16, rows: u16) -> Result<(), String> {
    trusted(&webview)?;
    pty::resize(&id, cols, rows);
    Ok(())
}
#[tauri::command]
pub fn pty_kill(webview: Webview, id: String) -> Result<(), String> {
    trusted(&webview)?;
    pty::kill(&id);
    Ok(())
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle, webview: Webview) -> Result<Option<String>, String> {
    trusted(&webview)?;
    let picked = app.dialog().file().set_title("Choose a project folder").set_can_create_directories(true).blocking_pick_folder();
    Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}
#[tauri::command]
pub fn reveal(app: AppHandle, webview: Webview, path: String) -> Result<(), String> {
    trusted(&webview)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn open_folder(app: AppHandle, webview: Webview, path: String) -> Result<String, String> {
    trusted(&webview)?;
    if !std::path::Path::new(&path).is_dir() {
        return Ok("That folder does not exist.".into());
    }
    Ok(app.opener().open_path(path, None::<&str>).err().map(|e| e.to_string()).unwrap_or_default())
}

#[tauri::command]
pub fn set_busy(webview: Webview, busy: State<Busy>, n: u32) -> Result<(), String> {
    trusted(&webview)?;
    busy.0.store(n, Ordering::Relaxed);
    Ok(())
}
#[tauri::command]
pub fn close_answer(app: AppHandle, webview: Webview, busy: State<Busy>, ok: bool) -> Result<(), String> {
    trusted(&webview)?;
    if ok {
        busy.0.store(0, Ordering::Relaxed);
        app.exit(0);
    }
    Ok(())
}

/* ------------------------------ moving from the Electron app ------------------------------ */
fn data(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn migrate_status(webview: Webview) -> Result<Value, String> {
    trusted(&webview)?;
    tauri::async_runtime::spawn_blocking(|| {
        let mut s = core::migrate::status();
        s["cleanup"] = json!(core::migrate::cleanup_targets().iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>());
        s
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn migrate_export(app: AppHandle, webview: Webview) -> Result<String, String> {
    trusted(&webview)?;
    let dir = data(&app)?;
    tauri::async_runtime::spawn_blocking(move || core::migrate::export(&dir).map_err(|e| e.message)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn migrate_done(app: AppHandle, webview: Webview) -> Result<(), String> {
    trusted(&webview)?;
    core::migrate::done(&data(&app)?).map_err(|e| e.message)
}
#[tauri::command]
pub async fn migrate_cleanup(app: AppHandle, webview: Webview) -> Result<Vec<String>, String> {
    trusted(&webview)?;
    let dir = data(&app)?;
    tauri::async_runtime::spawn_blocking(move || core::migrate::cleanup(&dir).map_err(|e| e.message)).await.map_err(|e| e.to_string())?
}

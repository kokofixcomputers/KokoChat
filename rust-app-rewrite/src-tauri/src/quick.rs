//! Quick ask: a global shortcut (or the menu bar icon) opens a small floating box. The question is handed to the main
//! window, which starts a new chat with it. A port of electron/quick.cjs.
use crate::commands::{trusted, trusted_quick};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Webview};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const WIDTH: f64 = 720.0;

#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
struct Config {
    enabled: bool,
    shortcut: String,
    menu_bar: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self { enabled: true, shortcut: DEFAULT_SHORTCUT.into(), menu_bar: true }
    }
}

#[derive(Default)]
pub struct Quick {
    config: Mutex<Config>,
    registered: AtomicBool,
    pub capturing: AtomicBool,
    tray: Mutex<Option<TrayIcon>>,
    last_hide: Mutex<Option<Instant>>,
}

fn file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("quick.json"))
}

fn window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("quick") {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("index.html?quick=1".into()))
        .title("Koko quick ask")
        .inner_size(WIDTH, 220.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .visible(false)
        .accept_first_mouse(true)
        .disable_drag_drop_handler()
        .build()
}

/// Open the box near the top of the screen the pointer is on, or under the menu bar icon (`anchor`: its centre and bottom).
fn show(app: &AppHandle, anchor: Option<(f64, f64)>) {
    let Ok(w) = window(app) else { return };
    let point = app.cursor_position().ok();
    let at = anchor.map(|(x, y)| (x, y + 1.0)).or_else(|| point.map(|p| (p.x, p.y)));
    let monitor = at.and_then(|(x, y)| app.monitor_from_point(x, y).ok().flatten()).or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let k = m.scale_factor();
        let (left, top) = (m.position().x as f64 / k, m.position().y as f64 / k);
        let (width, height) = (m.size().width as f64 / k, m.size().height as f64 / k);
        let (x, y) = match anchor {
            Some((cx, bottom)) => ((cx / k - WIDTH / 2.0).clamp(left + 6.0, (left + width - WIDTH - 6.0).max(left + 6.0)), bottom / k - 14.0),
            None => (left + (width - WIDTH) / 2.0, top + height * 0.2),
        };
        let _ = w.set_position(LogicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit_to("quick", "koko:quick:show", ());
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            *app.state::<Quick>().last_hide.lock().unwrap() = Some(Instant::now());
        }
    }
}
fn visible(app: &AppHandle) -> bool {
    app.get_webview_window("quick").is_some_and(|w| w.is_visible().unwrap_or(false))
}
fn toggle(app: &AppHandle) {
    if visible(app) {
        hide(app)
    } else {
        show(app, None)
    }
}

/// The box closes when you click elsewhere.
pub fn blurred(app: &AppHandle) {
    if !app.state::<Quick>().capturing.load(Ordering::Relaxed) {
        hide(app);
    }
}

fn sync_tray(app: &AppHandle, cfg: &Config) -> tauri::Result<()> {
    let state = app.state::<Quick>();
    let mut tray = state.tray.lock().unwrap();
    if !cfg.menu_bar {
        if tray.take().is_some() {
            app.remove_tray_by_id("quick");
        }
        return Ok(());
    }
    if tray.is_some() {
        return Ok(());
    }
    let menu = Menu::with_items(app, &[
        &MenuItem::with_id(app, "tray-ask", "Quick ask", true, None::<&str>)?,
        &MenuItem::with_id(app, "tray-open", "Open Koko", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "quit", "Quit Koko", true, None::<&str>)?,
    ])?;
    // the Mac menu bar wants a black "template" picture it can tint; elsewhere use the app icon
    let icon = if cfg!(target_os = "macos") { tauri::include_image!("../../electron/assets/trayTemplate@2x.png") } else { tauri::include_image!("icons/32x32.png") };
    let built = TrayIconBuilder::with_id("quick")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Koko: quick ask")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                let app = tray.app_handle();
                // pressing the icon first takes focus from the box (which closes it), so a click right after a close means "close"
                let just_closed = app.state::<Quick>().last_hide.lock().unwrap().is_some_and(|t| t.elapsed().as_millis() < 300);
                if visible(app) {
                    hide(app)
                } else if !just_closed {
                    let k = app.primary_monitor().ok().flatten().map_or(1.0, |m| m.scale_factor());
                    let (p, s) = (rect.position.to_physical::<f64>(k), rect.size.to_physical::<f64>(k));
                    show(app, Some((p.x + s.width / 2.0, p.y + s.height)));
                }
            }
        })
        .build(app)?;
    *tray = Some(built);
    Ok(())
}

pub fn menu_event(app: &AppHandle, id: &str) {
    match id {
        "tray-ask" => show(app, None),
        "tray-open" => crate::show_main(app),
        _ => {}
    }
}

/// (Re)register the global shortcut. Returns why the system refused it, if it did.
fn register(app: &AppHandle, cfg: &Config) -> Option<String> {
    let state = app.state::<Quick>();
    let keys = app.global_shortcut();
    let _ = keys.unregister_all();
    state.registered.store(false, Ordering::Relaxed);
    if !cfg.enabled || cfg.shortcut.is_empty() {
        return None;
    }
    let Ok(shortcut) = cfg.shortcut.replace("Return", "Enter").parse::<Shortcut>() else { return Some("That is not a valid shortcut.".into()) };
    let done = keys.on_shortcut(shortcut, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            toggle(app);
        }
    });
    match done {
        Ok(()) => {
            state.registered.store(true, Ordering::Relaxed);
            None
        }
        Err(_) => Some("Another app is already using that shortcut.".into()),
    }
}

fn report(app: &AppHandle, error: Option<String>) -> Value {
    let state = app.state::<Quick>();
    let cfg = state.config.lock().unwrap().clone();
    let mut v = serde_json::to_value(cfg).unwrap_or_default();
    v["registered"] = json!(state.registered.load(Ordering::Relaxed));
    v["defaultShortcut"] = json!(DEFAULT_SHORTCUT);
    v["error"] = json!(error);
    v
}

pub fn init(app: &AppHandle) {
    let cfg: Config = file(app).and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    *app.state::<Quick>().config.lock().unwrap() = cfg.clone();
    if let Some(e) = register(app, &cfg) {
        eprintln!("quick ask shortcut: {e}");
    }
    if let Err(e) = sync_tray(app, &cfg) {
        eprintln!("menu bar icon: {e}");
    }
}

/* ---------------------------------- from Settings (main window) ---------------------------------- */
#[tauri::command]
pub fn quick_get(app: AppHandle, webview: Webview) -> Result<Value, String> {
    trusted(&webview)?;
    Ok(report(&app, None))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    enabled: Option<bool>,
    shortcut: Option<String>,
    menu_bar: Option<bool>,
}
// not async: the menu bar icon has to be made on the main thread
#[tauri::command]
pub fn quick_set(app: AppHandle, webview: Webview, patch: Patch) -> Result<Value, String> {
    trusted(&webview)?;
    let cfg = {
        let state = app.state::<Quick>();
        let mut c = state.config.lock().unwrap();
        if let Some(v) = patch.enabled {
            c.enabled = v;
        }
        if let Some(v) = patch.shortcut.filter(|s| s.len() < 60) {
            c.shortcut = v;
        }
        if let Some(v) = patch.menu_bar {
            c.menu_bar = v;
        }
        c.clone()
    };
    let _ = sync_tray(&app, &cfg);
    let error = register(&app, &cfg);
    if let (Some(f), Ok(text)) = (file(&app), serde_json::to_vec(&cfg)) {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(f, text);
    }
    Ok(report(&app, error))
}

/* -------------------------------------- from the box itself -------------------------------------- */
#[tauri::command]
pub fn quick_hide(app: AppHandle, webview: Webview) -> Result<(), String> {
    trusted_quick(&webview)?;
    hide(&app);
    Ok(())
}
#[tauri::command]
pub fn quick_resize(app: AppHandle, webview: Webview, height: f64) -> Result<(), String> {
    trusted_quick(&webview)?;
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.set_size(LogicalSize::new(WIDTH, height.clamp(120.0, 640.0).round()));
    }
    Ok(())
}
#[tauri::command]
pub fn quick_submit(app: AppHandle, webview: Webview, payload: Value) -> Result<(), String> {
    trusted_quick(&webview)?;
    if !payload.is_object() {
        return Ok(());
    }
    hide(&app);
    crate::show_main(&app);
    app.emit_to("main", "koko:quick:submit", payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quick_capture(app: AppHandle, webview: Webview) -> Result<Value, String> {
    trusted_quick(&webview)?;
    if app.state::<Quick>().capturing.swap(true, Ordering::Relaxed) {
        return Ok(json!({ "error": "busy" }));
    }
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || capture::area(&worker)).await.map_err(|e| e.to_string());
    app.state::<Quick>().capturing.store(false, Ordering::Relaxed);
    result
}
#[tauri::command]
pub fn quick_open_screen_settings(webview: Webview) -> Result<(), String> {
    trusted_quick(&webview)?;
    if cfg!(target_os = "macos") {
        let _ = std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture").spawn();
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod capture {
    use super::*;
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    use objc2_app_kit::NSWindow;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    /// Make the box see-through instead of hiding it: hiding would bring Koko's main window forward, into the picture.
    fn fade(app: &AppHandle, away: bool) {
        let Some(w) = app.get_webview_window("quick") else { return };
        let _ = w.set_ignore_cursor_events(away);
        let target = w.clone();
        let _ = w.run_on_main_thread(move || {
            if let Ok(ptr) = target.ns_window() {
                // SAFETY: the pointer is this window's NSWindow, and we are on the main thread
                let ns: &NSWindow = unsafe { &*ptr.cast() };
                ns.setAlphaValue(if away { 0.0 } else { 1.0 });
            }
        });
    }

    /// Choose an area with the system's own crosshair (Esc cancels).
    pub fn area(app: &AppHandle) -> Value {
        // SAFETY: plain system calls without arguments
        if unsafe { !CGPreflightScreenCaptureAccess() } {
            unsafe { CGRequestScreenCaptureAccess() }; // shows the system prompt the first time
            return json!({ "error": "permission" });
        }
        let out = std::env::temp_dir().join(format!("koko-capture-{}.png", std::process::id()));
        let _ = std::fs::remove_file(&out);
        fade(app, true);
        std::thread::sleep(std::time::Duration::from_millis(150));
        let ran = std::process::Command::new("/usr/sbin/screencapture").args(["-i", "-x", "-t", "png"]).arg(&out).status();
        fade(app, false);
        if let Some(w) = app.get_webview_window("quick") {
            let _ = w.show();
            let _ = w.set_focus();
        }
        let bytes = std::fs::read(&out);
        let _ = std::fs::remove_file(&out);
        match (ran, bytes) {
            (Err(e), _) => json!({ "error": e.to_string() }),
            (_, Err(_)) => json!({ "cancelled": true }),
            (_, Ok(png)) => match shrink(png) {
                Ok(png) => json!({ "dataUrl": format!("data:image/png;base64,{}", B64.encode(png)) }),
                Err(e) => json!({ "error": e }),
            },
        }
    }

    /// Very large pictures cost the model a lot and add nothing.
    fn shrink(png: Vec<u8>) -> Result<Vec<u8>, String> {
        let img = image::load_from_memory(&png).map_err(|e| e.to_string())?;
        if img.width() <= 2200 {
            return Ok(png);
        }
        let mut out = std::io::Cursor::new(Vec::new());
        img.resize(2200, u32::MAX, image::imageops::FilterType::Triangle).write_to(&mut out, image::ImageFormat::Png).map_err(|e| e.to_string())?;
        Ok(out.into_inner())
    }
}

#[cfg(not(target_os = "macos"))]
mod capture {
    use super::*;
    pub fn area(_: &AppHandle) -> Value {
        json!({ "error": "Screen capture is only built for macOS so far. Paste or attach a picture instead." })
    }
}

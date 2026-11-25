// Koko, Rust shell (Tauri). The interface is the same React app as the Electron build (../../dist); this file hosts it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser;
mod commands;
mod notify;
mod pty;
mod quick;

use koko_tauri::core;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

/// how many agents are running, reported by the interface
pub struct Busy(pub AtomicU32);

pub fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// True when nothing is running. Otherwise the window asks (with its own dialog) and answers through `close_answer`.
fn may_close(app: &tauri::AppHandle) -> bool {
    let n = app.state::<Busy>().0.load(Ordering::Relaxed);
    if n == 0 {
        return true;
    }
    show_main(app);
    let _ = app.emit_to("main", "koko:close-request", n);
    false
}

/// The usual Mac menus, with our own Settings (Cmd+,) and a Quit that checks for running agents.
fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let sep = || PredefinedMenuItem::separator(app);
    let main = Submenu::with_items(app, "Koko", true, &[
        &PredefinedMenuItem::about(app, None, Some(AboutMetadata::default()))?,
        &sep()?,
        &MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
        &sep()?,
        &PredefinedMenuItem::services(app, None)?,
        &sep()?,
        &PredefinedMenuItem::hide(app, None)?,
        &PredefinedMenuItem::hide_others(app, None)?,
        &PredefinedMenuItem::show_all(app, None)?,
        &sep()?,
        &MenuItem::with_id(app, "quit", "Quit Koko", true, Some("CmdOrCtrl+Q"))?,
    ])?;
    let edit = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &sep()?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;
    let window = Submenu::with_items(app, "Window", true, &[
        &PredefinedMenuItem::minimize(app, None)?,
        &PredefinedMenuItem::maximize(app, None)?,
        &PredefinedMenuItem::fullscreen(app, None)?,
        &sep()?,
        &PredefinedMenuItem::close_window(app, None)?,
    ])?;
    Menu::with_items(app, &[&main, &edit, &window])
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        // requests to model providers go through Rust, so providers without CORS headers still work
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Busy(AtomicU32::new(0)))
        .manage(quick::Quick::default())
        .invoke_handler(tauri::generate_handler![
            commands::koko, commands::shell_kill, commands::pty_open, commands::pty_write, commands::pty_resize, commands::pty_kill,
            commands::pick_folder, commands::reveal, commands::open_folder, commands::set_busy, commands::close_answer,
            notify::notify_show, notify::notify_close,
            quick::quick_get, quick::quick_set, quick::quick_hide, quick::quick_resize, quick::quick_submit, quick::quick_capture, quick::quick_open_screen_settings,
            commands::migrate_status, commands::migrate_export, commands::migrate_done, commands::migrate_cleanup,
            browser::browser_create, browser::browser_bounds, browser::browser_nav, browser::browser_close, browser::browser_state, browser::browser_op
        ])
        .menu(menu)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "settings" => {
                show_main(app);
                let _ = app.emit_to("main", "koko:open-settings", ());
            }
            "quit" => {
                if may_close(app) {
                    app.exit(0);
                }
            }
            other => quick::menu_event(app, other),
        })
        .setup(|app| {
            notify::init(app.handle());
            quick::init(app.handle());
            core::checkpoints::init(app.path().app_data_dir()?.join("checkpoints"));
            std::thread::spawn(|| {
                core::shell::shell_env(); // warm up your shell's PATH in the background
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "quick" {
                if let tauri::WindowEvent::Focused(false) = event {
                    quick::blurred(window.app_handle());
                }
                return;
            }
            // the web view does not always notice losing focus (a hidden window), and notifications depend on it
            if let tauri::WindowEvent::Focused(focused) = event {
                let _ = window.app_handle().emit_to("main", "koko:focus", *focused);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let free = may_close(window.app_handle());
                // like the Electron app: on macOS the red button hides the window, Cmd+Q quits
                if cfg!(target_os = "macos") {
                    api.prevent_close();
                    if free {
                        let _ = window.hide();
                    }
                } else if !free {
                    api.prevent_close();
                } else {
                    window.app_handle().exit(0); // the hidden quick-ask box must not keep the app running
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while starting Koko")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => {
                pty::kill_all();
                core::shell::kill_all();
            }
            // clicking the Dock icon brings the hidden window back
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main(app),
            _ => {
                let _ = app;
            }
        });
}

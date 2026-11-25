//! System notifications with buttons (Allow / Deny). Clicks and button presses are reported back to the interface.
use crate::commands::trusted;
use serde_json::json;
use tauri::{AppHandle, Emitter, Webview};

#[derive(serde::Deserialize)]
pub struct Note {
    id: String,
    title: String,
    body: String,
    #[serde(default)]
    actions: Vec<String>,
    sound: Option<bool>,
}

fn pressed(app: &AppHandle, id: &str, action: Option<usize>) {
    if action.is_none() {
        crate::show_main(app);
    }
    let event = match action {
        Some(i) => json!({ "id": id, "type": "action", "index": i }),
        None => json!({ "id": id, "type": "click" }),
    };
    let _ = app.emit_to("main", "koko:notify:event", event);
}

/// Returns an empty text when the system accepted the notification, otherwise why it did not.
#[tauri::command]
pub async fn notify_show(app: AppHandle, webview: Webview, note: Note) -> Result<String, String> {
    trusted(&webview)?;
    tauri::async_runtime::spawn_blocking(move || platform::show(&app, note).err().unwrap_or_default()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notify_close(webview: Webview, id: String) -> Result<(), String> {
    trusted(&webview)?;
    platform::close(&id);
    Ok(())
}

pub fn init(app: &AppHandle) {
    platform::init(app);
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use block2::{DynBlock, RcBlock};
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, DefinedClass};
    use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSSet, NSString};
    use objc2_user_notifications::*;
    use std::collections::HashMap;
    use std::sync::{mpsc, Mutex, OnceLock};
    use std::time::Duration;

    struct Ivars {
        app: AppHandle,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing rules, and this class does not implement Drop.
        #[unsafe(super(NSObject))]
        #[name = "KokoNotificationDelegate"]
        #[ivars = Ivars]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            // without this macOS stays silent while the app is in front (the "Send a test" button)
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(&self, _center: &UNUserNotificationCenter, _n: &UNNotification, done: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>) {
                done.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List | UNNotificationPresentationOptions::Sound,));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(&self, _center: &UNUserNotificationCenter, response: &UNNotificationResponse, done: &DynBlock<dyn Fn()>) {
                let id = response.notification().request().identifier().to_string();
                let action = response.actionIdentifier().to_string();
                if let Some(i) = action.strip_prefix("koko.").and_then(|i| i.parse::<usize>().ok()) {
                    pressed(&self.ivars().app, &id, Some(i));
                } else if action.ends_with("UNNotificationDefaultActionIdentifier") {
                    pressed(&self.ivars().app, &id, None);
                }
                done.call(());
            }
        }
    );

    /// The system only works for a real app bundle; asking from a bare program (cargo run) would crash.
    fn center() -> Result<Retained<UNUserNotificationCenter>, String> {
        let bundled = NSBundle::mainBundle().bundleIdentifier().is_some() && std::env::current_exe().is_ok_and(|p| p.to_string_lossy().contains(".app/Contents/MacOS/"));
        if bundled {
            Ok(UNUserNotificationCenter::currentNotificationCenter())
        } else {
            Err("Notifications need the built app (cargo tauri build), not a development run.".into())
        }
    }

    pub fn init(app: &AppHandle) {
        let Ok(center) = center() else { return };
        let this = Delegate::alloc().set_ivars(Ivars { app: app.clone() });
        let delegate: Retained<Delegate> = unsafe { msg_send![super(this), init] };
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        std::mem::forget(delegate); // the centre keeps only a weak reference; it must live as long as the app
    }

    fn explain(e: &NSError) -> String {
        format!("macOS refused: {}. Check System Settings → Notifications → Koko.", e.localizedDescription())
    }

    /// Asks the first time (macOS shows its own prompt); later answers come back at once.
    fn authorize(center: &UNUserNotificationCenter) -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        let done = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            // SAFETY: the system passes null or a valid error
            let _ = tx.send(match unsafe { error.as_ref() } {
                Some(e) => Err(explain(e)),
                None if granted.as_bool() => Ok(()),
                None => Err("Notifications are turned off for Koko. Turn them on in System Settings → Notifications → Koko.".into()),
            });
        });
        center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound, &done);
        rx.recv_timeout(Duration::from_secs(60)).map_err(|_| "macOS is still waiting for you to allow notifications.".to_string())?
    }

    /// Buttons belong to a "category" that has to be registered before it is used.
    fn category(center: &UNUserNotificationCenter, actions: &[String]) -> String {
        static KNOWN: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();
        let name = format!("koko:{}", actions.join("|"));
        let mut known = KNOWN.get_or_init(Default::default).lock().unwrap();
        if known.insert(name.clone(), actions.to_vec()).is_none() {
            let all: Vec<Retained<UNNotificationCategory>> = known
                .iter()
                .map(|(name, labels)| {
                    let buttons: Vec<Retained<UNNotificationAction>> = labels
                        .iter()
                        .enumerate()
                        .map(|(i, l)| UNNotificationAction::actionWithIdentifier_title_options(&NSString::from_str(&format!("koko.{i}")), &NSString::from_str(l), UNNotificationActionOptions::empty()))
                        .collect();
                    UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(&NSString::from_str(name), &NSArray::from_retained_slice(&buttons), &NSArray::new(), UNNotificationCategoryOptions::empty())
                })
                .collect();
            center.setNotificationCategories(&NSSet::from_retained_slice(&all));
        }
        name
    }

    pub fn show(_app: &AppHandle, note: Note) -> Result<(), String> {
        let center = center()?;
        authorize(&center)?;
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&note.title.chars().take(120).collect::<String>()));
        content.setBody(&NSString::from_str(&note.body.chars().take(300).collect::<String>()));
        if note.sound != Some(false) {
            content.setSound(Some(&UNNotificationSound::defaultSound()));
        }
        let actions: Vec<String> = note.actions.iter().take(2).map(|a| a.chars().take(24).collect()).collect();
        if !actions.is_empty() {
            content.setCategoryIdentifier(&NSString::from_str(&category(&center, &actions)));
        }
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&note.id), &content, None);
        let (tx, rx) = mpsc::channel();
        let done = RcBlock::new(move |error: *mut NSError| {
            let _ = tx.send(unsafe { error.as_ref() }.map_or(Ok(()), |e| Err(explain(e))));
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&done));
        rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "macOS did not answer.".to_string())?
    }

    pub fn close(id: &str) {
        if let Ok(center) = center() {
            let ids = NSArray::from_retained_slice(&[NSString::from_str(id)]);
            center.removeDeliveredNotificationsWithIdentifiers(&ids);
            center.removePendingNotificationRequestsWithIdentifiers(&ids);
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use tauri::Manager;
    use tauri_winrt_notification::Toast;

    pub fn init(_: &AppHandle) {}

    pub fn show(app: &AppHandle, note: Note) -> Result<(), String> {
        // an installed app is known to Windows by its identifier; a bare development program borrows PowerShell's
        let known = if cfg!(debug_assertions) { Toast::POWERSHELL_APP_ID.to_string() } else { app.config().identifier.clone() };
        let (app, id) = (app.clone(), note.id.clone());
        let mut toast = Toast::new(&known).title(&note.title).text1(&note.body);
        if note.sound == Some(false) {
            toast = toast.sound(None);
        }
        for (i, label) in note.actions.iter().take(2).enumerate() {
            toast = toast.add_button(label, &format!("koko.{i}"));
        }
        toast
            .on_activated(move |action| {
                pressed(&app, &id, action.as_deref().and_then(|a| a.strip_prefix("koko.")).and_then(|i| i.parse().ok()));
                Ok(())
            })
            .show()
            .map_err(|e| format!("Windows refused: {e}"))
    }

    pub fn close(_: &str) {}
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use super::*;
    pub fn init(_: &AppHandle) {}
    pub fn show(_: &AppHandle, _: Note) -> Result<(), String> {
        Err("Notifications are not built for this system yet.".into())
    }
    pub fn close(_: &str) {}
}

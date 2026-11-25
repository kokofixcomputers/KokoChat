//! The side panel's browser tabs: native child web views placed over the panel, plus what the agent needs to drive them.
//! Unlike Electron, macOS web views take no simulated mouse or keyboard input, so clicks and typing are done by script.
use crate::commands::trusted;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Duration;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl};

fn label(id: u32) -> String {
    format!("browser-{id}")
}
fn guest(app: &AppHandle, id: u32) -> Result<Webview, String> {
    app.get_webview(&label(id)).ok_or_else(|| "That browser tab is not available.".to_string())
}
/// web pages only: never the app's own scheme or local files
fn web(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data") && url.host_str() != Some("tauri.localhost")
}
fn parse(url: &str) -> Result<Url, String> {
    let u = Url::parse(url).map_err(|e| e.to_string())?;
    if matches!(u.scheme(), "http" | "https") && web(&u) {
        Ok(u)
    } else {
        Err("Only http and https pages can be opened.".into())
    }
}
fn tell(app: &AppHandle, id: u32, kind: &str, value: &str) {
    let _ = app.emit_to("main", "koko:browser:event", json!({ "id": id, "type": kind, "value": value }));
}

#[derive(serde::Deserialize, Clone, Copy)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[tauri::command]
pub async fn browser_create(app: AppHandle, webview: Webview, id: u32, url: String, rect: Rect) -> Result<(), String> {
    trusted(&webview)?;
    let target = parse(&url)?;
    if app.get_webview(&label(id)).is_some() {
        return Ok(());
    }
    let window = app.get_window("main").ok_or("No window")?;
    let (load, title, popup) = (app.clone(), app.clone(), app.clone());
    let builder = WebviewBuilder::new(label(id), WebviewUrl::External(target))
        .on_navigation(web)
        .on_page_load(move |_, p| {
            let kind = if matches!(p.event(), PageLoadEvent::Started) { "started" } else { "stopped" };
            tell(&load, id, kind, p.url().as_str());
        })
        .on_document_title_changed(move |_, t| tell(&title, id, "title", &t))
        // links that want a new window become new tabs
        .on_new_window(move |u, _| {
            if matches!(u.scheme(), "http" | "https") {
                let _ = popup.emit_to("main", "koko:browser:open", u.as_str());
            }
            NewWindowResponse::Deny
        });
    window.add_child(builder, LogicalPosition::new(rect.x, rect.y), LogicalSize::new(rect.w.max(1.0), rect.h.max(1.0))).map_err(|e| e.to_string())?;
    Ok(())
}

/// Move the page over its place in the panel, or hide it (rect = null).
#[tauri::command]
pub fn browser_bounds(app: AppHandle, webview: Webview, id: u32, rect: Option<Rect>) -> Result<(), String> {
    trusted(&webview)?;
    let g = guest(&app, id)?;
    match rect {
        Some(r) if r.w >= 2.0 && r.h >= 2.0 => {
            let _ = g.set_position(LogicalPosition::new(r.x, r.y));
            let _ = g.set_size(LogicalSize::new(r.w, r.h));
            g.show().map_err(|e| e.to_string())
        }
        _ => g.hide().map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub async fn browser_nav(app: AppHandle, webview: Webview, id: u32, action: String, url: Option<String>) -> Result<(), String> {
    trusted(&webview)?;
    let g = guest(&app, id)?;
    match action.as_str() {
        "load" => g.navigate(parse(url.as_deref().unwrap_or(""))?).map_err(|e| e.to_string()),
        "reload" => g.reload().map_err(|e| e.to_string()),
        "back" => g.eval("history.back()").map_err(|e| e.to_string()),
        "forward" => g.eval("history.forward()").map_err(|e| e.to_string()),
        _ => Err("Unknown navigation".into()),
    }
}

#[tauri::command]
pub fn browser_close(app: AppHandle, webview: Webview, id: u32) -> Result<(), String> {
    trusted(&webview)?;
    if let Ok(g) = guest(&app, id) {
        g.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_state(app: AppHandle, webview: Webview, id: u32) -> Result<Value, String> {
    trusted(&webview)?;
    mac::state(&guest(&app, id)?)
}

#[tauri::command]
pub async fn browser_op(app: AppHandle, webview: Webview, op: String, id: u32, args: Value) -> Result<Value, String> {
    trusted(&webview)?;
    let done = tauri::async_runtime::spawn_blocking(move || run(&guest(&app, id)?, &op, &args)).await.map_err(|e| e.to_string())?;
    Ok(match done {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(e) => json!({ "ok": false, "error": { "message": e, "code": "BROWSER" } }),
    })
}

fn script(g: &Webview, body: &str, args: Value) -> Result<Value, String> {
    mac::eval(g, &format!("({body})({args})"))
}

fn run(g: &Webview, op: &str, a: &Value) -> Result<Value, String> {
    match op {
        "exec" => mac::eval(g, a["code"].as_str().unwrap_or("")),
        "shot" => shot(g),
        "click" => script(g, include_str!("js/click.js"), a.clone()),
        "text" => script(g, include_str!("js/text.js"), a.clone()),
        "key" => script(g, include_str!("js/key.js"), a.clone()),
        "scroll" => {
            let r = script(g, include_str!("js/scroll.js"), a.clone());
            std::thread::sleep(Duration::from_millis(120));
            r
        }
        _ => Err("Unknown browser operation".into()),
    }
}

fn shot(g: &Webview) -> Result<Value, String> {
    let png = mac::snapshot(g)?;
    let img = image::load_from_memory(&png).map_err(|e| e.to_string())?;
    // screenshots come in screen pixels; report the page's own size, as the Electron app does
    let css = mac::eval(g, "({w:innerWidth,h:innerHeight})")?;
    let width = css["w"].as_u64().filter(|w| *w > 0).unwrap_or(u64::from(img.width())) as u32;
    let height = (u64::from(img.height()) * u64::from(width) / u64::from(img.width().max(1))) as u32;
    let jpeg = |w: u32, quality: u8| -> Result<String, String> {
        let small = if img.width() > w { img.resize(w, u32::MAX, image::imageops::FilterType::Triangle) } else { img.clone() };
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality).encode_image(&small.to_rgb8()).map_err(|e| e.to_string())?;
        Ok(format!("data:image/jpeg;base64,{}", B64.encode(out)))
    };
    Ok(json!({ "dataUrl": jpeg(width.min(1280), 80)?, "thumb": jpeg(width.min(520), 60)?, "width": width, "height": height }))
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError, NSString};
    use objc2_web_kit::WKWebView;

    /// Run `f` with the native web view (on the main thread) and wait for the answer it sends back.
    fn with<T: Send + 'static>(g: &Webview, secs: u64, f: impl FnOnce(&WKWebView, mpsc::Sender<Result<T, String>>) + Send + 'static) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        g.with_webview(move |p| {
            // SAFETY: on macOS this pointer is the tab's WKWebView, alive for the duration of the closure
            let view: &WKWebView = unsafe { &*p.inner().cast() };
            f(view, tx);
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(secs)).map_err(|_| "The page did not answer in time.".to_string())?
    }

    /// Evaluate an expression in the page and return its value as JSON.
    pub fn eval(g: &Webview, code: &str) -> Result<Value, String> {
        let wrapped = format!("JSON.stringify(eval({}))", serde_json::to_string(code).map_err(|e| e.to_string())?);
        let text: Option<String> = with(g, 20, move |view, tx| {
            let done = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                // SAFETY: WebKit passes either null or valid objects
                let result = match unsafe { error.as_ref() } {
                    Some(e) => Err(format!("The page script failed: {}", e.localizedDescription())),
                    None => Ok(unsafe { value.as_ref() }.and_then(|v| v.downcast_ref::<NSString>()).map(ToString::to_string)),
                };
                let _ = tx.send(result);
            });
            unsafe { view.evaluateJavaScript_completionHandler(&NSString::from_str(&wrapped), Some(&done)) };
        })?;
        Ok(text.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null))
    }

    /// What the tab shows right now, as PNG bytes.
    pub fn snapshot(g: &Webview) -> Result<Vec<u8>, String> {
        with(g, 20, |view, tx| {
            let done = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
                let png = unsafe { image.as_ref() }.and_then(|image| {
                    let tiff = image.TIFFRepresentation()?;
                    let rep = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
                    let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
                    Some(data.to_vec())
                });
                let _ = tx.send(png.ok_or_else(|| "The page has nothing to show yet (is the browser tab visible?).".to_string()));
            });
            unsafe { view.takeSnapshotWithConfiguration_completionHandler(None, &done) };
        })
    }

    pub fn state(g: &Webview) -> Result<Value, String> {
        with(g, 5, |view, tx| {
            let v = unsafe {
                json!({
                    "url": view.URL().and_then(|u| u.absoluteString()).map(|s| s.to_string()).unwrap_or_default(),
                    "title": view.title().map(|s| s.to_string()).unwrap_or_default(),
                    "loading": view.isLoading(),
                    "back": view.canGoBack(),
                    "forward": view.canGoForward(),
                })
            };
            let _ = tx.send(Ok(v));
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod mac {
    use super::*;
    const NOPE: &str = "Browser control is only built for macOS so far.";
    pub fn eval(_: &Webview, _: &str) -> Result<Value, String> { Err(NOPE.into()) }
    pub fn snapshot(_: &Webview) -> Result<Vec<u8>, String> { Err(NOPE.into()) }
    pub fn state(_: &Webview) -> Result<Value, String> { Err(NOPE.into()) }
}

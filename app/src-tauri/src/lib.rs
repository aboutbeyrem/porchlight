//! Porchlight for Windows: a tray app that watches the home network in the background and notifies you, in plain
//! words, when something changes or a risk appears. It looks; it never breaks in.

mod checks;
mod guard;
mod names;
mod net;
mod wifi;

use guard::State;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;

struct Shared {
    state: Mutex<State>,
    path: PathBuf,
    trigger: Mutex<Sender<bool>>,
    busy: AtomicBool,
    progress: Mutex<String>,
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn snapshot(app: &AppHandle) -> serde_json::Value {
    let shared = app.state::<Shared>();
    let state = shared.state.lock().map(|s| s.clone()).unwrap_or_default();
    let mut v = serde_json::to_value(&state).unwrap_or_default();
    v["busy"] = serde_json::Value::Bool(shared.busy.load(Ordering::SeqCst));
    v["progress"] = serde_json::Value::String(shared.progress.lock().map(|p| p.clone()).unwrap_or_default());
    v["autostart"] = serde_json::Value::Bool(app.autolaunch().is_enabled().unwrap_or(false));
    v
}

fn publish(app: &AppHandle) {
    let _ = app.emit("state", snapshot(app));
}

fn run_check(app: &AppHandle, full: bool) {
    let shared = app.state::<Shared>();
    if shared.busy.swap(true, Ordering::SeqCst) {
        return;
    }
    let mut work = shared.state.lock().map(|s| s.clone()).unwrap_or_default();
    publish(app);
    let progress = |p: &str| {
        if let Ok(mut g) = app.state::<Shared>().progress.lock() {
            *g = p.to_string();
        }
        publish(app);
    };
    let alerts = guard::check(&mut work, full, &progress);
    // Keep anything the user changed while the check ran (names, settings, read alerts).
    if let Ok(mut live) = shared.state.lock() {
        work.settings = live.settings.clone();
        for (k, d) in work.devices.iter_mut() {
            if let Some(l) = live.devices.get(k) {
                d.custom_name = l.custom_name.clone();
                if d.custom_name.is_some() {
                    d.name = d.custom_name.clone().unwrap_or_default();
                }
            }
        }
        // Devices the user removed while the check ran stay removed (unless the check just found them again).
        let removed: Vec<String> = work.devices.keys().filter(|k| !live.devices.contains_key(*k) && work.devices[*k].last_seen < work.last_check).cloned().collect();
        for k in removed {
            work.devices.remove(&k);
        }
        *live = work;
        live.save(&shared.path);
    }
    if let Ok(mut g) = shared.progress.lock() {
        g.clear();
    }
    shared.busy.store(false, Ordering::SeqCst);
    let notify = shared.state.lock().map(|s| s.settings.notify).unwrap_or(true);
    if notify {
        for a in alerts.iter().take(4) {
            let _ = app.notification().builder().title(&a.title).body(&a.body).show();
        }
        if alerts.len() > 4 {
            let _ = app.notification().builder().title("Porchlight").body(format!("{} more things to look at. Open Porchlight to see them.", alerts.len() - 4)).show();
        }
    }
    if let Some(tray) = app.tray_by_id("main") {
        let status = shared.state.lock().map(|s| s.status.clone()).unwrap_or_default();
        let _ = tray.set_tooltip(Some(format!("Porchlight: {status}")));
    }
    publish(app);
}

fn trigger(app: &AppHandle, full: bool) {
    if let Ok(tx) = app.state::<Shared>().trigger.lock() {
        let _ = tx.send(full);
    }
}

// ---------- commands the window uses ----------
#[tauri::command]
fn get_state(app: AppHandle) -> serde_json::Value {
    snapshot(&app)
}

#[tauri::command]
fn visible_networks() -> serde_json::Value {
    let s = wifi::survey(false);
    let mut names: Vec<String> = s.aps.iter().map(|a| a.ssid.clone()).filter(|x| !x.is_empty()).collect();
    names.sort();
    names.dedup();
    let network = net::find_network();
    serde_json::json!({ "connected": s.connected.map(|c| c.ssid), "visible": names, "network": network })
}

#[tauri::command]
fn start_watching(app: AppHandle, home_ssid: Option<String>) {
    if let Ok(mut s) = app.state::<Shared>().state.lock() {
        s.settings.consented = true;
        s.settings.home_ssid = home_ssid.filter(|x| !x.is_empty());
        s.save(&app.state::<Shared>().path);
    }
    let _ = app.autolaunch().enable();
    trigger(&app, true);
    publish(&app);
}

#[tauri::command]
fn check_now(app: AppHandle, full: bool) {
    trigger(&app, full);
}

#[tauri::command]
fn rename_device(app: AppHandle, key: String, name: String) {
    let shared = app.state::<Shared>();
    if let Ok(mut s) = shared.state.lock() {
        if let Some(d) = s.devices.get_mut(&key) {
            let n = name.trim().chars().take(40).collect::<String>();
            d.custom_name = (!n.is_empty()).then_some(n);
            d.name = d.custom_name.clone().unwrap_or_else(|| d.name.clone());
        }
        s.save(&shared.path);
    }
    publish(&app);
}

#[tauri::command]
fn forget_device(app: AppHandle, key: String) {
    let shared = app.state::<Shared>();
    if let Ok(mut s) = shared.state.lock() {
        s.devices.remove(&key);
        s.save(&shared.path);
    }
    publish(&app);
}

#[tauri::command]
fn accept_router(app: AppHandle) {
    let shared = app.state::<Shared>();
    if let Ok(mut s) = shared.state.lock() {
        if let Some(h) = s.home.as_mut() {
            h.router_mac = None;
        }
        s.save(&shared.path);
    }
    trigger(&app, false);
}

#[tauri::command]
fn set_home_here(app: AppHandle) {
    let shared = app.state::<Shared>();
    if let Ok(mut s) = shared.state.lock() {
        s.home = None;
        s.devices.clear();
        s.baseline_done = false;
        s.save(&shared.path);
    }
    trigger(&app, true);
}

#[tauri::command]
fn set_settings(app: AppHandle, interval_min: u32, notify: bool, home_ssid: Option<String>, autostart: bool) {
    let shared = app.state::<Shared>();
    if let Ok(mut s) = shared.state.lock() {
        s.settings.interval_min = interval_min.clamp(2, 240);
        s.settings.notify = notify;
        s.settings.home_ssid = home_ssid.filter(|x| !x.is_empty());
        s.save(&shared.path);
    }
    let _ = if autostart { app.autolaunch().enable() } else { app.autolaunch().disable() };
    publish(&app);
}

#[tauri::command]
fn mark_read(app: AppHandle) {
    let shared = app.state::<Shared>();
    if let Ok(mut s) = shared.state.lock() {
        for a in s.alerts.iter_mut() {
            a.read = true;
        }
        s.save(&shared.path);
    }
    publish(&app);
}

#[tauri::command]
fn forget_everything(app: AppHandle) {
    let shared = app.state::<Shared>();
    if let Ok(mut s) = shared.state.lock() {
        *s = State { version: 1, ..Default::default() };
        let _ = std::fs::remove_file(&shared.path);
    }
    let _ = app.autolaunch().disable();
    publish(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let path = dir.join("porchlight-state.json");
            let state = State::load(&path);
            let (tx, rx) = channel::<bool>();
            app.manage(Shared { state: Mutex::new(state), path, trigger: Mutex::new(tx), busy: AtomicBool::new(false), progress: Mutex::new(String::new()) });

            // Tray: Porchlight keeps watching when the window is closed.
            let open = MenuItem::with_id(app, "open", "Open Porchlight", true, None::<&str>)?;
            let check = MenuItem::with_id(app, "check", "Check now", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Porchlight", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &check, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main").tooltip("Porchlight").menu(&menu).show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "open" => show_main(app),
                "check" => trigger(app, true),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;

            // The background guard: a light check every few minutes, a full one once a day.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut first = true;
                loop {
                    let interval = handle.state::<Shared>().state.lock().map(|s| s.settings.interval_min).unwrap_or(10).max(2);
                    let requested = if first { Ok(false) } else { rx.recv_timeout(Duration::from_secs(u64::from(interval) * 60)) };
                    first = false;
                    let full_requested = match requested {
                        Ok(full) => full,
                        Err(RecvTimeoutError::Timeout) => false,
                        Err(RecvTimeoutError::Disconnected) => break,
                    };
                    let (consented, paused, last_full) = handle.state::<Shared>().state.lock().map(|s| (s.settings.consented, s.settings.paused, s.last_full)).unwrap_or((false, true, 0));
                    if !consented || paused {
                        continue;
                    }
                    let daily = guard::now().saturating_sub(last_full) > 24 * 3600;
                    run_check(&handle, full_requested || daily);
                }
            });

            if !std::env::args().any(|a| a == "--minimized") {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![get_state, visible_networks, start_watching, check_now, rename_device, forget_device, accept_router, set_home_here, set_settings, mark_read, forget_everything])
        .run(tauri::generate_context!())
        .expect("error while running Porchlight");
}

//! Porchlight for Windows: a tray app that watches the home network in the background and notifies you, in plain
//! words, when something changes or a risk appears. It looks; it never breaks in.

mod checks;
mod guard;
#[macro_use]
mod log;
mod names;
mod net;
mod system;
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
use tauri_plugin_updater::UpdaterExt;

const SITE: &str = "https://porchlight-beryl.vercel.app";
const ISSUES: &str = "https://github.com/aboutbeyrem/porchlight/issues/new/choose";

struct Shared {
    state: Mutex<State>,
    path: PathBuf,
    trigger: Mutex<Sender<bool>>,
    busy: AtomicBool,
    /// True while live Wi-Fi events arrive (the kick-off watch).
    listening: AtomicBool,
    progress: Mutex<String>,
    /// A newer version, once an update check has found one.
    update: Mutex<Option<String>>,
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
    v["listening"] = serde_json::Value::Bool(shared.listening.load(Ordering::SeqCst));
    v["progress"] = serde_json::Value::String(shared.progress.lock().map(|p| p.clone()).unwrap_or_default());
    v["autostart"] = serde_json::Value::Bool(app.autolaunch().is_enabled().unwrap_or(false));
    v["appVersion"] = serde_json::Value::String(env!("CARGO_PKG_VERSION").into());
    v["update"] = shared.update.lock().ok().and_then(|u| u.clone()).map(serde_json::Value::String).unwrap_or_default();
    v
}

// ---------- updates: signed, checked once a day, installed only when you say so ----------

/// Asks the update server whether a newer, signed version exists. The installer that comes back is only used if
/// its signature matches the public key built into this app.
async fn find_update(app: &AppHandle) -> Option<String> {
    let updater = app.updater().map_err(|e| log_warn!("updater unavailable: {e}")).ok()?;
    match updater.check().await {
        Ok(Some(u)) => {
            log_info!("update available: {}", u.version);
            Some(u.version)
        }
        Ok(None) => {
            log_info!("no update: {} is the latest", env!("CARGO_PKG_VERSION"));
            None
        }
        Err(e) => {
            log_warn!("update check failed: {e}");
            None
        }
    }
}

fn watch_updates(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(90));
        let mut told: Option<String> = None;
        loop {
            let found = tauri::async_runtime::block_on(find_update(&app));
            if let Ok(mut u) = app.state::<Shared>().update.lock() {
                u.clone_from(&found);
            }
            if let Some(v) = found.filter(|v| told.as_ref() != Some(v)) {
                let _ = app.notification().builder().title(format!("Porchlight {v} is ready")).body("Open Porchlight and choose Install update. It takes a few seconds.").show();
                told = Some(v);
            }
            publish(&app);
            std::thread::sleep(Duration::from_secs(24 * 3600));
        }
    });
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Option<String> {
    let found = find_update(&app).await;
    if let Ok(mut u) = app.state::<Shared>().update.lock() {
        u.clone_from(&found);
    }
    publish(&app);
    found
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("Porchlight is already up to date.".into());
    };
    log_info!("installing {}", update.version);
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| {
        log_warn!("update failed: {e}");
        format!("The update couldn't be installed: {e}")
    })?;
    app.restart()
}

// ---------- help: privacy notes, reporting a problem, a diagnostic file for beta testers ----------

fn open_url(url: &str) {
    // Only ever called with the fixed addresses above.
    let _ = std::process::Command::new("explorer").arg(url).spawn();
}

#[tauri::command]
fn open_link(which: String) {
    match which.as_str() {
        "privacy" => open_url(&format!("{SITE}/privacy/")),
        "issues" => open_url(ISSUES),
        "site" => open_url(SITE),
        _ => {}
    }
}

/// Writes an anonymised summary (no names, addresses or network names) to Downloads and shows it in Explorer.
#[tauri::command]
fn export_diagnostics(app: AppHandle) -> Result<String, String> {
    let state = app.state::<Shared>().state.lock().map(|s| s.clone()).map_err(|e| e.to_string())?;
    let windows = net::run("cmd", &["/c", "ver"]).trim().to_string();
    let listening = app.state::<Shared>().listening.load(Ordering::SeqCst);
    let text = guard::diagnostics(&state, env!("CARGO_PKG_VERSION"), &windows, listening, &log::tail(200));
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let file = dir.join(format!("porchlight-diagnostics-{}.txt", log::timestamp(guard::now()).replace(':', "-")));
    std::fs::write(&file, text).map_err(|e| e.to_string())?;
    let _ = std::process::Command::new("explorer").arg(format!("/select,{}", file.display())).spawn();
    Ok(file.display().to_string())
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
    let began = guard::now();
    let alerts = guard::check(&mut work, full, &progress);
    if let Ok(mut live) = shared.state.lock() {
        guard::keep_user_changes(&mut work, &live, began);
        *live = work;
        live.save(&shared.path);
    }
    if let Ok(mut g) = shared.progress.lock() {
        g.clear();
    }
    shared.busy.store(false, Ordering::SeqCst);
    notify(app, &alerts);
    if let Some(tray) = app.tray_by_id("main") {
        let status = shared.state.lock().map(|s| s.status.clone()).unwrap_or_default();
        let _ = tray.set_tooltip(Some(format!("Porchlight: {status}")));
    }
    publish(app);
}

/// Shows up to four notifications, then one that sums up the rest.
fn notify(app: &AppHandle, alerts: &[guard::Alert]) {
    let on = app.state::<Shared>().state.lock().map(|s| s.settings.notify).unwrap_or(true);
    if !on || alerts.is_empty() {
        return;
    }
    for a in alerts.iter().take(4) {
        if let Err(e) = app.notification().builder().title(&a.title).body(&a.body).show() {
            log_warn!("notification failed: {e}");
        }
    }
    if alerts.len() > 4 {
        let _ = app.notification().builder().title("Porchlight").body(format!("{} more things to look at. Open Porchlight to see them.", alerts.len() - 4)).show();
    }
}

/// Repeated drops and reconnects with a good signal: warn, then look for a fake copy of the network.
fn kicked(app: &AppHandle, ssid: &str, bounces: usize) {
    let shared = app.state::<Shared>();
    let quality = wifi::survey(false).connected.map(|c| c.quality).unwrap_or(0);
    let alert = shared.state.lock().ok().and_then(|mut s| {
        if !s.settings.consented || s.settings.paused {
            return None;
        }
        let a = guard::kicked_off(&mut s, ssid, bounces, quality);
        s.save(&shared.path);
        a
    });
    if let Some(a) = alert {
        notify(app, &[a]);
        publish(app);
        trigger(app, false);
    }
}

/// Live Wi-Fi events, for spotting kick-off attacks as they happen rather than at the next check.
fn watch_wifi_events(app: AppHandle) {
    std::thread::spawn(move || {
        let (tx, rx) = channel::<wifi::Link>();
        let Some(_watch) = wifi::watch_links(tx) else { return };
        log_info!("listening for Wi-Fi connection events");
        app.state::<Shared>().listening.store(true, Ordering::SeqCst);
        publish(&app);
        let mut kick = guard::KickWatch::default();
        for event in rx {
            let t = guard::now();
            match event {
                wifi::Link::Disconnected { ssid, reason } => {
                    log_info!("Wi-Fi dropped (reason {reason:#x})");
                    kick.disconnected(&ssid, t);
                }
                wifi::Link::Connected(ssid) => {
                    if let Some(n) = kick.connected(&ssid, t) {
                        kicked(&app, &ssid, n);
                    }
                }
            }
        }
    });
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

/// The answer to "Is this yours?".
#[tauri::command]
fn confirm_device(app: AppHandle, key: String, mine: bool) {
    let shared = app.state::<Shared>();
    if let Ok(mut s) = shared.state.lock() {
        if let Some(d) = s.devices.get_mut(&key) {
            d.owner = Some(mine);
        }
        s.save(&shared.path);
    }
    publish(&app);
}

/// "It's fine, stop telling me" (or undo it). `key` is "ID|device".
#[tauri::command]
fn accept_finding(app: AppHandle, key: String, accept: bool) {
    let shared = app.state::<Shared>();
    if let Ok(mut s) = shared.state.lock() {
        s.accepted.retain(|k| k != &key);
        if accept {
            s.accepted.push(key);
        }
        s.refresh_score();
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            log::init(dir.clone());
            log_info!("Porchlight {} starting{}", env!("CARGO_PKG_VERSION"), if std::env::args().any(|a| a == "--minimized") { " in the background" } else { "" });
            let path = dir.join("porchlight-state.json");
            let state = State::load(&path);
            let (tx, rx) = channel::<bool>();
            app.manage(Shared { state: Mutex::new(state), path, trigger: Mutex::new(tx), busy: AtomicBool::new(false), listening: AtomicBool::new(false), progress: Mutex::new(String::new()), update: Mutex::new(None) });

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

            watch_wifi_events(app.handle().clone());
            watch_updates(app.handle().clone());

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
        .invoke_handler(tauri::generate_handler![get_state, visible_networks, start_watching, check_now, rename_device, forget_device, accept_router, set_home_here, set_settings, mark_read, forget_everything, confirm_device, accept_finding, check_update, install_update, open_link, export_diagnostics])
        .run(tauri::generate_context!())
        .expect("error while running Porchlight");
}

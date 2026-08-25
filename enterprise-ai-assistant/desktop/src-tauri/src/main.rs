// Prevents an extra console window on Windows in release, but keeps it in debug.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow,
};

const BACKEND_PORT: u16 = 8741;
const LLM_PORT: u16 = 8742;
const BACKEND_HEALTH: &str = "/api/health";

struct ChildProcesses {
    backend: Option<Child>,
    llm: Option<Child>,
}

static PROCS: Lazy<Mutex<ChildProcesses>> = Lazy::new(|| {
    Mutex::new(ChildProcesses {
        backend: None,
        llm: None,
    })
});

/// Resolve the directory containing the running executable (the install dir).
fn app_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let mut p = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::env::current_exe().unwrap().parent().unwrap().to_path_buf());
    // In a Tauri bundle, sidecar binaries live in the resource dir.
    if p.join("backend-server.exe").exists() || p.join("bin").exists() {
        return p;
    }
    // Dev fallback: repo layout.
    std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn start_backend(app: &tauri::AppHandle) -> std::io::Result<Child> {
    let dir = app_dir(app);
    let candidates = [
        dir.join("backend-server.exe"),
        dir.join("bin").join("backend-server.exe"),
        dir.join("backend").join("backend-server.exe"),
    ];
    let exe = candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .unwrap_or_else(|| candidates[0].clone());

    Command::new(exe)
        .current_dir(&dir)
        .env("APP_HOST", "127.0.0.1")
        .env("APP_PORT", BACKEND_PORT.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

fn start_llm(app: &tauri::AppHandle) -> Option<Child> {
    let dir = app_dir(app);
    let candidates = [
        dir.join("llama-server.exe"),
        dir.join("bin").join("llama-server.exe"),
        dir.join("llm").join("llama-server.exe"),
    ];
    let exe = candidates.iter().find(|p| p.exists())?.clone();
    // Auto-select the strongest available model (prefer 7B on 16GB+, else 1.5B).
    let model_candidates = [
        dir.join("models").join("llm").join("qwen2.5-7b-instruct-q4_k_m.gguf"),
        dir.join("models").join("llm").join("qwen2.5-1.5b-instruct-q4_k_m.gguf"),
    ];
    let model = model_candidates.iter().find(|p| p.exists())?.clone();
    if !model.exists() {
        eprintln!(
            "[desktop] LLM model not found under {:?}; skipping LLM server (offline fallback active)",
            dir.join("models").join("llm")
        );
        return None;
    }
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().to_string())
        .unwrap_or_else(|_| "4".to_string());
    Command::new(exe)
        .current_dir(&dir)
        .args([
            "--model",
            model.to_str().unwrap_or(""),
            "--host",
            "127.0.0.1",
            "--port",
            &LLM_PORT.to_string(),
            "--ctx-size",
            "4096",
            "--threads",
            &threads,
            "--parallel",
            "2",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

fn wait_for_health(url: &str, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if let Ok(resp) = reqwest::blocking::get(url) {
            if resp.status().is_success() {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

fn show_main_window(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn shutdown_all() {
    if let Ok(mut procs) = PROCS.lock() {
        if let Some(mut c) = procs.backend.take() {
            let _ = c.kill();
        }
        if let Some(mut c) = procs.llm.take() {
            let _ = c.kill();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let window = app.get_webview_window("main").unwrap();

            // Show splash while services boot.
            let _ = window.eval(
                "document.body.innerHTML='<div style=\"display:flex;align-items:center;justify-content:center;height:100vh;font-family:Vazirmatn,sans-serif;flex-direction:column;gap:16px\"><div style=\"font-size:20px;font-weight:600\">در حال راه‌اندازی دستیار هوشمند...</div><div style=\"width:200px;height:4px;background:#e5e7eb;border-radius:4px;overflow:hidden\"><div style=\"width:40%;height:100%;background:#2563eb;animation:s 1.2s infinite\"></div></div></div><style>@keyframes s{0%{margin-right:-40%}100%{margin-right:100%}}</style>';",
            );

            // Start backend (critical path).
            match start_backend(&handle) {
                Ok(child) => {
                    PROCS.lock().unwrap().backend = Some(child);
                }
                Err(e) => {
                    eprintln!("[desktop] failed to start backend: {e}");
                }
            }
            if !wait_for_health(
                &format!("http://127.0.0.1:{BACKEND_PORT}{BACKEND_HEALTH}"),
                Duration::from_secs(30),
            ) {
                eprintln!("[desktop] backend health check failed");
            }

            // Start LLM (optional; backend degrades to extractive mode).
            let llm_child = start_llm(&handle);
            PROCS.lock().unwrap().llm = llm_child;
            // Best-effort wait for the LLM; do not block UI launch.
            let _ = wait_for_health(
                &format!("http://127.0.0.1:{LLM_PORT}/health"),
                Duration::from_secs(5),
            );

            // Load the app UI from the embedded backend.
            let url = format!("http://127.0.0.1:{BACKEND_PORT}");
            let _ = window.eval(&format!("window.location.replace('{url}');"));
            show_main_window(&window);

            // System tray.
            let show = MenuItem::with_id(app, "show", "نمایش پنجره اصلی", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "خروج کامل", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("دستیار هوشمند سازمانی")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            show_main_window(&w);
                        }
                    }
                    "quit" => {
                        shutdown_all();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            show_main_window(&w);
                        }
                    }
                })
                .build(app);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Minimize to tray on close instead of quitting.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                shutdown_all();
            }
        });
}

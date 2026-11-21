// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

const PORT: u16 = 4173;

/// Holds the Node server we started (None when a server was already running, e.g. from start.cmd).
struct Server(Mutex<Option<Child>>);

fn server_is_up() -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], PORT).into();
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// Finds the project folder (the one containing server/index.js): $TUTORIAL_APP_ROOT, else walk up from the exe.
fn find_root() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("TUTORIAL_APP_ROOT") {
        let p = PathBuf::from(p);
        if p.join("server").join("index.js").exists() {
            return Some(p);
        }
    }
    let mut dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    loop {
        if dir.join("server").join("index.js").exists() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}

fn spawn_server() -> Option<Child> {
    // One shared server: if the browser version is already running, just use it.
    if server_is_up() {
        return None;
    }
    let root = find_root()?;
    let mut cmd = Command::new("node");
    cmd.current_dir(&root)
        .args(["--disable-warning=ExperimentalWarning", "server/index.js"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().ok()
}

fn main() {
    let child = spawn_server();
    let app = tauri::Builder::default()
        .manage(Server(Mutex::new(child)))
        .build(tauri::generate_context!())
        .expect("failed to build the Tauri app");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<Server>() {
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use backtrace::Backtrace;
use simplelog::*;
use std::fs::File;
use std::io::Write;
use std::panic;

fn main() {
    // 1. Calculate Log Path in %LOCALAPPDATA%
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    let log_dir = std::path::Path::new(&local_app_data)
        .join("Quick Explorer")
        .join("logs");

    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        eprintln!("Warning: Could not create log directory: {}", e);
    }

    let log_path = log_dir.join("debug.log");
    let log_path_str = log_path.to_string_lossy().to_string();

    // 2. Initialize Logger as early as possible
    let log_file = File::create(&log_path).expect("Could not create debug.log");

    CombinedLogger::init(vec![
        #[cfg(debug_assertions)]
        TermLogger::new(
            LevelFilter::Info,
            Config::default(),
            TerminalMode::Mixed,
            ColorChoice::Auto,
        ),
        WriteLogger::new(LevelFilter::Debug, Config::default(), log_file),
    ])
    .expect("Could not initialize logger");

    // 3. Setup Panic Hook for crash reporting
    let log_path_panic = log_path.clone();
    panic::set_hook(Box::new(move |panic_info| {
        let message = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };

        let location = panic_info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let bt = Backtrace::new();

        log::error!("APPLICATION PANIC at {}: {}", location, message);
        log::error!("BACKTRACE:\n{:?}", bt);

        // Force flush to ensure it's written before exit
        if let Ok(mut file) = File::options().append(true).open(&log_path_panic) {
            let _ = writeln!(file, "APPLICATION PANIC at {}: {}", location, message);
            let _ = writeln!(file, "BACKTRACE:\n{:?}", bt);
            let _ = file.flush();
        }
    }));

    log::info!("Starting SpeedExplorer... Logs at: {}", log_path_str);
    d_speedexplorer_lib::run()
}

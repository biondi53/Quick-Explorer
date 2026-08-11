use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::mem::ManuallyDrop;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::Duration;

use windows::core::{BSTR, GUID, Interface, PCWSTR};
use windows::Win32::Foundation::VARIANT_BOOL;
use windows::Win32::System::Com::{
    CLSIDFromProgID, CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER,
    COINIT_APARTMENTTHREADED, DISPATCH_FLAGS, DISPATCH_METHOD, DISPATCH_PROPERTYGET,
    DISPATCH_PROPERTYPUT, DISPPARAMS, IDispatch,
};
use windows::Win32::System::Variant::{
    VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VariantClear, VT_BOOL, VT_BSTR, VT_DISPATCH,
    VT_I4,
};

const DISPID_PROPERTYPUT: i32 = -3;
const EXPORT_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_DISK_CACHE_FILES: u64 = 600;
const DISK_CACHE_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 3600);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum OfficeKind {
    Word,
    Excel,
    PowerPoint,
}

fn kind_of(ext: &str) -> Option<OfficeKind> {
    match ext.trim_start_matches('.').to_ascii_lowercase().as_str() {
        "docx" | "docm" | "doc" | "dotx" => Some(OfficeKind::Word),
        "xlsx" | "xlsm" | "xls" => Some(OfficeKind::Excel),
        "pptx" | "pptm" | "ppt" => Some(OfficeKind::PowerPoint),
        _ => None,
    }
}

struct Job {
    path: String,
    kind: OfficeKind,
    cancel: Arc<AtomicBool>,
    tx: mpsc::Sender<Result<Vec<u8>, String>>,
}

static OFFICE_TX: OnceLock<mpsc::Sender<Job>> = OnceLock::new();
static OFFICE_AVAILABLE: OnceLock<bool> = OnceLock::new();
static COUNTER: AtomicU64 = AtomicU64::new(0);

fn office_available() -> bool {
    *OFFICE_AVAILABLE.get_or_init(|| {
        let wide: Vec<u16> = "Word.Application".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe { CLSIDFromProgID(PCWSTR(wide.as_ptr())).is_ok() }
    })
}

fn get_sender() -> Option<&'static mpsc::Sender<Job>> {
    let tx = OFFICE_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        let _ = std::thread::Builder::new()
            .name("office-com".to_string())
            .spawn(move || office_thread(rx));
        tx
    });
    Some(tx)
}

fn office_thread(rx: mpsc::Receiver<Job>) {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    let mut app: Option<(OfficeKind, IDispatch)> = None;
    while let Ok(job) = rx.recv() {
        if job.cancel.load(Ordering::Relaxed) {
            if let Some((_, disp)) = app.take() {
                let _ = invoke_noret(&disp, "Quit", "Quit", vec![]);
            }
        }
        let result = if job.cancel.load(Ordering::Relaxed) {
            Err("cancelled".to_string())
        } else {
            render_job(&job, &mut app)
        };
        let _ = job.tx.send(result);
        if job.cancel.load(Ordering::Relaxed) {
            if let Some((_, disp)) = app.take() {
                let _ = invoke_noret(&disp, "Quit", "Quit", vec![]);
            }
        }
    }
    if let Some((_, disp)) = app.take() {
        let _ = invoke_noret(&disp, "Quit", "Quit", vec![]);
    }
    unsafe {
        CoUninitialize();
    }
}

fn render_job(job: &Job, app: &mut Option<(OfficeKind, IDispatch)>) -> Result<Vec<u8>, String> {
    if app.as_ref().map(|(k, _)| *k) != Some(job.kind) {
        if let Some((_, disp)) = app.take() {
            let _ = invoke_noret(&disp, "Quit", "Quit", vec![]);
        }
        *app = Some((job.kind, create_app(job.kind)?));
    }
    let disp = &app.as_ref().unwrap().1;
    let pdf = temp_pdf_path();
    let export = export_pdf(disp, &job.kind, &job.path, &pdf);
    if let Err(e) = export {
        let _ = invoke_noret(disp, "Quit", "Quit", vec![]);
        *app = None;
        let _ = std::fs::remove_file(&pdf);
        return Err(e);
    }
    let bytes = crate::preview_engine::render_preview_sync(&pdf, 1200).ok_or_else(|| {
        format!("Failed to render exported PDF")
    });
    let _ = std::fs::remove_file(&pdf);
    bytes
}

fn create_app(kind: OfficeKind) -> Result<IDispatch, String> {
    let progid = match kind {
        OfficeKind::Word => "Word.Application",
        OfficeKind::Excel => "Excel.Application",
        OfficeKind::PowerPoint => "PowerPoint.Application",
    };
    unsafe {
        let wide: Vec<u16> = progid.encode_utf16().chain(std::iter::once(0)).collect();
        let clsid = CLSIDFromProgID(PCWSTR(wide.as_ptr()))
            .map_err(|e| format!("CLSIDFromProgID({progid}): {e}"))?;
        let disp: IDispatch = CoCreateInstance(
            &clsid,
            None::<&windows::core::IUnknown>,
            CLSCTX_LOCAL_SERVER,
        )
        .map_err(|e| format!("CoCreateInstance({progid}): {e}"))?;
        Ok(disp)
    }
}

fn export_pdf(app: &IDispatch, kind: &OfficeKind, path: &str, pdf: &str) -> Result<(), String> {
    match kind {
        OfficeKind::Word => {
            put_i32(app, "DisplayAlerts", 0)?;
            let docs = prop_get(app, "Documents", "Documents")?;
            let doc = invoke_ret(
                &docs,
                "Open",
                "Documents.Open",
                vec![v_bstr(path), v_bool(false), v_bool(true)],
            )?;
            let export = invoke_noret(
                &doc,
                "ExportAsFixedFormat",
                "Document.ExportAsFixedFormat",
                vec![v_bstr(pdf), v_i32(17)],
            );
            if export.is_err() {
                let _ = invoke_noret(&doc, "Close", "Document.Close", vec![v_i32(0)]);
                return export;
            }
            invoke_noret(&doc, "Close", "Document.Close", vec![v_i32(0)])
        }
        OfficeKind::Excel => {
            put_i32(app, "DisplayAlerts", 0)?;
            let wbs = prop_get(app, "Workbooks", "Workbooks")?;
            let wb = invoke_ret(
                &wbs,
                "Open",
                "Workbooks.Open",
                vec![v_bstr(path), v_i32(0), v_bool(true)],
            )?;
            let export = invoke_noret(
                &wb,
                "ExportAsFixedFormat",
                "Workbook.ExportAsFixedFormat",
                vec![v_i32(0), v_bstr(pdf)],
            );
            if export.is_err() {
                let _ = invoke_noret(&wb, "Close", "Workbook.Close", vec![v_bool(false)]);
                return export;
            }
            invoke_noret(&wb, "Close", "Workbook.Close", vec![v_bool(false)])
        }
        OfficeKind::PowerPoint => {
            let pres = prop_get(app, "Presentations", "Presentations")?;
            let p = invoke_ret(
                &pres,
                "Open",
                "Presentations.Open",
                vec![v_bstr(path), v_bool(true)],
            )?;
            let save = invoke_noret(
                &p,
                "SaveAs",
                "Presentation.SaveAs",
                vec![v_bstr(pdf), v_i32(32)],
            );
            if save.is_err() {
                let _ = invoke_noret(&p, "Close", "Presentation.Close", vec![]);
                return save;
            }
            invoke_noret(&p, "Close", "Presentation.Close", vec![])
        }
    }
}

fn dispid_of(obj: &IDispatch, name: &str) -> Result<i32, String> {
    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut id = 0i32;
    unsafe {
        obj.GetIDsOfNames(
            &GUID::zeroed(),
            &PCWSTR(wide.as_ptr()),
            1,
            0,
            &mut id,
        )
    }
    .map_err(|e| format!("GetIDsOfNames({name}): {e}"))?;
    Ok(id)
}

fn invoke_raw(
    obj: &IDispatch,
    name: &str,
    flags: DISPATCH_FLAGS,
    mut vargs: Vec<VARIANT>,
    result: Option<&mut VARIANT>,
) -> Result<(), String> {
    vargs.reverse();
    let dispid = match dispid_of(obj, name) {
        Ok(d) => d,
        Err(e) => {
            for v in &mut vargs {
                unsafe {
                    let _ = VariantClear(v);
                }
            }
            return Err(e);
        }
    };
    let dp = DISPPARAMS {
        rgvarg: if vargs.is_empty() {
            std::ptr::null_mut()
        } else {
            vargs.as_mut_ptr()
        },
        rgdispidNamedArgs: std::ptr::null_mut(),
        cArgs: vargs.len() as u32,
        cNamedArgs: 0,
    };
    let call = unsafe {
        obj.Invoke(
            dispid,
            &GUID::zeroed(),
            0,
            flags,
            &dp,
            result.map(|r| r as *mut VARIANT),
            None,
            None,
        )
    }
    .map_err(|e| format!("Invoke({name}): {e}"));
    for v in &mut vargs {
        unsafe {
            let _ = VariantClear(v);
        }
    }
    call
}

#[repr(C)]
struct VariantPlain {
    vt: u16,
    _r1: u16,
    _r2: u16,
    _r3: u16,
    value: *mut core::ffi::c_void,
}

fn take_dispatch(result: &mut VARIANT, label: &str) -> Result<IDispatch, String> {
    let plain = result as *mut VARIANT as *mut VariantPlain;
    let vt = unsafe { (*plain).vt };
    if vt != VT_DISPATCH.0 {
        return Err(format!("{label}: expected IDispatch result, got vt={}", vt));
    }
    let raw = unsafe { (*plain).value };
    unsafe { IDispatch::from_raw_borrowed(&raw) }
        .cloned()
        .ok_or_else(|| format!("{label}: null dispatch result"))
}

fn invoke_noret(obj: &IDispatch, name: &str, label: &str, vargs: Vec<VARIANT>) -> Result<(), String> {
    invoke_raw(obj, name, DISPATCH_METHOD, vargs, None).map_err(|e| format!("{label}: {e}"))
}

fn invoke_ret(obj: &IDispatch, name: &str, label: &str, vargs: Vec<VARIANT>) -> Result<IDispatch, String> {
    let mut result = VARIANT::default();
    invoke_raw(obj, name, DISPATCH_METHOD, vargs, Some(&mut result))
        .map_err(|e| format!("{label}: {e}"))?;
    let disp = take_dispatch(&mut result, label);
    unsafe {
        let _ = VariantClear(&mut result);
    }
    disp
}

fn prop_get(obj: &IDispatch, name: &str, label: &str) -> Result<IDispatch, String> {
    let mut result = VARIANT::default();
    invoke_raw(obj, name, DISPATCH_PROPERTYGET, vec![], Some(&mut result))
        .map_err(|e| format!("{label}: {e}"))?;
    let disp = take_dispatch(&mut result, label);
    unsafe {
        let _ = VariantClear(&mut result);
    }
    disp
}

fn put_i32(obj: &IDispatch, name: &str, value: i32) -> Result<(), String> {
    let mut arg = v_i32(value);
    let mut named = DISPID_PROPERTYPUT;
    let dp = DISPPARAMS {
        rgvarg: &mut arg,
        rgdispidNamedArgs: &mut named,
        cArgs: 1,
        cNamedArgs: 1,
    };
    let call = unsafe {
        obj.Invoke(
            dispid_of(obj, name)?,
            &GUID::zeroed(),
            0,
            DISPATCH_PROPERTYPUT,
            &dp,
            None,
            None,
            None,
        )
    }
    .map_err(|e| format!("put({name}): {e}"));
    unsafe {
        let _ = VariantClear(&mut arg);
    }
    call
}

fn v_bstr(s: &str) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_BSTR,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 {
                    bstrVal: ManuallyDrop::new(BSTR::from(s)),
                },
            }),
        },
    }
}

fn v_bool(b: bool) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_BOOL,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 {
                    boolVal: VARIANT_BOOL(if b { -1 } else { 0 }),
                },
            }),
        },
    }
}

fn v_i32(n: i32) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_I4,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 { lVal: n },
            }),
        },
    }
}

fn temp_pdf_path() -> String {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir()
        .join(format!("qe_office_{}_{}.pdf", std::process::id(), n))
        .to_string_lossy()
        .into_owned()
}

fn disk_cache_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
    PathBuf::from(base).join("Quick Explorer").join("office-thumbs")
}

fn disk_cache_key(path: &str, mtime: u64) -> String {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    mtime.hash(&mut h);
    format!("{:016x}_{}.jpg", h.finish(), mtime)
}

fn disk_cache_get(key: &str) -> Option<Vec<u8>> {
    let p = disk_cache_dir().join(key);
    std::fs::read(p).ok()
}

fn disk_cache_put(key: &str, bytes: &[u8]) {
    let dir = disk_cache_dir();
    if std::fs::create_dir_all(&dir).is_ok() {
        let _ = std::fs::write(dir.join(key), bytes);
    }
    if COUNTER.fetch_add(1, Ordering::Relaxed) % 64 == 0 {
        prune_disk_cache(&dir);
    }
}

fn prune_disk_cache(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for e in entries.flatten() {
        if let Ok(md) = e.metadata() {
            if md.is_file() {
                let t = md.modified().unwrap_or(std::time::UNIX_EPOCH);
                files.push((t, e.path()));
            }
        }
    }
    if files.len() as u64 > MAX_DISK_CACHE_FILES {
        files.sort_by_key(|(t, _)| *t);
        let excess = files.len() as u64 - MAX_DISK_CACHE_FILES;
        for (_, p) in files.iter().take(excess as usize) {
            let _ = std::fs::remove_file(p);
        }
    }
    for (t, p) in files {
        if t.elapsed().unwrap_or(DISK_CACHE_MAX_AGE) > DISK_CACHE_MAX_AGE {
            let _ = std::fs::remove_file(p);
        }
    }
}

pub(crate) fn kind_is_renderable(ext: &str) -> bool {
    office_available()
        && matches!(kind_of(ext), Some(k) if !matches!(k, OfficeKind::Excel))
}

pub(crate) async fn render_office_page1(path: String, ext: &str) -> Option<Vec<u8>> {
    if !office_available() {
        return None;
    }
    let kind = kind_of(ext)?;
    if matches!(kind, OfficeKind::Excel) {
        return None;
    }
    let mtime = std::fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let cache_key = disk_cache_key(&path, mtime);
    if let Some(bytes) = disk_cache_get(&cache_key) {
        return Some(bytes);
    }
    let ctx_path = path.clone();
    let tx = get_sender()?;
    let (res_tx, res_rx) = mpsc::channel();
    let cancel = Arc::new(AtomicBool::new(false));
    tx.send(Job {
        path,
        kind,
        cancel: cancel.clone(),
        tx: res_tx,
    })
    .ok()?;
    let wait = tokio::task::spawn_blocking(move || res_rx.recv().ok());
    match tokio::time::timeout(EXPORT_TIMEOUT, wait).await {
        Ok(Ok(Some(Ok(bytes)))) => {
            disk_cache_put(&cache_key, &bytes);
            Some(bytes)
        }
        Ok(Ok(Some(Err(e)))) => {
            log::warn!("[THUMB-COM] export failed for {}: {}", ctx_path, e);
            None
        }
        Ok(Ok(None)) => None,
        Ok(Err(_)) => None,
        Err(_) => {
            log::warn!("[THUMB-COM] timeout for {} -> abandoning instance", ctx_path);
            cancel.store(true, Ordering::Relaxed);
            None
        }
    }
}

#[cfg(test)]
mod qa_tests {
    use super::*;

    const PPTX: &str = r"F:\Nico 2\Nico\LG G4 Cosas\LG G4 Guia ARchivos TOT LOLLIPOP 5.1\[Guide] G4 series Rev3.0_MSM Big core disable tool Guide_20151126.pptx";

    fn render(path: &str, ext: &str) -> Option<Vec<u8>> {
        if !std::path::Path::new(path).exists() {
            eprintln!("SKIP: not found: {path}");
            return None;
        }
        let _ = simplelog::TermLogger::init(
            simplelog::LevelFilter::Debug,
            simplelog::Config::default(),
            simplelog::TerminalMode::Mixed,
            simplelog::ColorChoice::Auto,
        );
        tauri::async_runtime::block_on(render_office_page1(path.to_string(), ext))
    }

    #[test]
    #[ignore]
    fn com_render_pptx_smoke() {
        let bytes = render(PPTX, "pptx").expect("pptx page-1 render");
        assert!(bytes.len() > 1000, "pptx thumb too small: {}", bytes.len());
    }
}
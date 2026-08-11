use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::Path;

use windows::core::{PCWSTR};
use windows::Data::Pdf::PdfDocument;
use windows::Storage::StorageFile;
use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
use windows::Win32::Foundation::GENERIC_READ;
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppBGRA, IWICBitmapSource, IWICImagingFactory,
    WICConvertBitmapSource, WICDecodeMetadataCacheOnDemand, WICRect,
};
use windows::Win32::System::Com::StructuredStorage::StgOpenStorage;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, STGM_READ,
    STGM_SHARE_EXCLUSIVE,
};

const MAX_INPUT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const LARGE_PIXELS: u64 = 16_000_000;
const MAX_RENDER_STREAM: u64 = 64 * 1024 * 1024;
const MAX_EMBEDDED_THUMB: usize = 20 * 1024 * 1024;
const MAX_OLE_STREAM: usize = 32 * 1024 * 1024;

const PDF_EXTS: [&str; 1] = ["pdf"];
const PSD_EXTS: [&str; 2] = ["psd", "psb"];
const OOXML_EXTS: [&str; 10] = ["docx", "docm", "xlsx", "xlsm", "pptx", "pptm", "odt", "ods", "odp", "ots"];
const OLE_EXTS: [&str; 3] = ["doc", "xls", "ppt"];
const WIC_EXTS: [&str; 24] = [
    "heic", "heif", "heics", "avif", "jxr", "wdp", "hdp", "3fr", "arw", "cr2", "cr3", "crw",
    "dng", "erf", "iiq", "mef", "mrw", "nef", "nrw", "orf", "pef", "raf", "rw2", "x3f",
];
const IMAGE_CRATE_EXTS: [&str; 17] = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "tga", "exr", "hdr",
    "dds", "qoi", "pnm", "pbm", "pgm",
];

pub(crate) async fn render_preview(path: String, target_size: u32) -> Option<Vec<u8>> {
    tokio::task::spawn_blocking(move || render_preview_sync(&path, target_size))
        .await
        .ok()
        .flatten()
}

pub(crate) fn render_preview_sync(path: &str, target_size: u32) -> Option<Vec<u8>> {
    let img = decode(path)?;
    to_jpeg(img, target_size)
}

pub(crate) fn probe_dimensions(path: &str) -> Option<(u32, u32)> {
    if !input_size_ok(path) {
        return None;
    }
    let ext = ext_of(path);
    if WIC_EXTS.contains(&ext.as_str()) {
        return wic_dimensions(path);
    }
    if PSD_EXTS.contains(&ext.as_str()) {
        return psd_dimensions(path);
    }
    if IMAGE_CRATE_EXTS.contains(&ext.as_str()) {
        return image::image_dimensions(path).ok();
    }
    if OOXML_EXTS.contains(&ext.as_str()) || OLE_EXTS.contains(&ext.as_str()) {
        let img = decode(path)?;
        return Some((img.width(), img.height()));
    }
    None
}

fn decode(path: &str) -> Option<image::DynamicImage> {
    if path.len() > 100 && !path.contains('\\') && !path.contains(':') {
        return None;
    }
    if path.starts_with('<') || path.starts_with('>') {
        return None;
    }
    if !input_size_ok(path) {
        return None;
    }
    let ext = ext_of(path);
    if PDF_EXTS.contains(&ext.as_str()) {
        return pdf_render(path);
    }
    if PSD_EXTS.contains(&ext.as_str()) {
        return psd_render(path);
    }
    if OOXML_EXTS.contains(&ext.as_str()) {
        return office_ooxml(path);
    }
    if OLE_EXTS.contains(&ext.as_str()) {
        return office_ole(path);
    }
    if WIC_EXTS.contains(&ext.as_str()) {
        return wic_render(path);
    }
    if IMAGE_CRATE_EXTS.contains(&ext.as_str()) {
        let img = image::ImageReader::open(path).ok()?.decode().ok()?;
        return size_ok(img);
    }
    None
}

fn ext_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

pub(crate) fn is_engine_ext(ext: &str) -> bool {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    PDF_EXTS.contains(&ext.as_str())
        || PSD_EXTS.contains(&ext.as_str())
        || OOXML_EXTS.contains(&ext.as_str())
        || OLE_EXTS.contains(&ext.as_str())
        || WIC_EXTS.contains(&ext.as_str())
        || IMAGE_CRATE_EXTS.contains(&ext.as_str())
}

const OFFICE_EXTS: [&str; 14] = [
    "docx", "docm", "xlsx", "xlsm", "pptx", "pptm", "odt", "ods", "odp", "ots", "doc", "xls",
    "ppt", "dotx",
];

pub(crate) fn is_office_ext(ext: &str) -> bool {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    OFFICE_EXTS.contains(&ext.as_str())
}

fn input_size_ok(path: &str) -> bool {
    fs::metadata(path)
        .map(|m| m.is_file() && m.len() <= MAX_INPUT_BYTES)
        .unwrap_or(false)
}

fn size_ok(img: image::DynamicImage) -> Option<image::DynamicImage> {
    if (img.width() as u64) * (img.height() as u64) > MAX_PIXELS {
        return None;
    }
    Some(img)
}

fn to_jpeg(img: image::DynamicImage, target: u32) -> Option<Vec<u8>> {
    let img = size_ok(img)?;
    let img = img.thumbnail(target.max(1), target.max(1));
    let mut cursor = Cursor::new(Vec::new());
    img.write_to(&mut cursor, image::ImageFormat::Jpeg).ok()?;
    Some(cursor.into_inner())
}

fn psd_render(path: &str) -> Option<image::DynamicImage> {
    let bytes = fs::read(path).ok()?;
    let psd = psd::Psd::from_bytes(&bytes).ok()?;
    if (psd.width() as u64) * (psd.height() as u64) > MAX_PIXELS {
        return None;
    }
    let img = image::RgbaImage::from_raw(psd.width(), psd.height(), psd.rgba())?;
    Some(image::DynamicImage::ImageRgba8(img))
}

fn psd_dimensions(path: &str) -> Option<(u32, u32)> {
    let bytes = fs::read(path).ok()?;
    let psd = psd::Psd::from_bytes(&bytes).ok()?;
    Some((psd.width(), psd.height()))
}

fn pdf_render(path: &str) -> Option<image::DynamicImage> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let file = StorageFile::GetFileFromPathAsync(&windows::core::HSTRING::from(path))
            .ok()?
            .get()
            .ok()?;
        let doc = PdfDocument::LoadFromFileAsync(&file).ok()?.get().ok()?;
        if doc.PageCount().ok()? == 0 {
            return None;
        }
        let page = doc.GetPage(0).ok()?;
        let stream = InMemoryRandomAccessStream::new().ok()?;
        page.RenderToStreamAsync(&stream).ok()?.get().ok()?;
        let len = stream.Size().ok()?;
        if len == 0 || len > MAX_RENDER_STREAM {
            return None;
        }
        stream.Seek(0).ok()?;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
        reader.LoadAsync(len as u32).ok()?.get().ok()?;
        let mut buf = vec![0u8; len as usize];
        reader.ReadBytes(&mut buf).ok()?;
        let rdr = image::ImageReader::new(Cursor::new(buf));
        let img = rdr.with_guessed_format().ok()?.decode().ok()?;
        size_ok(img)
    }
}

fn wic_render(path: &str) -> Option<image::DynamicImage> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let factory: IWICImagingFactory = CoCreateInstance(
            &CLSID_WICImagingFactory,
            None,
            CLSCTX_INPROC_SERVER,
        )
        .ok()?;
        let w: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let dec = factory
            .CreateDecoderFromFilename(
                PCWSTR(w.as_ptr()),
                None,
                GENERIC_READ,
                WICDecodeMetadataCacheOnDemand,
            )
            .ok()?;
        let frame = dec.GetFrame(0).ok()?;
        let (mut w_px, mut h_px) = (0u32, 0u32);
        frame.GetSize(&mut w_px, &mut h_px).ok()?;
        if w_px == 0 || h_px == 0 {
            return None;
        }
        if (w_px as u64) * (h_px as u64) > LARGE_PIXELS {
            if let Ok(thumb) = frame.GetThumbnail() {
                let (mut tw, mut th) = (0u32, 0u32);
                thumb.GetSize(&mut tw, &mut th).ok()?;
                if tw > 0 && th > 0 && (tw as u64) * (th as u64) <= MAX_PIXELS {
                    let tconv =
                        WICConvertBitmapSource(&GUID_WICPixelFormat32bppBGRA, &thumb).ok()?;
                    return bgra_to_image(tconv, tw, th);
                }
            }
            return None;
        }
        let conv = WICConvertBitmapSource(&GUID_WICPixelFormat32bppBGRA, &frame).ok()?;
        bgra_to_image(conv, w_px, h_px)
    }
}

fn wic_dimensions(path: &str) -> Option<(u32, u32)> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()?;
        let w: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let dec = factory
            .CreateDecoderFromFilename(
                PCWSTR(w.as_ptr()),
                None,
                GENERIC_READ,
                WICDecodeMetadataCacheOnDemand,
            )
            .ok()?;
        let frame = dec.GetFrame(0).ok()?;
        let (mut w_px, mut h_px) = (0u32, 0u32);
        frame.GetSize(&mut w_px, &mut h_px).ok()?;
        if w_px == 0 || h_px == 0 {
            None
        } else {
            Some((w_px, h_px))
        }
    }
}

fn bgra_to_image(source: IWICBitmapSource, w: u32, h: u32) -> Option<image::DynamicImage> {
    unsafe {
        let stride = w * 4;
        let len = stride as usize * h as usize;
        let mut buf = vec![0u8; len];
        source
            .CopyPixels(std::ptr::null() as *const WICRect, stride, &mut buf)
            .ok()?;
        let mut rgba = vec![0u8; len];
        for (i, px) in buf.chunks_exact(4).enumerate() {
            let o = i * 4;
            rgba[o] = px[2];
            rgba[o + 1] = px[1];
            rgba[o + 2] = px[0];
            rgba[o + 3] = px[3];
        }
        let img = image::RgbaImage::from_raw(w, h, rgba)?;
        Some(image::DynamicImage::ImageRgba8(img))
    }
}

fn office_ooxml(path: &str) -> Option<image::DynamicImage> {
    let file = fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(file).ok()?;
    let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();

    for n in &names {
        let l = n.to_ascii_lowercase();
        if l.starts_with("docprops/thumbnail") || l.contains("thumbnails/thumbnail") {
            return office_ooxml_decode(&mut zip, n, MAX_EMBEDDED_THUMB);
        }
    }

    None
}

fn office_ooxml_decode(
    zip: &mut zip::ZipArchive<fs::File>,
    name: &str,
    cap: usize,
) -> Option<image::DynamicImage> {
    let mut entry = zip.by_name(name).ok()?;
    let mut data = Vec::new();
    entry.read_to_end(&mut data).ok()?;
    if data.len() > cap {
        return None;
    }
    let rdr = image::ImageReader::new(Cursor::new(data));
    let img = rdr.with_guessed_format().ok()?.decode().ok()?;
    size_ok(img)
}

fn office_ole(path: &str) -> Option<image::DynamicImage> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let w: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let storage = StgOpenStorage(
            PCWSTR(w.as_ptr()),
            None,
            STGM_READ | STGM_SHARE_EXCLUSIVE,
            None,
            0,
        )
        .ok()?;
        let name: Vec<u16> = "\u{5}SummaryInformation"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let stream = storage
            .OpenStream(
                PCWSTR(name.as_ptr()),
                None,
                STGM_READ | STGM_SHARE_EXCLUSIVE,
                0,
            )
            .ok()?;
        let mut data = Vec::new();
        let mut chunk = vec![0u8; 8192];
        loop {
            let mut read: u32 = 0;
            let hr = stream.Read(
                chunk.as_mut_ptr() as *mut std::ffi::c_void,
                chunk.len() as u32,
                Some(&mut read),
            );
            if hr.is_err() {
                return None;
            }
            if read == 0 {
                break;
            }
            data.extend_from_slice(&chunk[..read as usize]);
            if data.len() > MAX_OLE_STREAM {
                return None;
            }
        }
        parse_property_thumbnail(&data)
    }
}

const FMTID_SUMMARY_INFORMATION: [u8; 16] = [
    0xE0, 0x85, 0x9F, 0xF2, 0xF9, 0x4F, 0x68, 0x10, 0xAB, 0x91, 0x08, 0x00, 0x2B, 0x27, 0xB3, 0xD9,
];

fn parse_property_thumbnail(data: &[u8]) -> Option<image::DynamicImage> {
    if data.len() < 28 || data[0] != 0xFE || data[1] != 0xFF {
        return None;
    }
    let secs = u32::from_le_bytes(data[24..28].try_into().ok()?) as usize;
    let mut target = None;
    for i in 0..secs {
        let base = 28 + i * 20;
        if base + 20 > data.len() {
            return None;
        }
        let fmtid = &data[base..base + 16];
        let off = u32::from_le_bytes(data[base + 16..base + 20].try_into().ok()?) as usize;
        if fmtid == FMTID_SUMMARY_INFORMATION && off + 8 <= data.len() {
            target = Some(off);
            break;
        }
    }
    let off = target?;
    let cprops = u32::from_le_bytes(data[off + 4..off + 8].try_into().ok()?) as usize;
    let mut thumb = None;
    for i in 0..cprops {
        let base = off + 8 + i * 8;
        if base + 8 > data.len() {
            return None;
        }
        let pid = u32::from_le_bytes(data[base..base + 4].try_into().ok()?);
        let voff = u32::from_le_bytes(data[base + 4..base + 8].try_into().ok()?) as usize;
        if pid == 0x11 && off + voff + 12 <= data.len() {
            thumb = Some(off + voff);
            break;
        }
    }
    let base = thumb?;
    let vtype = u32::from_le_bytes(data[base..base + 4].try_into().ok()?);
    if vtype != 0x001F {
        return None;
    }
    let cb = u32::from_le_bytes(data[base + 4..base + 8].try_into().ok()?);
    let cf = u32::from_le_bytes(data[base + 8..base + 12].try_into().ok()?);
    if cf != 8 {
        return None;
    }
    let payload_end = base + 12 + cb as usize;
    if payload_end > data.len() || cb < 4 {
        return None;
    }
    let dib = &data[base + 12..payload_end];
    let img = bmp_from_dib(dib)?;
    size_ok(img)
}

fn bmp_from_dib(dib: &[u8]) -> Option<image::DynamicImage> {
    if dib.len() < 40 || dib[..4] != [40, 0, 0, 0] {
        return None;
    }
    let bpp = u16::from_le_bytes(dib[14..16].try_into().ok()?);
    let clrused = u32::from_le_bytes(dib[32..36].try_into().ok()?);
    let palette = if clrused != 0 {
        clrused as usize
    } else if bpp <= 8 {
        1usize << bpp
    } else {
        0
    };
    let header_end = 40 + palette * 4;
    if header_end > dib.len() {
        return None;
    }
    let mut fh = Vec::with_capacity(14 + dib.len());
    fh.extend_from_slice(b"BM");
    fh.extend((14 + dib.len() as u32).to_le_bytes());
    fh.extend(0u16.to_le_bytes());
    fh.extend(0u16.to_le_bytes());
    fh.extend((14 + header_end as u32).to_le_bytes());
    fh.extend_from_slice(dib);
    let img = image::load_from_memory(&fh).ok()?;
    size_ok(img)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dib_bmp_24bpp() {
        let (w, h) = (2u32, 1u32);
        let mut dib = Vec::new();
        dib.extend(40u32.to_le_bytes());
        dib.extend(w.to_le_bytes());
        dib.extend(i32::from_le_bytes(h.to_le_bytes()).to_le_bytes());
        dib.extend(1u16.to_le_bytes());
        dib.extend(24u16.to_le_bytes());
        dib.extend([0u8; 24]);
        let row = (((w * 3) + 3) & !3) as usize;
        dib.extend(std::iter::repeat(0u8).take(row * h as usize));
        let img = bmp_from_dib(&dib).expect("bmp from dib");
        assert_eq!(img.width(), 2);
        assert_eq!(img.height(), 1);
    }

    #[test]
    fn ooxml_thumbnail_from_zip() {
        let mut bytes = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(Cursor::new(&mut bytes));
            let opts = zip::write::SimpleFileOptions::default();
            zw.start_file("docProps/thumbnail.jpeg", opts).unwrap();
            let b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
            use base64::prelude::*;
            zw.write_all(
                &base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .unwrap(),
            )
            .unwrap();
            zw.finish().unwrap();
        }
        let path = std::env::temp_dir().join("qe_thumb_test.docx");
        std::fs::write(&path, &bytes).unwrap();
        let img = office_ooxml(path.to_str().unwrap()).expect("ooxml thumbnail");
        assert_eq!(img.width(), 1);
        assert_eq!(img.height(), 1);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn pdf_renders_png() {
        let path = std::env::temp_dir().join("qe_mini_test.pdf");
        if !path.exists() {
            return;
        }
        let img = pdf_render(path.to_str().unwrap()).expect("pdf render");
        assert!(img.width() > 0);
    }

    fn png_bytes(w: u32, h: u32, r: u8, g: u8, b: u8) -> Vec<u8> {
        let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            w,
            h,
            image::Rgba([r, g, b, 255]),
        ));
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    fn docx_zip_with(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(Cursor::new(&mut bytes));
            let opts = zip::write::SimpleFileOptions::default();
            for (name, data) in entries {
                zw.start_file(*name, opts).unwrap();
                zw.write_all(data).unwrap();
            }
            zw.finish().unwrap();
        }
        bytes
    }

    #[test]
    fn ooxml_no_thumb_returns_none() {
        let entries = vec![
            ("word/media/image1.png", png_bytes(40, 40, 255, 0, 0)),
            ("word/media/image2.png", png_bytes(6, 6, 0, 255, 0)),
        ];
        let path = std::env::temp_dir().join("qe_thumb_none.docx");
        std::fs::write(&path, docx_zip_with(&entries)).unwrap();
        assert!(office_ooxml(path.to_str().unwrap()).is_none());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn ooxml_docprops_priority() {
        let entries = vec![
            ("docProps/thumbnail.jpeg", png_bytes(1, 1, 0, 0, 255)),
            ("word/media/image1.png", png_bytes(98, 98, 0, 255, 255)),
        ];
        let path = std::env::temp_dir().join("qe_thumb_priority.docx");
        std::fs::write(&path, docx_zip_with(&entries)).unwrap();
        let img = office_ooxml(path.to_str().unwrap()).expect("docprops priority");
        assert_eq!(img.width(), 1);
        std::fs::remove_file(&path).ok();
    }
}
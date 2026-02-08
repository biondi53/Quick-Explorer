use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::Ole::IDropSource;

#[windows::core::implement(IDataObject, IDropSource)]
struct MyHandler;

impl MyHandler {
    // nothing yet
}

fn main() {}

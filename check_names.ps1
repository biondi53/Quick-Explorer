Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class ShellNames {
    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
    public interface IShellItem {
        void BindToHandler(IntPtr pbc, [In] ref Guid bhid, [In] ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, out IntPtr ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("bb2e617c-0920-11d1-9a0b-00a0c90541ee")]
    public interface IEnumShellItems {
        void Next(uint celt, [Out, MarshalAs(UnmanagedType.LPArray)] IShellItem[] rgelt, out uint pceltFetched);
        void Skip(uint celt);
        void Reset();
        void Clone(out IEnumShellItems ppenum);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    public static extern void SHGetKnownFolderItem([In] ref Guid rfid, uint dwFlags, IntPtr hToken, [In] ref Guid riid, out IShellItem ppv);

    public static Guid FOLDERID_RecycleBinFolder = new Guid("b7534046-34b2-4897-8c5e-155443a16d7e");
    public static Guid BHID_EnumItems = new Guid("94f60519-285a-4924-aa5a-d15e84868039");
    public static Guid IID_IShellItem = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");
}
"@

$bin = [ShellNames]::FOLDERID_RecycleBinFolder
$iid = [ShellNames]::IID_IShellItem
$bhid = [ShellNames]::BHID_EnumItems

$binItem = [IntPtr]::Zero
[ShellNames]::SHGetKnownFolderItem([ref]$bin, 0, [IntPtr]::Zero, [ref]$iid, [out]$binItem)

# This is hard to do purely in PowerShell with the custom interfaces for enumeration.
# I'll try to find a simpler way via Shell.Application maybe?
# No, lets just use the Rust debug script, but FIX it.

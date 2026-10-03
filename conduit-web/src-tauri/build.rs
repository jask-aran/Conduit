fn main() {
    // Resource artwork must rebuild even when Rust source and config stay put.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/dev/icon.ico");
    tauri_build::build()
}

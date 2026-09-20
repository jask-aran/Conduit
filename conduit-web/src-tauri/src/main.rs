// A release build must not hand the user a console window behind the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    conduit_desktop_lib::run()
}

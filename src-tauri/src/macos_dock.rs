#[cfg(target_os = "macos")]
mod platform {
    use std::{mem, sync::OnceLock};

    use objc::runtime::{Class, Object, Sel, BOOL, YES};
    use tauri::AppHandle;

    static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

    pub fn install_reopen_handler(app: &AppHandle) {
        let _ = APP_HANDLE.set(app.clone());

        let Some(delegate_class) = Class::get("TaoAppDelegate") else {
            return;
        };

        unsafe {
            let selector = Sel::register("applicationShouldHandleReopen:hasVisibleWindows:");
            let types = b"c@:@c\0".as_ptr().cast();
            let imp: objc::runtime::Imp = mem::transmute(
                application_should_handle_reopen
                    as extern "C" fn(&Object, Sel, *mut Object, BOOL) -> BOOL,
            );
            let _ = objc::runtime::class_addMethod(
                delegate_class as *const Class as *mut Class,
                selector,
                imp,
                types,
            );
        }
    }

    extern "C" fn application_should_handle_reopen(
        _: &Object,
        _: Sel,
        _: *mut Object,
        _: BOOL,
    ) -> BOOL {
        if let Some(app) = APP_HANDLE.get() {
            crate::hud::show_dashboard(app);
        }
        YES
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::AppHandle;

    pub fn install_reopen_handler(_: &AppHandle) {}
}

pub use platform::install_reopen_handler;

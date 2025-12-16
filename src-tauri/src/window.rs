use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

#[cfg(windows)]
use windows::Win32::{
    Foundation::HWND,
    System::ProcessStatus::GetModuleBaseNameW,
    System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ},
    UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub app_name: String,
    pub window_title: String,
}

impl Default for WindowInfo {
    fn default() -> Self {
        Self {
            app_name: "unknown".to_string(),
            window_title: "Unknown Window".to_string(),
        }
    }
}

/// Get information about the currently active (foreground) window
#[cfg(windows)]
pub fn get_active_window_info() -> WindowInfo {
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        
        if hwnd.0.is_null() {
            return WindowInfo::default();
        }
        
        // Get window title
        let mut title_buffer: [u16; 512] = [0; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buffer);
        let window_title = if title_len > 0 {
            OsString::from_wide(&title_buffer[..title_len as usize])
                .to_string_lossy()
                .into_owned()
        } else {
            "Unknown Window".to_string()
        };
        
        // Get process ID
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        
        // Get process name
        let app_name = if process_id != 0 {
            if let Ok(process_handle) = OpenProcess(
                PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                false,
                process_id,
            ) {
                let mut name_buffer: [u16; 256] = [0; 256];
                let name_len = GetModuleBaseNameW(
                    process_handle,
                    None,
                    &mut name_buffer,
                );
                
                if name_len > 0 {
                    OsString::from_wide(&name_buffer[..name_len as usize])
                        .to_string_lossy()
                        .into_owned()
                } else {
                    "unknown".to_string()
                }
            } else {
                "unknown".to_string()
            }
        } else {
            "unknown".to_string()
        };
        
        WindowInfo {
            app_name,
            window_title,
        }
    }
}

#[cfg(not(windows))]
pub fn get_active_window_info() -> WindowInfo {
    WindowInfo::default()
}

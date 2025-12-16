mod storage;
mod window;
mod input;

use std::sync::Mutex;
use storage::{AppStorage, ClipObject, Pastebook};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use window::get_active_window_info;

// Global storage state
struct AppState {
    storage: Mutex<AppStorage>,
}

// ==================== CLIP COMMANDS ====================

/// Get all clips from active pastebook
#[tauri::command]
fn get_clips(state: tauri::State<AppState>) -> Vec<ClipObject> {
    let storage = state.storage.lock().unwrap();
    storage.get_clips()
}

/// Capture current clipboard with metadata
#[tauri::command]
fn capture_clip(app: AppHandle, state: tauri::State<AppState>) -> Result<ClipObject, String> {
    let content = app
        .clipboard()
        .read_text()
        .unwrap_or_default();

    if content.trim().is_empty() {
        return Err("Clipboard is empty".to_string());
    }

    let window_info = get_active_window_info();
    let clip = ClipObject::new(content, window_info);

    let mut storage = state.storage.lock().unwrap();
    storage.add_clip(clip.clone());
    storage.save()?;

    Ok(clip)
}

/// Delete a clip
#[tauri::command]
fn delete_clip(id: String, state: tauri::State<AppState>) -> Result<bool, String> {
    let mut storage = state.storage.lock().unwrap();
    let deleted = storage.delete_clip(&id);
    storage.save()?;
    Ok(deleted)
}

/// Update a clip's content
#[tauri::command]
fn update_clip(id: String, content: String, state: tauri::State<AppState>) -> Result<bool, String> {
    let mut storage = state.storage.lock().unwrap();
    let updated = storage.update_clip(&id, content);
    storage.save()?;
    Ok(updated)
}

/// Reorder clips
#[tauri::command]
fn reorder_clips(ids: Vec<String>, state: tauri::State<AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.reorder_clips(ids);
    storage.save()?;
    Ok(())
}

/// Merge multiple clips
#[tauri::command]
fn merge_clips(ids: Vec<String>, state: tauri::State<AppState>) -> Result<Option<ClipObject>, String> {
    let mut storage = state.storage.lock().unwrap();
    let merged = storage.merge_clips(ids);
    storage.save()?;
    Ok(merged)
}

/// Get all content as single string
#[tauri::command]
fn get_all_content(state: tauri::State<AppState>) -> String {
    let storage = state.storage.lock().unwrap();
    storage.get_all_content()
}

/// Copy all content to clipboard
#[tauri::command]
fn copy_all_to_clipboard(app: AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    let storage = state.storage.lock().unwrap();
    let content = storage.get_all_content();
    
    app.clipboard()
        .write_text(content)
        .map_err(|e| format!("Failed to write to clipboard: {}", e))?;
    
    Ok(())
}

/// Clear all clips in active pastebook
#[tauri::command]
fn clear_all_clips(state: tauri::State<AppState>) -> Result<(), String> {
    let mut storage = state.storage.lock().unwrap();
    storage.clear_clips();
    storage.save()?;
    Ok(())
}

// ==================== PASTEBOOK COMMANDS ====================

/// Get list of all pastebooks
#[tauri::command]
fn list_pastebooks(state: tauri::State<AppState>) -> Vec<(String, String, usize)> {
    let storage = state.storage.lock().unwrap();
    storage.list_pastebooks()
}

/// Get active pastebook info
#[tauri::command]
fn get_active_pastebook(state: tauri::State<AppState>) -> Option<Pastebook> {
    let storage = state.storage.lock().unwrap();
    storage.get_active_pastebook().cloned()
}

/// Create a new pastebook
#[tauri::command]
fn create_pastebook(name: String, state: tauri::State<AppState>) -> Result<Pastebook, String> {
    let mut storage = state.storage.lock().unwrap();
    let pastebook = storage.create_pastebook(name);
    storage.save()?;
    Ok(pastebook)
}

/// Switch to a pastebook
#[tauri::command]
fn switch_pastebook(id: String, state: tauri::State<AppState>) -> Result<bool, String> {
    let mut storage = state.storage.lock().unwrap();
    let switched = storage.switch_pastebook(id);
    storage.save()?;
    Ok(switched)
}

/// Delete a pastebook
#[tauri::command]
fn delete_pastebook(id: String, state: tauri::State<AppState>) -> Result<bool, String> {
    let mut storage = state.storage.lock().unwrap();
    let deleted = storage.delete_pastebook(&id);
    storage.save()?;
    Ok(deleted)
}

/// Rename a pastebook
#[tauri::command]
fn rename_pastebook(id: String, name: String, state: tauri::State<AppState>) -> Result<bool, String> {
    let mut storage = state.storage.lock().unwrap();
    let renamed = storage.rename_pastebook(&id, name);
    storage.save()?;
    Ok(renamed)
}

// ==================== APP SETUP ====================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            storage: Mutex::new(AppStorage::load()),
        })
        .invoke_handler(tauri::generate_handler![
            // Clip commands
            get_clips,
            capture_clip,
            delete_clip,
            update_clip,
            reorder_clips,
            merge_clips,
            get_all_content,
            copy_all_to_clipboard,
            clear_all_clips,
            // Pastebook commands
            list_pastebooks,
            get_active_pastebook,
            create_pastebook,
            switch_pastebook,
            delete_pastebook,
            rename_pastebook,
        ])
        .setup(|app| {
            // Register global hotkey (Ctrl+Shift+C)
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyC);
            
            let app_handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
                // 1. Simulate Ctrl+C to copy selected text
                input::simulate_copy();
                
                // 2. Wait for clipboard to update (100ms)
                std::thread::sleep(std::time::Duration::from_millis(100));

                // 3. Perform capture
                let clipboard_content = app_handle.clipboard().read_text().unwrap_or_default();
                
                if clipboard_content.trim().is_empty() {
                    return;
                }
                
                // Get active window info
                let window_info = get_active_window_info();
                
                // Create clip
                let clip = ClipObject::new(clipboard_content, window_info);
                
                // Save to storage
                let state = app_handle.state::<AppState>();
                let mut storage = state.storage.lock().unwrap();
                
                // Deduplication: Check if the last clip is identical and created recently (< 2000ms) -- increased to 2s to be safe against user holding keys
                if let Some(pastebook) = storage.get_active_pastebook() {
                    if let Some(last_clip) = pastebook.clips.first() {
                        if last_clip.content == clip.content {
                            let time_diff = clip.metadata.timestamp.signed_duration_since(last_clip.metadata.timestamp);
                            if time_diff.num_milliseconds() < 2000 {
                                println!("Ignoring duplicate capture");
                                return;
                            }
                        }
                    }
                }
                
                storage.add_clip(clip.clone());
                let _ = storage.save();
                
                // Emit the new clip to the window
                let _ = app_handle.emit("clip-captured", clip);
            })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

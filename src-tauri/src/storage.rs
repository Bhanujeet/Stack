use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

use crate::window::WindowInfo;

/// A single clip captured by the user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipObject {
    pub id: String,
    pub content: String,
    pub metadata: ClipMetadata,
    pub status: String,
}

/// Metadata associated with a clip
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipMetadata {
    pub timestamp: DateTime<Utc>,
    pub source_app: String,
    pub window_title: String,
}

impl ClipObject {
    /// Create a new clip from content and window info
    pub fn new(content: String, window_info: WindowInfo) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            content,
            metadata: ClipMetadata {
                timestamp: Utc::now(),
                source_app: window_info.app_name,
                window_title: window_info.window_title,
            },
            status: "raw".to_string(),
        }
    }
}

/// A Pastebook is a named collection of clips
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pastebook {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub clips: Vec<ClipObject>,
}

impl Pastebook {
    pub fn new(name: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            created_at: Utc::now(),
            clips: Vec::new(),
        }
    }
}

/// Storage container for all pastebooks
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStorage {
    pub pastebooks: Vec<Pastebook>,
    pub active_pastebook_id: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
}

impl Default for AppStorage {
    fn default() -> Self {
        // Create a default pastebook
        let default_pastebook = Pastebook::new("My First Pastebook".to_string());
        let default_id = default_pastebook.id.clone();
        Self {
            pastebooks: vec![default_pastebook],
            active_pastebook_id: Some(default_id),
            api_key: None,
        }
    }
}

impl AppStorage {
    /// Get the path to the storage file
    fn get_storage_path() -> PathBuf {
        let app_data = dirs_next::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."));
        let stack_dir = app_data.join("Stack");
        
        // Create directory if it doesn't exist
        if !stack_dir.exists() {
            let _ = fs::create_dir_all(&stack_dir);
        }
        
        stack_dir.join("pastebooks.json")
    }
    
    /// Load from storage
    pub fn load() -> Self {
        let path = Self::get_storage_path();
        
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => {
                    serde_json::from_str(&content).unwrap_or_default()
                }
                Err(_) => Self::default(),
            }
        } else {
            Self::default()
        }
    }
    
    /// Save to storage
    pub fn save(&self) -> Result<(), String> {
        let path = Self::get_storage_path();
        
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        
        fs::write(&path, json)
            .map_err(|e| format!("Failed to write file: {}", e))?;
        
        Ok(())
    }
    
    /// Get the active pastebook
    pub fn get_active_pastebook(&self) -> Option<&Pastebook> {
        self.active_pastebook_id.as_ref().and_then(|id| {
            self.pastebooks.iter().find(|p| &p.id == id)
        })
    }
    
    /// Get mutable reference to active pastebook
    pub fn get_active_pastebook_mut(&mut self) -> Option<&mut Pastebook> {
        let id = self.active_pastebook_id.clone();
        id.and_then(move |id| {
            self.pastebooks.iter_mut().find(|p| p.id == id)
        })
    }
    
    /// Create a new pastebook
    pub fn create_pastebook(&mut self, name: String) -> Pastebook {
        let pastebook = Pastebook::new(name);
        self.pastebooks.push(pastebook.clone());
        self.active_pastebook_id = Some(pastebook.id.clone());
        pastebook
    }
    
    /// Switch to a pastebook
    pub fn switch_pastebook(&mut self, id: String) -> bool {
        if self.pastebooks.iter().any(|p| p.id == id) {
            self.active_pastebook_id = Some(id);
            true
        } else {
            false
        }
    }
    
    /// Delete a pastebook
    pub fn delete_pastebook(&mut self, id: &str) -> bool {
        if self.pastebooks.len() <= 1 {
            return false; // Can't delete the last pastebook
        }
        
        let initial_len = self.pastebooks.len();
        self.pastebooks.retain(|p| p.id != id);
        
        // If we deleted the active pastebook, switch to the first one
        if self.active_pastebook_id.as_ref() == Some(&id.to_string()) {
            self.active_pastebook_id = self.pastebooks.first().map(|p| p.id.clone());
        }
        
        self.pastebooks.len() < initial_len
    }
    
    /// Rename a pastebook
    pub fn rename_pastebook(&mut self, id: &str, new_name: String) -> bool {
        if let Some(pastebook) = self.pastebooks.iter_mut().find(|p| p.id == id) {
            pastebook.name = new_name;
            true
        } else {
            false
        }
    }
    
    /// Get list of all pastebooks (id, name)
    pub fn list_pastebooks(&self) -> Vec<(String, String, usize)> {
        self.pastebooks
            .iter()
            .map(|p| (p.id.clone(), p.name.clone(), p.clips.len()))
            .collect()
    }
    
    // ==================== CLIP OPERATIONS ====================
    
    /// Add a clip to the active pastebook
    pub fn add_clip(&mut self, clip: ClipObject) -> bool {
        if let Some(pastebook) = self.get_active_pastebook_mut() {
            pastebook.clips.insert(0, clip);
            true
        } else {
            false
        }
    }
    
    /// Get clips from active pastebook
    pub fn get_clips(&self) -> Vec<ClipObject> {
        self.get_active_pastebook()
            .map(|p| p.clips.clone())
            .unwrap_or_default()
    }
    
    /// Delete a clip from active pastebook
    pub fn delete_clip(&mut self, id: &str) -> bool {
        if let Some(pastebook) = self.get_active_pastebook_mut() {
            let initial_len = pastebook.clips.len();
            pastebook.clips.retain(|c| c.id != id);
            pastebook.clips.len() < initial_len
        } else {
            false
        }
    }
    
    /// Update a clip's content
    pub fn update_clip(&mut self, id: &str, content: String) -> bool {
        if let Some(pastebook) = self.get_active_pastebook_mut() {
            if let Some(clip) = pastebook.clips.iter_mut().find(|c| c.id == id) {
                clip.content = content;
                return true;
            }
        }
        false
    }
    
    /// Reorder clips
    pub fn reorder_clips(&mut self, ids: Vec<String>) {
        if let Some(pastebook) = self.get_active_pastebook_mut() {
            let mut new_clips = Vec::new();
            
            for id in ids {
                if let Some(clip) = pastebook.clips.iter().find(|c| c.id == id).cloned() {
                    new_clips.push(clip);
                }
            }
            
            for clip in &pastebook.clips {
                if !new_clips.iter().any(|c| c.id == clip.id) {
                    new_clips.push(clip.clone());
                }
            }
            
            pastebook.clips = new_clips;
        }
    }
    
    /// Merge multiple clips
    pub fn merge_clips(&mut self, ids: Vec<String>) -> Option<ClipObject> {
        if ids.len() < 2 {
            return None;
        }
        
        let pastebook = self.get_active_pastebook_mut()?;
        
        let mut merged_content = Vec::new();
        let mut first_metadata: Option<ClipMetadata> = None;
        
        for id in &ids {
            if let Some(clip) = pastebook.clips.iter().find(|c| &c.id == id) {
                merged_content.push(clip.content.clone());
                if first_metadata.is_none() {
                    first_metadata = Some(clip.metadata.clone());
                }
            }
        }
        
        if merged_content.is_empty() {
            return None;
        }
        
        let new_clip = ClipObject {
            id: Uuid::new_v4().to_string(),
            content: merged_content.join("\n\n"),
            metadata: first_metadata.unwrap_or(ClipMetadata {
                timestamp: Utc::now(),
                source_app: "Stack".to_string(),
                window_title: "Merged Clip".to_string(),
            }),
            status: "raw".to_string(),
        };
        
        // Remove merged clips
        for id in &ids {
            pastebook.clips.retain(|c| &c.id != id);
        }
        
        pastebook.clips.insert(0, new_clip.clone());
        Some(new_clip)
    }
    
    /// Get all clips as a single string
    pub fn get_all_content(&self) -> String {
        self.get_active_pastebook()
            .map(|p| {
                p.clips
                    .iter()
                    .map(|c| c.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n")
            })
            .unwrap_or_default()
    }
    
    /// Clear all clips in active pastebook
    pub fn clear_clips(&mut self) {
        if let Some(pastebook) = self.get_active_pastebook_mut() {
            pastebook.clips.clear();
        }
    }
}

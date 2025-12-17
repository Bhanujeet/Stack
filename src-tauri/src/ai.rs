use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

const API_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

#[derive(Clone, Debug)]
pub struct GeminiClient {
    http_client: Client,
    api_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
    error: Option<GeminiError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Candidate {
    content: Content,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Content {
    parts: Vec<Part>,
    role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Part {
    text: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiError {
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelList {
    models: Option<Vec<ModelInfo>>,
    error: Option<GeminiError>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelInfo {
    name: String,
    bearer_token: Option<String>, // Just in case, usually not needed
    display_name: Option<String>,
    supported_generation_methods: Option<Vec<String>>,
}

impl GeminiClient {
    pub fn new(api_key: String) -> Self {
        Self {
            http_client: Client::new(),
            api_key,
        }
    }

    pub async fn chat(&self, model: &str, prompt: &str) -> Result<String, String> {
        let url = format!("{}/{}:generateContent?key={}", API_BASE_URL, model, self.api_key);
        
        let body = json!({
            "contents": [{
                "parts": [{ "text": prompt }]
            }]
        });

        let response = self.http_client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("API Error: {}", error_text));
        }

        let gemini_resp: GeminiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;
            
        if let Some(error) = gemini_resp.error {
            return Err(format!("Gemini Error: {}", error.message));
        }

        gemini_resp.candidates
            .and_then(|c| c.first().cloned())
            .and_then(|c| c.content.parts.first().cloned())
            .map(|p| p.text)
            .ok_or_else(|| "No content returned".to_string())
    }

    pub async fn magic_sort(&self, clips_content: &str) -> Result<String, String> {
        let prompt = format!(
            "You are a helpful assistant. \
            Analyze the following list of text clips. \
            Reorder them into a logical structure (e.g., Problem -> Solution -> Evidence, or Chronological). \
            Return ONLY a valid JSON array of indices representing the new order. \
            Example: [3, 0, 1, 2]. \
            Do not include Markdown formatting or explanations. \
            \
            Clips: \
            {}", 
            clips_content
        );

        let response = self.chat("gemini-flash-latest", &prompt).await?;
        
        // Clean cleanup markdown if present (```json ... ```)
        let cleaned = response
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```");
            
        Ok(cleaned.to_string())
    }

    pub async fn list_models(&self) -> Result<Vec<String>, String> {
        let url = format!("{}?key={}", API_BASE_URL, self.api_key);
        
        let response = self.http_client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("API Error: {}", error_text));
        }

        let model_list: ModelList = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        if let Some(error) = model_list.error {
            return Err(format!("Gemini Error: {}", error.message));
        }

        let models = model_list.models
            .ok_or("No models found")?
            .into_iter()
            .filter(|m| {
                m.supported_generation_methods
                    .as_ref()
                    .map_or(false, |methods| methods.contains(&"generateContent".to_string()))
            })
            .map(|m| m.name)
            .collect();

        Ok(models)
    }
}

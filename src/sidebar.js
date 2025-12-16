// Sidebar JavaScript - Floating overlay for quick clip access
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

let clips = [];

// DOM Elements
const clipsList = document.getElementById('clips-list');
const captureFlash = document.getElementById('capture-flash');

// Initialize
async function init() {
    await loadClips();
    setupEventListeners();

    // Setup close button
    document.getElementById('close-btn').addEventListener('click', () => {
        getCurrentWindow().close();
    });
}

// Load clips from backend
async function loadClips() {
    try {
        clips = await invoke('get_clips');
        renderClips();
    } catch (error) {
        console.error('Failed to load clips:', error);
    }
}

// Render clips in the sidebar
function renderClips() {
    if (clips.length === 0) {
        clipsList.innerHTML = `
            <div class="empty-state">
                <div class="icon">📋</div>
                <p>No clips yet!<br>Select text anywhere and press<br><strong>Ctrl+Shift+C</strong> to capture.</p>
            </div>
        `;
        return;
    }

    clipsList.innerHTML = clips.map(clip => `
        <div class="clip-mini" data-id="${clip.id}" onclick="openInCanvas('${clip.id}')">
            <div class="source">
                <span class="app-icon"></span>
                <span>${escapeHtml(clip.metadata.source_app)} - ${escapeHtml(truncate(clip.metadata.window_title, 30))}</span>
            </div>
            <div class="content">${escapeHtml(clip.content)}</div>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteClip('${clip.id}')" title="Delete">×</button>
        </div>
    `).join('');
}

// Setup event listeners
function setupEventListeners() {
    // Listen for clip captured from hotkey (backend does the capture now)
    listen('clip-captured', async (event) => {
        const newClip = event.payload;
        // Show flash animation
        captureFlash.classList.add('active');
        setTimeout(() => captureFlash.classList.remove('active'), 150);

        clips.unshift(newClip);
        renderClips();
    });

    // Listen for clip updates from main window
    listen('clips-updated', async () => {
        await loadClips();
    });
}

// Delete a clip
async function deleteClip(id) {
    try {
        await invoke('delete_clip', { id });
        clips = clips.filter(c => c.id !== id);
        renderClips();
    } catch (error) {
        console.error('Failed to delete clip:', error);
    }
}

// Open clip in canvas (focus main window)
function openInCanvas(id) {
    // Emit event to main window to scroll to/highlight this clip
    window.__TAURI__.event.emit('focus-clip', { id });
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncate(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// Make functions available globally for onclick handlers
window.deleteClip = deleteClip;
window.openInCanvas = openInCanvas;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

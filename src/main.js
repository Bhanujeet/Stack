// Stack Canvas - Main Application Logic
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// State
let clips = [];
let pastebooks = [];
let activePastebook = null;
let selectedIds = new Set();
let searchQuery = '';
let draggedId = null;

// DOM Elements
const canvasGrid = document.getElementById('canvas-grid');
const clipCount = document.getElementById('clip-count');
const selectionInfo = document.getElementById('selection-info');
const searchInput = document.getElementById('search-input');
const modalOverlay = document.getElementById('modal-overlay');
const currentPastebookName = document.getElementById('current-pastebook-name');
const pastebookMenu = document.getElementById('pastebook-menu');
const pastebookDropdown = document.getElementById('pastebook-dropdown');

// Buttons
const btnSelectAll = document.getElementById('btn-select-all');
const btnDeselectAll = document.getElementById('btn-deselect-all');
const btnMerge = document.getElementById('btn-merge');
const btnDeleteSelected = document.getElementById('btn-delete-selected');
const btnCopyAll = document.getElementById('btn-copy-all');
const btnClearAll = document.getElementById('btn-clear-all');
const btnNewPastebook = document.getElementById('btn-new-pastebook');
const modalCancel = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

// Current modal action
let modalAction = null;

// ==================== INITIALIZATION ====================

async function init() {
  await loadPastebooks();
  await loadClips();
  setupEventListeners();
  setupDragAndDrop();
}

// ==================== PASTEBOOK MANAGEMENT ====================

async function loadPastebooks() {
  try {
    pastebooks = await invoke('list_pastebooks');
    activePastebook = await invoke('get_active_pastebook');
    renderPastebookMenu();
    updatePastebookDisplay();
  } catch (error) {
    console.error('Failed to load pastebooks:', error);
  }
}

function renderPastebookMenu() {
  const menuItems = pastebooks.map(([id, name, count]) => {
    const isActive = activePastebook && activePastebook.id === id;
    return `
      <div class="pastebook-item ${isActive ? 'active' : ''}" data-id="${id}" onclick="switchPastebook('${id}')">
        <div class="pastebook-item-info">
          <span class="pastebook-item-name">${escapeHtml(name)}</span>
          <span class="pastebook-item-count">${count} clip${count !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
  }).join('');

  pastebookMenu.innerHTML = menuItems + `
    <div class="pastebook-new" id="btn-new-pastebook" onclick="promptNewPastebook()">
      ➕ New Pastebook
    </div>
  `;
}

function updatePastebookDisplay() {
  if (activePastebook) {
    currentPastebookName.textContent = activePastebook.name;
  } else {
    currentPastebookName.textContent = 'No Pastebook';
  }
}

async function switchPastebook(id) {
  try {
    await invoke('switch_pastebook', { id });
    await loadPastebooks();
    await loadClips();
    closePastebookMenu();
    showToast('Switched pastebook', 'success');
  } catch (error) {
    console.error('Failed to switch pastebook:', error);
    showToast('Failed to switch pastebook', 'error');
  }
}

function promptNewPastebook() {
  closePastebookMenu();
  showInputModal('New Pastebook', 'Enter a name for your new pastebook:', 'My Pastebook', async (name) => {
    if (name && name.trim()) {
      await createPastebook(name.trim());
    }
  });
}

async function createPastebook(name) {
  try {
    await invoke('create_pastebook', { name });
    await loadPastebooks();
    await loadClips();
    showToast(`Created "${name}"`, 'success');
  } catch (error) {
    console.error('Failed to create pastebook:', error);
    showToast('Failed to create pastebook', 'error');
  }
}

function togglePastebookMenu() {
  pastebookMenu.classList.toggle('active');
}

function closePastebookMenu() {
  pastebookMenu.classList.remove('active');
}

// ==================== DATA LOADING ====================

async function loadClips() {
  try {
    clips = await invoke('get_clips');
    selectedIds.clear();
    renderClips();
    updateUI();
  } catch (error) {
    console.error('Failed to load clips:', error);
    showToast('Failed to load clips', 'error');
  }
}

// ==================== RENDERING ====================

function renderClips() {
  const filteredClips = getFilteredClips();

  if (filteredClips.length === 0) {
    canvasGrid.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <h3>${searchQuery ? 'No matching clips' : 'No clips yet!'}</h3>
        <p>${searchQuery ? 'Try a different search term' : 'Select text in any app and press Ctrl+Shift+C to capture'}</p>
      </div>
    `;
    return;
  }

  canvasGrid.innerHTML = filteredClips.map(clip => createClipCardHtml(clip)).join('');

  // Re-attach drag handlers
  document.querySelectorAll('.clip-card').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', handleDrop);
  });
}

function createClipCardHtml(clip) {
  const isSelected = selectedIds.has(clip.id);
  const timestamp = formatTimestamp(clip.metadata.timestamp);
  const contentPreview = escapeHtml(clip.content);
  const isLong = clip.content.length > 300;

  return `
    <div class="clip-card ${isSelected ? 'selected' : ''}" 
         data-id="${clip.id}" 
         draggable="true">
      <div class="clip-card-header">
        <div class="clip-card-source">
          <span class="app-name">${escapeHtml(clip.metadata.source_app)}</span>
          <span>•</span>
          <span>${escapeHtml(truncate(clip.metadata.window_title, 40))}</span>
        </div>
        <div class="clip-card-actions">
          <button class="btn btn-icon btn-secondary" onclick="editClip('${clip.id}')" title="Edit">✏️</button>
          <button class="btn btn-icon btn-secondary" onclick="copyClip('${clip.id}')" title="Copy">📋</button>
          <button class="btn btn-icon btn-danger" onclick="confirmDeleteClip('${clip.id}')" title="Delete">🗑️</button>
        </div>
      </div>
      <div class="clip-card-content ${isLong ? 'collapsed' : ''}">${contentPreview}</div>
      <textarea class="clip-card-editor" data-id="${clip.id}">${escapeHtml(clip.content)}</textarea>
      <div class="edit-actions">
        <button class="btn btn-primary" onclick="saveEdit('${clip.id}')">Save</button>
        <button class="btn btn-secondary" onclick="cancelEdit('${clip.id}')">Cancel</button>
      </div>
      ${isLong ? `<button class="expand-btn" onclick="toggleExpand('${clip.id}')">Show more</button>` : ''}
      <div class="clip-card-footer">
        <span class="clip-card-timestamp">${timestamp}</span>
        <input type="checkbox" class="clip-card-checkbox" 
               ${isSelected ? 'checked' : ''} 
               onchange="toggleSelection('${clip.id}', this.checked)">
      </div>
    </div>
  `;
}

function getFilteredClips() {
  if (!searchQuery) return clips;

  const query = searchQuery.toLowerCase();
  return clips.filter(clip =>
    clip.content.toLowerCase().includes(query) ||
    clip.metadata.source_app.toLowerCase().includes(query) ||
    clip.metadata.window_title.toLowerCase().includes(query)
  );
}

function updateUI() {
  // Update clip count
  clipCount.textContent = `${clips.length} clip${clips.length !== 1 ? 's' : ''}`;

  // Update selection info
  if (selectedIds.size > 0) {
    selectionInfo.textContent = `${selectedIds.size} selected`;
  } else {
    selectionInfo.textContent = '';
  }

  // Update button states
  btnDeselectAll.disabled = selectedIds.size === 0;
  btnMerge.disabled = selectedIds.size < 2;
  btnDeleteSelected.disabled = selectedIds.size === 0;
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
  // Search
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderClips();
  });

  // Pastebook dropdown
  document.getElementById('pastebook-current').addEventListener('click', togglePastebookMenu);

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!pastebookDropdown.contains(e.target)) {
      closePastebookMenu();
    }
  });

  // Selection buttons
  btnSelectAll.addEventListener('click', selectAll);
  btnDeselectAll.addEventListener('click', deselectAll);

  // Action buttons
  btnMerge.addEventListener('click', mergeSelected);
  btnDeleteSelected.addEventListener('click', confirmDeleteSelected);
  btnCopyAll.addEventListener('click', copyAll);
  btnClearAll.addEventListener('click', confirmClearAll);

  // AI Buttons
  document.getElementById('btn-magic-sort').addEventListener('click', handleMagicSort);
  document.getElementById('btn-chat-toggle').addEventListener('click', toggleChatDrawer);
  document.getElementById('btn-chat-close').addEventListener('click', toggleChatDrawer);
  document.getElementById('btn-chat-send').addEventListener('click', handleChatSubmit);
  document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });

  // Settings Modal
  document.getElementById('settings-save').addEventListener('click', saveSettings);
  document.getElementById('settings-cancel').addEventListener('click', closeSettingsModal);
  document.getElementById('btn-check-models').addEventListener('click', checkModels);
  document.getElementById('btn-check-models').addEventListener('click', checkModels);

  // Modal
  modalCancel.addEventListener('click', closeModal);
  modalConfirm.addEventListener('click', executeModalAction);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Listen for clip captured from hotkey
  listen('clip-captured', (event) => {
    const newClip = event.payload;
    clips.unshift(newClip);
    renderClips();
    updateUI();
    showToast('Clip captured!', 'success');
    // Update pastebook list to reflect new clip count
    loadPastebooks();
  });
}

// ==================== DRAG AND DROP ====================

function setupDragAndDrop() {
  // Already attached in renderClips
}

function handleDragStart(e) {
  draggedId = e.target.dataset.id;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  draggedId = null;
}

function handleDragOver(e) {
  e.preventDefault();
  const card = e.target.closest('.clip-card');
  if (card && card.dataset.id !== draggedId) {
    card.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  const card = e.target.closest('.clip-card');
  if (card) {
    card.classList.remove('drag-over');
  }
}

async function handleDrop(e) {
  e.preventDefault();
  const targetCard = e.target.closest('.clip-card');
  if (!targetCard || !draggedId) return;

  const targetId = targetCard.dataset.id;
  if (targetId === draggedId) return;

  targetCard.classList.remove('drag-over');

  // Reorder clips
  const draggedIndex = clips.findIndex(c => c.id === draggedId);
  const targetIndex = clips.findIndex(c => c.id === targetId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  // Remove dragged clip and insert at target position
  const [draggedClip] = clips.splice(draggedIndex, 1);
  clips.splice(targetIndex, 0, draggedClip);

  // Update backend
  try {
    await invoke('reorder_clips', { ids: clips.map(c => c.id) });
    renderClips();
    showToast('Clips reordered', 'success');
  } catch (error) {
    console.error('Failed to reorder:', error);
    await loadClips(); // Reload on error
  }
}

// ==================== CLIP ACTIONS ====================

async function copyClip(id) {
  const clip = clips.find(c => c.id === id);
  if (!clip) return;

  try {
    await navigator.clipboard.writeText(clip.content);
    showToast('Copied to clipboard', 'success');
  } catch (error) {
    console.error('Copy failed:', error);
  }
}

function editClip(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.classList.add('editing');
  }
}

function cancelEdit(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.classList.remove('editing');
    // Reset textarea
    const textarea = card.querySelector('.clip-card-editor');
    const clip = clips.find(c => c.id === id);
    if (textarea && clip) {
      textarea.value = clip.content;
    }
  }
}

async function saveEdit(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  const textarea = card?.querySelector('.clip-card-editor');

  if (!textarea) return;

  const newContent = textarea.value.trim();
  if (!newContent) {
    showToast('Content cannot be empty', 'error');
    return;
  }

  try {
    await invoke('update_clip', { id, content: newContent });
    const clip = clips.find(c => c.id === id);
    if (clip) {
      clip.content = newContent;
    }
    renderClips();
    showToast('Clip updated', 'success');
  } catch (error) {
    console.error('Update failed:', error);
    showToast('Failed to update clip', 'error');
  }
}

function toggleExpand(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    const content = card.querySelector('.clip-card-content');
    const btn = card.querySelector('.expand-btn');
    content.classList.toggle('collapsed');
    btn.textContent = content.classList.contains('collapsed') ? 'Show more' : 'Show less';
  }
}

// ==================== SELECTION ====================

function toggleSelection(id, checked) {
  if (checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
  updateUI();
}

function selectAll() {
  clips.forEach(clip => selectedIds.add(clip.id));
  renderClips();
  updateUI();
}

function deselectAll() {
  selectedIds.clear();
  renderClips();
  updateUI();
}

// ==================== BULK ACTIONS ====================

async function mergeSelected() {
  const ids = Array.from(selectedIds);
  if (ids.length < 2) return;

  try {
    const merged = await invoke('merge_clips', { ids });
    if (merged) {
      await loadClips();
      selectedIds.clear();
      updateUI();
      showToast(`Merged ${ids.length} clips`, 'success');
    }
  } catch (error) {
    console.error('Merge failed:', error);
    showToast('Failed to merge clips', 'error');
  }
}

async function deleteClip(id) {
  try {
    await invoke('delete_clip', { id });
    clips = clips.filter(c => c.id !== id);
    selectedIds.delete(id);
    renderClips();
    updateUI();
    showToast('Clip deleted', 'success');
    loadPastebooks();
  } catch (error) {
    console.error('Delete failed:', error);
    showToast('Failed to delete clip', 'error');
  }
}

async function deleteSelected() {
  const ids = Array.from(selectedIds);

  try {
    for (const id of ids) {
      await invoke('delete_clip', { id });
    }
    clips = clips.filter(c => !ids.includes(c.id));
    selectedIds.clear();
    renderClips();
    updateUI();
    showToast(`Deleted ${ids.length} clips`, 'success');
    loadPastebooks();
  } catch (error) {
    console.error('Delete failed:', error);
    showToast('Failed to delete clips', 'error');
  }
}

async function copyAll() {
  try {
    await invoke('copy_all_to_clipboard');
    showToast('All clips copied to clipboard!', 'success');
  } catch (error) {
    console.error('Copy all failed:', error);
    showToast('Failed to copy clips', 'error');
  }
}

async function clearAll() {
  try {
    await invoke('clear_all_clips');
    clips = [];
    selectedIds.clear();
    renderClips();
    updateUI();
    showToast('All clips cleared', 'success');
    loadPastebooks();
  } catch (error) {
    console.error('Clear failed:', error);
    showToast('Failed to clear clips', 'error');
  }
}
// ==================== AI FEATURES ====================

async function handleMagicSort() {
  const btn = document.getElementById('btn-magic-sort');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '✨ Sorting...';

  try {
    await invoke('magic_sort');
    await loadClips();
    showToast('✨ Stack sorted magically!', 'success');
  } catch (error) {
    console.error('Magic sort failed:', error);
    if (error.includes("API Key")) {
      openSettingsModal();
      showToast('Please enter your AI Studio API Key', 'error');
    } else {
      showToast('Magic sort failed: ' + error, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// Chat
const chatDrawer = document.getElementById('chat-drawer');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');

function toggleChatDrawer() {
  chatDrawer.classList.toggle('active');
  if (chatDrawer.classList.contains('active')) {
    setTimeout(() => chatInput.focus(), 300);
  }
}

async function handleChatSubmit() {
  const prompt = chatInput.value.trim();
  if (!prompt) return;

  // Add user message
  appendChatMessage(prompt, 'user');
  chatInput.value = '';

  // Show loading state
  appendChatMessage('Thinking... 🤔', 'bot', true);

  try {
    const response = await invoke('chat_submit', { prompt });
    // Remove loading message
    const loader = chatMessages.querySelector('.loading');
    if (loader) loader.remove();

    // Add bot response
    appendChatMessage(response, 'bot');
  } catch (error) {
    const loader = chatMessages.querySelector('.loading');
    if (loader) loader.remove();

    if (error.includes("API Key")) {
      appendChatMessage("Please set your API Key in Settings.", 'bot');
      openSettingsModal();
    } else {
      appendChatMessage("Error: " + error, 'bot');
    }
  }
}

function appendChatMessage(text, sender, isLoading = false) {
  const div = document.createElement('div');
  div.className = `chat-message ${sender} ${isLoading ? 'loading' : ''}`;
  div.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
  chatMessages.appendChild(div);
  chatMessages.scrollTo(0, chatMessages.scrollHeight);
}

// Settings (API Key)
const settingsModalOverlay = document.getElementById('settings-modal-overlay');
const apiKeyInput = document.getElementById('api-key-input');

function openSettingsModal() {
  settingsModalOverlay.classList.add('active');
}

function closeSettingsModal() {
  settingsModalOverlay.classList.remove('active');
}

async function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showToast('API Key cannot be empty', 'error');
    return;
  }

  try {
    await invoke('set_api_key', { apiKey });
    closeSettingsModal();
    showToast('API Key saved!', 'success');
  } catch (error) {
    showToast('Failed to save settings', 'error');
  }
}

async function checkModels() {
  const listDiv = document.getElementById('models-list');
  listDiv.innerHTML = 'Loading models...';

  try {
    const models = await invoke('get_models');
    console.log('Available models:', models);

    if (models.length === 0) {
      listDiv.innerHTML = 'No models found supporting generateContent';
      return;
    }

    const cleanModels = models.map(m => m.replace('models/', ''));
    listDiv.innerHTML = '<strong>Available:</strong><br>' + cleanModels.join('<br>');

  } catch (error) {
    console.error('List models failed:', error);
    listDiv.innerHTML = '<span style="color: var(--error)">Error: ' + error + '</span>';
    if (error.includes("API Key")) {
      showToast('Save your API Key first!', 'error');
    }
  }
}

// ==================== MODAL ====================

function showModal(title, body, action) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  modalAction = action;
  modalOverlay.classList.add('active');
}

function showInputModal(title, prompt, placeholder, callback) {
  const body = `
    <p>${prompt}</p>
    <input type="text" class="modal-input" id="modal-input" placeholder="${placeholder}" value="${placeholder}">
  `;
  showModal(title, body, () => {
    const input = document.getElementById('modal-input');
    callback(input?.value);
  });

  // Focus input after modal opens
  setTimeout(() => {
    const input = document.getElementById('modal-input');
    if (input) {
      input.select();
    }
  }, 100);
}

function closeModal() {
  modalOverlay.classList.remove('active');
  modalAction = null;
}

function executeModalAction() {
  if (modalAction) {
    modalAction();
  }
  closeModal();
}

function confirmDeleteClip(id) {
  showModal('Delete Clip', 'Are you sure you want to delete this clip?', () => deleteClip(id));
}

function confirmDeleteSelected() {
  showModal('Delete Selected', `Delete ${selectedIds.size} selected clips?`, deleteSelected);
}

function confirmClearAll() {
  showModal('Clear All', 'This will delete all clips in this pastebook. Are you sure?', clearAll);
}

// ==================== UTILITIES ====================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Make functions available globally for onclick handlers
window.editClip = editClip;
window.copyClip = copyClip;
window.saveEdit = saveEdit;
window.cancelEdit = cancelEdit;
window.toggleExpand = toggleExpand;
window.toggleSelection = toggleSelection;
window.confirmDeleteClip = confirmDeleteClip;
window.switchPastebook = switchPastebook;
window.promptNewPastebook = promptNewPastebook;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);

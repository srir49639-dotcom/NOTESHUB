/**
 * script.js - Core application logic, localStorage adapters, IndexedDB file storage
 */

// Global configuration
const DB_NAME = 'NotesHubDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

// Application State
const state = {
  currentUser: null,
  theme: 'light'
};

/* ========================================================================= */
/* INITIALIZATION & THEME                                                    */
/* ========================================================================= */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initDB();
  loadCurrentUser();
  updateNavbar();
});

function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  state.theme = savedTheme;
  document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('theme', state.theme);
}

/* ========================================================================= */
/* UTILITIES (Toasts, Generators, Formats)                                   */
/* ========================================================================= */

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-check-circle';
  if (type === 'error') icon = 'fa-exclamation-circle';
  if (type === 'warning') icon = 'fa-exclamation-triangle';

  toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function calculateAverageRating(ratingsObj) {
  if (!ratingsObj) return 0;
  const values = Object.values(ratingsObj);
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return (sum / values.length).toFixed(1);
}

/* ========================================================================= */
/* LOCAL STORAGE ADAPTERS (JSON relational db)                               */
/* ========================================================================= */

const db = {
  get(key) {
    return JSON.parse(localStorage.getItem(key)) || [];
  },
  set(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  },

  // Users
  getUsers() { return this.get('users'); },
  getUserById(id) { return this.getUsers().find(u => u.userId === id); },
  getUserByEmail(email) { return this.getUsers().find(u => u.email === email); },
  saveUser(user) {
    const users = this.getUsers();
    users.push(user);
    this.set('users', users);
  },
  updateUser(updatedUser) {
    const users = this.getUsers().map(u => u.userId === updatedUser.userId ? updatedUser : u);
    this.set('users', users);
  },

  // Notes Meta
  getNotes() { return this.get('notes'); },
  getNoteById(id) { return this.getNotes().find(n => n.noteId === id); },
  saveNote(note) {
    const notes = this.getNotes();
    notes.push(note);
    this.set('notes', notes);
  },
  updateNote(updatedNote) {
    const notes = this.getNotes().map(n => n.noteId === updatedNote.noteId ? updatedNote : n);
    this.set('notes', notes);
  },

  // Comments
  getComments() { return this.get('comments'); },
  getCommentsForNote(noteId) { return this.getComments().filter(c => c.noteId === noteId); },
  saveComment(comment) {
    const comments = this.getComments();
    comments.push(comment);
    this.set('comments', comments);
  },

  // Ratings (structured as { noteId: { userId: score, ... }, ... })
  getRatings() { return JSON.parse(localStorage.getItem('ratings')) || {}; },
  setRatings(ratings) { localStorage.setItem('ratings', JSON.stringify(ratings)); },
  rateNote(noteId, userId, score) {
    const ratings = this.getRatings();
    if (!ratings[noteId]) ratings[noteId] = {};
    ratings[noteId][userId] = score;
    this.setRatings(ratings);

    // Update cached stats on note
    const note = this.getNoteById(noteId);
    if (note) {
      note.ratingCount = Object.keys(ratings[noteId]).length;
      note.averageRating = calculateAverageRating(ratings[noteId]);
      this.updateNote(note);
    }
  },

  // Bookmarks
  getBookmarks(userId) {
    const bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || {};
    return bookmarks[userId] || [];
  },
  toggleBookmark(userId, noteId) {
    const allBookmarks = JSON.parse(localStorage.getItem('bookmarks')) || {};
    if (!allBookmarks[userId]) allBookmarks[userId] = [];

    const idx = allBookmarks[userId].indexOf(noteId);
    let isBookmarked = false;
    if (idx > -1) {
      allBookmarks[userId].splice(idx, 1);
    } else {
      allBookmarks[userId].push(noteId);
      isBookmarked = true;
    }
    localStorage.setItem('bookmarks', JSON.stringify(allBookmarks));
    return isBookmarked;
  }
};

/* ========================================================================= */
/* INDEXED DB ADAPTER (File storage)                                         */
/* ========================================================================= */

let idb;

function initDB() {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onerror = (e) => {
    console.error("IndexedDB error:", e.target.error);
  };

  request.onsuccess = (e) => {
    idb = e.target.result;
    console.log("IndexedDB initialized");
  };

  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
    }
  };
}

const fileDB = {
  saveFile(fileId, fileBlob) {
    return new Promise((resolve, reject) => {
      if (!idb) return reject("Database not initialized");
      const transaction = idb.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ fileId, fileBlob });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  getFile(fileId) {
    return new Promise((resolve, reject) => {
      if (!idb) return reject("Database not initialized");
      const transaction = idb.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(fileId);

      request.onsuccess = () => {
        if (request.result) resolve(request.result.fileBlob);
        else reject(new Error("File not found"));
      };
      request.onerror = () => reject(request.error);
    });
  }
};

/* ========================================================================= */
/* AUTHENTICATION                                                            */
/* ========================================================================= */

function loadCurrentUser() {
  const activeToken = localStorage.getItem('activeUser');
  if (activeToken) {
    state.currentUser = db.getUserById(activeToken);
  }
}

function updateNavbar() {
  const userElements = document.querySelectorAll('.auth-user-only');
  const guestElements = document.querySelectorAll('.auth-guest-only');

  if (state.currentUser) {
    userElements.forEach(el => el.style.display = '');
    guestElements.forEach(el => el.style.display = 'none');
  } else {
    userElements.forEach(el => el.style.display = 'none');
    guestElements.forEach(el => el.style.display = '');
  }
}

function logout() {
  localStorage.removeItem('activeUser');
  state.currentUser = null;
  window.location.href = 'index.html';
}

function requireAuth() {
  if (!state.currentUser) {
    localStorage.setItem('redirectAfterLogin', window.location.pathname);
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

// Event delegation for logout and theme toggle across pages
document.addEventListener('click', (e) => {
  if (e.target.closest('#logout-btn')) {
    e.preventDefault();
    logout();
  }
  if (e.target.closest('#theme-toggle')) {
    e.preventDefault();
    toggleTheme();
  }
  // Mobile menu toggle
  if (e.target.closest('.mobile-menu-btn')) {
    document.querySelector('.nav-links').classList.toggle('show');
  }
});

/* ========================================================================= */
/* BADGE SYSTEM & STATS UPDATES                                              */
/* ========================================================================= */

function checkAndAwardBadges(userId) {
  const user = db.getUserById(userId);
  if (!user) return;

  const oldBadgeCount = user.badges.length;

  if (user.uploads >= 1 && !user.badges.includes("First Upload")) {
    user.badges.push("First Upload");
  }
  if (user.uploads >= 10 && !user.badges.includes("Top Contributor")) {
    user.badges.push("Top Contributor");
  }
  if (user.downloads >= 100 && !user.badges.includes("100 Downloads")) {
    user.badges.push("100 Downloads");
  }
  if (user.averageRating >= 4.5 && user.uploads >= 5 && !user.badges.includes("5 Star Master")) {
    user.badges.push("5 Star Master");
  }

  if (user.badges.length > oldBadgeCount) {
    db.updateUser(user);
    const newBadges = user.badges.slice(oldBadgeCount);
    // If the active user earned it, show a toast
    if (state.currentUser && state.currentUser.userId === user.userId) {
      state.currentUser = user; // keep in sync
      showToast(`Congratulations! You earned a new badge: ${newBadges.join(', ')}`, 'success');
    }
  }
}
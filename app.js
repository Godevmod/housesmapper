const DB_NAME = "houses-mappe";
const DB_VERSION = 1;
const STORE = "records";
const PHOTO_MAX_SIZE = 1600;
const PHOTO_QUALITY = 0.78;

const state = {
  records: [],
  filter: "all",
  addressQuery: "",
  dateQuery: "",
  comments: [],
  photos: [],
  viewerPhotos: [],
  viewerIndex: 0
};

const els = {
  form: document.querySelector("#listingForm"),
  recordId: document.querySelector("#recordId"),
  clearBtn: document.querySelector("#clearBtn"),
  siteUrl: document.querySelector("#siteUrl"),
  visitDate: document.querySelector("#visitDate"),
  address: document.querySelector("#address"),
  commentInput: document.querySelector("#commentInput"),
  addCommentBtn: document.querySelector("#addCommentBtn"),
  commentCount: document.querySelector("#commentCount"),
  commentPreview: document.querySelector("#commentPreview"),
  visited: document.querySelector("#visited"),
  photos: document.querySelector("#photos"),
  photoPreview: document.querySelector("#photoPreview"),
  recordsList: document.querySelector("#recordsList"),
  counter: document.querySelector("#counter"),
  addressSearch: document.querySelector("#addressSearch"),
  dateSearch: document.querySelector("#dateSearch"),
  resetSearchBtn: document.querySelector("#resetSearchBtn"),
  addRecordBtn: document.querySelector("#addRecordBtn"),
  recordModal: document.querySelector("#recordModal"),
  closeModalBtn: document.querySelector("#closeModalBtn"),
  modalTitle: document.querySelector("#modalTitle"),
  imageViewer: document.querySelector("#imageViewer"),
  closeViewerBtn: document.querySelector("#closeViewerBtn"),
  viewerImage: document.querySelector("#viewerImage"),
  viewerMeta: document.querySelector("#viewerMeta"),
  prevPhotoBtn: document.querySelector("#prevPhotoBtn"),
  nextPhotoBtn: document.querySelector("#nextPhotoBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  installBtn: document.querySelector("#installBtn"),
  offlineStatus: document.querySelector("#offlineStatus"),
  template: document.querySelector("#recordTemplate")
};

let dbPromise;
let installPrompt;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function transact(mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function getAllRecords() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result.map(normalizeRecord));
    request.onerror = () => reject(request.error);
  });
}

async function saveRecord(record) {
  await transact("readwrite", store => store.put(record));
}

async function deleteRecord(id) {
  await transact("readwrite", store => store.delete(id));
}

function normalizeRecord(record) {
  const legacyComment = typeof record.comments === "string" && record.comments.trim()
    ? [{ id: crypto.randomUUID(), text: record.comments.trim(), createdAt: record.updatedAt || new Date().toISOString() }]
    : [];

  return {
    ...record,
    comments: Array.isArray(record.comments) ? record.comments : legacyComment,
    photos: Array.isArray(record.photos) ? record.photos : []
  };
}

async function fileToPhoto(file) {
  const compressed = await compressImage(file);
  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ".jpg"),
    type: compressed.type,
    dataUrl: compressed.dataUrl,
    originalSize: file.size,
    storedSize: compressed.size,
    createdAt: new Date().toISOString()
  };
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, PHOTO_MAX_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        canvas.width = width;
        canvas.height = height;
        context.drawImage(image, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
        resolve({
          type: "image/jpeg",
          dataUrl,
          size: dataUrlSize(dataUrl),
          width,
          height
        });
      };
      image.onerror = () => reject(new Error("Не удалось обработать фото"));
      image.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function dataUrlSize(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.round(base64.length * 0.75);
}

async function handlePhotos(files) {
  const photos = await Promise.all(Array.from(files).map(fileToPhoto));
  state.photos = [...state.photos, ...photos];
  els.photos.value = "";
  renderPhotoPreview();
}

function addComment() {
  const text = els.commentInput.value.trim();
  if (!text) return;

  state.comments = [
    ...state.comments,
    { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }
  ];
  els.commentInput.value = "";
  renderCommentPreview();
}

function removeComment(id) {
  state.comments = state.comments.filter(comment => comment.id !== id);
  renderCommentPreview();
}

function removePhoto(id) {
  state.photos = state.photos.filter(photo => photo.id !== id);
  renderPhotoPreview();
}

function renderCommentPreview() {
  els.commentPreview.innerHTML = "";
  els.commentCount.textContent = String(state.comments.length);

  state.comments.forEach(comment => {
    els.commentPreview.append(createCommentElement(comment, true));
  });
}

function renderPhotoPreview() {
  els.photoPreview.innerHTML = "";
  state.photos.forEach(photo => {
    const item = document.createElement("div");
    item.className = "photo-item";

    const img = document.createElement("img");
    img.className = "photo-preview";
    img.src = photo.dataUrl;
    img.alt = photo.name || "Фото объекта";
    img.addEventListener("click", () => openImageViewer(state.photos, photo.id));

    const button = document.createElement("button");
    button.className = "photo-remove";
    button.type = "button";
    button.textContent = "×";
    button.title = "Удалить фото";
    button.addEventListener("click", () => removePhoto(photo.id));

    const size = document.createElement("span");
    size.className = "photo-size";
    size.textContent = formatBytes(photo.storedSize || dataUrlSize(photo.dataUrl));

    item.append(img, button, size);
    els.photoPreview.append(item);
  });
}

function createCommentElement(comment, editable = false) {
  const item = document.createElement("div");
  item.className = "comment-item";

  const row = document.createElement("div");
  row.className = "comment-row";

  const text = document.createElement("div");
  text.className = "comment-text";
  text.textContent = comment.text;

  row.append(text);

  if (editable) {
    const button = document.createElement("button");
    button.className = "danger comment-delete";
    button.type = "button";
    button.textContent = "Удалить";
    button.addEventListener("click", () => removeComment(comment.id));
    row.append(button);
  }

  const time = document.createElement("time");
  time.dateTime = comment.createdAt || "";
  time.textContent = formatDateTime(comment.createdAt);

  item.append(row, time);
  return item;
}

function recordFromForm() {
  return {
    id: els.recordId.value || crypto.randomUUID(),
    siteUrl: els.siteUrl.value.trim(),
    address: els.address.value.trim(),
    visited: els.visited.checked,
    visitDate: els.visitDate.value,
    comments: state.comments,
    photos: state.photos,
    updatedAt: new Date().toISOString()
  };
}

function resetForm() {
  els.form.reset();
  els.recordId.value = "";
  state.comments = [];
  state.photos = [];
  els.modalTitle.textContent = "Добавить дом";
  renderCommentPreview();
  renderPhotoPreview();
}

function openModal(mode = "add") {
  els.modalTitle.textContent = mode === "edit" ? "Изменить дом" : "Добавить дом";
  els.recordModal.classList.add("open");
  els.recordModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  window.setTimeout(() => els.address.focus(), 0);
}

function closeModal() {
  els.recordModal.classList.remove("open");
  els.recordModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openAddModal() {
  resetForm();
  openModal("add");
}

async function refresh() {
  state.records = (await getAllRecords()).sort((a, b) => {
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
  renderRecords();
}

function filteredRecords() {
  return state.records.filter(record => {
    if (state.filter === "visited" && !record.visited) return false;
    if (state.filter === "pending" && record.visited) return false;
    if (state.addressQuery && !record.address.toLowerCase().includes(state.addressQuery)) return false;
    if (state.dateQuery && record.visitDate !== state.dateQuery) return false;
    return true;
  });
}

function renderRecords() {
  const records = filteredRecords();
  els.recordsList.innerHTML = "";
  els.counter.textContent = records.length === state.records.length
    ? `${state.records.length} ${decline(state.records.length, "запись", "записи", "записей")}`
    : `${records.length} из ${state.records.length}`;

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.records.length ? "Ничего не найдено" : "Пока нет записей";
    els.recordsList.append(empty);
    return;
  }

  records.forEach(record => {
    const card = els.template.content.firstElementChild.cloneNode(true);
    const photos = card.querySelector(".record-photos");
    const title = card.querySelector("h3");
    const badge = card.querySelector(".badge");
    const meta = card.querySelector(".meta");
    const comments = card.querySelector(".record-comments");
    const link = card.querySelector(".site-link");

    title.textContent = record.address || "Без адреса";
    badge.textContent = record.visited ? "посещено" : "новое";
    badge.classList.toggle("done", record.visited);
    meta.textContent = [
      record.visitDate ? `Дата: ${record.visitDate}` : "Дата не указана",
      `${record.comments.length} ${decline(record.comments.length, "комментарий", "комментария", "комментариев")}`,
      `${record.photos.length} ${decline(record.photos.length, "фото", "фото", "фото")}`
    ].join(" · ");

    if (record.siteUrl) {
      link.href = record.siteUrl;
      link.textContent = record.siteUrl;
    } else {
      link.remove();
    }

    record.photos.forEach(photo => {
      const img = document.createElement("img");
      img.src = photo.dataUrl;
      img.alt = photo.name || "Фото объекта";
      img.addEventListener("click", () => openImageViewer(record.photos, photo.id));
      photos.append(img);
    });

    if (!record.photos.length) {
      photos.remove();
      card.style.gridTemplateColumns = "1fr";
    }

    if (record.comments.length) {
      record.comments.forEach(comment => comments.append(createCommentElement(comment)));
    } else {
      comments.remove();
    }

    card.querySelector(".edit").addEventListener("click", () => editRecord(record));
    card.querySelector(".share").addEventListener("click", () => shareRecord(record));
    card.querySelector(".delete").addEventListener("click", async () => {
      if (!confirm("Удалить запись?")) return;
      await deleteRecord(record.id);
      await refresh();
    });

    els.recordsList.append(card);
  });
}

function editRecord(record) {
  els.recordId.value = record.id;
  els.siteUrl.value = record.siteUrl || "";
  els.address.value = record.address || "";
  els.visited.checked = Boolean(record.visited);
  els.visitDate.value = record.visitDate || "";
  state.comments = [...record.comments];
  state.photos = [...record.photos];
  renderCommentPreview();
  renderPhotoPreview();
  openModal("edit");
}

function openImageViewer(photos, photoId) {
  if (!photos.length) return;
  state.viewerPhotos = photos;
  state.viewerIndex = Math.max(0, photos.findIndex(photo => photo.id === photoId));
  els.imageViewer.classList.add("open");
  els.imageViewer.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  renderImageViewer();
}

function closeImageViewer() {
  els.imageViewer.classList.remove("open");
  els.imageViewer.setAttribute("aria-hidden", "true");
  state.viewerPhotos = [];
  state.viewerIndex = 0;
  if (!els.recordModal.classList.contains("open")) {
    document.body.classList.remove("modal-open");
  }
}

function renderImageViewer() {
  const photo = state.viewerPhotos[state.viewerIndex];
  if (!photo) return;

  els.viewerImage.src = photo.dataUrl;
  els.viewerImage.alt = photo.name || "Фото объекта";
  els.viewerMeta.textContent = [
    `${state.viewerIndex + 1} из ${state.viewerPhotos.length}`,
    photo.name || "",
    formatBytes(photo.storedSize || dataUrlSize(photo.dataUrl))
  ].filter(Boolean).join(" · ");

  els.prevPhotoBtn.disabled = state.viewerIndex <= 0;
  els.nextPhotoBtn.disabled = state.viewerIndex >= state.viewerPhotos.length - 1;
}

function showPrevPhoto() {
  if (state.viewerIndex <= 0) return;
  state.viewerIndex -= 1;
  renderImageViewer();
}

function showNextPhoto() {
  if (state.viewerIndex >= state.viewerPhotos.length - 1) return;
  state.viewerIndex += 1;
  renderImageViewer();
}

async function shareRecord(record) {
  const text = buildShareText(record);
  const files = await photosToFiles(record.photos);

  if (navigator.canShare && files.length && navigator.canShare({ files })) {
    try {
      await navigator.share({ title: record.address || "Вариант дома", text, files });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: record.address || "Вариант дома", text, url: record.siteUrl || undefined });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  const url = record.siteUrl || "";
  const telegram = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  window.open(telegram, "_blank", "noopener,noreferrer");
}

function buildShareText(record) {
  const comments = record.comments.map(comment => `- ${comment.text}`).join("\n");
  return [
    record.address,
    record.visitDate ? `Дата: ${record.visitDate}` : "",
    record.visited ? "Посещено" : "Не посещено",
    comments ? `Комментарии:\n${comments}` : "",
    record.siteUrl
  ].filter(Boolean).join("\n");
}

async function photosToFiles(photos) {
  const files = [];
  for (const photo of photos) {
    const response = await fetch(photo.dataUrl);
    const blob = await response.blob();
    files.push(new File([blob], photo.name || "house.jpg", { type: photo.type || blob.type }));
  }
  return files;
}

function decline(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.records, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `houses-mappe-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function showStatus(message) {
  els.offlineStatus.textContent = message;
  els.offlineStatus.classList.add("show");
  window.setTimeout(() => els.offlineStatus.classList.remove("show"), 3600);
}

els.addRecordBtn.addEventListener("click", openAddModal);
els.clearBtn.addEventListener("click", resetForm);
els.closeModalBtn.addEventListener("click", closeModal);
els.closeViewerBtn.addEventListener("click", closeImageViewer);
els.prevPhotoBtn.addEventListener("click", showPrevPhoto);
els.nextPhotoBtn.addEventListener("click", showNextPhoto);
els.addCommentBtn.addEventListener("click", addComment);
els.photos.addEventListener("change", event => handlePhotos(event.target.files));
els.exportBtn.addEventListener("click", exportJson);

els.addressSearch.addEventListener("input", event => {
  state.addressQuery = event.target.value.trim().toLowerCase();
  renderRecords();
});

els.dateSearch.addEventListener("change", event => {
  state.dateQuery = event.target.value;
  renderRecords();
});

els.resetSearchBtn.addEventListener("click", () => {
  state.addressQuery = "";
  state.dateQuery = "";
  els.addressSearch.value = "";
  els.dateSearch.value = "";
  renderRecords();
});

els.recordModal.addEventListener("click", event => {
  if (event.target.hasAttribute("data-close-modal")) {
    closeModal();
  }
});

els.imageViewer.addEventListener("click", event => {
  if (event.target.hasAttribute("data-close-viewer")) {
    closeImageViewer();
  }
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && els.imageViewer.classList.contains("open")) {
    closeImageViewer();
    return;
  }
  if (event.key === "ArrowLeft" && els.imageViewer.classList.contains("open")) {
    showPrevPhoto();
    return;
  }
  if (event.key === "ArrowRight" && els.imageViewer.classList.contains("open")) {
    showNextPhoto();
    return;
  }
  if (event.key === "Escape" && els.recordModal.classList.contains("open")) {
    closeModal();
  }
});

els.commentInput.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    addComment();
  }
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  els.installBtn.hidden = false;
});

els.installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  els.installBtn.hidden = true;
});

els.form.addEventListener("submit", async event => {
  event.preventDefault();
  addComment();

  const record = recordFromForm();
  if (!record.siteUrl && !record.address && !record.comments.length && !record.photos.length) return;

  await saveRecord(record);
  resetForm();
  closeModal();
  await refresh();
});

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach(item => item.classList.toggle("active", item === button));
    renderRecords();
  });
});

renderCommentPreview();
renderPhotoPreview();
refresh();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js")
    .then(() => showStatus("Офлайн-кэш включен. После установки приложение будет работать без компьютера."))
    .catch(() => showStatus("Приложение работает, но офлайн-кэш не включился."));
} else if (location.protocol === "file:") {
  showStatus("Открыто как файл: сохранение работает, но установка PWA недоступна.");
}
